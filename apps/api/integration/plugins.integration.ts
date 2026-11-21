import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { GenericContainer, Wait } from "testcontainers";
import { promisify } from "node:util";
import { hashPassword } from "@atlas/auth";
import { readConfig } from "@atlas/config";
import { seed, sql } from "@atlas/db";
import { startPluginPostgres } from "@atlas/plugin-testkit";
import { createKernel } from "@atlas/kernel";
import SwaggerParser from "@apidevtools/swagger-parser";
import { expect, it } from "vitest";
import { createApi } from "../src/index.js";

const run = promisify(execFile);
const repository = fileURLToPath(new URL("../../../", import.meta.url));
const cli = join(repository, "packages/cli/dist/main.js");
const email = "phase2@atlas.test";
const password = "example plugin operator password";
const sandboxImage = process.env.ATLAS_TEST_SANDBOX_IMAGE ?? "node:22-bookworm-slim";

function environment(databaseUrl: string, pluginRoot: string) {
  return {
    ...process.env,
    NODE_ENV: "test",
    DATABASE_URL: databaseUrl,
    ATLAS_AUTH_SECRET: Buffer.alloc(32, 31).toString("base64url"),
    ATLAS_SITE_HOST: "127.0.0.1",
    ATLAS_LOG_LEVEL: "silent",
    ATLAS_PLUGIN_ROOT: pluginRoot,
    ATLAS_TRUSTED_PLUGINS: "contact-form,related-posts",
  };
}

async function open(pluginRoot: string, extra: Record<string, string> = {}) {
  const postgres = await startPluginPostgres();
  const { database } = postgres;
  const env = { ...environment(postgres.url, pluginRoot), ...extra };
  const mail: { to: string; subject: string; text: string }[] = [];
  const kernel = createKernel(readConfig(env), {
    database,
    async pluginMail(message) {
      mail.push(message);
    },
  });
  const app = await createApi(kernel);
  async function close() {
    try {
      await app.close();
    } finally {
      await postgres.close();
    }
  }
  try {
    await seed(database, {
      email,
      passwordHash: await hashPassword(password),
      hostname: "127.0.0.1",
      tenant: "atlas",
      site: "main",
    });
    await kernel.boot();
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    const login = await fetch(address + "/v1/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    expect(login.status).toBe(200);
    const { accessToken } = (await login.json()) as { accessToken: string };
    const headers = { authorization: "Bearer " + accessToken, "content-type": "application/json" };
    const operator = { ...env, ATLAS_API_URL: address, ATLAS_OPERATOR_TOKEN: accessToken };
    return {
      close,
      database,
      mail,
      address,
      headers,
      async command(...args: string[]) {
        return run(process.execPath, [cli, "plugin", ...args], {
          env: operator,
          cwd: repository,
          timeout: 25_000,
        });
      },
    };
  } catch (error) {
    await close();
    throw error;
  }
}

it("installs and activates both example releases through the CLI and serves their API", async () => {
  const fixture = await open(join(repository, "examples/plugins"));
  try {
    const { address, headers } = fixture;
    await fixture.command("install", "contact-form", "1.0.0");
    await fixture.command("install", "related-posts", "1.0.0");
    await fixture.command("activate", "contact-form");
    await fixture.command("activate", "related-posts");

    const configuration = await fetch(address + "/v1/plugins/related-posts/settings", { headers });
    expect(configuration.status).toBe(200);
    expect(await configuration.json()).toMatchObject({
      settings: { limit: 5 },
      uiSchema: { properties: { limit: { type: "integer" } } },
    });
    const etag = configuration.headers.get("etag") ?? "";
    const update = (limit: number) =>
      fetch(address + "/v1/plugins/related-posts/settings", {
        method: "PUT",
        headers: { ...headers, "if-match": etag },
        body: JSON.stringify({ settings: { limit } }),
      });
    expect((await update(500)).status).toBe(400);
    expect((await update(1)).status).toBe(200);
    expect((await update(2)).status).toBe(412);

    const response = await fetch(address + "/v1/extensions/contact-form/submit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "sender@example.test", message: "Integration test" }),
    });
    expect(response.status, await response.clone().text()).toBe(200);
    const submission = (await response.json()) as { accepted: boolean; id: string };
    expect(submission.accepted).toBe(true);
    const loaded = await fixture.command(
      "command",
      "contact-form",
      "submission.get",
      submission.id,
    );
    expect(JSON.parse(loaded.stdout)).toMatchObject({
      result: { id: submission.id, email: "sender@example.test" },
    });
    expect(fixture.mail).toHaveLength(1);
    expect(
      await fixture.database.query(
        sql`select message from plg_contact_form__submissions where id = ${submission.id}`,
      ),
    ).toEqual([{ message: "Integration test" }]);

    const first = { id: "first", terms: ["topic"] };
    const ranked = await fetch(address + "/v1/extensions/related-posts/rank", {
      method: "POST",
      headers,
      body: JSON.stringify({
        post: { id: "source", terms: ["topic"] },
        candidates: [first, { id: "second", terms: ["topic"] }],
      }),
    });
    expect(ranked.status).toBe(200);
    expect(await ranked.json()).toEqual([first]);

    const openApi = await fetch(address + "/openapi.json");
    const document: unknown = await openApi.json();
    expect(document).toMatchObject({
      paths: { "/v1/extensions/contact-form/submit": { post: {} } },
    });
    await SwaggerParser.validate(document as Parameters<typeof SwaggerParser.validate>[0]);
    await fixture.command("deactivate", "contact-form");
    expect(
      (
        await fetch(address + "/v1/extensions/contact-form/submit", {
          method: "POST",
          headers,
          body: "{}",
        })
      ).status,
    ).toBe(404);
  } finally {
    await fixture.close();
  }
}, 120_000);

