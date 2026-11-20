Read AGENTS.md, docs/architecture/*, docs/contracts/*, docs/reports/phase-0.md. Implement PHASE 1.

SCOPE
1. `@atlas/kernel`: app bootstrap, DI container, config (Zod-validated env), logger, error model (RFC 9457 problem details), lifecycle (boot, ready, shutdown), health/readiness endpoints, graceful shutdown.
2. `@atlas/db`: Drizzle schema + migrator for core tables: tenants/sites, users, roles, capabilities, role_capabilities, user_meta, sessions, refresh_tokens, api_keys, options, audit_log, jobs metadata, plugin registry (installed plugins, versions, state, settings), migrations ledger (core + per plugin). Seed script. Multi-tenant (site_id) support wired from day one.
3. `@atlas/auth`: Argon2id hashing; JWT access tokens (short TTL) + rotating refresh tokens with reuse detection and family revocation; account lockout and progressive delays; password reset and email verification flows (mail adapter); TOTP 2FA (enroll, verify, recovery codes); API keys with scopes; sessions list/revoke; OIDC provider interface with one generic implementation.
4. RBAC: capabilities registry, roles (administrator, editor, author, contributor, subscriber, + shop_manager, customer reserved), per-resource policies (`can(user, 'edit', resource)`), capability checks as Fastify hooks, role/capability editing API.
5. `@atlas/hooks`: typed `actions` and `filters` (priorities, async, error isolation, removal, once, introspection/debug mode listing registered callbacks) + typed event bus with an event catalog type map. Include a perf test and a type-level test.
6. Plugin loader (server side only): discover plugins from `plugins/` and `node_modules`, validate `plugin.json` (Zod), resolve dependency graph + semver `engines`, topologically order, lifecycle (install, activate, upgrade, deactivate, uninstall) with transaction + rollback, per-plugin migrations, per-plugin settings storage, crash isolation (a failing plugin is disabled, not fatal), activation state persisted.
7. `@atlas/cli` (`atlas`): `atlas dev|build|start`, `atlas db migrate|rollback|seed`, `atlas user create`, `atlas plugin list|activate|deactivate|install|uninstall`, `atlas doctor`.
8. API app skeleton in apps/api: auth routes, users routes, roles routes, options routes, plugin management routes; OpenAPI generated from Zod and served at /openapi.json plus docs UI.
9. Rate limiting, CORS, helmet-equivalent headers, request IDs, audit log writes for auth + privileged actions.

TESTS
Unit tests for hooks/auth/RBAC; Testcontainers integration tests for migrations, refresh-token rotation + reuse detection, lockout, 2FA, plugin lifecycle rollback; contract test for the plugin manifest schema.

ACCEPTANCE
- Fresh DB -> `atlas db migrate && atlas db seed` -> working login, refresh rotation, 2FA, RBAC enforced on a sample protected route.
- A sample in-repo plugin can be installed, activated, upgraded, deactivated and uninstalled with migrations applied and rolled back on failure.
- OpenAPI doc validates with a linter. Definition of Done met. Report: docs/reports/phase-1.md
