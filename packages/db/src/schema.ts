import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export const tenants = pgTable(
  "tenants",
  {
    id: uuid("id").notNull().defaultRandom(),
    slug: text("slug").notNull(),
    state: text("state").notNull().default("active"),
  },
  (t) => [
    primaryKey({ name: "tenants_pk", columns: [t.id] }),
    unique("tenants_unique_1").on(t.slug),
    check("tenants_state_check", sql`state in ('active', 'suspended')`),
  ],
);

export const sites = pgTable(
  "sites",
  {
    id: uuid("id").notNull().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    slug: text("slug").notNull(),
    locale: text("locale").notNull().default("en"),
    timeZone: text("time_zone").notNull().default("UTC"),
    state: text("state").notNull().default("active"),
  },
  (t) => [
    primaryKey({ name: "sites_pk", columns: [t.id] }),
    foreignKey({ name: "sites_fk_1", columns: [t.tenantId], foreignColumns: [tenants.id] }),
    unique("sites_unique_1").on(t.tenantId, t.slug),
    unique("sites_unique_2").on(t.tenantId, t.id),
    check("sites_state_check", sql`state in ('active', 'suspended')`),
  ],
);

export const siteDomains = pgTable(
  "site_domains",
  {
    hostname: text("hostname").notNull(),
    siteId: uuid("site_id").notNull(),
    canonical: boolean("canonical").notNull().default(true),
  },
  (t) => [
    primaryKey({ name: "site_domains_pk", columns: [t.hostname] }),
    foreignKey({ name: "site_domains_fk_1", columns: [t.siteId], foreignColumns: [sites.id] }),
    uniqueIndex("site_domains_canonical_idx")
      .on(t.siteId)
      .where(sql`canonical`),
  ],
);

