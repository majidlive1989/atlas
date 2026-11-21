import { createHooks } from "@atlas/hooks";
import { z } from "zod";
import type {
  DeclarationKind,
  PluginContext,
  PluginDeclaration,
  PluginRoute,
  PluginValue,
} from "@atlas/plugin-sdk";
import { AtlasProblem } from "./problem.js";
import { getPluginHttp, nameSchema, pluginDatabase, valueSchema } from "./plugin-adapters.js";
import type { PluginResources } from "./plugin-resources.js";
import type { Release } from "./plugin-catalog.js";
import type { Database } from "@atlas/db";

const methods = z.enum(["GET", "POST", "PUT", "DELETE"]);
const pathSchema = z
  .string()
  .max(180)
  .regex(/^\/[a-z0-9][a-z0-9_-]*(?:\/[a-z0-9][a-z0-9_-]*)*$/);
const access = z.union([
  z.literal("public"),
  z.literal("authenticated"),
  z.strictObject({ capability: nameSchema }),
]);
const storageKey = z
  .string()
  .max(240)
  .regex(/^[a-zA-Z0-9][\w.-]*(?:\/[a-zA-Z0-9][\w.-]*)*$/);
const declarations = [
  "postTypes",
  "taxonomies",
  "customFields",
  "blocks",
  "shortcodes",
  "emailTemplates",
  "notifications",
  "adminMenu",
  "capabilities",
  "roles",
] as const satisfies readonly DeclarationKind[];

export interface RegisteredRoute {
  method: PluginRoute<z.ZodType, z.ZodType>["method"];
  path: string;
  access: PluginRoute<z.ZodType, z.ZodType>["access"];
  input: Readonly<Record<string, unknown>>;
  output: Readonly<Record<string, unknown>>;
  handle(value: unknown): Promise<unknown>;
}

