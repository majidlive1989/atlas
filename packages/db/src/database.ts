import { PgDialect } from "drizzle-orm/pg-core";
import { Pool, type PoolClient } from "pg";
import { sql, type SQL } from "drizzle-orm";
import * as schema from "./schema.js";

export interface DbSession {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    statement: SQL,
  ): Promise<Row[]>;
}

export type Site = { id: string; tenantId: string; locale: string; slug: string };

export interface AuditContext {
  readonly site: Site;
  readonly correlationId: string;
  readonly actorId?: string;
}

const dialect = new PgDialect();

function createSession(executor: Pick<PoolClient, "query">): DbSession {
  return {
    async query<Row extends Record<string, unknown>>(statement: SQL) {
      // Compile Drizzle SQL while using the driver's native result codecs.
      // Credentials and other bound parameters stay out of telemetry.
      const query = dialect.sqlToQuery(statement);
      const result = await executor.query<Row>(query.sql, query.params);
      return result.rows ?? [];
    },
  };
}

export function openDatabase(connectionString: string, onError: () => void = () => undefined) {
  const pool = new Pool({
    connectionString,
    max: 12,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 15_000,
  });
  pool.on("error", onError);
  async function transaction<T>(operation: (tx: DbSession) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    let discard: Error | undefined;
    try {
      await client.query("begin");
      const result = await operation(createSession(client));
      await client.query("commit");
      return result;
    } catch (error) {
      try {
        await client.query("rollback");
      } catch {
        discard = new Error("Unable to roll back transaction.");
      }
      throw error;
    } finally {
      client.release(discard);
    }
  }
  return {
    ...createSession(pool),
    transaction,
    scoped<T>(siteId: string, operation: (tx: DbSession) => Promise<T>): Promise<T> {
      return transaction(async (tx) => {
        await scopeSession(tx, siteId);
        return operation(tx);
      });
    },
    close: () => pool.end(),
  };
}

export type Database = ReturnType<typeof openDatabase>;

export async function scopeSession(db: DbSession, siteId: string): Promise<void> {
  await db.query(sql`select set_config('atlas.site_id', ${siteId}, true)`);
}

export function normalizeHostname(host: string): string | null {
  if (!/^(?:[a-z0-9.-]+|\[[a-f0-9:]+\])(?::[0-9]{1,5})?$/i.test(host)) return null;
  try {
    return new URL("http://" + host).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return null;
  }
}

export async function resolveSite(db: DbSession, hostname: string): Promise<Site | null> {
  const host = normalizeHostname(hostname);
  if (!host) return null;
  const [site] = await db.query<Site>(sql`
    select s.id, s.tenant_id as "tenantId", s.locale, s.slug
    from site_domains d join sites s on s.id = d.site_id join tenants t on t.id = s.tenant_id
    where d.hostname = ${host} and s.state = 'active' and t.state = 'active'
  `);
  return site ?? null;
}

export async function activeSites(db: DbSession): Promise<Site[]> {
  return db.query<Site>(sql`select s.id, s.tenant_id as "tenantId", s.locale, s.slug
    from sites s join tenants t on t.id = s.tenant_id where s.state = 'active' and t.state = 'active'
    order by s.id`);
}

export async function audit(
  db: DbSession,
  context: AuditContext,
  action: string,
  details: schema.JsonValue = {},
): Promise<void> {
  await db.query(sql`insert into audit_entries (site_id, tenant_id, actor_id, correlation_id, action, details)
    values (${context.site.id}, ${context.site.tenantId}, ${context.actorId ?? null}, ${context.correlationId},
      ${action}, ${JSON.stringify(details)}::jsonb)`);
}

export interface RecordedEvent<Name extends string, Payload extends schema.JsonValue> {
  readonly id: string;
  readonly name: Name;
  readonly siteId: string;
  readonly schemaVersion: number;
  readonly correlationId: string;
  readonly occurredAt: string;
  readonly payload: Payload;
}

export async function recordEvent<Name extends string, Payload extends schema.JsonValue>(
  db: DbSession,
  context: AuditContext,
  name: Name,
  payload: Payload,
): Promise<RecordedEvent<Name, Payload>> {
  const [row] = await db.query<{ id: string; occurred_at: Date; schema_version: number }>(
    sql`insert into outbox_events (site_id, name, correlation_id, payload)
      values (${context.site.id}, ${name}, ${context.correlationId}, ${JSON.stringify(payload)}::jsonb)
      returning id, occurred_at, schema_version`,
  );
  if (!row) throw new Error("Outbox insertion failed.");
  return {
    id: row.id,
    name,
    siteId: context.site.id,
    correlationId: context.correlationId,
    occurredAt: row.occurred_at.toISOString(),
    schemaVersion: row.schema_version,
    payload,
  };
}
