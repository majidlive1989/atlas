# Phase 0 report

Atlas now has a buildable monorepo with 55 workspace projects and a root task runner. The [architecture overview](../architecture/overview.md) defines the boundaries, request and extension lifecycles, caching, jobs, tenancy and security model. The [logical data model](../architecture/data-model.md) covers publishing and commerce, including an order state machine. There are 12 [accepted ADRs](../adr/README.md), eight [draft contract specs](../contracts/README.md) with typechecked sketches, and a [roadmap](../roadmap.md) for Phases 1–9 with risks and prioritized additions.

The 132-row [parity matrix](../parity-matrix.md) assigns every capability to an existing workspace name and a delivery phase. Statuses describe future outcomes. The corresponding behavior studies start from the [logic template](../logic/_template.md) before feature implementation.

## Decisions and assumptions

- The workspace arrived with operating rules and phase briefs. Git was initialized on `main` and those files were committed as the project baseline.
- Runtime workspaces expose empty named ESM entry points until their assigned phases add functionality. The three shared config packages expose working TypeScript, ESLint and Prettier configs. Build, lint, typecheck, test and app compile watchers run through the root commands.
- The design uses the prescribed stack. The untrusted plugin tier places worker-thread RPC inside an OS-enforced isolation boundary. The Phase 2 implementation owns proof of enforcement. [ADR 0003](../adr/0003-plugin-isolation.md)
- Docker Compose uses PostgreSQL 17, Redis 7.4, Mailpit and MinIO. The MinIO development image is built from official Linux amd64 or arm64 release binaries with pinned SHA-256 checksums because the upstream registry image requires authorization. [MinIO release metadata](https://api.github.com/repos/minio/minio/releases/tags/RELEASE.2025-09-07T16-13-09Z)

## Logic study and improvements

| Area                           | Behavior Atlas plans to preserve                                                                | Deliberate changes and reasons                                                                                                                         |
| ------------------------------ | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Identity and network           | Accounts, roles, permissions, and site administration                                           | Separate global identity, site membership and network grants. Scoped credentials and row policies reduce unintended access.                            |
| Extension and scheduled work   | Installation, activation, callbacks, filters and recurring jobs                                 | Use typed registries, reversible lifecycle changes, declared permissions and durable job delivery. These make ordering, rollback and retries testable. |
| Content and media              | Posts, pages, taxonomies, uploads, revisions, menus and moderation                              | Validate extension fields and block trees, keep autosaves private and reject stale edits. Record import mappings so users can review losses.           |
| Themes and public access       | Template hierarchy, child themes, live customization, widgets, publishing APIs and localization | Use resolver keys, versioned previews, slots and a REST-only data boundary. ICU catalogs preserve pluralization and direction across clients.          |
| Storefront and checkout        | Product variations, inventory, cart, discounts, taxes, shipping and payments                    | Calculate amounts in minor units, reserve stock atomically, and bind checkout retries to an idempotency key.                                           |
| Orders, refunds and operations | State transitions, manual and automated refunds, downloads, email, analytics and webhooks       | Snapshot financial inputs and record refund allocations. Durable events support reconciliation and repeated delivery.                                  |
| Migration and updates          | Import and export, extension discovery, upgrades and operational recovery                       | Use mappings and explicit review reports for ports. Signed staged updates and verified restores support rollback.                                      |

The studies use published behavior documentation. The [parity matrix](../parity-matrix.md) records the per-capability outcomes and references.

## Run and verify

Use Node 22.13 or later in the Node 22 line and pnpm 10.34.9.

```sh
pnpm install
pnpm build
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm services:up
pnpm test:integration
pnpm services:down
```

The [CI workflow](../../.github/workflows/ci.yml) runs the frozen install and workspace checks, plus a separate Compose job for PostgreSQL query, Redis ping, Mailpit readiness and MinIO readiness. The Playwright checks load each app's built public entry from a separate Node process. Browser workflows begin when app functionality exists.

## Verification

| Check                                   | Result                                                                                                                               |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Dependency install and lockfile         | Installed successfully. A fresh local clone used the frozen lockfile and populated package store with Node 22.23.5 and pnpm 10.34.9. |
| Build, lint and typecheck               | 52 workspace tasks passed in each pipeline. Root lint also ran workspace dependency and formatting checks.                           |
| Tests                                   | 52 workspace smoke tests and three shared tooling tests passed. All three Playwright app package checks passed.                      |
| Parity matrix                           | 132 capability rows with zero missing or unknown workspace owners.                                                                   |
| Compose configuration                   | The standalone Compose CLI validated the configuration with `.env.example` and resolved all four services.                           |
| Compose startup and service integration | The host has no Docker Engine endpoint. Compose startup and the service probes therefore remain unverified.                          |
| Hosted CI                               | The local repository has no remote. Hosted workflow results remain unverified.                                                       |

## Deferred

- The API, admin UI, public site, domain plugins and themes are assigned to later phases. Phase 0 delivers their build surfaces and architecture only.
- Database migrations, feature-level Testcontainers and browser E2E coverage begin with the relevant runtime features. The current checks cover workspace tooling and the development dependency stack.
- Production subscriptions, bundles, provider add-on breadth and native POS/mobile clients are outside the core roadmap. Phase 7 plans extension contracts and a reference implementation.
