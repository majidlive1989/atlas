import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { sql, type DbSession } from "@atlas/db";
import { z } from "zod";

const identifier = z
  .string()
  .max(22)
  .regex(/^[a-z][a-z0-9_]*$/);
const type = z.enum(["text", "integer", "bool", "jsonb", "timestamptz", "uuid"]);
const column = z.strictObject({
  name: identifier.refine((name) => name !== "site_id" && name !== "id"),
  type,
});
const migrationSchema = z
  .array(
    z.discriminatedUnion("action", [
      z.strictObject({
        action: z.literal("create-table"),
        table: identifier,
        columns: z.array(column).max(64),
      }),
      z.strictObject({ action: z.literal("add-column"), table: identifier, column }),
    ]),
  )
  .min(1)
  .max(100);

type Migration = { version: number; digest: string; operations: z.infer<typeof migrationSchema> };

export async function readMigrations(path: string): Promise<Migration[]> {
  const entries = (await readdir(path)).sort();
  const result: Migration[] = [];
  for (const [index, name] of entries.entries()) {
    if (name !== String(index + 1).padStart(4, "0") + ".json")
      throw new Error("Invalid plugin migration sequence.");
    const raw = await readFile(join(path, name), "utf8");
    const operations = migrationSchema.parse(JSON.parse(raw));
    result.push({
      version: index + 1,
      digest: createHash("sha256").update(JSON.stringify(operations)).digest("hex"),
      operations,
    });
  }
  return result;
}

export async function applyPluginMigrations(tx: DbSession, slug: string, migrations: Migration[]) {
  const existing = await tx.query<{
    version: number;
    checksum: string;
  }>(sql`select version, checksum
    from plugin_migrations where slug = ${slug} order by version`);
  if (
    existing.some(
      (row, index) =>
        migrations[index]?.version !== row.version || migrations[index]?.digest !== row.checksum,
    )
  )
    throw new Error("Plugin migration history diverges.");
  for (const migration of migrations.slice(existing.length)) {
    for (const operation of migration.operations) {
      const table = sql.identifier("plg_" + slug.replaceAll("-", "_") + "__" + operation.table);
      if (operation.action === "add-column") {
        await tx.query(
          sql`alter table ${table} add column ${sql.identifier(operation.column.name)} ${sql.raw(operation.column.type)}`,
        );
        continue;
      }
      const columns = operation.columns.map(
        (field) => sql`, ${sql.identifier(field.name)} ${sql.raw(field.type)}`,
      );
      await tx.query(sql`create table ${table} (
        site_id uuid not null references sites(id), id uuid not null default gen_random_uuid()
        ${sql.join(columns)}, primary key (site_id, id))`);
      await tx.query(sql`alter table ${table} enable row level security`);
      await tx.query(sql`alter table ${table} force row level security`);
      await tx.query(sql`create policy atlas_site on ${table}
        using (site_id = nullif(current_setting('atlas.site_id', true), '')::uuid)
        with check (site_id = nullif(current_setting('atlas.site_id', true), '')::uuid)`);
    }
    await tx.query(sql`insert into plugin_migrations (slug, version, checksum)
      values (${slug}, ${migration.version}, ${migration.digest})`);
  }
}
