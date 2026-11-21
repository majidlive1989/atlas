# Phase 2 report

Atlas can load extensions through the public TypeScript SDK, publish site-scoped REST routes at
activation, and run approved untrusted releases in a container-hosted worker. The
[parity matrix](../parity-matrix.md) records the delivered capabilities and their owners.

## What was built

- The SDK exposes registration and boot, typed actions and filters, core fact subscriptions,
  dependency-scoped services, Zod routes and settings, declaration registries, commands, jobs and
  cron, locale catalogs, logging and scoped adapters. Package consumers use the named entry point.
  The [API Extractor report](../../packages/plugin-sdk/etc/plugin-sdk.api.md) records its surface.
- The existing lifecycle supports trusted releases and digest-approved untrusted releases. Release
  migrations remain transactional. Trusted upgrade callbacks can read and write plugin-owned tables
  and settings inside the upgrade transaction. The worker uses bounded RPC, a non-root user, a
  loopback-only network namespace, a read-only root, temporary storage and process resource limits.
- Plugin routes occupy the versioned extension namespace. Active-site routes appear in OpenAPI 3.1.
  Site settings expose a generated schema and use optimistic writes. Capability and role declarations
  are scoped to the plugin namespace and integrated with site authorization.
- PostgreSQL stores plugin queue requests, schedules and job claims. BullMQ handles Redis delivery
  and retry. Plugins can use a dedicated Redis cache or the local development cache. HTTP follows
  origin permissions, public IPv4 resolution and a pinned TLS connection. Storage and mail go through
  scoped host adapters.
- The testkit supplies a lifecycle harness, route client, hook and event inspection, test adapters
  and an ephemeral PostgreSQL helper. The generator produces a TypeScript ESM project, localized
  endpoint, tests and workflow, with optional admin and frontend entries.
- The CLI packs ZIP and TGZ archives, writes SHA-256 receipts, and can sign and verify with Ed25519.
  The [registry index schema](../contracts/plugin-registry.schema.json) describes future distributor
  metadata. The contact form and related posts examples use the same SDK and management routes as
  third-party extensions.

## Logic study and improvements

| Area                           | WordPress behavior preserved                                                                    | Atlas decision and rationale                                                                                                                                                         |
| ------------------------------ | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Lifecycle and upgrade          | Install, activate, deactivate and upgrade independently of the application.                     | Validate versions and dependency order before execution. Commit namespaced migrations and publish registrations after staging succeeds. Retain owned data on uninstall.              |
| Extension hooks and REST       | Compose filter results, react to lifecycle events and add HTTP endpoints.                       | Separate ordered hooks from committed facts. Use explicit route access, scoped dispatch and a shared Zod contract for validation and documentation.                                  |
| Configuration and declarations | Register content types, settings, admin navigation, permissions, templates and locale catalogs. | Keep declarations tied to the owner and site. Derive the settings form schema and require an ETag for operator edits.                                                                |
| Jobs and adapters              | Schedule plugin tasks, send mail, cache values and fetch remote resources.                      | Put durable scheduling and job claims in PostgreSQL and use BullMQ for delivery. Bind adapters to the release and its grants.                                                        |
| Isolation and distribution     | Run downloaded extensions, package compatible releases and scaffold new projects.               | Apply the selected trust boundary before loading a release. Use an independently trusted signing key and immutable digests. Generate a runnable TypeScript project and test harness. |
| Example extensions             | Accept contact submissions and surface related content.                                         | Keep submissions private and validate spam before persistence. Rank by shared terms with stable ties and a per-site limit.                                                           |

The studies precede implementations. [SDK behavior](../logic/plugin-sdk.md) ·
[Isolation behavior](../logic/plugin-isolation.md) · [Authoring behavior](../logic/plugin-authoring.md)

## Architecture and assumptions

- The implementation follows the [isolation](../adr/0003-plugin-isolation.md),
  [hook and event](../adr/0004-hooks.md), [queue](../adr/0010-queue.md) and
  [admin extension](../adr/0011-admin-extensions.md) ADRs.
- Trusted slug approval grants the release's initial declared permissions. New privileges or a
  tier change on upgrade require an approved digest. The untrusted runner requires a
  locally provisioned Linux Node 22 image and Docker-compatible CLI.
- The generated project links to the built Atlas checkout. Its CI workflow checks out the
  matching source repository and ref from repository variables. This supports development during
  the workspace's prepublication period.
- The example contact form persists a submission before notifying its configured recipient.
  If delivery fails, the private submission remains available through the operator command.
- The root formatting gate also required normalizing spacing in the existing Gemini instructions.

## Run and verify

Follow the [plugin tutorial](../guides/plugin-development.md), [security guide](../guides/plugin-security.md)
and [generated hook reference](../guides/hooks-reference.md).

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm lint
pnpm typecheck
pnpm test
pnpm --filter @atlas/plugin-sdk test:api
pnpm --filter @atlas/plugin-sdk hooks:reference --check
pnpm --filter @atlas/plugin-sdk registry:schema --check
pnpm test:integration
pnpm test:e2e
```

## Verification

Kiri 0.2.2 reported the server through `docker version`, and
`docker run --rm alpine echo hello` printed `hello`. The verification used Node 22.23.5 and
pnpm 10.34.9. On Windows, the container suites used the documented Kiri named pipe and the official
PostgreSQL 17 and Node 22 images from Amazon ECR Public. Local Testcontainers used explicit teardown
with Ryuk disabled, and the testkit waited for PostgreSQL's final startup log.

A clean clone of `db61c34` passed all commands above. The container integration suite passed
14 tests, and Playwright passed six. API Extractor accepted the committed public API report,
and both generated references matched their source.

The Phase 2 integration tests install and activate both examples through the CLI, check live
OpenAPI and settings updates, and call the examples over HTTP. They exercise undeclared database
permission denial inside the container-backed worker, as well as Redis cache access and
PostgreSQL-backed enqueue and cron through BullMQ. The Playwright suite checks that the generated
project builds and tests unchanged and that signed ZIP and TGZ archives verify and detect
tampering.

GitHub Actions runs the workspace gates, generated contract checks and real container-backed
suites. Hosted workflow results remain unverified. [CI workflow](../../.github/workflows/ci.yml)

## Deferred

- Rendering the admin menu, settings UI, content types, shortcodes, blocks and templates belongs
  to their corresponding admin, content and theme phases. Phase 2 registers their server
  declarations and exposes metadata.
- The marketplace service, registry signing policy and remote artifact installation are later
  work. Phase 2 signs and verifies local artifacts and installs deployed releases from the catalog.
- Untrusted code must package relative ESM dependencies and use portable JSON Schemas and JSON
  callback values. Transactional upgrade callbacks are available to trusted releases. Both tiers
  use the same declarative migration files.
- Runtime activation and queue workers are composed in one API process. Multi-instance lifecycle
  coordination and broader event redrive tooling remain later operational work. Job handlers that
  change external systems must supply their own idempotency protection.
- The HTTP adapter resolves public IPv4 addresses. IPv6 egress and additional object-storage
  adapters follow later infrastructure work.