it("denies undeclared database access in a worker inside an OS sandbox", async () => {
  const root = await mkdtemp(join(tmpdir(), "atlas-plugin-boundary-"));
  const directory = join(root, "boundary-example");
  await mkdir(directory);
  const files = new Map([
    [
      "plugin.json",
      JSON.stringify({
        schemaVersion: 1,
        slug: "boundary-example",
        version: "1.0.0",
        engines: { atlas: "*" },
        tier: "untrusted",
        entries: { server: "server.mjs" },
        permissions: [],
      }),
    ],
    [
      "server.mjs",
      String.raw`
      import { existsSync, readdirSync } from "node:fs";
      const schema = (properties) => ({
        toJSONSchema: () => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false }),
        safeParseAsync: async (data) => ({ success: true, data }),
        parseAsync: async (data) => data,
      });
      export const plugin = {
        register(ctx) {
          ctx.routes.register({
            method: "GET", path: "/boundary", access: "public", input: schema({}),
            output: schema({ denied: { type: "boolean" }, noCredentials: { type: "boolean" }, isolated: { type: "boolean" } }),
            async handle() {
              let denied = false;
              try { await ctx.db.get("submissions", "87f35d55-b7e5-407e-95df-6c246dd0ebae"); }
              catch { denied = true; }
              return {
                denied, noCredentials: !process.env.ATLAS_AUTH_SECRET && !process.env.DATABASE_URL,
                isolated: process.getuid() === 65534 && !existsSync("/var/run/docker.sock") &&
                  readdirSync("/sys/class/net").every(name => name === "lo"),
              };
            },
          });
        },
      };
    `,
    ],
  ]);
  const hash = createHash("sha256");
  for (const [path, source] of files) {
    await writeFile(join(directory, path), source);
    hash.update(JSON.stringify([path, Buffer.byteLength(source)])).update(source);
  }
  try {
    const fixture = await open(root, {
      ATLAS_PLUGIN_SANDBOX_IMAGE: sandboxImage,
      ATLAS_PLUGIN_RELEASE_GRANTS: hash.digest("hex"),
    });
    try {
      await fixture.command("install", "boundary-example", "1.0.0");
      await fixture.command("activate", "boundary-example");
      const response = await fetch(fixture.address + "/v1/extensions/boundary-example/boundary");
      expect(response.status, await response.clone().text()).toBe(200);
      expect(await response.json()).toEqual({ denied: true, noCredentials: true, isolated: true });
    } finally {
      await fixture.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 120_000);

it("relays a queued plugin job and a PostgreSQL-backed cron schedule through BullMQ", async () => {
  const root = await mkdtemp(join(repository, "apps/api/node_modules/atlas-plugin-jobs-"));
  const directory = join(root, "job-example");
  await mkdir(directory);
  const redis = await new GenericContainer(process.env.ATLAS_TEST_REDIS_IMAGE ?? "redis:7.4-alpine")
    .withExposedPorts(6379)
    .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
    .start();
  try {
    await writeFile(
      join(directory, "plugin.json"),
      JSON.stringify({
        schemaVersion: 1,
        slug: "job-example",
        version: "1.0.0",
        engines: { atlas: "*" },
        tier: "trusted",
        entries: { server: "server.mjs" },
        permissions: [{ kind: "jobs" }, { kind: "cache" }],
      }),
    );
    await writeFile(
      join(directory, "server.mjs"),
      String.raw`
      import { z } from "zod";
      export const plugin = {
        register(ctx) {
          ctx.jobs.register("deliver", async value => {
            const name = z.enum(["queued", "scheduled"]).parse(value);
            const count = (await ctx.cache.get(name)) ?? 0;
            await ctx.cache.set(name, count + 1, 60);
          });
          ctx.routes.register({
            method: "POST", path: "/enqueue", access: "authenticated",
            input: z.strictObject({}), output: z.strictObject({ queued: z.boolean() }),
            async handle() {
              await ctx.jobs.enqueue({ name: "deliver", key: "same", payload: "queued" });
              await ctx.jobs.enqueue({ name: "deliver", key: "same", payload: "queued" });
              await ctx.jobs.cron({ name: "deliver", key: "cron", payload: "scheduled" }, "*/1 * * * * *", "UTC");
              return { queued: true };
            },
          });
          ctx.routes.register({
            method: "GET", path: "/counts", access: "authenticated",
            input: z.strictObject({}), output: z.strictObject({ queued: z.number(), scheduled: z.number() }),
            async handle() {
              return { queued: (await ctx.cache.get("queued")) ?? 0, scheduled: (await ctx.cache.get("scheduled")) ?? 0 };
            },
          });
        },
      };
    `,
    );
    const redisUrl = "redis://" + redis.getHost() + ":" + redis.getMappedPort(6379);
    const fixture = await open(root, {
      ATLAS_TRUSTED_PLUGINS: "job-example",
      ATLAS_PLUGIN_QUEUE_URL: redisUrl,
      ATLAS_PLUGIN_CACHE_URL: redisUrl,
    });
    try {
      await fixture.command("install", "job-example", "1.0.0");
      await fixture.command("activate", "job-example");
      const { address, headers } = fixture;
      const queued = await fetch(address + "/v1/extensions/job-example/enqueue", {
        method: "POST",
        headers,
        body: "{}",
      });
      expect(queued.status, await queued.clone().text()).toBe(200);
      await expect
        .poll(
          async () => {
            const response = await fetch(address + "/v1/extensions/job-example/counts", {
              headers,
            });
            return response.json();
          },
          { timeout: 15_000 },
        )
        .toMatchObject({ queued: 1, scheduled: expect.any(Number) });
      await expect
        .poll(
          async () => {
            const response = await fetch(address + "/v1/extensions/job-example/counts", {
              headers,
            });
            const counts = (await response.json()) as { scheduled: number };
            return counts.scheduled;
          },
          { timeout: 15_000 },
        )
        .toBeGreaterThan(0);
      expect(await fixture.database.query(sql`select name from job_schedules`)).toHaveLength(1);
      expect(
        await fixture.database.query(sql`select id from outbox_events
        where name = 'extension.pluginJobQueued' and dispatched_at is not null`),
      ).toHaveLength(2);
    } finally {
      await fixture.close();
    }
  } finally {
    try {
      await redis.stop();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
}, 120_000);
