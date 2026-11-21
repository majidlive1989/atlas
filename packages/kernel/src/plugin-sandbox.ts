import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { posix, join } from "node:path";
import { z } from "zod";
import type { PluginContext, PluginDefinition } from "@atlas/plugin-sdk";
import type { Release } from "./plugin-catalog.js";

const lineLimit = 1024 * 1024;
const bootstrap = String.raw`
const { Worker } = require("node:worker_threads");
const { createInterface } = require("node:readline");
const fs = require("node:fs");
const readline = createInterface({ input: process.stdin, crlfDelay: Infinity });
let worker;
function send(message) { process.stdout.write(JSON.stringify(message) + "\n"); }
function initialize(data) {
  const status = fs.readFileSync("/proc/self/status", "utf8");
  const limits = ["/sys/fs/cgroup/memory.max", "/sys/fs/cgroup/memory/memory.limit_in_bytes"];
  const memory = limits.filter(file => fs.existsSync(file)).map(file => Number(fs.readFileSync(file, "utf8")));
  if (process.getuid() !== 65534 || !/^NoNewPrivs:\s+1$/m.test(status) ||
      !/^CapEff:\s+0+$/m.test(status) || !memory.some(limit => limit > 0 && limit <= 192 * 1024 * 1024) ||
      fs.readdirSync("/sys/class/net").some(name => name !== "lo"))
    throw Error("Sandbox restrictions are unavailable.");
  try {
    fs.writeFileSync("/atlas-sandbox-probe", "", { flag: "wx" });
    throw Error("Sandbox root is writable.");
  } catch (error) {
    if (error.code !== "EROFS") throw error;
  }
  const root = fs.mkdtempSync("/tmp/atlas-");
  for (const [key, content] of Object.entries(data.files)) {
    if (!key.split("/").every(segment => /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(segment)))
      throw Error("Invalid release path.");
    const file = root + "/" + key;
    fs.mkdirSync(require("node:path").dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from(content, "base64"), { flag: "wx" });
  }
  if (!fs.existsSync(root + "/package.json")) fs.writeFileSync(root + "/package.json", '{"type":"module"}');
  worker = new Worker("(" + workerMain.toString() + ")()", {
    eval: true, env: {}, workerData: { file: root + "/" + data.entry, siteId: data.siteId, slug: data.slug },
    resourceLimits: { maxOldGenerationSizeMb: 64, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 },
    stdout: true, stderr: true
  });
  worker.stdout.resume(); worker.stderr.resume();
  worker.on("message", send);
  worker.on("error", () => process.exit(1));
  worker.on("exit", () => process.exit(1));
}
readline.on("line", line => {
  const data = JSON.parse(line);
  if (!worker) initialize(data);
  else worker.postMessage(data);
});
readline.on("close", () => process.exit(0));

function workerMain() {
  const { parentPort, workerData } = require("node:worker_threads");
  const callbacks = new Map(), waiters = new Map(), cleanups = [];
  const catalogs = new Map();
  let next = 0;
  const send = message => parentPort.postMessage(message);
  const remote = (operation, ...args) => new Promise((resolve, reject) => {
    const id = ++next;
    waiters.set(id, { resolve, reject });
    send({ type: "rpc", id, operation, args });
  });
  const stage = (promise) => {
    void promise.catch(() => {});
    registration.push(promise);
    return promise;
  };
  const register = (operation, args, handler) => {
    const id = ++next;
    callbacks.set(id, handler);
    stage(remote(operation, ...args, id));
  };
  const registration = [];
  const ctx = {
    siteId: workerData.siteId, slug: workerData.slug,
    db: { insert: (...args) => remote("insert", ...args), get: (...args) => remote("get", ...args) },
    routes: { register(route) {
      register("route", [route.method, route.path, route.access,
        route.input.toJSONSchema({ io: "input" }), route.output.toJSONSchema()],
        async value => {
          const input = await route.input.safeParseAsync(value);
          if (!input.success) return { valid: false };
          return { valid: true, value: await route.output.parseAsync(await route.handle(input.data)) };
        });
    } },
    hooks: {
      actions: { register(action, handler, options) {
        register("action", [action.name, options ?? {}], input => handler(action.input.parse(input)));
      }, run: (action, value) => remote("actionRun", action.name, action.input.parse(value)) },
      filters: { register(filter, handler, options) {
        register("filter", [filter.name, options ?? {}],
          async (value, input) => filter.value.parse(await handler(filter.value.parse(value), filter.input.parse(input))));
      }, async apply(filter, value, input, failure) {
        return filter.value.parse(await remote("filterRun", filter.name, filter.value.parse(value), filter.input.parse(input), failure ?? "closed"));
      } }
    },
    events: { subscribe(name, handler) { register("event", [name], handler); } },
    services: {
      provide(service, handler) {
        register("provide", [service.name, service.input.toJSONSchema({ io: "input" }), service.output.toJSONSchema()],
          async value => service.output.parse(await handler(service.input.parse(value))));
      },
      async call(plugin, service, value) {
        return service.output.parse(await remote("service", plugin, service.name,
          service.input.toJSONSchema({ io: "input" }), service.output.toJSONSchema(), service.input.parse(value)));
      }
    },
    registry: Object.fromEntries(["postTypes", "taxonomies", "customFields", "blocks", "shortcodes", "emailTemplates",
      "notifications", "adminMenu", "capabilities", "roles"].map(kind => [kind, { register(definition) {
        stage(remote("declaration", kind, {
          key: definition.key, label: definition.label, options: definition.options,
          schema: definition.schema?.toJSONSchema()
        }));
      } }])),
    cli: { register(name, handler) { register("cli", [name], handler); } },
    jobs: {
      register(name, handler) { register("job", [name], handler); },
      enqueue: job => remote("enqueue", job),
      cron: (job, pattern, timezone) => remote("cron", job, pattern, timezone),
    },
    settings: { define(definition) {
      const uiSchema = definition.schema.toJSONSchema({ io: "input" });
      const ready = stage(remote("settingsDefine", uiSchema, definition.schema.parse(definition.initial)));
      return {
        uiSchema,
        async get() { await ready; return definition.schema.parse(await remote("settingsGet")); },
        async set(value) { await ready; await remote("settingsSet", definition.schema.parse(value)); },
      };
    } },
    i18n: {
      register(locale, messages) { catalogs.set(Intl.getCanonicalLocales(locale)[0], messages); },
      message(locale, key) {
        for (const language of [locale, locale.split("-")[0], "en"]) {
          const messages = catalogs.get(language);
          if (messages && Object.hasOwn(messages, key)) return messages[key];
        }
        return key;
      }
    },
    storage: {
      async read(key) { return Uint8Array.from(await remote("read", key)); },
      write: (key, contents) => remote("write", key, Array.from(contents))
    },
    mail: { send: value => remote("mail", value) },
    logger: { info: value => void remote("log", value).catch(() => {}), warn: value => void remote("log", value).catch(() => {}) },
    cache: { get: key => remote("cacheGet", key), set: (...args) => remote("cacheSet", ...args) },
    http: { get: url => remote("http", url) },
    onDispose(cleanup) { cleanups.push(cleanup); }
  };
  parentPort.on("message", async msg => {
    if (msg.type === "rpcResult") {
      const waiter = waiters.get(msg.id);
      if (waiter) {
        waiters.delete(msg.id);
        if (msg.ok) waiter.resolve(msg.value);
        else waiter.reject(Error("Host operation denied."));
      }
      return;
    }
    try {
      let value;
      if (msg.type === "start") {
        const module = await import(require("node:url").pathToFileURL(workerData.file).href);
        const definition = module.plugin ?? module;
        if (definition.onUpgrade) throw Error("Upgrade callbacks require the trusted tier.");
        await definition.register(ctx);
        await definition.boot?.(ctx);
        await Promise.all(registration);
      } else if (msg.type === "callback") {
        value = await callbacks.get(msg.callback)(...msg.args);
      } else if (msg.type === "dispose") {
        for (const cleanup of cleanups.reverse()) await cleanup();
      }
      send({ type: "result", id: msg.id, ok: true, value });
    } catch {
      send({ type: "result", id: msg.id, ok: false });
    }
  });
}
`;

const messageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("rpc"),
    id: z.number().int().positive(),
    operation: z.string(),
    args: z.array(z.unknown()).max(8),
  }),
  z.object({
    type: z.literal("result"),
    id: z.number().int().positive(),
    ok: z.boolean(),
    value: z.unknown().optional(),
  }),
]);

async function collect(release: Release) {
  const files: Record<string, string> = Object.create(null);
  const hash = createHash("sha256");
  let count = 0;
  let bytes = 0;
  async function visit(relative: string) {
    const entries = await readdir(join(release.root, relative), { withFileTypes: true });
    for (const item of entries.sort((a, b) => (a.name < b.name ? -1 : a.name === b.name ? 0 : 1))) {
      if (item.name === "node_modules" || item.name === ".git" || item.name === ".turbo") continue;
      const key = posix.join(relative, item.name);
      if (item.isDirectory()) {
        await visit(key);
        continue;
      }
      if (!item.isFile()) throw new Error("Invalid sandbox release entry.");
      const data = await readFile(join(release.root, key));
      if (++count > 2048 || (bytes += data.length) > 32 * 1024 * 1024)
        throw new Error("Sandbox release exceeds limits.");
      hash.update(JSON.stringify([key, data.length])).update(data);
      if (key.split("/").every((segment) => /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(segment)))
        files[key] = data.toString("base64");
    }
  }
  await visit("");
  if (hash.digest("hex") !== release.digest)
    throw new Error("Sandbox release changed after verification.");
  return files;
}

