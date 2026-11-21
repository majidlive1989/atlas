import {
  audit,
  coreCapabilities,
  sql,
  type AuditContext,
  type Capability,
  type Database,
  type DbSession,
} from "@atlas/db";

export type { Capability } from "@atlas/db";

export type AuthErrorCode =
  | "invalid-credentials"
  | "second-factor-required"
  | "verification-required"
  | "invalid-challenge"
  | "invalid-factor"
  | "forbidden"
  | "not-found"
  | "conflict"
  | "oidc-unavailable";

export class AuthError extends Error {
  constructor(readonly code: AuthErrorCode) {
    super(code);
    this.name = "AuthError";
  }
}

export interface Principal {
  readonly userId: string;
  readonly siteId: string;
  readonly tenantId: string;
  readonly sessionId?: string;
  readonly keyId?: string;
  readonly capabilities: ReadonlySet<string>;
}

export interface ProtectedResource {
  readonly siteId: string;
  readonly ownerId?: string;
  readonly status?: "draft" | "published";
}

export function can(
  principal: Principal,
  action: Capability | "edit",
  resource: ProtectedResource,
): boolean {
  if (principal.siteId !== resource.siteId) return false;
  if (action !== "edit") return principal.capabilities.has(action);
  if (principal.capabilities.has("content.post.edit-any")) return true;
  return (
    principal.capabilities.has("content.post.edit") &&
    principal.userId === resource.ownerId &&
    (resource.status !== "published" || principal.capabilities.has("content.post.publish"))
  );
}

export async function loadCapabilities(
  tx: DbSession,
  siteId: string,
  userId: string,
): Promise<Set<string>> {
  const rows = await tx.query<{ capability_key: string }>(sql`select distinct r.capability_key
    from member_roles m join role_capabilities r on r.site_id = m.site_id and r.role_id = m.role_id
    where m.site_id = ${siteId} and m.user_id = ${userId}`);
  return new Set(rows.map((row) => row.capability_key));
}

export function verifyDelegation(principal: Principal, capabilities: readonly string[]): void {
  if (capabilities.some((key) => !Object.hasOwn(coreCapabilities, key)))
    throw new AuthError("not-found");
  if (capabilities.some((key) => !principal.capabilities.has(key)))
    throw new AuthError("forbidden");
}

type RoleRow = {
  id: string;
  key: string;
  label: string;
  reserved: boolean;
  capabilities: string[];
};

export function createAccessService(database: Database) {
  return {
    capabilities: () => Object.entries(coreCapabilities).map(([key, label]) => ({ key, label })),
    roles(context: AuditContext) {
      return database.scoped(context.site.id, (tx) =>
        tx.query<RoleRow>(sql`
        select r.id, r.key, r.label, r.reserved, coalesce(array_agg(c.capability_key order by c.capability_key)
          filter (where c.capability_key is not null), '{}') as capabilities
        from roles r left join role_capabilities c on c.site_id = r.site_id and c.role_id = r.id
        where r.site_id = ${context.site.id} group by r.site_id, r.id order by r.key`),
      );
    },
    writeRole(
      context: AuditContext,
      principal: Principal,
      input: { key: string; label: string; capabilities: string[] },
    ) {
      if (!can(principal, "identity.role.manage", { siteId: context.site.id }))
        throw new AuthError("forbidden");
      verifyDelegation(principal, input.capabilities);
      return database.scoped(context.site.id, async (tx) => {
        const [role] = await tx.query<{ id: string }>(sql`insert into roles (site_id, key, label)
          values (${context.site.id}, ${input.key}, ${input.label})
          on conflict (site_id, key) do update set label = excluded.label where not roles.reserved returning id`);
        if (!role) throw new AuthError("forbidden");
        // An operator must be allowed to delegate the current grants before editing a more powerful role.
        const current = await tx.query<{ capability_key: string }>(sql`select capability_key
          from role_capabilities where site_id = ${context.site.id} and role_id = ${role.id}`);
        verifyDelegation(
          principal,
          current.map((entry) => entry.capability_key),
        );
        await tx.query(
          sql`delete from role_capabilities where site_id = ${context.site.id} and role_id = ${role.id}`,
        );
        for (const capability of new Set(input.capabilities)) {
          await tx.query(sql`insert into role_capabilities (site_id, role_id, capability_key)
            values (${context.site.id}, ${role.id}, ${capability})`);
        }
        await audit(tx, context, "identity.role.changed", { roleId: role.id });
        return role.id;
      });
    },
    assignRole(
      context: AuditContext,
      principal: Principal,
      userId: string,
      key: string,
      assigned: boolean,
    ) {
      if (!can(principal, "identity.role.manage", { siteId: context.site.id }))
        throw new AuthError("forbidden");
      return database.scoped(context.site.id, async (tx) => {
        const [role] = await tx.query<{
          id: string;
        }>(sql`select id from roles where site_id = ${context.site.id}
          and key = ${key} for update`);
        const [member] = await tx.query(sql`select user_id from site_members
          where site_id = ${context.site.id} and user_id = ${userId} and state = 'active'`);
        if (!role || !member) throw new AuthError("not-found");
        const grants = await tx.query<{ capability_key: string }>(sql`select capability_key
          from role_capabilities where site_id = ${context.site.id} and role_id = ${role.id}`);
        verifyDelegation(
          principal,
          grants.map((grant) => grant.capability_key),
        );
        if (assigned) {
          await tx.query(sql`insert into member_roles (site_id, user_id, role_id)
            values (${context.site.id}, ${userId}, ${role.id}) on conflict do nothing`);
        } else {
          if (key === "administrator") {
            const others = await tx.query(sql`select m.user_id from member_roles m
              join site_members s on s.site_id=m.site_id and s.user_id=m.user_id
              join identities u on u.id=m.user_id
              where m.site_id = ${context.site.id} and m.role_id = ${role.id} and m.user_id != ${userId}
              and s.state = 'active' and u.state = 'active' limit 1`);
            if (!others.length) throw new AuthError("conflict");
          }
          await tx.query(sql`delete from member_roles where site_id = ${context.site.id}
            and role_id = ${role.id} and user_id = ${userId}`);
        }
        await audit(tx, context, assigned ? "identity.role.assigned" : "identity.role.removed", {
          userId,
          roleId: role.id,
        });
      });
    },
  };
}