export function createRegistrations(
  database: Database,
  resources: PluginResources,
  fault: (slug: string, action: string) => void,
) {
  const hooks = createHooks<
    Record<string, { input: unknown }>,
    Record<string, { value: unknown; context: { input: unknown } }>
  >((name, owner) => fault(owner.owner, name));
  const running = new Map<string, ReturnType<typeof prepare>>();
  const id = (site: string, slug: string) => site + ":" + slug;

  function prepare(options: {
    siteId: string;
    release: Release;
    owner: string;
    initial: PluginValue | undefined;
    getSettings(): Promise<PluginValue | undefined>;
    setSettings(value: PluginValue): Promise<void>;
    subscribe: PluginContext["events"]["subscribe"];
  }) {
    const { siteId, release, owner } = options;
    const { slug, permissions, version } = release.manifest;
    const scope = id(siteId, slug);
    const adapters = resources.scope(siteId, slug, version);
    const routes = new Map<string, RegisteredRoute>();
    const registryData = new Map<string, object>();
    const services = new Map<string, (value: unknown) => Promise<unknown>>();
    const catalogs = new Map<string, Readonly<Record<string, string>>>();
    const commands = new Map<
      string,
      (args: readonly string[]) => PluginValue | Promise<PluginValue>
    >();
    const jobNames = new Set<string>();
    const pending: (() => (() => void) | undefined)[] = [];
    const cleanups: (() => void | Promise<void>)[] = [];
    let state: "staging" | "running" | "disposed" = "staging";
    let settings:
      | {
          parse(value: unknown): PluginValue;
          read(value: unknown): PluginValue;
          uiSchema: Readonly<Record<string, unknown>>;
        }
      | undefined;

    function register() {
      if (state !== "staging") throw new Error("Registration is closed.");
    }
    function active() {
      if (state !== "running") throw new Error("Plugin is inactive.");
    }
    function allow(kind: "mail" | "jobs" | "cache") {
      active();
      if (!permissions.some((entry) => entry.kind === kind))
        throw new Error("Plugin permission denied.");
    }
    function hook(name: string) {
      const key = nameSchema.parse(name);
      if (!permissions.some((entry) => entry.kind === "hooks" && entry.names.includes(key)))
        throw new Error("Hook permission denied.");
      return siteId + ":" + key;
    }
    function key(input: string) {
      active();
      const key = storageKey.parse(input);
      if (
        !permissions.some(
          (entry) =>
            entry.kind === "storage" &&
            entry.prefixes.some((prefix) => key === prefix || key.startsWith(prefix + "/")),
        )
      )
        throw new Error("Storage permission denied.");
      return key;
    }
    function stage(mount: () => (() => void) | undefined) {
      register();
      if (pending.length >= 128) throw new Error("Too many plugin subscriptions.");
      pending.push(mount);
    }
    const hookOptions = z.strictObject({
      priority: z.number().optional(),
      once: z.boolean().optional(),
    });
    function handlerOptions(input: unknown) {
      const { priority, once } = hookOptions.parse(input ?? {});
      return {
        owner,
        ...(priority === undefined ? {} : { priority }),
        ...(once === undefined ? {} : { once }),
      };
    }
    const put = <Value>(map: Map<string, Value>, key: string, value: Value) => {
      register();
      if (map.size >= 128 || map.has(key))
        throw new Error("Duplicate or excessive plugin registration.");
      map.set(key, value);
    };
    const db = pluginDatabase(release, siteId, (work) => {
      active();
      return database.scoped(siteId, work);
    });
    const context: PluginContext = {
      siteId,
      slug,
      routes: {
        register(route) {
          const method = methods.parse(route.method);
          const path = pathSchema.parse(route.path);
          put(routes, method + " " + path, {
            method,
            path,
            access: access.parse(route.access),
            input: z.toJSONSchema(route.input, {
              io: "input",
              target: "draft-2020-12",
              cycles: "throw",
            }),
            output: z.toJSONSchema(route.output, { target: "draft-2020-12", cycles: "throw" }),
            async handle(value) {
              active();
              const input = await route.input.safeParseAsync(value);
              if (!input.success) throw new AtlasProblem(400, "invalid-request");
              const result = await route.output.safeParseAsync(await route.handle(input.data));
              if (!result.success) throw new Error("Plugin returned an invalid response.");
              return result.data;
            },
          });
        },
      },
      hooks: {
        actions: {
          register(action, handler, options) {
            register();
            const name = hook(action.name);
            const registration = handlerOptions(options);
            stage(
              () =>
                hooks.actions.register(
                  name,
                  (input) => handler(action.input.parse(input.input)),
                  registration,
                ).dispose,
            );
          },
          run(action, input) {
            active();
            return hooks.actions.run(
              hook(action.name),
              { input: action.input.parse(input) },
              { failure: "closed" },
            );
          },
        },
        filters: {
          register(filter, handler, options) {
            register();
            const name = hook(filter.name);
            const registration = handlerOptions(options);
            stage(
              () =>
                hooks.filters.register(
                  name,
                  async (value, input) =>
                    filter.value.parse(
                      await handler(filter.value.parse(value), filter.input.parse(input.input)),
                    ),
                  registration,
                ).dispose,
            );
          },
          async apply(filter, value, input, failure = "closed") {
            active();
            const result = await hooks.filters.run(
              hook(filter.name),
              value as unknown,
              { input: filter.input.parse(input) },
              (value) => filter.value.parse(value),
              { failure },
            );
            return filter.value.parse(result);
          },
        },
      },
      events: { subscribe: options.subscribe },
      services: {
        provide(service, handler) {
          put(services, nameSchema.parse(service.name), async (value) =>
            service.output.parse(await handler(service.input.parse(value))),
          );
        },
        async call(plugin, service, value) {
          active();
          if (!Object.hasOwn(release.manifest.requires ?? {}, plugin))
            throw new Error("Service permission denied.");
          const handler = running.get(id(siteId, plugin))?.services.get(service.name);
          if (!handler) throw new Error("Plugin service is unavailable.");
          return service.output.parse(await handler(service.input.parse(value)));
        },
      },
      db,
      settings: {
        define(definition) {
          register();
          if (settings) throw new Error("Settings already registered.");
          const initial = definition.schema.parse(definition.initial);
          const parse = (input: unknown) => definition.schema.parse(input);
          const current = (input: unknown) => (input === undefined ? initial : parse(input));
          const uiSchema = z.toJSONSchema(definition.schema, { io: "input" });
          settings = {
            parse: (input) => valueSchema.parse(parse(input)),
            read: (input) => valueSchema.parse(current(input)),
            uiSchema,
          };
          settings.read(options.initial);
          return {
            uiSchema,
            async get() {
              if (state === "disposed") active();
              return current(state === "staging" ? options.initial : await options.getSettings());
            },
            async set(value) {
              active();
              await options.setSettings(valueSchema.parse(parse(value)));
            },
          };
        },
      },
      registry: Object.fromEntries(
        declarations.map((kind) => [
          kind,
          {
            register(declaration: PluginDeclaration) {
              const key = nameSchema.parse(declaration.key);
              const label = nameSchema.parse(declaration.label);
              put(registryData, kind + ":" + key, {
                kind,
                key,
                label,
                ...(declaration.schema ? { schema: z.toJSONSchema(declaration.schema) } : {}),
                ...(declaration.options ? { options: valueSchema.parse(declaration.options) } : {}),
              });
            },
          },
        ]),
      ) as PluginContext["registry"],
      cli: {
        register(command, handler) {
          put(commands, nameSchema.parse(command), handler);
        },
      },
      jobs: {
        register(name, handler) {
          register();
          nameSchema.parse(name);
          if (jobNames.has(name) || !permissions.some((entry) => entry.kind === "jobs"))
            throw new Error("Job permission denied or duplicate.");
          jobNames.add(name);
          stage(() => adapters.jobs.register(name, handler));
        },
        async enqueue(job) {
          allow("jobs");
          if (!jobNames.has(job.name)) throw new Error("Unknown job.");
          await adapters.jobs.enqueue(job);
        },
        async cron(job, pattern, timeZone) {
          allow("jobs");
          if (!jobNames.has(job.name)) throw new Error("Unknown job.");
          await adapters.jobs.cron(job, pattern, timeZone);
        },
      },
      i18n: {
        register(locale, messages) {
          const language = Intl.getCanonicalLocales(locale)[0];
          if (!language) throw new Error("Invalid locale.");
          put(catalogs, language, z.record(nameSchema, z.string().max(4000)).parse(messages));
        },
        message(locale, key) {
          const lookup = (language: string) => {
            const catalog = catalogs.get(language);
            return catalog && Object.hasOwn(catalog, key) ? catalog[key] : undefined;
          };
          return lookup(locale) ?? lookup(locale.split("-")[0] ?? "en") ?? lookup("en") ?? key;
        },
      },
      logger: {
        info(event) {
          fault(slug, nameSchema.parse(event));
        },
        warn(event) {
          fault(slug, nameSchema.parse(event));
        },
      },
      storage: {
        async read(input) {
          return adapters.storage.read(key(input));
        },
        async write(input, contents) {
          await adapters.storage.write(key(input), contents);
        },
      },
      mail: {
        async send(message) {
          allow("mail");
          await adapters.mail(message);
        },
      },
      cache: {
        async get(key) {
          allow("cache");
          return adapters.cache.get(key);
        },
        async set(key, value, ttl) {
          allow("cache");
          await adapters.cache.set(key, value, ttl);
        },
      },
      http: {
        get(url) {
          active();
          return getPluginHttp(
            url,
            permissions.flatMap((entry) => (entry.kind === "http" ? entry.origins : [])),
          );
        },
      },
      onDispose(cleanup) {
        register();
        cleanups.push(cleanup);
      },
    };

    const result = {
      context,
      routes,
      registryData,
      commands,
      services,
      get settings() {
        return settings;
      },
      activate() {
        state = "running";
        for (const mount of pending) {
          const dispose = mount();
          if (dispose) cleanups.push(dispose);
        }
        running.set(scope, result);
      },
      async dispose() {
        state = "disposed";
        if (running.get(scope) === result) running.delete(scope);
        hooks.removeOwner(owner);
        for (const cleanup of cleanups.splice(0).reverse()) {
          try {
            await cleanup();
          } catch {
            fault(slug, "dispose");
          }
        }
      },
    };
    return result;
  }

  return {
    prepare,
    get: (siteId: string, slug: string) => running.get(id(siteId, slug)),
    forSite: (siteId: string) =>
      [...running.entries()].filter(([key]) => key.startsWith(siteId + ":")),
  };
}
