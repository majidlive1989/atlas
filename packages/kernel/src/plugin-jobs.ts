import { createHash } from "node:crypto";
import { activeSites, sql, type Database } from "@atlas/db";
import type { PluginJob, PluginValue } from "@atlas/plugin-sdk";
import { Queue, Worker } from "bullmq";
import { CronExpressionParser } from "cron-parser";
import { z } from "zod";
import { nameSchema, valueSchema } from "./plugin-adapters.js";

const jobSchema = z.strictObject({
  name: nameSchema,
  key: z.string().min(1).max(140),
  payload: valueSchema,
});
const envelope = z.strictObject({ name: z.string(), data: valueSchema, key: z.string() });
const jobFact = "extension.pluginJobQueued";
const digest = (input: string) => createHash("sha256").update(input).digest("hex");

function nextOccurrence(pattern: string, tz: string, after: Date) {
  return CronExpressionParser.parse(pattern, { tz, currentDate: after }).next().toDate();
}

export function createPluginJobs(
  database: Database,
  redisUrl: string | undefined,
  fault: () => void,
) {
  const queue = redisUrl
    ? new Queue<PluginValue>("atlas-plugins", {
        connection: {
          url: redisUrl,
          enableOfflineQueue: false,
          maxRetriesPerRequest: 1,
          commandTimeout: 2_000,
        },
      })
    : undefined;
  queue?.on("error", fault);
  const handlers = new Map<
    string,
    {
      siteId: string;
      handle(value: PluginValue): void | Promise<void>;
    }
  >();
  let worker: Worker<PluginValue> | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let running: Promise<void> | undefined;

  async function relay() {
    if (!queue || !handlers.size) return;
    const sites = await activeSites(database);
    const now = new Date();
    const options = {
      attempts: 5,
      backoff: { type: "exponential", delay: 1000 },
      removeOnComplete: { age: 86400 },
    } as const;
    for (const site of sites) {
      const available = [...handlers.entries()].flatMap(([name, handler]) =>
        handler.siteId === site.id ? [name] : [],
      );
      if (!available.length) continue;
      await database.scoped(site.id, async (tx) => {
        const scheduled = await tx.query<{
          id: string;
          name: string;
          expression: string;
          timeZone: string;
          nextAt: Date;
          payload: unknown;
        }>(sql`
          select id, name, expression, time_zone as "timeZone", next_at as "nextAt", payload from job_schedules
          where site_id = ${site.id} and next_at <= ${now} and name = any(${sql.param(available)}::text[])
          order by next_at, id limit 25 for update skip locked`);
        for (const schedule of scheduled) {
          const key = digest(schedule.id + ":" + schedule.nextAt.toISOString());
          await queue.add(schedule.name, valueSchema.parse(schedule.payload), {
            ...options,
            jobId: key,
          });
          const next = nextOccurrence(schedule.expression, schedule.timeZone, now);
          await tx.query(
            sql`update job_schedules set next_at = ${next} where id = ${schedule.id} and site_id = ${site.id}`,
          );
        }
        const facts = await tx.query<{ id: string; payload: unknown }>(sql`
          select id, payload from outbox_events where site_id = ${site.id} and dispatched_at is null
          and name = ${jobFact} and payload->>'name' = any(${sql.param(available)}::text[])
          order by occurred_at, id limit 25 for update skip locked`);
        for (const fact of facts) {
          const message = envelope.parse(fact.payload);
          await queue.add(message.name, message.data, { ...options, jobId: message.key });
          await tx.query(
            sql`update outbox_events set dispatched_at = now() where id = ${fact.id} and site_id = ${site.id}`,
          );
        }
      });
    }
  }

  return {
    start() {
      if (!redisUrl || worker) return;
      worker = new Worker<PluginValue>(
        "atlas-plugins",
        async (job) => {
          const owner = handlers.get(job.name);
          if (!owner || !job.id) throw new Error("Plugin job handler is unavailable.");
          // The handler owns external idempotency. This transaction prevents duplicate committed effects.
          await database.scoped(owner.siteId, async (tx) => {
            const [lease] = await tx.query(sql`insert into job_effects (site_id, dedupe_key, state)
            values (${owner.siteId}, ${job.id}, 'running') on conflict do nothing returning dedupe_key`);
            if (!lease) return;
            await owner.handle(valueSchema.parse(job.data));
            await tx.query(sql`update job_effects set state = 'done', updated_at = now()
            where site_id = ${owner.siteId} and dedupe_key = ${job.id}`);
          });
        },
        { connection: { url: redisUrl, maxRetriesPerRequest: null }, concurrency: 2 },
      );
      worker.on("error", fault);
      timer = setInterval(() => {
        running ??= relay()
          .catch(fault)
          .finally(() => {
            running = undefined;
          });
      }, 1000);
      timer.unref();
    },
    async close() {
      clearInterval(timer);
      try {
        await running;
        await worker?.close();
      } finally {
        await queue?.close();
      }
    },
    scope(siteId: string, slug: string, version: string) {
      const owner = digest(siteId + ":" + slug) + "." + version;
      const jobName = (name: string) => owner + "." + nameSchema.parse(name);
      return {
        register(name: string, handle: (payload: PluginValue) => void | Promise<void>) {
          const qualified = jobName(name);
          const entry = { siteId, handle };
          handlers.set(qualified, entry);
          return () => {
            if (handlers.get(qualified) === entry) handlers.delete(qualified);
          };
        },
        async enqueue(input: PluginJob) {
          if (!queue) throw new Error("Plugin queue is unavailable.");
          const job = jobSchema.parse(input);
          const name = jobName(job.name);
          const key = digest(name + ":" + job.key);
          await database.scoped(siteId, (tx) =>
            tx.query(sql`insert into outbox_events
            (site_id, name, schema_version, payload, correlation_id)
            values (${siteId}, ${jobFact}, 1, ${JSON.stringify({ name, data: job.payload, key })}::jsonb, ${key})`),
          );
        },
        async cron(input: PluginJob, pattern: string, timeZone: string) {
          if (!queue) throw new Error("Plugin queue is unavailable.");
          const job = jobSchema.parse(input);
          const name = jobName(job.name);
          const expression = z.string().min(5).max(120).parse(pattern);
          const next = nextOccurrence(expression, timeZone, new Date());
          const token = digest(name + ":" + job.key);
          const id = [
            token.slice(0, 8),
            token.slice(8, 12),
            token.slice(12, 16),
            token.slice(16, 20),
            token.slice(20, 32),
          ].join("-");
          await database.scoped(siteId, (tx) =>
            tx.query(sql`insert into job_schedules
            (id, site_id, name, expression, time_zone, next_at, payload)
            values (${id}, ${siteId}, ${name}, ${expression}, ${timeZone}, ${next}, ${JSON.stringify(job.payload)}::jsonb)
            on conflict (id) do update set expression = excluded.expression,
              time_zone = excluded.time_zone, next_at = excluded.next_at, payload = excluded.payload
            where job_schedules.site_id = excluded.site_id`),
          );
        },
      };
    },
  };
}