export const identities = pgTable(
  "identities",
  {
    id: uuid("id").notNull().defaultRandom(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    failedAttempts: integer("failed_attempts").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    state: text("state").notNull().default("active"),
  },
  (t) => [
    primaryKey({ name: "identities_pk", columns: [t.id] }),
    unique("identities_unique_1").on(t.email),
    check("identities_state_check", sql`state in ('active', 'disabled')`),
  ],
);

export const siteMembers = pgTable(
  "site_members",
  {
    siteId: uuid("site_id").notNull(),
    userId: uuid("user_id").notNull(),
    state: text("state").notNull().default("active"),
  },
  (t) => [
    primaryKey({ name: "site_members_pk", columns: [t.siteId, t.userId] }),
    foreignKey({ name: "site_members_fk_1", columns: [t.siteId], foreignColumns: [sites.id] }),
    foreignKey({ name: "site_members_fk_2", columns: [t.userId], foreignColumns: [identities.id] }),
    check("site_members_state_check", sql`state in ('active', 'disabled')`),
  ],
);

export const roles = pgTable(
  "roles",
  {
    siteId: uuid("site_id").notNull(),
    id: uuid("id").notNull().defaultRandom(),
    key: text("key").notNull(),
    label: text("label").notNull(),
    reserved: boolean("reserved").notNull().default(false),
  },
  (t) => [
    primaryKey({ name: "roles_pk", columns: [t.siteId, t.id] }),
    foreignKey({ name: "roles_fk_1", columns: [t.siteId], foreignColumns: [sites.id] }),
    unique("roles_unique_1").on(t.siteId, t.key),
  ],
);

export const capabilities = pgTable(
  "capabilities",
  {
    key: text("key").notNull(),
    label: text("label").notNull(),
  },
  (t) => [primaryKey({ name: "capabilities_pk", columns: [t.key] })],
);

export const roleCapabilities = pgTable(
  "role_capabilities",
  {
    siteId: uuid("site_id").notNull(),
    roleId: uuid("role_id").notNull(),
    capabilityKey: text("capability_key").notNull(),
  },
  (t) => [
    primaryKey({ name: "role_capabilities_pk", columns: [t.siteId, t.roleId, t.capabilityKey] }),
    foreignKey({
      name: "role_capabilities_fk_1",
      columns: [t.siteId, t.roleId],
      foreignColumns: [roles.siteId, roles.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "role_capabilities_fk_2",
      columns: [t.capabilityKey],
      foreignColumns: [capabilities.key],
    }),
  ],
);

export const memberRoles = pgTable(
  "member_roles",
  {
    siteId: uuid("site_id").notNull(),
    userId: uuid("user_id").notNull(),
    roleId: uuid("role_id").notNull(),
  },
  (t) => [
    primaryKey({ name: "member_roles_pk", columns: [t.siteId, t.userId, t.roleId] }),
    foreignKey({
      name: "member_roles_fk_1",
      columns: [t.siteId, t.userId],
      foreignColumns: [siteMembers.siteId, siteMembers.userId],
    }).onDelete("cascade"),
    foreignKey({
      name: "member_roles_fk_2",
      columns: [t.siteId, t.roleId],
      foreignColumns: [roles.siteId, roles.id],
    }),
    index("member_roles_idx_1").on(t.siteId, t.roleId),
  ],
);

export const userProfiles = pgTable(
  "user_profiles",
  {
    siteId: uuid("site_id").notNull(),
    userId: uuid("user_id").notNull(),
    displayName: text("display_name").notNull(),
    locale: text("locale").notNull().default("en"),
    meta: jsonb("meta").$type<JsonValue>().notNull().default({}),
  },
  (t) => [
    primaryKey({ name: "user_profiles_pk", columns: [t.siteId, t.userId] }),
    foreignKey({
      name: "user_profiles_fk_1",
      columns: [t.siteId, t.userId],
      foreignColumns: [siteMembers.siteId, siteMembers.userId],
    }).onDelete("cascade"),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").notNull().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    siteId: uuid("site_id").notNull(),
    userId: uuid("user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    primaryKey({ name: "sessions_pk", columns: [t.id] }),
    foreignKey({
      name: "sessions_fk_1",
      columns: [t.tenantId, t.siteId],
      foreignColumns: [sites.tenantId, sites.id],
    }),
    foreignKey({
      name: "sessions_fk_2",
      columns: [t.siteId, t.userId],
      foreignColumns: [siteMembers.siteId, siteMembers.userId],
    }),
    unique("sessions_unique_1").on(t.siteId, t.id),
    index("sessions_idx_1").on(t.siteId, t.userId),
  ],
);

export const refreshCredentials = pgTable(
  "refresh_credentials",
  {
    id: uuid("id").notNull().defaultRandom(),
    siteId: uuid("site_id").notNull(),
    sessionId: uuid("session_id").notNull(),
    previousId: uuid("previous_id"),
    digest: text("digest").notNull(),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
  },
  (t) => [
    primaryKey({ name: "refresh_credentials_pk", columns: [t.id] }),
    foreignKey({
      name: "refresh_credentials_fk_1",
      columns: [t.siteId, t.sessionId],
      foreignColumns: [sessions.siteId, sessions.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "refresh_credentials_fk_2",
      columns: [t.sessionId, t.previousId],
      foreignColumns: [t.sessionId, t.id],
    }),
    unique("refresh_credentials_unique_1").on(t.siteId, t.digest),
    unique("refresh_credentials_unique_2").on(t.sessionId, t.id),
    unique("refresh_credentials_unique_3").on(t.previousId),
    index("refresh_credentials_idx_1").on(t.siteId, t.sessionId),
  ],
);

export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").notNull().defaultRandom(),
    siteId: uuid("site_id").notNull(),
    userId: uuid("user_id").notNull(),
    digest: text("digest").notNull(),
    label: text("label").notNull(),
    scopes: jsonb("scopes").$type<JsonValue>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    primaryKey({ name: "api_keys_pk", columns: [t.id] }),
    foreignKey({
      name: "api_keys_fk_1",
      columns: [t.siteId, t.userId],
      foreignColumns: [siteMembers.siteId, siteMembers.userId],
    }),
    unique("api_keys_unique_1").on(t.siteId, t.digest),
    index("api_keys_idx_1").on(t.siteId, t.userId),
  ],
);

export const authFactors = pgTable(
  "auth_factors",
  {
    userId: uuid("user_id").notNull(),
    encryptedSecret: text("encrypted_secret").notNull(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    lastCounter: bigint("last_counter", { mode: "number" }),
  },
  (t) => [
    primaryKey({ name: "auth_factors_pk", columns: [t.userId] }),
    foreignKey({
      name: "auth_factors_fk_1",
      columns: [t.userId],
      foreignColumns: [identities.id],
    }).onDelete("cascade"),
  ],
);

export const pendingFactors = pgTable(
  "pending_factors",
  {
    userId: uuid("user_id").notNull(),
    encryptedSecret: text("encrypted_secret").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    primaryKey({ name: "pending_factors_pk", columns: [t.userId] }),
    foreignKey({
      name: "pending_factors_fk_1",
      columns: [t.userId],
      foreignColumns: [identities.id],
    }).onDelete("cascade"),
  ],
);

export const recoveryCodes = pgTable(
  "recovery_codes",
  {
    userId: uuid("user_id").notNull(),
    digest: text("digest").notNull(),
  },
  (t) => [
    primaryKey({ name: "recovery_codes_pk", columns: [t.userId, t.digest] }),
    foreignKey({
      name: "recovery_codes_fk_1",
      columns: [t.userId],
      foreignColumns: [authFactors.userId],
    }).onDelete("cascade"),
  ],
);

export const accountChallenges = pgTable(
  "account_challenges",
  {
    digest: text("digest").notNull(),
    siteId: uuid("site_id").notNull(),
    userId: uuid("user_id").notNull(),
    kind: text("kind").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
  },
  (t) => [
    primaryKey({ name: "account_challenges_pk", columns: [t.digest] }),
    foreignKey({
      name: "account_challenges_fk_1",
      columns: [t.siteId, t.userId],
      foreignColumns: [siteMembers.siteId, siteMembers.userId],
    }).onDelete("cascade"),
    check("account_challenges_kind_check", sql`kind in ('verify', 'reset')`),
    index("account_challenges_idx_1").on(t.siteId, t.userId, t.kind),
  ],
);

export const externalIdentities = pgTable(
  "external_identities",
  {
    issuer: text("issuer").notNull(),
    subject: text("subject").notNull(),
    userId: uuid("user_id").notNull(),
  },
  (t) => [
    primaryKey({ name: "external_identities_pk", columns: [t.issuer, t.subject] }),
    foreignKey({
      name: "external_identities_fk_1",
      columns: [t.userId],
      foreignColumns: [identities.id],
    }).onDelete("cascade"),
    unique("external_identities_unique_1").on(t.issuer, t.userId),
  ],
);

export const oidcFlows = pgTable(
  "oidc_flows",
  {
    digest: text("digest").notNull(),
    siteId: uuid("site_id").notNull(),
    userId: uuid("user_id"),
    encryptedPayload: text("encrypted_payload").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    primaryKey({ name: "oidc_flows_pk", columns: [t.digest] }),
    foreignKey({ name: "oidc_flows_fk_1", columns: [t.siteId], foreignColumns: [sites.id] }),
    foreignKey({
      name: "oidc_flows_fk_2",
      columns: [t.siteId, t.userId],
      foreignColumns: [siteMembers.siteId, siteMembers.userId],
    }),
    index("oidc_flows_idx_1").on(t.siteId, t.expiresAt),
  ],
);

export const siteSettings = pgTable(
  "site_settings",
  {
    siteId: uuid("site_id").notNull(),
    key: text("key").notNull(),
    value: jsonb("value").$type<JsonValue>().notNull(),
    version: integer("version").notNull().default(1),
    schemaVersion: integer("schema_version").notNull().default(1),
  },
  (t) => [
    primaryKey({ name: "site_settings_pk", columns: [t.siteId, t.key] }),
    foreignKey({ name: "site_settings_fk_1", columns: [t.siteId], foreignColumns: [sites.id] }),
  ],
);

export const tenantSettings = pgTable(
  "tenant_settings",
  {
    tenantId: uuid("tenant_id").notNull(),
    key: text("key").notNull(),
    value: jsonb("value").$type<JsonValue>().notNull(),
    version: integer("version").notNull().default(1),
  },
  (t) => [
    primaryKey({ name: "tenant_settings_pk", columns: [t.tenantId, t.key] }),
    foreignKey({
      name: "tenant_settings_fk_1",
      columns: [t.tenantId],
      foreignColumns: [tenants.id],
    }),
  ],
);

export const auditEntries = pgTable(
  "audit_entries",
  {
    id: uuid("id").notNull().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    siteId: uuid("site_id").notNull(),
    actorId: uuid("actor_id"),
    action: text("action").notNull(),
    correlationId: text("correlation_id").notNull(),
    details: jsonb("details").$type<JsonValue>().notNull().default({}),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: "audit_entries_pk", columns: [t.id] }),
    foreignKey({
      name: "audit_entries_fk_1",
      columns: [t.tenantId, t.siteId],
      foreignColumns: [sites.tenantId, sites.id],
    }),
    foreignKey({
      name: "audit_entries_fk_2",
      columns: [t.actorId],
      foreignColumns: [identities.id],
    }),
    index("audit_entries_idx_1").on(t.siteId, t.recordedAt),
  ],
);

export const jobSchedules = pgTable(
  "job_schedules",
  {
    id: uuid("id").notNull().defaultRandom(),
    siteId: uuid("site_id").notNull(),
    name: text("name").notNull(),
    expression: text("expression").notNull(),
    timeZone: text("time_zone").notNull(),
    nextAt: timestamp("next_at", { withTimezone: true }).notNull(),
    payload: jsonb("payload").$type<JsonValue>().notNull().default({}),
  },
  (t) => [
    primaryKey({ name: "job_schedules_pk", columns: [t.id] }),
    foreignKey({ name: "job_schedules_fk_1", columns: [t.siteId], foreignColumns: [sites.id] }),
    index("job_schedules_idx_1").on(t.siteId, t.nextAt),
  ],
);

export const jobEffects = pgTable(
  "job_effects",
  {
    siteId: uuid("site_id").notNull(),
    dedupeKey: text("dedupe_key").notNull(),
    state: text("state").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: "job_effects_pk", columns: [t.siteId, t.dedupeKey] }),
    foreignKey({ name: "job_effects_fk_1", columns: [t.siteId], foreignColumns: [sites.id] }),
  ],
);

