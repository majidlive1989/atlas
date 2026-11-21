import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import SwaggerParser from "@apidevtools/swagger-parser";
import { createTotp, hashPassword, type AccountMail } from "@atlas/auth";
import { readConfig } from "@atlas/config";
import {
  checkMigrations,
  migrate,
  openDatabase,
  resolveSite,
  seed,
  sql,
  type Database,
} from "@atlas/db";
import { createKernel } from "@atlas/kernel";
import { type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApi, type AtlasApi } from "../src/index.js";
import { startPostgres } from "../test/postgres.js";

const run = promisify(execFile);
const root = new URL("../../../", import.meta.url);
const cliPath = fileURLToPath(new URL("packages/cli/dist/main.js", root));
const password = "integration password 123";
const email = "admin@atlas.test";
const now = new Date("2026-11-21T00:00:00.000Z");
const mail: AccountMail[] = [];
let db: Database;
let app: AtlasApi;
let container: StartedPostgreSqlContainer;
let environment: NodeJS.ProcessEnv;
let time = now.getTime();
let requestAddress = 1;

type Tokens = { accessToken: string; refreshToken: string; sessionId: string };
const login = (address = email, pass = password, code?: string) =>
  app.inject({
    method: "POST",
    url: "/v1/auth/login",
    remoteAddress: "192.0.2." + requestAddress++,
    payload: { email: address, password: pass, ...(code ? { code } : {}) },
  });
const bearer = (token: string) => ({ authorization: "Bearer " + token });
const refresh = (refreshToken: string) =>
  app.inject({ method: "POST", url: "/v1/auth/refresh", payload: { refreshToken } });

async function loginAdmin() {
  const response = await login();
  expect(response.statusCode, response.body).toBe(200);
  return response.json<Tokens>();
}

beforeAll(async () => {
  container = await startPostgres("atlas-integration");
  environment = {
    ...process.env,
    NODE_ENV: "test",
    DATABASE_URL: container.getConnectionUri(),
    ATLAS_AUTH_SECRET: Buffer.alloc(32, 29).toString("base64url"),
    ATLAS_LOG_LEVEL: "silent",
    ATLAS_SITE_HOST: "localhost",
    ATLAS_SEED_EMAIL: email,
    ATLAS_SEED_PASSWORD: password,
    ATLAS_PLUGIN_ROOT: fileURLToPath(new URL("plugins/", root)),
    ATLAS_TRUSTED_PLUGINS: "phase-one-example",
    ATLAS_ALLOWED_ORIGINS: "http://localhost:5173",
  };
  db = openDatabase(container.getConnectionUri());
  await run(process.execPath, [cliPath, "db", "migrate"], {
    env: environment,
    cwd: root,
    timeout: 30_000,
  });
  await run(process.execPath, [cliPath, "db", "seed"], {
    env: environment,
    cwd: root,
    timeout: 30_000,
  });
  const kernel = createKernel(readConfig(environment), {
    database: db,
    mail: {
      async send(message) {
        mail.push(message);
      },
    },
    clock: () => new Date(time),
  });
  app = await createApi(kernel);
  await kernel.boot();
});

afterAll(async () => {
  try {
    await app?.close();
  } finally {
    try {
      await db?.close();
    } finally {
      await container?.stop();
    }
  }
});

