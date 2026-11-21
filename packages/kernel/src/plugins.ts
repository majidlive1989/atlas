import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { gt, satisfies } from "semver";
import {
  supportsAtlas,
  type PluginDefinition,
  type PluginManifest,
  type PluginValue,
} from "@atlas/plugin-sdk";
import { z } from "zod";
import { registerPluginAccess } from "./plugin-access.js";
import { createRegistrations } from "./plugin-registration.js";
import { pluginDatabase, valueSchema } from "./plugin-adapters.js";
import type { PluginResources } from "./plugin-resources.js";
import { sandboxPlugin } from "./plugin-sandbox.js";
import { createSandboxDispatch } from "./plugin-sandbox-dispatch.js";
import {
  activeSites,
  audit,
  recordEvent,
  scopeSession,
  sql,
  type AuditContext,
  type Database,
  type DbSession,
  type JsonValue,
} from "@atlas/db";
import { type CoreEventCatalog, type EventEnvelope, type createEventBus } from "@atlas/hooks";
import { discoverPlugins, type Release } from "./plugin-catalog.js";
import { applyPluginMigrations } from "./plugin-migrations.js";
import { AtlasProblem } from "./problem.js";

const atlasVersion = "0.0.0";
type State = "inactive" | "active" | "faulted";
type Operation = "install" | "activate" | "deactivate" | "upgrade" | "uninstall";
type EventName = keyof CoreEventCatalog;
type Cleanup = () => void | Promise<void>;
type CoreEvents = { [Key in EventName]: EventEnvelope<Key, CoreEventCatalog[Key]> };
type EventHandler<Key extends EventName> = (
  event: Readonly<CoreEvents[Key]>,
) => void | Promise<void>;

export interface PluginContext {
  readonly siteId: string;
  readonly settings: JsonValue;
  onDispose(cleanup: Cleanup): void;
  onEvent<Key extends EventName>(name: Key, handler: EventHandler<Key>): void;
}

type PluginModule = {
  register(context: PluginContext): void | Promise<void>;
  boot?(context: PluginContext): void | Promise<void>;
};
type Installed = {
  slug: string;
  version: string;
  state: State;
  settings: JsonValue;
  digest: string;
  settingsVersion: number;
};
type Subscriptions = {
  activate(): void;
  dispose(): Promise<void>;
  persist(tx: DbSession): Promise<void>;
};
type PluginEvents = ReturnType<typeof createEventBus<CoreEventCatalog>>;

interface PluginOptions {
  readonly root: string;
  readonly trusted: readonly string[];
  readonly database: Database;
  readonly grants: readonly string[];
  readonly sandboxImage?: string | undefined;
  readonly resources: PluginResources;
  readonly events: PluginEvents;
  readonly fault: (slug: string, action: string) => void;
}

const conflict = () => new AtlasProblem(409, "plugin-conflict");
const unavailable = () => new AtlasProblem(409, "plugin-unavailable");

function resolveRelease(
  releases: Release[],
  slug: string,
  version: string,
  digest?: string,
): Release {
  const choices = releases.filter(
    (candidate) => candidate.manifest.slug === slug && candidate.manifest.version === version,
  );
  const first = choices[0];
  if (
    !first ||
    choices.some((candidate) => candidate.digest !== first.digest) ||
    (digest && digest !== first.digest)
  ) {
    throw unavailable();
  }
  return first;
}

function checkRelease(release: Release, options: PluginOptions): void {
  const { manifest } = release;
  const approved = options.grants.includes(release.digest);
  if (
    !supportsAtlas(manifest, atlasVersion) ||
    (manifest.tier === "trusted"
      ? !options.trusted.includes(manifest.slug)
      : !approved || !options.sandboxImage) ||
    (release.migrations.length > 0 &&
      !manifest.permissions.some((permission) => permission.kind === "database"))
  ) {
    throw unavailable();
  }
}

async function readModule(release: Release) {
  const url = pathToFileURL(release.server);
  url.searchParams.set("release", release.digest);
  return z
    .object({
      plugin: z
        .custom<PluginDefinition>(
          (value) =>
            value !== null &&
            typeof value === "object" &&
            "register" in value &&
            typeof value.register === "function",
        )
        .optional(),
      register: z
        .custom<PluginModule["register"]>((value) => typeof value === "function")
        .optional(),
      boot: z
        .custom<NonNullable<PluginModule["boot"]>>((value) => typeof value === "function")
        .optional(),
    })
    .parse(await import(url.href));
}