export const outboxEvents = pgTable(
  "outbox_events",
  {
    id: uuid("id").notNull().defaultRandom(),
    siteId: uuid("site_id").notNull(),
    name: text("name").notNull(),
    schemaVersion: integer("schema_version").notNull().default(1),
    correlationId: text("correlation_id").notNull(),
    payload: jsonb("payload").$type<JsonValue>().notNull().default({}),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    dispatchedAt: timestamp("dispatched_at", { withTimezone: true }),
  },
  (t) => [
    primaryKey({ name: "outbox_events_pk", columns: [t.id] }),
    foreignKey({ name: "outbox_events_fk_1", columns: [t.siteId], foreignColumns: [sites.id] }),
    index("outbox_events_idx_1").on(t.siteId, t.dispatchedAt, t.occurredAt),
  ],
);

export const pluginReleases = pgTable(
  "plugin_releases",
  {
    slug: text("slug").notNull(),
    version: text("version").notNull(),
    digest: text("digest").notNull(),
    manifest: jsonb("manifest").$type<JsonValue>().notNull(),
  },
  (t) => [primaryKey({ name: "plugin_releases_pk", columns: [t.slug, t.version] })],
);

export const pluginActivations = pgTable(
  "plugin_activations",
  {
    siteId: uuid("site_id").notNull(),
    slug: text("slug").notNull(),
    version: text("version").notNull(),
    state: text("state").notNull().default("inactive"),
    settings: jsonb("settings").$type<JsonValue>().notNull().default({}),
    settingsVersion: integer("settings_version").notNull().default(1),
  },
  (t) => [
    primaryKey({ name: "plugin_activations_pk", columns: [t.siteId, t.slug] }),
    foreignKey({
      name: "plugin_activations_fk_1",
      columns: [t.siteId],
      foreignColumns: [sites.id],
    }),
    foreignKey({
      name: "plugin_activations_fk_2",
      columns: [t.slug, t.version],
      foreignColumns: [pluginReleases.slug, pluginReleases.version],
    }),
    check("plugin_activations_state_check", sql`state in ('inactive', 'active', 'faulted')`),
    index("plugin_activations_idx_1").on(t.slug, t.version),
  ],
);

export const pluginMigrations = pgTable(
  "plugin_migrations",
  {
    slug: text("slug").notNull(),
    version: integer("version").notNull(),
    checksum: text("checksum").notNull(),
    appliedAt: timestamp("applied_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ name: "plugin_migrations_pk", columns: [t.slug, t.version] })],
);

export const coreMigrations = pgTable("core_migrations", {
  version: text("version").primaryKey(),
  checksum: text("checksum").notNull(),
  appliedAt: timestamp("applied_at", { withTimezone: true }).notNull().defaultNow(),
});
