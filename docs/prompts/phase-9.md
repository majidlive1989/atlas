Read AGENTS.md and all prior reports. Implement PHASE 9, the production-readiness phase.

SCOPE
1. Updates: update checker (core, plugins, themes) against a registry index; signed-package verification; staged update flow (maintenance mode -> backup -> apply -> migrate -> health check -> auto-rollback on failure); update channels (stable/beta); compatibility pre-check (engines, dependency graph, API Extractor diffs); UI in admin; CLI `atlas update`.
2. Backups/restore: DB + media + settings snapshots (scheduled jobs), storage adapters, retention, encryption at rest option, verified restore (`atlas backup verify`), disaster-recovery runbook.
3. Marketplace-ready: registry server reference implementation (publish, versioning, signing, search, ratings hook), `atlas plugin publish`, license-key/entitlement hook for paid plugins and themes, install-from-marketplace UI in admin, security review checklist and automated static checks on submissions (permissions diff, dependency audit, forbidden APIs).
4. Multisite/multi-tenant: complete tenant lifecycle (create/clone/suspend/delete), per-tenant domains and themes/plugins activation, network admin (super-admin) UI, tenant-scoped storage/search/cache namespaces, tenant isolation tests (no cross-tenant data access, proven by tests), per-tenant limits/quotas.
5. Security hardening: threat model document (STRIDE per component), CSP/headers audit, upload and SSRF re-audit, secrets management guide, dependency/license scanning in CI (npm audit/osv, license-checker, Trivy for images, CodeQL), SBOM generation, security.txt, vulnerability disclosure policy, permission-prompt UX for plugins, rate-limit and abuse protections reviewed, optional WAF-style request rules plugin, pen-test checklist run with results recorded.
6. Performance: load tests (k6) for public read API, search, cart/checkout, admin lists with documented targets and results (e.g., p95 latency budgets), query-plan review and missing-index fixes, N+1 detection in tests, HTTP/CDN caching guide with cache-tag invalidation, Redis caching layers (object cache, page fragments), image/CDN guide, memory/CPU profiling notes, horizontal-scaling guide (stateless API, queue workers, sticky-less sessions).
7. Observability: structured logs, OpenTelemetry traces/metrics wiring, Prometheus endpoint, example Grafana dashboards, error-reporting adapter interface (Sentry example), admin "Site Health" expanded checks.
8. Accessibility + i18n final pass: full axe sweep, keyboard audit, RTL visual regression, missing-translation gate, translation-contribution workflow doc (e.g., Crowdin/Weblate config).
9. Docs site (VitePress or Docusaurus): getting started, architecture, plugin guide, theme guide, headless guide, commerce guide, WP porting guide, deployment guides (Docker, Kubernetes Helm chart, single-VPS), upgrade guides, API reference (auto-generated from OpenAPI + TSDoc), hooks/events reference, ADR index, contribution guide, governance/LICENSE/CODE_OF_CONDUCT, versioning/deprecation policy.
10. CI/CD and release: matrix CI (Node versions, Postgres versions), E2E in CI with artifacts, preview deployments, Changesets-driven releases, npm provenance, Docker multi-arch images, Helm chart, `create-atlas` app installer (`npm create atlas@latest`) that scaffolds a new site with sensible defaults, one-command local demo with seeded content and a seeded demo store.
11. Final audit: re-verify the Parity Matrix (every row has a status and a tested module or an ADR-justified replacement), publish the final `docs/parity-report.md` with coverage percentages and known gaps, and a prioritized v1.1 roadmap.

TESTS
Full regression of all prior phases; tenant isolation suite; update/rollback failure-injection tests (kill process mid-update, corrupt package, failing migration); backup-restore round-trip test; k6 thresholds as CI gates on a nightly job.

ACCEPTANCE
- `npm create atlas@latest my-site` -> running site + admin + demo store in under 10 minutes on a clean machine (documented and scripted).
- Failure-injection tests prove no data loss and automatic rollback.
- Tenant isolation, security scans, and performance gates pass. Definition of Done met. Final report: docs/reports/phase-9.md and docs/parity-report.md
