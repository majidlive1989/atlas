import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { gt, satisfies } from "semver";
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
type Subscriptions = { activate(): void; dispose(): Promise<void> };
type PluginEvents = ReturnType<typeof createEventBus<CoreEventCatalog>>;

interface PluginOptions {
  readonly root: string;
  readonly trusted: readonly string[];
  readonly database: Database;
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

function checkRelease(release: Release, trusted: readonly string[]): void {
  const { manifest } = release;
  if (
    !satisfies(atlasVersion, manifest.engines.atlas) ||
    manifest.tier !== "trusted" ||
    !trusted.includes(manifest.slug)
  ) {
    throw unavailable();
  }
  if (
    manifest.permissions.some(
      (permission) => permission.kind === "http" || permission.kind === "storage",
    ) ||
    (release.migrations.length > 0 &&
      !manifest.permissions.some((permission) => permission.kind === "database"))
  ) {
    throw unavailable();
  }
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
  const { database, trusted, fault, events } = options;
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
    checkRelease(release, trusted);
    const url = pathToFileURL(release.server);
    url.searchParams.set("release", release.digest);
    const module: unknown = await import(url.href);
    if (
      !module ||
      typeof module !== "object" ||
      !("register" in module) ||
      typeof module.register !== "function" ||
      ("boot" in module && typeof module.boot !== "function")
    )
      throw unavailable();
    const extension = module as PluginModule;
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
        if (!registering || !allowed.has(name) || typeof handler !== "function")
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
    async function dispose() {
      events.removeOwner(owner);
      for (const cleanup of cleanups.splice(0).reverse()) {
        try {
          await cleanup();
        } catch {
          fault(installed.slug, "dispose");
        }
      }
    }
    try {
      await extension.register(ctx);
      await extension.boot?.(ctx);
      return { activate: () => pending.splice(0).forEach((subscribe) => subscribe()), dispose };
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
    checkRelease(candidate, trusted);
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
        available: releases.map(({ manifest }) => ({
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
                release.manifest.permissions.some(
                  (next) =>
                    !prior.manifest.permissions.some(
                      (before) => JSON.stringify(next) === JSON.stringify(before),
                    ),
                )
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
              if (next.state === "active") {
                allDependenciesLive(release, context.site.id);
                staged.subscription = await stage(context.site.id, next, release);
              }
              await tx.query(sql`insert into plugin_activations (site_id, slug, version, state)
                values (${context.site.id}, ${slug}, ${version}, ${next.state})
                on conflict (site_id, slug) do update set version = excluded.version, state = excluded.state`);
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
        return entry;
      });
    },

    writeSettings(context: AuditContext, slug: string, version: number, settings: JsonValue) {
      return serial(() =>
        database.scoped(context.site.id, async (tx) => {
          await databaseLock(tx);
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
