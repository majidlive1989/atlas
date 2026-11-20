You are the principal architect of Atlas. Read AGENTS.md first.

GOAL
Produce the architecture and the empty-but-building monorepo skeleton. No feature code yet except tooling.

DELIVERABLES
1. Monorepo skeleton per AGENTS.md: pnpm workspaces, Turborepo pipelines (build, lint, typecheck, test, dev), shared tsconfig/eslint/prettier packages, Changesets, Husky/lint-staged, GitHub Actions CI, Docker Compose (postgres, redis, mailpit, minio), `.env.example`, Makefile or pnpm scripts for common tasks. Every listed package/app exists with a README, a public index, and a passing placeholder test.
2. docs/architecture/overview.md: module boundaries, dependency rules (who may import whom), request lifecycle, hook/event system design, plugin lifecycle, theme resolution, caching strategy, queue/cron design, multi-tenancy/multisite approach, security model, extensibility points. Include Mermaid diagrams: C4 context+container, request lifecycle sequence, plugin lifecycle state machine, theme template resolution flow, order state machine.
3. docs/architecture/data-model.md: full ERD (Mermaid) for core + content + media + comments + menus + options + users/roles + multisite + commerce (products, variations, attributes, inventory, carts, orders, order items, refunds, coupons, taxes, shipping, payments, customers, downloads). Define JSONB meta strategy, indexing strategy, soft-delete/trash strategy, revision strategy.
4. docs/adr/: one ADR per major decision (framework choice, ORM, plugin isolation, hooks design, block editor choice, i18n approach, auth tokens, multi-tenancy, search, queue, admin extension loading mechanism, theme rendering strategy).
5. docs/parity-matrix.md: exhaustive table of WordPress core + WooCommerce features (users, roles, posts, pages, CPT, taxonomies, meta, revisions, media, comments, menus, widgets, options, transients, cron, rewrite, REST, shortcodes, blocks, themes, child themes, customizer, multisite, updates, import/export, SEO, i18n, privacy tools, site health, products, variations, cart, checkout, coupons, tax, shipping, orders, refunds, reports, emails, REST, webhooks, subscriptions/bundles as extensions, etc.). Columns: Feature | WP/Woo behavior (described, not copied) | Atlas module | Logic doc (`docs/logic/<area>.md`) | Delivery phase | Status (planned/replaced) | Notes. Also create `docs/logic/_template.md` (sections: purpose, rules, lifecycle/state transitions, edge cases, failure modes, security, WP/Woo weaknesses, Atlas design, test scenarios) that later phases must fill per feature area BEFORE writing code.
6. docs/roadmap.md: Phases 1 to 9 with scope, dependencies, acceptance criteria, risk register.
7. docs/contracts/: draft specs (markdown + TypeScript type sketches) for: plugin manifest, theme manifest, hook naming convention, REST conventions (pagination, filtering, errors RFC 9457, versioning), event catalog, capability naming convention, i18n key conventions.
8. A "gaps and additions" section listing features beyond WP/Woo you recommend (forms builder, feature flags, observability, accessibility checker, etc.) with priority.

ACCEPTANCE
- `pnpm install && pnpm build && pnpm lint && pnpm typecheck && pnpm test` green; `docker compose up` brings up dependencies.
- Parity matrix has no empty Atlas-module cells.
- Report: docs/reports/phase-0.md
