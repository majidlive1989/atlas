# Phase 1 report

Phase 1 delivers the Atlas API, the PostgreSQL foundation, site-scoped identity and role management,
typed hooks and events, the trusted server plugin lifecycle, and the operator CLI. The
[parity matrix](../parity-matrix.md) records implemented and partial capabilities. The logic studies in
[docs/logic](../logic/) precede their implementations.

## What was built

- The kernel validates configuration, exposes typed services, emits redacted Pino logs, and provides
  OpenTelemetry spans. Liveness, readiness, shutdown, request IDs, CORS, security headers, rate limits
  and RFC 9457 errors are wired into Fastify.
- PostgreSQL stores tenants, sites and domains, identities and profiles, role grants, credentials,
  options, audits, job metadata, the outbox, and plugin releases. The Drizzle schema and SQL
  parameterization use PostgreSQL's native query codecs. Core migrations record versions and checksums.
  Composite references and transaction-local row policies constrain site-owned rows.
- Authentication includes Argon2id, short-lived JWTs, rotating refresh-token families and replay
  revocation, progressive lockout, verification and reset mail, TOTP with single-use recovery codes,
  scoped API keys, and a generic OpenID Connect code-flow provider. Role rules combine scope, ownership,
  resource state, and capabilities. Custom roles and grant assignments are API-editable.
- The trusted plugin manager discovers filesystem and package releases, validates manifests and
  dependency graphs, pins release digests, checks and applies namespaced migrations transactionally,
  preserves data on uninstall, and restores active releases on boot. Sample releases demonstrate
  install, activate, upgrade, deactivate, uninstall, DDL rollback and isolated boot failure.
- The API serves Zod-derived OpenAPI 3.1 at `/openapi.json` and its interactive UI at `/docs/`. The
  `atlas` executable exposes build, dev, start, doctor, migration, seed, user and plugin operations.

## Logic study and improvements

| Area                    | Behavior preserved                                             | Atlas decision and rationale                                                                                                                          |
| ----------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Configuration and sites | Canonical site resolution and editable site options            | Resolve host before access. Validate typed settings and protect edits with versions.                                                                  |
| Identity                | Account verification, login, password recovery and revocation  | Bind sessions to a site, store credential digests and detect token-family replay. Let the verified recipient choose a password for self-registration. |
| Permissions             | Predefined roles, delegated access and ownership checks        | Persist site-scoped role grants, separate role from policy, reserve core roles and protect the last site administrator.                               |
| Hooks and jobs          | Ordered callbacks, filters and a foundation for scheduled work | Type their contracts, bound handler waits, and use a transactionally recorded event for durable facts. Phase 1 creates scheduling and job metadata.   |
| Plugin lifecycle        | Install, activate, upgrade, deactivate and uninstall           | Validate dependency state and release content before execution. Apply versioned migrations and audit writes transactionally.                          |
| Plugin storage          | Settings and plugin-owned storage across release transitions   | Use a namespaced DDL vocabulary and checksummed files. Preserve stored data on uninstall and reject divergent history.                                |
| API and operations      | Remote administration, discovery, maintenance and recovery     | Share validated schemas and services, generate the API contract, and use the running API for CLI plugin operations.                                   |

The architecture follows [ADR 0001](../adr/0001-framework.md),
[ADR 0002](../adr/0002-orm.md), [ADR 0004](../adr/0004-hooks.md),
[ADR 0007](../adr/0007-auth-tokens.md), and [ADR 0008](../adr/0008-multi-tenancy.md).
Trusted in-process activation applies the Phase 1 portion of
[ADR 0003](../adr/0003-plugin-isolation.md). Untrusted tiers and permissions without a Phase 1
runtime service fail closed. The outbox and scheduling metadata pave the way for the
[queue and delivery design](../adr/0010-queue.md).

## Local setup

Use Node 22 and the pnpm version pinned in the root manifest. From the repository root:

```powershell
pnpm install
pnpm build
Copy-Item .env.example .env
node -p "require('node:crypto').randomBytes(32).toString('base64url')"
```

