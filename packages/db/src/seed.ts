import { sql } from "drizzle-orm";
import {
  audit,
  normalizeHostname,
  scopeSession,
  type Database,
  type DbSession,
  type Site,
} from "./database.js";

export const coreCapabilities = {
  "identity.user.read": "identity:capability.user-read",
  "identity.user.create": "identity:capability.user-create",
  "identity.role.read": "identity:capability.role-read",
  "identity.role.manage": "identity:capability.role-manage",
  "system.setting.read": "system:capability.setting-read",
  "system.setting.write": "system:capability.setting-write",
  "extension.plugin.read": "extension:capability.plugin-read",
  "extension.plugin.manage": "extension:capability.plugin-manage",
  "content.post.edit": "content:capability.post-edit",
  "content.post.edit-any": "content:capability.post-edit-any",
  "content.post.publish": "content:capability.post-publish",
} as const;

export type Capability = keyof typeof coreCapabilities;

const roles: Readonly<Record<string, readonly Capability[]>> = {
  administrator: Object.keys(coreCapabilities) as Capability[],
  editor: ["content.post.edit", "content.post.edit-any", "content.post.publish"],
  author: ["content.post.edit", "content.post.publish"],
  contributor: ["content.post.edit"],
  subscriber: [],
  shop_manager: [],
  customer: [],
};

async function seedRoles(tx: DbSession, siteId: string): Promise<void> {
  for (const [key, label] of Object.entries(coreCapabilities)) {
    await tx.query(
      sql`insert into capabilities (key, label) values (${key}, ${label}) on conflict do nothing`,
    );
  }
  for (const [key, grants] of Object.entries(roles)) {
    await tx.query(sql`insert into roles (site_id, key, label, reserved)
      values (${siteId}, ${key}, ${"identity:role." + key.replaceAll("_", "-")}, true) on conflict do nothing`);
    for (const capability of grants) {
      await tx.query(sql`insert into role_capabilities (site_id, role_id, capability_key)
        select site_id, id, ${capability} from roles where site_id = ${siteId} and key = ${key}
        on conflict do nothing`);
    }
  }
}

export interface SeedOptions {
  readonly hostname: string;
  readonly tenant: string;
  readonly site: string;
  readonly email: string;
  readonly passwordHash: string;
}

export async function seed(database: Database, options: SeedOptions): Promise<Site> {
  const hostname = normalizeHostname(options.hostname);
  if (!hostname) throw new Error("Invalid seed hostname.");
  return database.transaction(async (tx) => {
    await tx.query(sql`select pg_advisory_xact_lock(125630, 2)`);
    const [site] = await tx.query<Site>(sql`
      with tenant as (insert into tenants (slug) values (${options.tenant})
        on conflict (slug) do update set slug = excluded.slug returning id)
      insert into sites (tenant_id, slug) select id, ${options.site} from tenant
        on conflict (tenant_id, slug) do update set slug = excluded.slug
        returning id, tenant_id as "tenantId", locale, slug`);
    if (!site) throw new Error("Seed could not establish the site.");
    await tx.query(sql`insert into site_domains (hostname, site_id) values (${hostname}, ${site.id})
      on conflict (hostname) do nothing`);
    const [domain] = await tx.query<{ site_id: string }>(
      sql`select site_id from site_domains where hostname = ${hostname}`,
    );
    if (domain?.site_id !== site.id) throw new Error("Seed hostname is already assigned.");
    await scopeSession(tx, site.id);
    await seedRoles(tx, site.id);
    const [user] = await tx.query<{
      id: string;
    }>(sql`insert into identities (email, password_hash, verified_at)
      values (${options.email}, ${options.passwordHash}, now()) on conflict (email) do nothing returning id`);
    if (!user) {
      const [owner] = await tx.query(sql`select u.id from identities u
        join member_roles m on m.user_id = u.id join roles r on r.site_id = m.site_id and r.id = m.role_id
        where u.email = ${options.email} and m.site_id = ${site.id} and r.key = 'administrator'`);
      if (!owner) throw new Error("Seed cannot elevate an existing identity.");
      return site;
    }
    await tx.query(
      sql`insert into site_members (site_id, user_id) values (${site.id}, ${user.id})`,
    );
    await tx.query(sql`insert into user_profiles (site_id, user_id, display_name)
      values (${site.id}, ${user.id}, ${options.email})`);
    await tx.query(sql`insert into member_roles (site_id, user_id, role_id) select site_id, ${user.id}, id
      from roles where site_id = ${site.id} and key = 'administrator'`);
    await audit(tx, { site, correlationId: "operator-seed" }, "identity.user.seeded", {
      userId: user.id,
    });
    return site;
  });
}
