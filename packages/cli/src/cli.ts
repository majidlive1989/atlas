import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readConfig } from "@atlas/config";
import { z } from "zod";
import { packPlugin, verifyPlugin } from "./plugin-package.js";

type Environment = Readonly<Record<string, string | undefined>>;
const portOrigin = z.url({ protocol: /^https?$/ });
const slug = z
  .string()
  .regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/)
  .max(32);

const help = `atlas dev | build | start | doctor
atlas db migrate | rollback | seed
atlas user create <email> <display-name>
atlas plugin pack <release-directory> <archive.zip|archive.tgz> [--sign <private-key>]
atlas plugin verify <archive> [--key <public-key>]
atlas plugin command <slug> <command> [arguments...]
atlas plugin list
atlas plugin install | upgrade <slug> <version>
atlas plugin activate | deactivate | uninstall <slug>`;

function print(value: unknown) {
  process.stdout.write(JSON.stringify(value, null, 2) + "\n");
}

async function pnpm(args: string[]) {
  const bin = process.env.npm_execpath;
  return new Promise<number>((resolve, reject) => {
    const child = bin
      ? spawn(process.execPath, [bin, ...args], { stdio: "inherit" })
      : spawn("pnpm", args, { shell: process.platform === "win32", stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
}

async function useApi(
  env: Environment,
  path: string,
  method = "GET",
  body?: Record<string, string | readonly string[]>,
) {
  const base = portOrigin.parse(env.ATLAS_API_URL ?? "http://localhost:3000");
  const token = z.string().min(32).max(4096).parse(env.ATLAS_OPERATOR_TOKEN);
  const headers = new Headers({ authorization: "Bearer " + token });
  if (body) headers.set("content-type", "application/json");
  const response = await fetch(new URL(path, base), {
    method,
    headers,
    redirect: "error",
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status === 204) return;
  if (!response.ok) {
    const json: unknown = await response.json().catch(() => null);
    const issue = z.object({ code: z.string().regex(/^[a-z0-9-]+$/) }).safeParse(json);
    throw new Error(
      "Atlas API returned " + response.status + (issue.success ? " (" + issue.data.code + ")" : ""),
    );
  }
  print(await response.json());
}

export async function runCli(args: readonly string[], env: Environment): Promise<number> {
  const [group, action, subject, rest] = args;
  if (group === "--help" || group === "-h" || !group) {
    process.stdout.write(help + "\n");
    return 0;
  }
  if (args.length === 1 && group === "build") return pnpm(["build"]);
  if (args.length === 1 && (group === "dev" || group === "start")) {
    if (group === "dev") {
      const built = await pnpm(["exec", "turbo", "run", "build", "--filter=@atlas/api"]);
      return built === 0 ? pnpm(["exec", "node", "--watch", "apps/api/dist/main.js"]) : built;
    }
    const { startApi } = await import("@atlas/api");
    const server = await startApi(env);
    print({ address: server.address });
    await new Promise<void>((resolve, reject) => {
      function stop() {
        process.off("SIGTERM", stop);
        process.off("SIGINT", stop);
        server.kernel.drain();
        void server.app.close().then(resolve, reject);
      }
      process.on("SIGTERM", stop);
      process.on("SIGINT", stop);
    });
    return 0;
  }

  if (args.length === 1 && group === "doctor") {
    const { checkMigrations, openDatabase, resolveSite } = await import("@atlas/db");
    const config = readConfig(env);
    const database = openDatabase(config.DATABASE_URL);
    try {
      await checkMigrations(database);
      const site = await resolveSite(database, config.ATLAS_SITE_HOST);
      print({ database: "ready", migrations: "ready", site: site?.slug ?? null });
      return site ? 0 : 1;
    } catch {
      print({ database: "unavailable-or-unmigrated" });
      return 1;
    } finally {
      await database.close();
    }
  }

  if (
    group === "db" &&
    args.length === 2 &&
    (action === "migrate" || action === "rollback" || action === "seed")
  ) {
    const { migrate, openDatabase, seed } = await import("@atlas/db");
    const url = z.url({ protocol: /^postgres(?:ql)?$/ }).parse(env.DATABASE_URL);
    const database = openDatabase(url);
    try {
      if (action === "seed") {
        const { emailSchema, hashPassword, passwordSchema } = await import("@atlas/auth");
        const email = emailSchema.parse(env.ATLAS_SEED_EMAIL);
        const passwordHash = await hashPassword(passwordSchema.parse(env.ATLAS_SEED_PASSWORD));
        print(
          await seed(database, {
            email,
            passwordHash,
            hostname: env.ATLAS_SITE_HOST ?? "localhost",
            tenant: slug.parse(env.ATLAS_SEED_TENANT ?? "atlas"),
            site: slug.parse(env.ATLAS_SEED_SITE ?? "main"),
          }),
        );
      } else print({ migrations: await migrate(database, action === "migrate" ? "up" : "down") });
      return 0;
    } finally {
      await database.close();
    }
  }

  if (group === "user" && action === "create" && args.length === 4) {
    const { emailSchema, passwordSchema } = await import("@atlas/auth");
    const email = emailSchema.parse(subject);
    const displayName = z.string().trim().min(1).max(100).parse(rest);
    const password = passwordSchema.parse(env.ATLAS_USER_PASSWORD);
    if (env.ATLAS_OPERATOR_TOKEN) {
      await useApi(env, "/v1/users", "POST", { email, displayName, password });
    } else {
      const config = readConfig(env);
      const [{ createKernel }, { resolveSite }] = await Promise.all([
        import("@atlas/kernel"),
        import("@atlas/db"),
      ]);
      const kernel = createKernel(config);
      try {
        const site = await resolveSite(kernel.services.database, config.ATLAS_SITE_HOST);
        if (!site) throw new Error("The operator site does not exist.");
        print({
          id: await kernel.services.auth.createUser(
            { site, correlationId: randomUUID() },
            email,
            password,
            displayName,
          ),
        });
      } finally {
        await kernel.shutdown();
      }
    }
    return 0;
  }

  if (group === "plugin" && action) {
    if (
      action === "pack" &&
      subject &&
      rest &&
      (args.length === 4 || (args.length === 6 && args[4] === "--sign"))
    ) {
      print(await packPlugin(subject, rest, args[5]));
      return 0;
    }
    if (
      action === "verify" &&
      subject &&
      (args.length === 3 || (args.length === 5 && rest === "--key"))
    ) {
      print(await verifyPlugin(subject, args[4]));
      return 0;
    }
    if (action === "command" && subject && rest) {
      const command = z
        .string()
        .regex(/^[a-z][a-z0-9._-]{0,99}$/)
        .parse(rest);
      await useApi(env, "/v1/plugins/" + slug.parse(subject) + "/commands/" + command, "POST", {
        args: args.slice(4),
      });
      return 0;
    }
    if (action === "list" && args.length === 2) {
      await useApi(env, "/v1/plugins");
      return 0;
    }
    if ((action === "install" || action === "upgrade") && args.length === 4) {
      const version = z.string().min(1).max(64).parse(rest);
      await useApi(env, "/v1/plugins/" + slug.parse(subject) + "/" + action, "POST", { version });
      return 0;
    }
    if (
      (action === "activate" || action === "deactivate" || action === "uninstall") &&
      args.length === 3
    ) {
      await useApi(env, "/v1/plugins/" + slug.parse(subject) + "/" + action, "POST", {});
      return 0;
    }
  }

  process.stderr.write(help + "\n");
  return 2;
}
