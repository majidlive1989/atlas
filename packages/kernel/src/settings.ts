import { audit, sql, type AuditContext, type Database, type JsonValue } from "@atlas/db";
import { z } from "zod";
import { AtlasProblem } from "./problem.js";

const settingSchemas = {
  "site.title": z.string().trim().min(1).max(120),
  "site.tagline": z.string().trim().max(240),
  "site.locale": z
    .string()
    .max(35)
    .refine((value) => {
      try {
        return Intl.getCanonicalLocales(value).length === 1;
      } catch {
        return false;
      }
    }),
  "site.time-zone": z
    .string()
    .max(64)
    .refine((value) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: value });
        return true;
      } catch {
        return false;
      }
    }),
  "site.visibility": z.enum(["public", "private"]),
  "site.registration": z.boolean(),
};

export const settingKey = z.enum([
  "site.title",
  "site.tagline",
  "site.locale",
  "site.time-zone",
  "site.visibility",
  "site.registration",
]);
export type SettingKey = z.infer<typeof settingKey>;

const defaults: Record<SettingKey, JsonValue> = {
  "site.title": "Atlas",
  "site.tagline": "",
  "site.locale": "en",
  "site.time-zone": "UTC",
  "site.visibility": "public",
  "site.registration": false,
};

export function createSettings(database: Database) {
  return {
    async registrationEnabled(context: AuditContext) {
      return database.scoped(context.site.id, async (tx) => {
        const [row] = await tx.query<{ value: boolean }>(sql`
          select value from site_settings where site_id = ${context.site.id} and key = 'site.registration'`);
        return row?.value === true;
      });
    },

    list(context: AuditContext) {
      return database.scoped(context.site.id, async (tx) => {
        const rows = await tx.query<{ key: SettingKey; value: JsonValue; version: number }>(sql`
          select key, value, version from site_settings where site_id = ${context.site.id} order by key`);
        return settingKey.options.map(
          (key) =>
            rows.find((row) => row.key === key) ?? {
              key,
              value: key === "site.locale" ? context.site.locale : defaults[key],
              version: 0,
            },
        );
      });
    },

    write(context: AuditContext, key: SettingKey, raw: JsonValue, expected: number) {
      const validated = settingSchemas[key].safeParse(raw);
      if (!validated.success) throw new AtlasProblem(400, "invalid-setting");
      const value = validated.data;
      return database.scoped(context.site.id, async (tx) => {
        const encoded = JSON.stringify(value);
        const [row] =
          expected === 0
            ? await tx.query<{
                version: number;
              }>(sql`insert into site_settings (site_id, key, value)
              values (${context.site.id}, ${key}, ${encoded}::jsonb) on conflict do nothing returning version`)
            : await tx.query<{
                version: number;
              }>(sql`update site_settings set value = ${encoded}::jsonb, version = version + 1
              where site_id = ${context.site.id} and key = ${key} and version = ${expected} returning version`);
        if (!row) throw new AtlasProblem(412, "version-conflict");
        if (key === "site.locale")
          await tx.query(sql`update sites set locale = ${value} where id = ${context.site.id}`);
        if (key === "site.time-zone")
          await tx.query(sql`update sites set time_zone = ${value} where id = ${context.site.id}`);
        await audit(tx, context, "system.setting.changed", { key, version: row.version });
        return { key, value, version: row.version };
      });
    },
  };
}