type SandboxDispatch = (
  operation: string,
  args: unknown[],
  invoke: (id: number, ...args: unknown[]) => Promise<unknown>,
) => Promise<unknown>;

export async function sandboxPlugin(
  image: string,
  release: Release,
  dispatch: SandboxDispatch,
): Promise<PluginDefinition> {
  const files = await collect(release);
  const name = "atlas-plugin-" + randomUUID();
  const child = spawn(
    "docker",
    [
      "run",
      "--pull=never",
      "--rm",
      "--name",
      name,
      "-i",
      "--network=none",
      "--read-only",
      "--cap-drop=ALL",
      "--security-opt=no-new-privileges:true",
      "--pids-limit=48",
      "--memory=192m",
      "--memory-swap=192m",
      "--cpus=0.5",
      "--user=65534:65534",
      "--tmpfs=/tmp:rw,noexec,nosuid,nodev,size=48m",
      "--entrypoint=node",
      image,
      "-e",
      bootstrap,
    ],
    { stdio: ["pipe", "pipe", "ignore"], windowsHide: true },
  );
  const waiting = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  let next = 0;
  let pending = 0;
  let closed = false;
  let buffer = "";

  function stop() {
    if (closed) return;
    closed = true;
    for (const request of waiting.values()) request.reject(new Error("Sandbox closed."));
    waiting.clear();
    child.stdin.destroy();
    if (child.exitCode === null) {
      const cleanup = spawn("docker", ["rm", "-f", name], { stdio: "ignore", windowsHide: true });
      cleanup.on("error", () => child.kill());
      cleanup.on("exit", () => child.kill());
      cleanup.unref();
    }
  }
  child.once("error", stop);
  child.once("exit", stop);
  child.stdin.on("error", stop);
  function send(message: object, limit = lineLimit) {
    if (closed) throw new Error("Sandbox is closed.");
    const line = JSON.stringify(message);
    if (Buffer.byteLength(line) > limit) throw new Error("Sandbox message exceeds limit.");
    child.stdin.write(line + "\n");
  }
  async function request(type: string, payload: object = {}, timeout = 5000) {
    if (waiting.size >= 32) throw new Error("Sandbox is busy.");
    const id = ++next;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await new Promise<unknown>((resolve, reject) => {
        waiting.set(id, { resolve, reject });
        timer = setTimeout(stop, timeout);
        send({ type, id, ...payload });
      });
    } finally {
      clearTimeout(timer);
      waiting.delete(id);
    }
  }
  const invoke = (id: number, ...args: unknown[]) => request("callback", { callback: id, args });

  async function handle(line: string) {
    const response = messageSchema.parse(JSON.parse(line));
    if (response.type === "result") {
      const waiter = waiting.get(response.id);
      if (response.ok) waiter?.resolve(response.value);
      else waiter?.reject(new Error("Sandbox operation failed."));
      return;
    }
    if (++pending > 32) {
      stop();
      return;
    }
    try {
      const value = await dispatch(response.operation, response.args, invoke);
      send({ type: "rpcResult", id: response.id, ok: true, value });
    } catch {
      if (!closed) send({ type: "rpcResult", id: response.id, ok: false });
    } finally {
      pending -= 1;
    }
  }
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    buffer += chunk;
    if (Buffer.byteLength(buffer) > lineLimit) {
      stop();
      return;
    }
    let newline = buffer.indexOf("\n");
    while (newline >= 0 && !closed) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      void handle(line).catch(stop);
      newline = buffer.indexOf("\n");
    }
  });
  return {
    async register(context: PluginContext) {
      context.onDispose(async () => {
        try {
          if (!closed) await request("dispose", {}, 1000);
        } finally {
          stop();
        }
      });
      try {
        send(
          {
            files,
            entry: release.manifest.entries.server,
            siteId: context.siteId,
            slug: context.slug,
          },
          45 * 1024 * 1024,
        );
        await request("start", {}, 30_000);
      } catch (error) {
        stop();
        throw error;
      }
    },
  };
}
