import { sql, type DbSession } from "@atlas/db";
import { z } from "zod";

const key = z
  .string()
  .max(60)
  .regex(/^[a-z][a-z0-9-]*$/);
const capability = z.strictObject({
  kind: z.literal("capabilities"),
  key,
  label: z.string(),
  options: z.unknown().optional(),
  schema: z.unknown().optional(),
});
const role = z.strictObject({
  kind: z.literal("roles"),
  key,
  label: z.string(),
  schema: z.unknown().optional(),
  options: z.strictObject({ capabilities: z.array(key).max(64) }),
});
const descriptor = z.discriminatedUnion("kind", [capability, role]);
const isAccess = (value: object) =>
  "kind" in value && (value.kind === "capabilities" || value.kind === "roles");

export async function registerPluginAccess(
  tx: DbSession,
  siteId: string,
  slug: string,
  definitions: Iterable<object>,
) {
  const entries = [...definitions].filter(isAccess).map((value) => descriptor.parse(value));
  const names = new Set(
    entries.flatMap((entry) => (entry.kind === "capabilities" ? [entry.key] : [])),
  );
  const qualified = (name: string) => "plugin." + slug + "." + name;
  for (const entry of entries) {
    if (entry.kind !== "capabilities") continue;
    const name = qualified(entry.key);
    const label = slug + ":" + entry.label;
    await tx.query(sql`insert into capabilities (key, label) values (${name}, ${label})
      on conflict (key) do update set label = excluded.label`);
    await tx.query(sql`insert into role_capabilities (site_id, role_id, capability_key)
      select site_id, id, ${name} from roles where site_id = ${siteId} and key = 'administrator'
      on conflict do nothing`);
  }
  for (const entry of entries) {
    if (entry.kind !== "roles") continue;
    if (entry.options.capabilities.some((cap) => !names.has(cap)))
      throw new Error("Plugin roles can grant only that release's declared capabilities.");
    const [row] = await tx.query<{
      id: string;
    }>(sql`insert into roles (site_id, key, label, reserved)
      values (${siteId}, ${qualified(entry.key)}, ${slug + ":" + entry.label}, true)
      on conflict (site_id, key) do update set label = excluded.label where roles.reserved
      returning id`);
    if (!row) throw new Error("Plugin role conflicts with an existing role.");
    await tx.query(
      sql`delete from role_capabilities where site_id = ${siteId} and role_id = ${row.id}`,
    );
    for (const cap of new Set(entry.options.capabilities))
      await tx.query(sql`insert into role_capabilities (site_id, role_id, capability_key) values
        (${siteId}, ${row.id}, ${qualified(cap)})`);
  }
}
