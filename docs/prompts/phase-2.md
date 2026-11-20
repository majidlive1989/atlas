Read AGENTS.md, prior reports, docs/contracts/plugin-manifest.md. Implement PHASE 2.

SCOPE
1. `@atlas/plugin-sdk` (public, versioned, documented with TSDoc, API Extractor report committed):
   - `definePlugin({ register(ctx), boot(ctx) })`, typed `PluginContext`: DI services, `hooks.actions/filters`, `events`, `routes` (REST registration with Zod schemas -> OpenAPI), `db` (scoped, migrations helper), `jobs` (queue/cron), `cli` (register commands), `settings` (Zod schema -> typed get/set + auto-generated settings UI schema), `capabilities/roles` registration, `i18n` (register catalogs), `logger`, `storage`, `mail`, `cache`, `http` (SSRF-safe client).
   - Registration APIs: post types, taxonomies, custom fields, blocks (server definition), shortcodes, REST routes, GraphQL fragments (optional), email templates, notification types, admin-menu declarations (data only; UI comes in Phase 4).
   - Manifest schema + `engines.atlas` compatibility check + permissions model (declared permissions are enforced at runtime by the loader: DB scope, network, filesystem, hooks access).
   - Upgrade API: `onUpgrade(from, to)` with migration helpers.
2. Plugin isolation: implement the isolation tiers decided in ADRs: trusted (in-process) and untrusted (worker thread with message-passing RPC, resource limits, restricted APIs). Same SDK surface for both where feasible; document the differences.
3. `@atlas/plugin-testkit`: mock context, in-memory/ephemeral Postgres helper, hook/event assertion helpers, lifecycle test runner, HTTP route test client.
4. `create-atlas-plugin` scaffolder (interactive + flags): TS plugin with server entry, tests, manifest, i18n stub, optional admin/frontend entry stubs, CI workflow.
5. Plugin packaging: `atlas plugin pack` (zip/tgz with checksum + signature support), `atlas plugin verify`, registry index format (JSON schema) for a future marketplace.
6. Two complete example plugins in examples/plugins: `contact-form` (CPT-like submissions, REST endpoint, email notification, spam hook, settings, migration, i18n) and `related-posts` (filter hook, setting UI schema). Both fully tested through the testkit.
7. docs/guides/plugin-development.md (tutorial from zero), docs/guides/hooks-reference.md (auto-generated from types), docs/guides/plugin-security.md.

ACCEPTANCE
- `create-atlas-plugin` output builds and passes its own tests unmodified.
- Both examples install/activate via the CLI and work end-to-end on the API.
- An untrusted worker-isolated plugin cannot access a permission it did not declare (test proves it).
- API Extractor report shows a stable public surface. Definition of Done met. Report: docs/reports/phase-2.md