function settingsValue(value: PluginValue, version: number): PluginValue | undefined {
  return version === 1 &&
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === 0
    ? undefined
    : value;
}

function expandsPermissions(before: PluginManifest, after: PluginManifest): boolean {
  if (before.tier !== after.tier) return true;
  const previous = before.permissions;
  return after.permissions.some((permission) => {
    switch (permission.kind) {
      case "hooks":
        return permission.names.some(
          (name) => !previous.some((entry) => entry.kind === "hooks" && entry.names.includes(name)),
        );
      case "http":
        return permission.origins.some(
          (origin) =>
            !previous.some((entry) => entry.kind === "http" && entry.origins.includes(origin)),
        );
      case "storage":
        return permission.prefixes.some(
          (prefix) =>
            !previous.some(
              (entry) =>
                entry.kind === "storage" &&
                entry.prefixes.some((older) => prefix === older || prefix.startsWith(older + "/")),
            ),
        );
      default:
        return !previous.some((entry) => entry.kind === permission.kind);
    }
  });
}

function checkGraph(releases: ReadonlyMap<string, Release>): string[] {
  const seen = new Set<string>();
  const visiting = new Set<string>();
  const sorted: string[] = [];
  function visit(slug: string) {
    if (visiting.has(slug)) throw conflict();
    if (seen.has(slug)) return;
    const current = releases.get(slug);
    if (!current) throw conflict();
    visiting.add(slug);
    for (const [name, range] of Object.entries(current.manifest.requires ?? {})) {
      const dependency = releases.get(name);
      if (!dependency || !satisfies(dependency.manifest.version, range)) throw conflict();
      visit(name);
    }
    visiting.delete(slug);
    seen.add(slug);
    sorted.push(slug);
  }
  for (const slug of releases.keys()) visit(slug);
  return sorted;
}

async function readInstalled(tx: DbSession, siteId: string): Promise<Installed[]> {
  return tx.query<Installed>(sql`select a.slug, a.version, a.state, a.settings, a.settings_version as "settingsVersion", r.digest
    from plugin_activations a join plugin_releases r on r.slug = a.slug and r.version = a.version
    where a.site_id = ${siteId} order by a.slug`);
}

