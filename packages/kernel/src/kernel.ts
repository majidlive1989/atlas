import { resolve } from "node:path";
import {
  createAccessService,
  createAuth,
  createOidcProvider,
  createSmtpMail,
  type AuthOptions,
} from "@atlas/auth";
import { readConfig, type AtlasConfig } from "@atlas/config";
import { checkMigrations, openDatabase, type Database, type Site } from "@atlas/db";
import { createEventBus, createHooks, type CoreEventCatalog } from "@atlas/hooks";
import { trace, SpanStatusCode, type Span } from "@opentelemetry/api";
import { pino } from "pino";
import { createPluginManager } from "./plugins.js";
import { createPluginResources } from "./plugin-resources.js";
import type { PluginMail } from "@atlas/plugin-sdk";
import { createSettings } from "./settings.js";

type State = "created" | "booting" | "ready" | "draining" | "closed" | "failed";
type CoreActions = {
  "system.ready": { startedAt: string };
  "system.beforeShutdown": { startedAt: string };
};

export interface KernelDependencies {
  readonly database?: Database;
  readonly mail?: AuthOptions["mail"];
  readonly pluginMail?: (message: PluginMail) => Promise<void>;
  readonly clock?: () => Date;
}

export function createKernel(config: AtlasConfig, dependencies: KernelDependencies = {}) {
  const logger = pino({
    level: config.ATLAS_LOG_LEVEL,
    base: { service: "atlas" },
    redact: [
      "password",
      "token",
      "refreshToken",
      "accessToken",
      "*.authorization",
      "*.cookie",
      "*.password",
      "*.token",
    ],
  });
  const database =
    dependencies.database ??
    openDatabase(config.DATABASE_URL, () => logger.warn({ event: "db.pool.error" }));
  const tracer = trace.getTracer("@atlas/kernel");
  const hooks = createHooks<CoreActions, Record<never, never>>((name, owner) =>
    logger.warn({ hook: name, owner: owner.owner }),
  );
  const events = createEventBus<CoreEventCatalog>((name, owner) =>
    logger.warn({ event: name, owner: owner.owner }),
  );
  const callback = new URL("/v1/auth/oidc/callback", config.ATLAS_ISSUER).href;
  const oidc =
    config.ATLAS_OIDC_ISSUER && config.ATLAS_OIDC_CLIENT_ID
      ? createOidcProvider(
          config.ATLAS_OIDC_ISSUER,
          config.ATLAS_OIDC_CLIENT_ID,
          callback,
          config.ATLAS_OIDC_CLIENT_SECRET,
        )
      : undefined;
  const auth = createAuth(database, {
    secret: config.ATLAS_AUTH_SECRET,
    issuer: config.ATLAS_ISSUER,
    mail: dependencies.mail ?? createSmtpMail(config.ATLAS_MAIL_URL, config.ATLAS_MAIL_FROM),
    mailFailure: () => logger.warn({ event: "identity.mail.failed" }),
    sessionRevoked: (event) => events.emit("identity.sessionRevoked", event),
    ...(dependencies.clock ? { clock: dependencies.clock } : {}),
    ...(oidc ? { oidc } : {}),
  });
  const resources = createPluginResources({
    storageRoot: resolve(config.ATLAS_PLUGIN_STORAGE),
    database,
    cacheUrl: config.ATLAS_PLUGIN_CACHE_URL,
    redisUrl: config.ATLAS_PLUGIN_QUEUE_URL,
    mailUrl: config.ATLAS_MAIL_URL,
    mailFrom: config.ATLAS_MAIL_FROM,
    mail: dependencies.pluginMail,
    fault: () => logger.warn("Plugin queue error"),
  });
  const plugins = createPluginManager({
    root: resolve(config.ATLAS_PLUGIN_ROOT),
    trusted: config.ATLAS_TRUSTED_PLUGINS,
    grants: config.ATLAS_PLUGIN_RELEASE_GRANTS,
    sandboxImage: config.ATLAS_PLUGIN_SANDBOX_IMAGE,
    resources,
    database,
    events,
    fault: (slug, action) => logger.warn({ slug, action }, "Plugin lifecycle failed"),
  });
  const services = Object.freeze({
    database,
    auth,
    access: createAccessService(database),
    settings: createSettings(database),
    plugins,
    hooks,
    events,
    logger,
  });
  const startedAt = new Date().toISOString();
  let state: State = "created";
  let start: Promise<void> | undefined;
  let close: Promise<void> | undefined;

  return {
    config,
    services,
    get state(): State {
      return state;
    },
    startSpan(name: string): Span {
      return tracer.startSpan(name);
    },
    async inSpan<T>(name: string, operation: () => Promise<T>): Promise<T> {
      return tracer.startActiveSpan(name, async (span) => {
        try {
          return await operation();
        } catch (error) {
          span.setStatus({ code: SpanStatusCode.ERROR });
          throw error;
        } finally {
          span.end();
        }
      });
    },
    boot() {
      if (state !== "created") {
        if (state === "booting" || state === "ready") return start;
        return Promise.reject(new Error("Atlas cannot boot from its current state."));
      }
      state = "booting";
      start = (async () => {
        try {
          await checkMigrations(database);
          await plugins.restore();
          resources.start();
          await hooks.actions.run("system.ready", { startedAt });
          if (state === "booting") state = "ready";
        } catch (error) {
          if (state === "booting") state = "failed";
          throw error;
        }
      })();
      return start;
    },
    async isReady() {
      if (state !== "ready") return false;
      try {
        await checkMigrations(database);
        return state === "ready";
      } catch {
        return false;
      }
    },
    drain() {
      if (state !== "closed") state = "draining";
    },
    shutdown() {
      if (close) return close;
      state = "draining";
      close = (async () => {
        try {
          await start?.catch(() => undefined);
          await hooks.actions.run("system.beforeShutdown", { startedAt });
          await resources.close();
          await plugins.shutdown();
        } finally {
          try {
            if (!dependencies.database) await database.close();
          } finally {
            state = "closed";
          }
        }
      })();
      return close;
    },
  };
}

export function kernelFromEnv(
  env: Readonly<Record<string, string | undefined>>,
  dependencies?: KernelDependencies,
) {
  return createKernel(readConfig(env), dependencies);
}

export type Kernel = ReturnType<typeof createKernel>;
export type { Site };
