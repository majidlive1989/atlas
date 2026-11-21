import { randomUUID } from "node:crypto";
import { openDatabase, migrate } from "@atlas/db";
import { createEventBus, createHooks, type CoreEventCatalog } from "@atlas/hooks";
import type {
  DeclarationKind,
  PluginContext,
  PluginDeclaration,
  PluginDefinition,
  PluginJob,
  PluginMail,
  PluginRow,
  PluginValue,
} from "@atlas/plugin-sdk";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { z } from "zod";

export interface PluginHarnessOptions {
  readonly siteId?: string;
  readonly slug?: string;
  readonly settings?: PluginValue;
  readonly adapters?: Partial<Pick<PluginContext, "db" | "mail" | "http" | "storage">>;
}

const valueSchema = z.json();

export function createPluginHarness(options: PluginHarnessOptions = {}) {
  const siteId = options.siteId ?? randomUUID();
  const slug = options.slug ?? "test-plugin";
  const mail: PluginMail[] = [];
  const jobs: PluginJob[] = [];
  const logs: string[] = [];
  const declarations = new Map<DeclarationKind, PluginDeclaration[]>();
  const routes = new Map<string, { handle(input: unknown): Promise<unknown>; access: unknown }>();
  const tables = new Map<string, Map<string, PluginRow>>();
  const storage = new Map<string, Uint8Array>();
  const cache = new Map<string, { value: PluginValue; expires: number }>();
  const callbacks = new Map<string, (value: PluginValue) => void | Promise<void>>();
  const commands = new Map<
    string,
    (args: readonly string[]) => PluginValue | Promise<PluginValue>
  >();
  const services = new Map<string, (value: unknown) => Promise<unknown>>();
  const catalogs = new Map<string, Readonly<Record<string, string>>>();
  const cleanups: (() => void | Promise<void>)[] = [];
  const hooks = createHooks<
    Record<string, { input: unknown }>,
    Record<string, { value: unknown; context: { input: unknown } }>
  >();
  const events = createEventBus<CoreEventCatalog>();
  let settings = options.settings;
  let started = false;
  let disposed = false;

  function unique<Value>(map: Map<string, Value>, key: string, value: Value) {
    if (map.has(key)) throw new Error("Duplicate registration.");
    map.set(key, value);
  }
  const context: PluginContext = {
    siteId,
    slug,
    db: options.adapters?.db ?? {
      async insert(table, values) {
        const rows = tables.get(table) ?? new Map<string, PluginRow>();
        tables.set(table, rows);
        const id = randomUUID();
        rows.set(id, { ...structuredClone(values), id });
        return id;
      },
      async get(table, id) {
        return structuredClone(tables.get(table)?.get(id));
      },
    },
    mail: options.adapters?.mail ?? {
      async send(message) {
        mail.push(structuredClone(message));
      },
    },
    http: options.adapters?.http ?? {
      async get() {
        throw new Error("Configure a test HTTP adapter.");
      },
    },
    storage: options.adapters?.storage ?? {
      async read(key) {
        const bytes = storage.get(key);
        if (!bytes) throw new Error("Missing storage object.");
        return bytes.slice();
      },
      async write(key, bytes) {
        storage.set(key, bytes.slice());
      },
    },
    cache: {
      async get(key) {
        const entry = cache.get(key);
        return entry && entry.expires > Date.now() ? structuredClone(entry.value) : undefined;
      },
      async set(key, value, ttl) {
        cache.set(key, { value: structuredClone(value), expires: Date.now() + ttl * 1000 });
      },
    },
    logger: {
      info(event) {
        logs.push(event);
      },
      warn(event) {
        logs.push(event);
      },
    },
    settings: {
      define(definition) {
        definition.schema.parse(settings ?? definition.initial);
        return {
          uiSchema: z.toJSONSchema(definition.schema, { io: "input" }),
          async get() {
            return definition.schema.parse(settings ?? definition.initial);
          },
          async set(value) {
            settings = valueSchema.parse(definition.schema.parse(value));
          },
        };
      },
    },
    registry: Object.fromEntries(
      (
        [
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
        ] as const
      ).map((kind) => [
        kind,
        {
          register(declaration: PluginDeclaration) {
            const current = declarations.get(kind) ?? [];
            if (current.some(({ key }) => key === declaration.key))
              throw new Error("Duplicate declaration.");
            declarations.set(kind, [...current, declaration]);
          },
        },
      ]),
    ) as PluginContext["registry"],
    routes: {
      register(route) {
        unique(routes, route.method + " " + route.path, {
          access: route.access,
          async handle(input) {
            return route.output.parseAsync(await route.handle(await route.input.parseAsync(input)));
          },
        });
      },
    },
    hooks: {
      actions: {
        register(action, handler, options) {
          hooks.actions.register(action.name, (value) => handler(action.input.parse(value.input)), {
            ...options,
            owner: slug,
          });
        },
        run(action, input) {
          return hooks.actions.run(
            action.name,
            { input: action.input.parse(input) },
            { failure: "closed" },
          );
        },
      },
      filters: {
        register(filter, handler, options) {
          hooks.filters.register(
            filter.name,
            async (value, input) =>
              filter.value.parse(
                await handler(filter.value.parse(value), filter.input.parse(input.input)),
              ),
            { ...options, owner: slug },
          );
        },
        async apply(filter, value, input, failure = "closed") {
          const result = await hooks.filters.run(
            filter.name,
            value as unknown,
            { input: filter.input.parse(input) },
            (value) => filter.value.parse(value),
            { failure },
          );
          return filter.value.parse(result);
        },
      },
    },
    events: {
      subscribe(name, handler) {
        events.subscribe(name, handler, { owner: slug });
      },
    },
    services: {
      provide(service, handler) {
        unique(services, service.name, async (value) =>
          service.output.parse(await handler(service.input.parse(value))),
        );
      },
      async call(plugin, service, value) {
        const handler = plugin === slug ? services.get(service.name) : undefined;
        if (!handler) throw new Error("Missing test service.");
        return service.output.parse(await handler(service.input.parse(value)));
      },
    },
    cli: {
      register(command, handler) {
        unique(commands, command, handler);
      },
    },
    jobs: {
      register(name, handler) {
        unique(callbacks, name, handler);
      },
      async enqueue(job) {
        jobs.push(structuredClone(job));
      },
      async cron(job) {
        jobs.push(structuredClone(job));
      },
    },
    i18n: {
      register(locale, messages) {
        unique(catalogs, locale, messages);
      },
      message(locale, key) {
        return (
          catalogs.get(locale)?.[key] ??
          catalogs.get(locale.split("-")[0] ?? "en")?.[key] ??
          catalogs.get("en")?.[key] ??
          key
        );
      },
    },
    onDispose(cleanup) {
      cleanups.push(cleanup);
    },
  };

  async function stop() {
    if (disposed) return;
    disposed = true;
    hooks.removeOwner(slug);
    events.removeOwner(slug);
    routes.clear();
    await Promise.allSettled(cleanups.reverse().map(async (cleanup) => cleanup()));
  }

  return {
    context,
    mail,
    jobs,
    logs,
    declarations,
    hooks,
    events,
    tables,
    commands,
    callbacks,
    stop,
    async start(plugin: PluginDefinition) {
      if (started || disposed) throw new Error("Harness has already run.");
      started = true;
      try {
        await plugin.register(context);
        await plugin.boot?.(context);
      } catch (error) {
        await stop();
        throw error;
      }
    },
    async request(
      method: string,
      path: string,
      input: unknown,
      authenticated = false,
      capabilities: readonly string[] = [],
    ) {
      const route = routes.get(method + " " + path);
      if (!route) return { status: 404, body: null };
      if (route.access !== "public" && !authenticated) return { status: 401, body: null };
      if (
        route.access &&
        typeof route.access === "object" &&
        "capability" in route.access &&
        typeof route.access.capability === "string" &&
        !capabilities.includes(route.access.capability)
      )
        return { status: 403, body: null };
      try {
        return { status: 200, body: await route.handle(input) };
      } catch (error) {
        return { status: error instanceof z.ZodError ? 400 : 500, body: null };
      }
    },
  };
}

/** Starts and migrates an ephemeral PostgreSQL instance using Testcontainers. */
export async function startPluginPostgres(
  image = process.env.ATLAS_TEST_POSTGRES_IMAGE ?? "postgres:17-alpine",
) {
  const container = await new PostgreSqlContainer(image).withPassword(randomUUID()).start();
  const database = openDatabase(container.getConnectionUri());
  async function close() {
    try {
      await database.close();
    } finally {
      await container.stop();
    }
  }
  try {
    await migrate(database, "up");
    return { database, url: container.getConnectionUri(), close };
  } catch (error) {
    await close();
    throw error;
  }
}