export function createPluginManager(options: PluginOptions) {
  const { database, fault, events } = options;
  const registrations = createRegistrations(database, options.resources, fault);
  const live = new Map<string, Subscriptions>();
  let tail: Promise<unknown> = Promise.resolve();
  const liveKey = (siteId: string, slug: string) => siteId + ":" + slug;
  const catalog = () =>
    discoverPlugins(options.root, resolve("node_modules"), () => fault("catalog", "discover"));

  function serial<T>(run: () => Promise<T>): Promise<T> {
    const next = tail.then(run);
    tail = next.catch(() => undefined);
    return next;
  }

  function databaseLock(tx: DbSession) {
    return tx.query(sql`select pg_advisory_xact_lock(125630, 3)`);
  }

  async function stage(
    siteId: string,
    installed: Installed,
    release: Release,
  ): Promise<Subscriptions> {
    checkRelease(release, options);
    const cleanups: Cleanup[] = [];
    const pending: (() => void)[] = [];
    const owner = liveKey(siteId, installed.slug) + ":" + randomUUID();
    const allowed = new Set(
      release.manifest.permissions.flatMap((p) => (p.kind === "hooks" ? p.names : [])),
    );
    let registering = true;
    const ctx: PluginContext = {
      siteId,
      settings: structuredClone(installed.settings),
      onDispose(cleanup) {
        if (!registering || typeof cleanup !== "function") throw unavailable();
        cleanups.push(cleanup);
      },
      onEvent(name, handler) {
        if (
          !registering ||
          pending.length >= 128 ||
          !allowed.has(name) ||
          typeof handler !== "function"
        )
          throw unavailable();
        pending.push(() => {
          events.subscribe(
            name,
            (event) => (event.siteId === siteId ? handler(event) : undefined),
            { owner },
          );
        });
      },
    };
    const runtime = registrations.prepare({
      siteId,
      release,
      owner,
      initial: settingsValue(installed.settings, installed.settingsVersion),
      subscribe: ctx.onEvent,
      getSettings: async () =>
        database.scoped(siteId, async (tx) => {
          const current = (await readInstalled(tx, siteId)).find(
            (row) => row.slug === installed.slug,
          );
          if (!current || current.version !== installed.version) throw unavailable();
          return settingsValue(current.settings, current.settingsVersion);
        }),
      setSettings: async (settings) => {
        await database.scoped(siteId, async (tx) => {
          const [updated] = await tx.query(sql`update plugin_activations set
            settings = ${JSON.stringify(settings)}::jsonb, settings_version = settings_version + 1
            where site_id = ${siteId} and slug = ${installed.slug} and version = ${installed.version}
              and state = 'active' returning slug`);
          if (!updated) throw unavailable();
        });
      },
    });
    async function dispose() {
      events.removeOwner(owner);
      await runtime.dispose();
      for (const cleanup of cleanups.splice(0).reverse()) {
        try {
          await cleanup();
        } catch {
          fault(installed.slug, "dispose");
        }
      }
    }
    try {
      if (release.manifest.tier === "untrusted") {
        if (!options.sandboxImage) throw unavailable();
        const extension = await sandboxPlugin(
          options.sandboxImage,
          release,
          createSandboxDispatch(runtime.context),
        );
        await extension.register(runtime.context);
      } else {
        const extension = await readModule(release);
        if (extension.plugin) {
          await extension.plugin.register(runtime.context);
          await extension.plugin.boot?.(runtime.context);
        } else if (extension.register) {
          await extension.register(ctx);
          await extension.boot?.(ctx);
        } else throw unavailable();
      }
      return {
        activate() {
          runtime.activate();
          pending.splice(0).forEach((subscribe) => subscribe());
        },
        dispose,
        persist: (tx) =>
          registerPluginAccess(tx, siteId, installed.slug, runtime.registryData.values()),
      };
    } catch (error) {
      await dispose();
      throw error;
    } finally {
      registering = false;
    }
  }

  async function releaseCandidate(
    tx: DbSession,
    context: AuditContext,
    releases: Release[],
    slug: string,
    version: string,
  ) {
    const candidate = resolveRelease(releases, slug, version);
    checkRelease(candidate, options);
    for (const site of await activeSites(tx)) {
      if (site.id === context.site.id) continue;
      await scopeSession(tx, site.id);
      const [other] =
        await tx.query(sql`select slug from plugin_activations where site_id = ${site.id}
        and slug = ${slug} and version != ${version}`);
      if (other) throw conflict();
    }
    await scopeSession(tx, context.site.id);
    return candidate;
  }

  function baseRows(rows: Installed[], releases: Release[], ignore?: string) {
    const graph = new Map<string, Release>();
    for (const row of rows) {
      if (row.slug === ignore) continue;
      graph.set(row.slug, resolveRelease(releases, row.slug, row.version, row.digest));
    }
    return graph;
  }

  async function validateDependents(
    tx: DbSession,
    siteId: string,
    slug: string,
    operation: "deactivate" | "uninstall",
  ) {
    const rows = await tx.query<{ manifest: unknown }>(sql`
      select r.manifest from plugin_activations a join plugin_releases r on r.slug = a.slug and r.version = a.version
      where a.site_id = ${siteId} and a.slug != ${slug}
      and (${operation} = 'uninstall' or a.state = 'active')
      and coalesce(r.manifest->'requires', '{}'::jsonb) ? ${slug}`);
    if (rows.length) throw conflict();
  }

  function allDependenciesLive(candidate: Release, siteId: string) {
    if (
      Object.keys(candidate.manifest.requires ?? {}).some(
        (slug) => !live.has(liveKey(siteId, slug)),
      )
    )
      throw conflict();
  }

  const manager = {
    route: (siteId: string, slug: string, method: string, path: string) =>
      registrations.get(siteId, slug)?.routes.get(method + " " + path),
    routes: (siteId: string) =>
      registrations.forSite(siteId).flatMap(([key, registration]) =>
        [...registration.routes.values()].map((route) => ({
          slug: key.slice(siteId.length + 1),
          route,
        })),
      ),
    declarations: (siteId: string, slug: string) => [
      ...(registrations.get(siteId, slug)?.registryData.values() ?? []),
    ],
    async command(siteId: string, slug: string, name: string, args: string[]) {
      const handler = registrations.get(siteId, slug)?.commands.get(name);
      if (!handler) throw new AtlasProblem(404, "not-found");
      return valueSchema.parse(await handler(args));
    },
    async list(context: AuditContext) {
      const releases = await catalog();
      const installed = await database.scoped(context.site.id, (tx) =>
        readInstalled(tx, context.site.id),
      );
      return {
        installed: installed.map(({ slug, version, state, settingsVersion }) => ({
          slug,
          version,
          state,
          settingsVersion,
        })),
        available: releases.map(({ manifest, digest }) => ({
          digest,
          slug: manifest.slug,
          version: manifest.version,
          tier: manifest.tier,
        })),
      };
    },

    change(context: AuditContext, operation: Operation, slug: string, version?: string) {
      return serial(async () => {
        const id = liveKey(context.site.id, slug);
        const releases = await catalog();
        // Assigned as part of the transaction; disposed if the transaction does not commit.
        const staged: {
          subscription?: Subscriptions;
          fact?: CoreEvents["extension.pluginActivated"];
        } = {};
        try {
          await database.scoped(context.site.id, async (tx) => {
            await databaseLock(tx);
            const rows = await readInstalled(tx, context.site.id);
            const current = rows.find((row) => row.slug === slug);
            if (operation === "install" || operation === "upgrade") {
              if (
                !version ||
                (operation === "install" && current) ||
                (operation === "upgrade" && (!current || !gt(version, current.version)))
              )
                throw conflict();
              const release = await releaseCandidate(tx, context, releases, slug, version);
              const graph = baseRows(rows, releases, slug);
              graph.set(slug, release);
              checkGraph(graph);
              const [prior] = await tx.query<{ digest: string; manifest: Release["manifest"] }>(sql`
                select digest, manifest from plugin_releases where slug = ${slug} and version = ${current?.version ?? version}`);
              if (
                current &&
                prior &&
                !options.grants.includes(release.digest) &&
                expandsPermissions(prior.manifest, release.manifest)
              )
                throw unavailable();
              if (!current && prior && prior.digest !== release.digest) throw unavailable();
              await tx.query(sql`insert into plugin_releases (slug, version, digest, manifest)
                values (${slug}, ${version}, ${release.digest}, ${JSON.stringify(release.manifest)}::jsonb)
                on conflict do nothing`);
              const [verified] = await tx.query<{
                digest: string;
              }>(sql`select digest from plugin_releases
                where slug = ${slug} and version = ${version}`);
              if (verified?.digest !== release.digest) throw unavailable();
              await applyPluginMigrations(tx, slug, release.migrations);
              const next: Installed = {
                slug,
                version,
                state: current?.state === "active" ? "active" : "inactive",
                settings: current?.settings ?? {},
                digest: release.digest,
                settingsVersion: current?.settingsVersion ?? 1,
              };
              if (operation === "upgrade" && current && release.manifest.tier === "trusted") {
                const { plugin } = await readModule(release);
                await plugin?.onUpgrade?.(current.version, version, {
                  db: pluginDatabase(release, context.site.id, (work) => work(tx)),
                  readSettings: () => structuredClone(next.settings),
                  async writeSettings(value) {
                    next.settings = valueSchema.parse(value);
                    next.settingsVersion += 1;
                  },
                });
              }
              if (next.state === "active") {
                allDependenciesLive(release, context.site.id);
                staged.subscription = await stage(context.site.id, next, release);
              }
              await tx.query(sql`insert into plugin_activations (site_id, slug, version, state, settings, settings_version)
                values (${context.site.id}, ${slug}, ${version}, ${next.state}, ${JSON.stringify(next.settings)}::jsonb, ${next.settingsVersion})
                on conflict (site_id, slug) do update set version = excluded.version, state = excluded.state, settings = excluded.settings, settings_version = excluded.settings_version`);
            } else {
              if (!current) throw new AtlasProblem(404, "not-found");
              if (operation === "activate") {
                if (current.state === "active") {
                  if (!live.has(id)) throw conflict();
                  return;
                }
                const graph = baseRows(rows, releases);
                checkGraph(graph);
                const candidate = resolveRelease(releases, slug, current.version, current.digest);
                allDependenciesLive(candidate, context.site.id);
                staged.subscription = await stage(context.site.id, current, candidate);
                await tx.query(
                  sql`update plugin_activations set state = 'active' where site_id = ${context.site.id} and slug = ${slug}`,
                );
              } else {
                await validateDependents(tx, context.site.id, slug, operation);
                if (operation === "uninstall") {
                  if (current.state === "active") throw conflict();
                  await tx.query(
                    sql`delete from plugin_activations where site_id = ${context.site.id} and slug = ${slug}`,
                  );
                } else
                  await tx.query(sql`update plugin_activations set state = 'inactive'
                  where site_id = ${context.site.id} and slug = ${slug}`);
              }
            }
            if (staged.subscription) {
              await staged.subscription.persist(tx);
              const payload = { slug, version: version ?? current?.version ?? "" };
              staged.fact = await recordEvent(tx, context, "extension.pluginActivated", payload);
            }
            await audit(tx, context, "extension.plugin." + operation, {
              slug,
              version: version ?? current?.version ?? null,
            });
          });
        } catch (error) {
          await staged.subscription?.dispose();
          if (error instanceof AtlasProblem) throw error;
          fault(slug, operation);
          await database.scoped(context.site.id, async (tx) => {
            await audit(tx, context, "extension.plugin.failed", { slug, operation });
            if (operation === "activate") {
              await tx.query(sql`update plugin_activations set state = 'faulted'
                where site_id = ${context.site.id} and slug = ${slug} and state != 'active'`);
            }
          });
          throw unavailable();
        }
        if (staged.subscription || operation === "deactivate" || operation === "uninstall") {
          await live.get(id)?.dispose();
          live.delete(id);
        }
        if (staged.subscription) {
          staged.subscription.activate();
          live.set(id, staged.subscription);
        }
        if (staged.fact) void events.emit("extension.pluginActivated", staged.fact);
      });
    },

    readSettings(context: AuditContext, slug: string) {
      return database.scoped(context.site.id, async (tx) => {
        const [entry] = await tx.query<{ settings: JsonValue; version: number }>(sql`
          select settings, settings_version as version from plugin_activations
          where site_id = ${context.site.id} and slug = ${slug}`);
        if (!entry) throw new AtlasProblem(404, "not-found");
        const schema = registrations.get(context.site.id, slug)?.settings;
        return schema
          ? {
              ...entry,
              settings: schema.read(settingsValue(entry.settings, entry.version)),
              uiSchema: schema.uiSchema,
            }
          : entry;
      });
    },

    writeSettings(context: AuditContext, slug: string, version: number, settings: JsonValue) {
      return serial(() =>
        database.scoped(context.site.id, async (tx) => {
          await databaseLock(tx);
          const schema = registrations.get(context.site.id, slug)?.settings;
          if (schema) settings = schema.parse(settings);
          const [entry] = await tx.query<{ version: number }>(sql`update plugin_activations
          set settings = ${JSON.stringify(settings)}::jsonb, settings_version = settings_version + 1
          where site_id = ${context.site.id} and slug = ${slug} and settings_version = ${version}
          returning settings_version as version`);
          if (!entry) throw new AtlasProblem(412, "version-conflict");
          await audit(tx, context, "extension.plugin.settings-changed", { slug });
          return { settings, version: entry.version };
        }),
      );
    },

    restore() {
      return serial(async () => {
        const releases = await catalog();
        for (const site of await activeSites(database)) {
          const rows = await database.scoped(site.id, (tx) => readInstalled(tx, site.id));
          const active = new Map(
            rows.filter((row) => row.state === "active").map((row) => [row.slug, row]),
          );
          async function restoreOne(row: Installed, visiting: Set<string>): Promise<void> {
            const id = liveKey(site.id, row.slug);
            if (live.has(id)) return;
            if (visiting.has(row.slug)) throw conflict();
            visiting.add(row.slug);
            try {
              const release = resolveRelease(releases, row.slug, row.version, row.digest);
              for (const [slug, range] of Object.entries(release.manifest.requires ?? {})) {
                const dependency = active.get(slug);
                if (!dependency || !satisfies(dependency.version, range)) throw conflict();
                await restoreOne(dependency, visiting);
              }
              const subscription = await stage(site.id, row, release);
              try {
                await database.scoped(site.id, (tx) => subscription.persist(tx));
              } catch (error) {
                await subscription.dispose();
                throw error;
              }
              subscription.activate();
              live.set(id, subscription);
            } finally {
              visiting.delete(row.slug);
            }
          }
          for (const row of active.values()) {
            try {
              await restoreOne(row, new Set());
            } catch {
              fault(row.slug, "restore");
              active.delete(row.slug);
              await database.scoped(site.id, async (tx) => {
                await tx.query(sql`update plugin_activations set state = 'faulted'
                  where site_id = ${site.id} and slug = ${row.slug} and version = ${row.version}`);
                await audit(tx, { site, correlationId: "startup" }, "extension.plugin.failed", {
                  slug: row.slug,
                });
              });
            }
          }
        }
      });
    },

    shutdown() {
      return serial(async () => {
        for (const subscription of [...live.values()].reverse()) await subscription.dispose();
        live.clear();
      });
    },
  };
  return manager;
}
