import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Database, DbSession } from "./database.js";
import { coreV1 } from "./migrations/0001-foundation.js";

const migrations = [coreV1];
const checksum = (migration: (typeof migrations)[number]) =>
  createHash("sha256")
    .update(migration.up + "\0" + migration.down)
    .digest("hex");

async function applied(db: DbSession) {
  const rows = await db.query<{ version: string; checksum: string }>(sql`
    select version, checksum from core_migrations order by version`);
  if (
    rows.some((row, index) => {
      const migration = migrations[index];
      return (
        !migration || row.version !== migration.version || row.checksum !== checksum(migration)
      );
    })
  )
    throw new Error("Core migration history diverges from the packaged migration history.");
  return rows;
}

export async function migrate(
  database: Database,
  direction: "up" | "down" = "up",
): Promise<string[]> {
  return database.transaction(async (tx) => {
    await tx.query(sql`select pg_advisory_xact_lock(125630, 1)`);
    await tx.query(sql`create table if not exists core_migrations (
      version text primary key, checksum text not null, applied_at timestamptz not null default now())`);
    const current = await applied(tx);
    if (direction === "down") {
      const migration = migrations[current.length - 1];
      if (!migration) return [];
      const releases = await tx.query(sql`select slug from plugin_migrations limit 1`);
      if (releases.length)
        throw new Error(
          "Core rollback requires a fresh database or a reviewed plugin backup and teardown.",
        );
      await tx.query(sql.raw(migration.down));
      await tx.query(sql`delete from core_migrations where version = ${migration.version}`);
      return [migration.version];
    }
    const pending = migrations.slice(current.length);
    for (const migration of pending) {
      await tx.query(sql.raw(migration.up));
      await tx.query(sql`insert into core_migrations (version, checksum)
        values (${migration.version}, ${checksum(migration)})`);
    }
    return pending.map((migration) => migration.version);
  });
}

export async function checkMigrations(db: DbSession): Promise<void> {
  if ((await applied(db)).length !== migrations.length)
    throw new Error("Core migrations are pending.");
}
