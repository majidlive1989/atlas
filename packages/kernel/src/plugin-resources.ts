import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { Redis } from "ioredis";
import { type Database } from "@atlas/db";
import { createPluginJobs } from "./plugin-jobs.js";
import nodemailer from "nodemailer";
import { z } from "zod";
import type { PluginMail, PluginValue } from "@atlas/plugin-sdk";
import { nameSchema, valueSchema } from "./plugin-adapters.js";

const mailSchema = z.strictObject({
  to: z.email(),
  subject: z
    .string()
    .min(1)
    .max(200)
    .regex(/^[^\r\n]+$/),
  text: z.string().max(32_768),
});

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function createPluginResources(options: {
  storageRoot: string;
  database: Database;
  cacheUrl?: string | undefined;
  redisUrl?: string | undefined;
  mailUrl: string;
  mailFrom: string;
  mail?: ((message: PluginMail) => Promise<void>) | undefined;
  fault: () => void;
}) {
  const transport = nodemailer.createTransport(options.mailUrl, {
    from: options.mailFrom,
    disableFileAccess: true,
    disableUrlAccess: true,
    connectionTimeout: 5_000,
    socketTimeout: 10_000,
  });
  const cache = new Map<string, { value: PluginValue; expiresAt: number }>();
  const jobs = createPluginJobs(options.database, options.redisUrl, options.fault);
  const redis = options.cacheUrl
    ? new Redis(options.cacheUrl, {
        lazyConnect: true,
        commandTimeout: 2_000,
        maxRetriesPerRequest: 1,
        retryStrategy: (attempt) => (attempt < 4 ? attempt * 100 : null),
      })
    : undefined;
  redis?.on("error", options.fault);
  return {
    start: jobs.start,
    async close() {
      try {
        await jobs.close();
      } finally {
        redis?.disconnect();
        transport.close();
        cache.clear();
      }
    },
    scope(siteId: string, slug: string, version: string) {
      const scopeKey = digest(siteId + ":" + slug);
      return {
        async mail(message: PluginMail) {
          const data = mailSchema.parse(message);
          if (options.mail) await options.mail(data);
          else await transport.sendMail(data);
        },
        cache: {
          async get(key: string) {
            const id = "atlas:plugin:" + scopeKey + ":" + nameSchema.parse(key);
            if (redis) {
              const data = await redis.get(id);
              return data === null ? undefined : valueSchema.parse(JSON.parse(data));
            }
            const entry = cache.get(id);
            if (entry && entry.expiresAt > Date.now()) return structuredClone(entry.value);
            cache.delete(id);
          },
          async set(key: string, value: PluginValue, ttl: number) {
            const data = valueSchema.parse(value);
            if (Buffer.byteLength(JSON.stringify(data)) > 64 * 1024)
              throw new Error("Cache entry exceeds limit.");
            const ttlSeconds = z.number().int().min(1).max(86400).parse(ttl);
            const id = "atlas:plugin:" + scopeKey + ":" + nameSchema.parse(key);
            if (redis) {
              await redis.set(id, JSON.stringify(data), "EX", ttlSeconds);
              return;
            }
            const first = cache.keys().next().value;
            if (cache.size >= 1024 && first !== undefined) cache.delete(first);
            cache.set(id, {
              value: data,
              expiresAt: Date.now() + ttlSeconds * 1000,
            });
          },
        },
        storage: {
          read(key: string) {
            return readFile(join(options.storageRoot, scopeKey, digest(key)));
          },
          async write(key: string, contents: Uint8Array) {
            if (!(contents instanceof Uint8Array) || contents.length > 4 * 1024 * 1024)
              throw new Error("Storage object exceeds limit.");
            const directory = join(options.storageRoot, scopeKey);
            await mkdir(directory, { recursive: true, mode: 0o700 });
            const destination = join(directory, digest(key));
            const temporary = destination + "." + crypto.randomUUID();
            await writeFile(temporary, contents, { flag: "wx", mode: 0o600 });
            try {
              await rename(temporary, destination);
            } finally {
              await rm(temporary, { force: true });
            }
          },
        },
        jobs: jobs.scope(siteId, slug, version),
      };
    },
  };
}

export type PluginResources = ReturnType<typeof createPluginResources>;