Save the generated value as `ATLAS_AUTH_SECRET` and choose a seed password of at least 12 characters
in `.env`. Keep the site hostname, issuer and CLI URL consistent. The defaults use localhost, the
Compose PostgreSQL credentials and the Mailpit SMTP port. Run:

```powershell
pnpm services:up
pnpm atlas db migrate
pnpm atlas db seed
pnpm atlas doctor
pnpm atlas start
```

Send `POST /v1/auth/login` with the seed identity. Use the returned access token as a Bearer credential.
CLI plugin commands read the same token or an authorized API key from `ATLAS_OPERATOR_TOKEN`. They
use `ATLAS_API_URL`, defaulting to `http://localhost:3000`. With `phase-one-example` in the trusted
release configuration, the lifecycle can be exercised as follows:

```powershell
pnpm atlas plugin list
pnpm atlas plugin install phase-one-example 1.0.0
pnpm atlas plugin activate phase-one-example
pnpm atlas plugin upgrade phase-one-example 1.1.0
pnpm atlas plugin deactivate phase-one-example
pnpm atlas plugin uninstall phase-one-example
```

Configure the OIDC issuer, client ID and optional client secret with the `ATLAS_OIDC_*` variables.
Register `/v1/auth/oidc/callback` on the configured API issuer as the redirect URI. An authenticated
session links its provider identity explicitly. Use HTTPS for deployed issuers and browser origins.

## Verification

Kiri 0.2.2 answered `docker version` and the Alpine container printed `hello` after prepending the
documented CLI path and providing the Kiri endpoint outside the process sandbox. The initial
sandboxed shell returned `permission denied while trying to connect to the docker API at npipe:////./pipe/kiri`.

Kiri's Docker Hub pull returned `pull access denied for postgres, repository does not exist or may require 'docker login'`.
The official Postgres 17 image was pulled from Amazon ECR Public and used through
`ATLAS_TEST_POSTGRES_IMAGE`. The initial Testcontainers setup also returned
`No such image: testcontainers/ryuk:0.14.0`. Local verification set
`TESTCONTAINERS_RYUK_DISABLED=true` and used explicit Testcontainers teardown. The suites still
started real PostgreSQL containers and waited for the final PostgreSQL readiness log. CI uses
Testcontainers' normal cleanup and image defaults.

```powershell
pnpm build
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm test:e2e
```

The Vitest integration suite covers real migrations and CLI seeding, validated OpenAPI and live HTTP,
concurrent token rotation, credential replay, lockout, 2FA and recovery, browser origin and cookie
controls, role policy and RLS, verification and password reset, and plugin rollback. Playwright
exercises HTTP login, protected options, rotation and replay against a separate PostgreSQL container.
The [GitHub Actions workflow](../../.github/workflows/ci.yml) runs the workspace gates, the two
container-backed suites and the separate Compose checks.

The Phase 1 verification passed the frozen install, build, lint, typecheck and Vitest unit and
contract gates, plus 11 PostgreSQL integration tests and four Playwright tests. Swagger Parser
validated the generated OpenAPI 3.1 document and its schema references. The parity matrix has 132
entries and no empty owners.

## Deferred and limitations

- Phase 2 owns the extension SDK, sandboxed untrusted execution, signed packaging and permission
  expansion. Phase 1 operators approve trusted local slugs. In-process exceptions and rejected
  promises are isolated. A trusted module retains ordinary process privileges.
- Plugin runtime subscriptions are managed by one API process. Plugin commands use that process's
  HTTP API. Cross-instance activation and broad network operations follow the multisite operations
  work. Shared DDL prevents installing a conflicting version while another active site uses it.
- Queue workers, schedule execution, market distribution and broader audit retention policy are
  assigned to later phases. Phase 1 records durable job metadata and outbox entries.
- The OIDC code-flow adapter is included. Verification here uses local credentials and an SMTP
  test adapter. Accounts with a local TOTP factor use the password-and-factor flow pending an
  OIDC step-up mechanism.
- Hosted CI results for the Phase 1 commits remain unverified. Local integration and E2E used Kiri
  and ephemeral PostgreSQL containers. The Compose stack is covered separately by the CI workflow.