describe("Phase 1 PostgreSQL and HTTP integration", () => {
  it("checks migrations, rolls back and reapplies on a separate database", async () => {
    await checkMigrations(db);
    expect(await migrate(db)).toEqual([]);
    await db.query(sql`create database atlas_reversible`);
    const url = new URL(container.getConnectionUri());
    url.pathname = "/atlas_reversible";
    const isolated = openDatabase(url.href);
    try {
      expect(await migrate(isolated)).toEqual(["0001-foundation"]);
      expect(await migrate(isolated, "down")).toEqual(["0001-foundation"]);
      expect(
        await isolated.query<{ site: string | null }>(
          sql`select to_regclass('public.sites')::text as site`,
        ),
      ).toEqual([{ site: null }]);
      expect(await migrate(isolated)).toEqual(["0001-foundation"]);
    } finally {
      await isolated.close();
    }
  });

  it("serves liveness, readiness and validated OpenAPI 3.1 over a real HTTP listener", async () => {
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    const url = address.replace("127.0.0.1", "localhost");
    const response = await fetch(url + "/health/ready");
    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBeTruthy();
    expect((await fetch(url + "/health/live")).status).toBe(200);
    expect((await fetch(url + "/openapi.json")).status).toBe(200);
    expect((await fetch(url + "/docs/")).status).toBe(200);
    const document = await SwaggerParser.validate(app.swagger());
    expect(document).toHaveProperty("openapi", "3.1.0");
    const session = await fetch(url + "/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    expect(session.status).toBe(200);
    const doctor = await run(process.execPath, [cliPath, "doctor"], {
      env: environment,
      cwd: root,
    });
    expect(doctor.stdout).toContain('"database": "ready"');
    const token = ((await session.json()) as Tokens).accessToken;
    const list = await run(process.execPath, [cliPath, "plugin", "list"], {
      cwd: root,
      env: { ...environment, ATLAS_API_URL: url, ATLAS_OPERATOR_TOKEN: token },
    });
    expect(list.stdout).toContain("phase-one-example");
  });

  it("rotates refresh tokens and revokes the family if the first token is reused", async () => {
    const tokens = await loginAdmin();
    const first = await refresh(tokens.refreshToken);
    expect(first.statusCode, first.body).toBe(200);
    const rotated = first.json<Tokens>();
    expect(rotated.refreshToken).not.toBe(tokens.refreshToken);
    expect((await refresh(tokens.refreshToken)).statusCode).toBe(401);
    expect((await refresh(rotated.refreshToken)).statusCode).toBe(401);
    const response = await app.inject({ url: "/v1/options", headers: bearer(rotated.accessToken) });
    expect(response.statusCode).toBe(401);
    expect(response.headers["content-type"]).toContain("application/problem+json");
    const site = await resolveSite(db, "localhost");
    if (!site) throw new Error("Seeded site missing.");
    const facts = await db.scoped(site.id, (tx) =>
      tx.query(sql`select id from outbox_events
      where site_id = ${site.id} and name = 'identity.sessionRevoked' and payload->>'sessionId' = ${tokens.sessionId}`),
    );
    expect(facts).toHaveLength(1);
  });

  it("serializes simultaneous refreshes and rejects the replacement after replay", async () => {
    const tokens = await loginAdmin();
    const responses = await Promise.all([
      refresh(tokens.refreshToken),
      refresh(tokens.refreshToken),
    ]);
    expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 401]);
    const replacement = responses.find((response) => response.statusCode === 200);
    if (!replacement) throw new Error("Refresh rotation never succeeded.");
    expect((await refresh(replacement.json<Tokens>().refreshToken)).statusCode).toBe(401);
  });

  it("applies backoff and locks a real account after failed passwords", async () => {
    const user = "locked@atlas.test";
    await createAndVerify(user);
    for (let attempt = 0; attempt < 5; attempt++) {
      expect((await login(user, "incorrect password")).statusCode).toBe(401);
      if (attempt < 4) time += 1000;
    }
    expect((await login(user)).statusCode).toBe(401);
    time += 61_000;
    expect((await login(user)).statusCode).toBe(200);
  });

  it("enrolls TOTP, prevents counter replay and consumes a recovery code once", async () => {
    const user = "totp@atlas.test";
    await createAndVerify(user);
    const authenticated = await login(user);
    expect(authenticated.statusCode).toBe(200);
    const headers = bearer(authenticated.json<Tokens>().accessToken);
    const enrollment = await app.inject({
      method: "POST",
      url: "/v1/auth/totp/enroll",
      headers,
      payload: { password },
    });
    expect(enrollment.statusCode, enrollment.body).toBe(200);
    const totp = createTotp(enrollment.json<{ secret: string }>().secret, user);
    const confirm = await app.inject({
      method: "POST",
      url: "/v1/auth/totp/confirm",
      headers,
      payload: { code: totp.generate({ timestamp: time }) },
    });
    expect(confirm.statusCode, confirm.body).toBe(200);
    const code = confirm.json<{ recoveryCodes: [string, ...string[]] }>().recoveryCodes[0];
    expect((await login(user)).json<{ code: string }>().code).toBe("second-factor-required");
    time += 30_000;
    const oneTime = totp.generate({ timestamp: time });
    expect((await login(user, password, oneTime)).statusCode).toBe(200);
    expect((await login(user, password, oneTime)).statusCode).toBe(401);
    expect((await login(user, password, code)).statusCode).toBe(200);
    expect((await login(user, password, code)).statusCode).toBe(401);
  });

  it("requires an allowed browser origin and never includes a browser refresh token in JSON", async () => {
    const payload = { email, password, client: "browser" };
    const rejected = await app.inject({ method: "POST", url: "/v1/auth/login", payload });
    expect(rejected.statusCode).toBe(403);
    const allowed = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload,
      headers: { origin: "http://localhost:5173" },
    });
    expect(allowed.statusCode, allowed.body).toBe(200);
    expect(allowed.json()).not.toHaveProperty("refreshToken");
    expect(String(allowed.headers["set-cookie"])).toContain("HttpOnly");
    expect(String(allowed.headers["set-cookie"])).toContain("Secure");
  });

  it("enforces delegated role, API key, versioning and tenant scope", async () => {
    const user = "policy@atlas.test";
    const userId = await createAndVerify(user);
    const headers = bearer((await loginAdmin()).accessToken);
    const loginResponse = await login(user);
    expect(loginResponse.statusCode).toBe(200);
    const userHeaders = bearer(loginResponse.json<Tokens>().accessToken);
    expect((await app.inject({ url: "/v1/options", headers: userHeaders })).statusCode).toBe(403);
    const role = await app.inject({
      method: "PUT",
      url: "/v1/roles/settings-reader",
      headers,
      payload: { label: "Settings reader", capabilities: ["system.setting.read"] },
    });
    expect(role.statusCode, role.body).toBe(200);
    const assign = await app.inject({
      method: "PUT",
      url: "/v1/users/" + userId + "/roles/settings-reader",
      headers,
      payload: { assigned: true },
    });
    expect(assign.statusCode, assign.body).toBe(204);
    expect((await app.inject({ url: "/v1/options", headers: userHeaders })).statusCode).toBe(200);
    const write = (version: number) =>
      app.inject({
        method: "PUT",
        url: "/v1/options/site.title",
        headers: { ...headers, "if-match": '"' + version + '"' },
        payload: { value: "Atlas integration" },
      });
    expect((await write(0)).statusCode).toBe(200);
    expect((await write(0)).statusCode).toBe(412);
    const key = await app.inject({
      method: "POST",
      url: "/v1/auth/keys",
      headers,
      payload: { label: "Read only", scopes: ["system.setting.read"] },
    });
    expect(key.statusCode, key.body).toBe(201);
    const keyHeaders = bearer(key.json<{ key: string }>().key);
    expect((await app.inject({ url: "/v1/options", headers: keyHeaders })).statusCode).toBe(200);
    expect((await app.inject({ url: "/v1/roles", headers: keyHeaders })).statusCode).toBe(403);

    const secondSite = await seed(db, {
      hostname: "other.atlas.test",
      tenant: "other",
      site: "other",
      email: "other@atlas.test",
      passwordHash: await hashPassword(password),
    });
    expect(
      (await app.inject({ url: "/v1/options", headers: { ...headers, host: "other.atlas.test" } }))
        .statusCode,
    ).toBe(401);
    await db.scoped(secondSite.id, (tx) =>
      tx.query(sql`insert into site_settings (site_id, key, value)
      values (${secondSite.id}, 'site.title', '"Other"'::jsonb)`),
    );
    await db.query(sql`create role atlas_rls_test`);
    await db.query(sql`grant select on site_settings to atlas_rls_test`);
    const site = await resolveSite(db, "localhost");
    if (!site) throw new Error("Seeded site missing.");
    const visible = await db.scoped(site.id, async (tx) => {
      await tx.query(sql`set local role atlas_rls_test`);
      return tx.query<{ site_id: string }>(sql`select site_id from site_settings`);
    });
    expect(visible).toEqual([{ site_id: site.id }]);
  });

  it("revokes sessions on a single-use password reset", async () => {
    const user = "reset@atlas.test";
    await createAndVerify(user);
    const session = await login(user);
    expect(session.statusCode).toBe(200);
    const tokens = session.json<Tokens>();
    const requested = await app.inject({
      method: "POST",
      url: "/v1/auth/reset/request",
      payload: { email: user },
    });
    expect(requested.statusCode).toBe(202);
    const mailItem = mail.findLast((item) => item.to === user && item.kind === "reset");
    if (!mailItem) throw new Error("Reset mail was not recorded.");
    const payload = { token: mailItem.token, password: "new integration password 123" };
    expect(
      (await app.inject({ method: "POST", url: "/v1/auth/reset/confirm", payload })).statusCode,
    ).toBe(204);
    expect(
      (await app.inject({ method: "POST", url: "/v1/auth/reset/confirm", payload })).statusCode,
    ).toBe(400);
    expect((await refresh(tokens.refreshToken)).statusCode).toBe(401);
    expect((await login(user, payload.password)).statusCode).toBe(200);
  });

  it("lets the email recipient choose the password for opt-in self-registration", async () => {
    const email = "registration@atlas.test";
    const register = () =>
      app.inject({
        method: "POST",
        url: "/v1/auth/register",
        payload: { email, displayName: "Registration test" },
      });
    expect((await register()).statusCode).toBe(403);
    const headers = bearer((await loginAdmin()).accessToken);
    expect(
      (
        await app.inject({
          method: "PUT",
          url: "/v1/options/site.registration",
          headers: { ...headers, "if-match": '"0"' },
          payload: { value: true },
        })
      ).statusCode,
    ).toBe(200);
    expect((await register()).statusCode).toBe(202);
    expect((await register()).statusCode).toBe(202);
    const challenge = mail.find((item) => item.kind === "verify" && item.to === email);
    if (!challenge) throw new Error("Registration did not issue a verification challenge.");
    expect((await login(email)).statusCode).toBe(401);
    const confirmation = await app.inject({
      method: "POST",
      url: "/v1/auth/verify/confirm",
      payload: { token: challenge.token, password },
    });
    expect(confirmation.statusCode, confirmation.body).toBe(204);
    expect((await login(email)).statusCode).toBe(200);
  });

  it("installs, activates, upgrades and uninstalls, preserving the live release after failed DDL or boot", async () => {
    const headers = bearer((await loginAdmin()).accessToken);
    const action = (operation: string, version?: string) =>
      app.inject({
        method: "POST",
        url: "/v1/plugins/phase-one-example/" + operation,
        headers,
        payload: version ? { version } : {},
      });
    const install = await action("install", "1.0.0");
    expect(install.statusCode, install.body).toBe(204);
    const activated = await action("activate");
    expect(activated.statusCode, activated.body).toBe(204);
    const upgraded = await action("upgrade", "1.1.0");
    expect(upgraded.statusCode, upgraded.body).toBe(204);
    expect((await action("upgrade", "1.2.0")).statusCode).toBe(409);
    expect((await action("upgrade", "1.3.0")).statusCode).toBe(409);
    const list = (await app.inject({ url: "/v1/plugins", headers })).json<{
      installed: { state: string; version: string }[];
    }>();
    expect(list.installed).toEqual([
      expect.objectContaining({ state: "active", version: "1.1.0" }),
    ]);
    const state = await db.query<{
      column_name: string;
    }>(sql`select column_name from information_schema.columns
      where table_name = 'plg_phase_one_example__inventory' and column_name in ('label', 'transient')`);
    expect(state).toEqual([{ column_name: "label" }]);
    const ledger = await db.query<{ version: number }>(sql`select version from plugin_migrations
      where slug = 'phase-one-example' order by version`);
    expect(ledger.map((row) => row.version)).toEqual([1, 2]);
    expect((await action("deactivate")).statusCode).toBe(204);
    expect((await action("uninstall")).statusCode).toBe(204);
    expect(
      (await db.query(sql`select to_regclass('plg_phase_one_example__inventory') as retained`))[0],
    ).toEqual({ retained: "plg_phase_one_example__inventory" });
    expect((await action("install", "1.3.0")).statusCode).toBe(204);
    expect((await action("activate")).statusCode).toBe(409);
    expect((await app.inject({ url: "/health/ready" })).statusCode).toBe(200);
    const fault = (await app.inject({ url: "/v1/plugins", headers })).json<{
      installed: { state: string }[];
    }>();
    expect(fault.installed[0]?.state).toBe("faulted");
  });
});

async function createAndVerify(address: string): Promise<string> {
  const headers = bearer((await loginAdmin()).accessToken);
  const create = await app.inject({
    method: "POST",
    url: "/v1/users",
    headers,
    payload: { email: address, password, displayName: randomUUID() },
  });
  expect(create.statusCode, create.body).toBe(201);
  const item = mail.findLast((message) => message.to === address && message.kind === "verify");
  if (!item) throw new Error("Verification mail was not recorded.");
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/v1/auth/verify/confirm",
        payload: { token: item.token },
      })
    ).statusCode,
  ).toBe(204);
  return create.json<{ id: string }>().id;
}
