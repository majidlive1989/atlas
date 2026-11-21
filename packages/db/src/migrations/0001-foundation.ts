export const coreV1 = {
  version: "0001-foundation",
  up: `
CREATE TABLE tenants (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  slug text NOT NULL,
  state text NOT NULL DEFAULT 'active',
  CONSTRAINT tenants_pk PRIMARY KEY (id),
  CONSTRAINT tenants_unique_1 UNIQUE (slug),
  CONSTRAINT tenants_state_check CHECK (state in ('active', 'suspended'))
);


CREATE TABLE sites (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  slug text NOT NULL,
  locale text NOT NULL DEFAULT 'en',
  time_zone text NOT NULL DEFAULT 'UTC',
  state text NOT NULL DEFAULT 'active',
  CONSTRAINT sites_pk PRIMARY KEY (id),
  CONSTRAINT sites_fk_1 FOREIGN KEY (tenant_id) REFERENCES tenants (id),
  CONSTRAINT sites_unique_1 UNIQUE (tenant_id,slug),
  CONSTRAINT sites_unique_2 UNIQUE (tenant_id,id),
  CONSTRAINT sites_state_check CHECK (state in ('active', 'suspended'))
);


CREATE TABLE site_domains (
  hostname text NOT NULL,
  site_id uuid NOT NULL,
  canonical boolean NOT NULL DEFAULT true,
  CONSTRAINT site_domains_pk PRIMARY KEY (hostname),
  CONSTRAINT site_domains_fk_1 FOREIGN KEY (site_id) REFERENCES sites (id)
);
CREATE UNIQUE INDEX site_domains_canonical_idx ON site_domains (site_id) WHERE canonical;

CREATE TABLE identities (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  email text NOT NULL,
  password_hash text NOT NULL,
  verified_at timestamptz,
  failed_attempts integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  state text NOT NULL DEFAULT 'active',
  CONSTRAINT identities_pk PRIMARY KEY (id),
  CONSTRAINT identities_unique_1 UNIQUE (email),
  CONSTRAINT identities_state_check CHECK (state in ('active', 'disabled'))
);


CREATE TABLE site_members (
  site_id uuid NOT NULL,
  user_id uuid NOT NULL,
  state text NOT NULL DEFAULT 'active',
  CONSTRAINT site_members_pk PRIMARY KEY (site_id, user_id),
  CONSTRAINT site_members_fk_1 FOREIGN KEY (site_id) REFERENCES sites (id),
  CONSTRAINT site_members_fk_2 FOREIGN KEY (user_id) REFERENCES identities (id),
  CONSTRAINT site_members_state_check CHECK (state in ('active', 'disabled'))
);
ALTER TABLE site_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_members FORCE ROW LEVEL SECURITY;
CREATE POLICY atlas_site ON site_members USING (site_id = nullif(current_setting('atlas.site_id', true), '')::uuid) WITH CHECK (site_id = nullif(current_setting('atlas.site_id', true), '')::uuid);

CREATE TABLE roles (
  site_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  key text NOT NULL,
  label text NOT NULL,
  reserved boolean NOT NULL DEFAULT false,
  CONSTRAINT roles_pk PRIMARY KEY (site_id, id),
  CONSTRAINT roles_fk_1 FOREIGN KEY (site_id) REFERENCES sites (id),
  CONSTRAINT roles_unique_1 UNIQUE (site_id,key)
);
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles FORCE ROW LEVEL SECURITY;
CREATE POLICY atlas_site ON roles USING (site_id = nullif(current_setting('atlas.site_id', true), '')::uuid) WITH CHECK (site_id = nullif(current_setting('atlas.site_id', true), '')::uuid);

CREATE TABLE capabilities (
  key text NOT NULL,
  label text NOT NULL,
  CONSTRAINT capabilities_pk PRIMARY KEY (key)
);


CREATE TABLE role_capabilities (
  site_id uuid NOT NULL,
  role_id uuid NOT NULL,
  capability_key text NOT NULL,
  CONSTRAINT role_capabilities_pk PRIMARY KEY (site_id, role_id, capability_key),
  CONSTRAINT role_capabilities_fk_1 FOREIGN KEY (site_id,role_id) REFERENCES roles (site_id,id) ON DELETE CASCADE,
  CONSTRAINT role_capabilities_fk_2 FOREIGN KEY (capability_key) REFERENCES capabilities (key)
);
ALTER TABLE role_capabilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_capabilities FORCE ROW LEVEL SECURITY;
CREATE POLICY atlas_site ON role_capabilities USING (site_id = nullif(current_setting('atlas.site_id', true), '')::uuid) WITH CHECK (site_id = nullif(current_setting('atlas.site_id', true), '')::uuid);

CREATE TABLE member_roles (
  site_id uuid NOT NULL,
  user_id uuid NOT NULL,
  role_id uuid NOT NULL,
  CONSTRAINT member_roles_pk PRIMARY KEY (site_id, user_id, role_id),
  CONSTRAINT member_roles_fk_1 FOREIGN KEY (site_id,user_id) REFERENCES site_members (site_id,user_id) ON DELETE CASCADE,
  CONSTRAINT member_roles_fk_2 FOREIGN KEY (site_id,role_id) REFERENCES roles (site_id,id)
);
CREATE INDEX member_roles_idx_1 ON member_roles (site_id,role_id);
ALTER TABLE member_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE member_roles FORCE ROW LEVEL SECURITY;
CREATE POLICY atlas_site ON member_roles USING (site_id = nullif(current_setting('atlas.site_id', true), '')::uuid) WITH CHECK (site_id = nullif(current_setting('atlas.site_id', true), '')::uuid);

CREATE TABLE user_profiles (
  site_id uuid NOT NULL,
  user_id uuid NOT NULL,
  display_name text NOT NULL,
  locale text NOT NULL DEFAULT 'en',
  meta jsonb NOT NULL DEFAULT '{}',
  CONSTRAINT user_profiles_pk PRIMARY KEY (site_id, user_id),
  CONSTRAINT user_profiles_fk_1 FOREIGN KEY (site_id,user_id) REFERENCES site_members (site_id,user_id) ON DELETE CASCADE
);
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profiles FORCE ROW LEVEL SECURITY;
CREATE POLICY atlas_site ON user_profiles USING (site_id = nullif(current_setting('atlas.site_id', true), '')::uuid) WITH CHECK (site_id = nullif(current_setting('atlas.site_id', true), '')::uuid);

CREATE TABLE sessions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  site_id uuid NOT NULL,
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CONSTRAINT sessions_pk PRIMARY KEY (id),
  CONSTRAINT sessions_fk_1 FOREIGN KEY (tenant_id,site_id) REFERENCES sites (tenant_id,id),
  CONSTRAINT sessions_fk_2 FOREIGN KEY (site_id,user_id) REFERENCES site_members (site_id,user_id),
  CONSTRAINT sessions_unique_1 UNIQUE (site_id,id)
);
CREATE INDEX sessions_idx_1 ON sessions (site_id,user_id);
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY atlas_site ON sessions USING (site_id = nullif(current_setting('atlas.site_id', true), '')::uuid) WITH CHECK (site_id = nullif(current_setting('atlas.site_id', true), '')::uuid);

CREATE TABLE refresh_credentials (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL,
  session_id uuid NOT NULL,
  previous_id uuid,
  digest text NOT NULL,
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  CONSTRAINT refresh_credentials_pk PRIMARY KEY (id),
  CONSTRAINT refresh_credentials_fk_1 FOREIGN KEY (site_id,session_id) REFERENCES sessions (site_id,id) ON DELETE CASCADE,
  CONSTRAINT refresh_credentials_fk_2 FOREIGN KEY (session_id,previous_id) REFERENCES refresh_credentials (session_id,id),
  CONSTRAINT refresh_credentials_unique_1 UNIQUE (site_id,digest),
  CONSTRAINT refresh_credentials_unique_2 UNIQUE (session_id,id),
  CONSTRAINT refresh_credentials_unique_3 UNIQUE (previous_id)
);
CREATE INDEX refresh_credentials_idx_1 ON refresh_credentials (site_id,session_id);
ALTER TABLE refresh_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE refresh_credentials FORCE ROW LEVEL SECURITY;
CREATE POLICY atlas_site ON refresh_credentials USING (site_id = nullif(current_setting('atlas.site_id', true), '')::uuid) WITH CHECK (site_id = nullif(current_setting('atlas.site_id', true), '')::uuid);

CREATE TABLE api_keys (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL,
  user_id uuid NOT NULL,
  digest text NOT NULL,
  label text NOT NULL,
  scopes jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  CONSTRAINT api_keys_pk PRIMARY KEY (id),
  CONSTRAINT api_keys_fk_1 FOREIGN KEY (site_id,user_id) REFERENCES site_members (site_id,user_id),
  CONSTRAINT api_keys_unique_1 UNIQUE (site_id,digest)
);
CREATE INDEX api_keys_idx_1 ON api_keys (site_id,user_id);
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys FORCE ROW LEVEL SECURITY;
CREATE POLICY atlas_site ON api_keys USING (site_id = nullif(current_setting('atlas.site_id', true), '')::uuid) WITH CHECK (site_id = nullif(current_setting('atlas.site_id', true), '')::uuid);

CREATE TABLE auth_factors (
  user_id uuid NOT NULL,
  encrypted_secret text NOT NULL,
  confirmed_at timestamptz,
  last_counter bigint,
  CONSTRAINT auth_factors_pk PRIMARY KEY (user_id),
  CONSTRAINT auth_factors_fk_1 FOREIGN KEY (user_id) REFERENCES identities (id) ON DELETE CASCADE
);


CREATE TABLE pending_factors (
  user_id uuid NOT NULL,
  encrypted_secret text NOT NULL,
  expires_at timestamptz NOT NULL,
  CONSTRAINT pending_factors_pk PRIMARY KEY (user_id),
  CONSTRAINT pending_factors_fk_1 FOREIGN KEY (user_id) REFERENCES identities (id) ON DELETE CASCADE
);


CREATE TABLE recovery_codes (
  user_id uuid NOT NULL,
  digest text NOT NULL,
  CONSTRAINT recovery_codes_pk PRIMARY KEY (user_id, digest),
  CONSTRAINT recovery_codes_fk_1 FOREIGN KEY (user_id) REFERENCES auth_factors (user_id) ON DELETE CASCADE
);


CREATE TABLE account_challenges (
  digest text NOT NULL,
  site_id uuid NOT NULL,
  user_id uuid NOT NULL,
  kind text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  CONSTRAINT account_challenges_pk PRIMARY KEY (digest),
  CONSTRAINT account_challenges_fk_1 FOREIGN KEY (site_id,user_id) REFERENCES site_members (site_id,user_id) ON DELETE CASCADE,
  CONSTRAINT account_challenges_kind_check CHECK (kind in ('verify', 'reset'))
);
CREATE INDEX account_challenges_idx_1 ON account_challenges (site_id,user_id,kind);
ALTER TABLE account_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_challenges FORCE ROW LEVEL SECURITY;
CREATE POLICY atlas_site ON account_challenges USING (site_id = nullif(current_setting('atlas.site_id', true), '')::uuid) WITH CHECK (site_id = nullif(current_setting('atlas.site_id', true), '')::uuid);

CREATE TABLE external_identities (
  issuer text NOT NULL,
  subject text NOT NULL,
  user_id uuid NOT NULL,
  CONSTRAINT external_identities_pk PRIMARY KEY (issuer, subject),
  CONSTRAINT external_identities_fk_1 FOREIGN KEY (user_id) REFERENCES identities (id) ON DELETE CASCADE,
  CONSTRAINT external_identities_unique_1 UNIQUE (issuer,user_id)
);


CREATE TABLE oidc_flows (
  digest text NOT NULL,
  site_id uuid NOT NULL,
  user_id uuid,
  encrypted_payload text NOT NULL,
  expires_at timestamptz NOT NULL,
  CONSTRAINT oidc_flows_pk PRIMARY KEY (digest),
  CONSTRAINT oidc_flows_fk_1 FOREIGN KEY (site_id) REFERENCES sites (id),
  CONSTRAINT oidc_flows_fk_2 FOREIGN KEY (site_id,user_id) REFERENCES site_members (site_id,user_id)
);
CREATE INDEX oidc_flows_idx_1 ON oidc_flows (site_id,expires_at);
ALTER TABLE oidc_flows ENABLE ROW LEVEL SECURITY;
ALTER TABLE oidc_flows FORCE ROW LEVEL SECURITY;
CREATE POLICY atlas_site ON oidc_flows USING (site_id = nullif(current_setting('atlas.site_id', true), '')::uuid) WITH CHECK (site_id = nullif(current_setting('atlas.site_id', true), '')::uuid);

CREATE TABLE site_settings (
  site_id uuid NOT NULL,
  key text NOT NULL,
  value jsonb NOT NULL,
  version integer NOT NULL DEFAULT 1,
  schema_version integer NOT NULL DEFAULT 1,
  CONSTRAINT site_settings_pk PRIMARY KEY (site_id, key),
  CONSTRAINT site_settings_fk_1 FOREIGN KEY (site_id) REFERENCES sites (id)
);
ALTER TABLE site_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY atlas_site ON site_settings USING (site_id = nullif(current_setting('atlas.site_id', true), '')::uuid) WITH CHECK (site_id = nullif(current_setting('atlas.site_id', true), '')::uuid);

CREATE TABLE tenant_settings (
  tenant_id uuid NOT NULL,
  key text NOT NULL,
  value jsonb NOT NULL,
  version integer NOT NULL DEFAULT 1,
  CONSTRAINT tenant_settings_pk PRIMARY KEY (tenant_id, key),
  CONSTRAINT tenant_settings_fk_1 FOREIGN KEY (tenant_id) REFERENCES tenants (id)
);


CREATE TABLE audit_entries (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  site_id uuid NOT NULL,
  actor_id uuid,
  action text NOT NULL,
  correlation_id text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}',
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT audit_entries_pk PRIMARY KEY (id),
  CONSTRAINT audit_entries_fk_1 FOREIGN KEY (tenant_id,site_id) REFERENCES sites (tenant_id,id),
  CONSTRAINT audit_entries_fk_2 FOREIGN KEY (actor_id) REFERENCES identities (id)
);
CREATE INDEX audit_entries_idx_1 ON audit_entries (site_id,recorded_at);
ALTER TABLE audit_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_entries FORCE ROW LEVEL SECURITY;
CREATE POLICY atlas_site ON audit_entries USING (site_id = nullif(current_setting('atlas.site_id', true), '')::uuid) WITH CHECK (site_id = nullif(current_setting('atlas.site_id', true), '')::uuid);

CREATE TABLE job_schedules (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL,
  name text NOT NULL,
  expression text NOT NULL,
  time_zone text NOT NULL,
  next_at timestamptz NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  CONSTRAINT job_schedules_pk PRIMARY KEY (id),
  CONSTRAINT job_schedules_fk_1 FOREIGN KEY (site_id) REFERENCES sites (id)
);
CREATE INDEX job_schedules_idx_1 ON job_schedules (site_id,next_at);
ALTER TABLE job_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_schedules FORCE ROW LEVEL SECURITY;
CREATE POLICY atlas_site ON job_schedules USING (site_id = nullif(current_setting('atlas.site_id', true), '')::uuid) WITH CHECK (site_id = nullif(current_setting('atlas.site_id', true), '')::uuid);

CREATE TABLE job_effects (
  site_id uuid NOT NULL,
  dedupe_key text NOT NULL,
  state text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT job_effects_pk PRIMARY KEY (site_id, dedupe_key),
  CONSTRAINT job_effects_fk_1 FOREIGN KEY (site_id) REFERENCES sites (id)
);
ALTER TABLE job_effects ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_effects FORCE ROW LEVEL SECURITY;
CREATE POLICY atlas_site ON job_effects USING (site_id = nullif(current_setting('atlas.site_id', true), '')::uuid) WITH CHECK (site_id = nullif(current_setting('atlas.site_id', true), '')::uuid);

CREATE TABLE outbox_events (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL,
  name text NOT NULL,
  schema_version integer NOT NULL DEFAULT 1,
  correlation_id text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  occurred_at timestamptz NOT NULL DEFAULT now(),
  dispatched_at timestamptz,
  CONSTRAINT outbox_events_pk PRIMARY KEY (id),
  CONSTRAINT outbox_events_fk_1 FOREIGN KEY (site_id) REFERENCES sites (id)
);
CREATE INDEX outbox_events_idx_1 ON outbox_events (site_id,dispatched_at,occurred_at);
ALTER TABLE outbox_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE outbox_events FORCE ROW LEVEL SECURITY;
CREATE POLICY atlas_site ON outbox_events USING (site_id = nullif(current_setting('atlas.site_id', true), '')::uuid) WITH CHECK (site_id = nullif(current_setting('atlas.site_id', true), '')::uuid);

CREATE TABLE plugin_releases (
  slug text NOT NULL,
  version text NOT NULL,
  digest text NOT NULL,
  manifest jsonb NOT NULL,
  CONSTRAINT plugin_releases_pk PRIMARY KEY (slug, version)
);


CREATE TABLE plugin_activations (
  site_id uuid NOT NULL,
  slug text NOT NULL,
  version text NOT NULL,
  state text NOT NULL DEFAULT 'inactive',
  settings jsonb NOT NULL DEFAULT '{}',
  settings_version integer NOT NULL DEFAULT 1,
  CONSTRAINT plugin_activations_pk PRIMARY KEY (site_id, slug),
  CONSTRAINT plugin_activations_fk_1 FOREIGN KEY (site_id) REFERENCES sites (id),
  CONSTRAINT plugin_activations_fk_2 FOREIGN KEY (slug,version) REFERENCES plugin_releases (slug,version),
  CONSTRAINT plugin_activations_state_check CHECK (state in ('inactive', 'active', 'faulted'))
);
CREATE INDEX plugin_activations_idx_1 ON plugin_activations (slug,version);
ALTER TABLE plugin_activations ENABLE ROW LEVEL SECURITY;
ALTER TABLE plugin_activations FORCE ROW LEVEL SECURITY;
CREATE POLICY atlas_site ON plugin_activations USING (site_id = nullif(current_setting('atlas.site_id', true), '')::uuid) WITH CHECK (site_id = nullif(current_setting('atlas.site_id', true), '')::uuid);

CREATE TABLE plugin_migrations (
  slug text NOT NULL,
  version integer NOT NULL,
  checksum text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT plugin_migrations_pk PRIMARY KEY (slug, version)
);

`,
  down: `
DROP TABLE plugin_migrations;
DROP TABLE plugin_activations;
DROP TABLE plugin_releases;
DROP TABLE outbox_events;
DROP TABLE job_effects;
DROP TABLE job_schedules;
DROP TABLE audit_entries;
DROP TABLE tenant_settings;
DROP TABLE site_settings;
DROP TABLE oidc_flows;
DROP TABLE external_identities;
DROP TABLE account_challenges;
DROP TABLE recovery_codes;
DROP TABLE pending_factors;
DROP TABLE auth_factors;
DROP TABLE api_keys;
DROP TABLE refresh_credentials;
DROP TABLE sessions;
DROP TABLE user_profiles;
DROP TABLE member_roles;
DROP TABLE role_capabilities;
DROP TABLE capabilities;
DROP TABLE roles;
DROP TABLE site_members;
DROP TABLE identities;
DROP TABLE site_domains;
DROP TABLE sites;
DROP TABLE tenants;
`,
} as const;
