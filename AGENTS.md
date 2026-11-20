# Atlas: Agent Operating Rules

## Product
Atlas is a modern, open-source CMS + commerce platform on Node.js and TypeScript.
WordPress and WooCommerce are the FUNCTIONAL BASELINE: their logic, concepts and full feature set are the foundation.
Atlas must cover everything WP core and WooCommerce cover (or document a better replacement), but redesigned with modern engineering: strict typing, API-first, event-driven, secure by default, testable, lightweight. We do NOT clone PHP code or its legacy problems (global state, untyped hooks, serialized PHP blobs, SQL in templates).

## Method: Logic-first, clean-room (MANDATORY for every feature)
- WordPress and WooCommerce are studied as a SPECIFICATION OF BEHAVIOR (domain rules, lifecycles, edge cases, user-facing capabilities), never as source code to translate or imitate.
- Before implementing any feature area, write `docs/logic/<area>.md` in your own words: what the feature must do, the business rules, state transitions, edge cases, failure modes, security concerns, what WP/Woo handle awkwardly or badly, and the improved Atlas design. Then implement from that document plus the architecture docs, NOT from WP's code structure.
- Do not copy, transliterate or mirror WP/Woo/plugin source code, function bodies, DB table layouts, option names, hook names, class hierarchies or file structure (this also keeps us clear of GPL entanglement). Design Atlas-native names, schemas and typed APIs. Common domain words (post, term, order, coupon) are fine; the shape and API must be Atlas-native.
- Parity is judged on capabilities and outcomes, never on API shape or internal structure.
- Every phase report contains a "Logic study and improvements" section: per feature, the WP/Woo behavior preserved, the behavior deliberately changed, and why.

## Fixed stack (do not change without an ADR in docs/adr)
- Node 22 LTS, TypeScript strict, ESM only, pnpm workspaces + Turborepo, Changesets.
- Backend: Fastify, Zod (single source of truth for validation and OpenAPI 3.1), Pino, OpenTelemetry hooks.
- DB: PostgreSQL + Drizzle ORM. Core migrations are versioned. Plugin migrations are versioned files run by Atlas's own migrator, with tables namespaced `plg_<slug>_*`. Typed meta uses JSONB.
- Cache/queue: Redis + BullMQ. Adapters (interfaces + default impl) for storage (local, S3), mail, search (Postgres FTS default), cache, payments.
- Admin: React + Vite + TypeScript, TanStack Router + Query, Tailwind + Radix primitives, own design-system package.
- Public reference site: Next.js App Router consuming `@atlas/frontend-sdk`.
- Tests: Vitest (unit), Testcontainers (integration), Playwright (E2E), contract tests for plugin/theme APIs.
- Lint/format: ESLint (typescript-eslint strict), Prettier. CI: GitHub Actions.

## Architecture rules
1. Small kernel. Content, media, comments, SEO, commerce are first-party plugins using the SAME public plugin API as third parties. No private back doors.
2. API-first. Every feature is reachable via REST (OpenAPI generated from Zod). Admin and frontends are API clients only.
3. No `any` in public APIs. No default exports in packages. No circular package dependencies (enforce with a lint rule).
4. Everything user-visible is translatable (no hard-coded strings). All dates, numbers, currencies via Intl.
5. Security by default (OWASP ASVS L2): validate all input with Zod, parameterized queries only, output-sanitize rich content, rate-limit, audit-log privileged actions.
6. Every package has: README, public API surface file, tests, and changeset entries.
7. Breaking changes to Plugin API / Theme API / REST need a semver major + migration note.

## Repo layout (target)
apps/ api, admin, site (reference Next.js)
packages/ kernel, db, auth, hooks, plugin-sdk, plugin-testkit, wp-compat, ui (design system), i18n, frontend-sdk, config, cli
plugins/ (first-party) content, media, comments, menus, seo, search, forms, commerce-*, ...
themes/ reference, storefront
docs/ architecture, adr, guides, parity-matrix.md, reports/
examples/ plugins, themes

## Definition of Done (every phase)
- `pnpm install && pnpm build && pnpm lint && pnpm typecheck && pnpm test` all green from a clean clone.
- Integration + E2E tests for the phase's features pass in CI.
- No TODO / placeholder / stub / "not implemented" in delivered scope. If something is out of scope, it is listed in the phase report under "Deferred" with a reason.
- `docs/parity-matrix.md` updated (feature -> module -> status).
- `docs/reports/phase-<N>.md` written: what was built, decisions, deviations (with ADR links), how to run, known limitations.
- Conventional Commits, small logical commits, a git tag `phase-<N>-done`.

## Working protocol
- Do not ask questions. State assumptions in the phase report and proceed.
- Read `docs/architecture/*` and previous phase reports before coding. Respect them; if you must deviate, write an ADR first.
- Work in this loop: plan -> implement -> test -> self-review against acceptance criteria -> fix -> report.
- Never weaken a test to make it pass. Never skip a failing test without documenting why in the report.
- Prefer boring, well-maintained dependencies; justify each new dependency in the package README.
