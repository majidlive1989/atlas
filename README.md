# Atlas

Atlas is a TypeScript CMS and commerce platform designed around public REST, plugin and theme contracts.
Phase 1 adds the API, PostgreSQL setup, account and role management, the trusted plugin lifecycle and the operator CLI.

## Start locally

Use Node 22 and the pnpm version pinned in `package.json`. Install Docker with the Compose plugin for service checks.

```sh
pnpm install
pnpm build
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm test:e2e
pnpm services:up
pnpm test:services
pnpm services:down
```

Compose runs on loopback with local development credentials. Copy `.env.example` to `.env` to override ports or credentials. Named volumes survive `pnpm services:down`. The Mailpit UI defaults to port 8025 and the MinIO console to port 9001. The first Compose startup builds the MinIO image from a checksum-pinned release binary for Linux amd64 or arm64. See the [Phase 1 report](docs/reports/phase-1.md) for API startup, initial credentials and Kiri test setup.

## Workspace tooling

pnpm and Turborepo provide workspace linking and task scheduling. TypeScript builds ESM and declarations. ESLint and typescript-eslint check source, Prettier checks formatting, and Husky with lint-staged checks staged source and configuration. Vitest tests workspace surfaces, shared tooling and domain behavior. Playwright checks built app exports and the running API. Changesets records workspace release intent. The ESLint, Prettier, and TypeScript configurations are separate workspace packages.

Read the [architecture](docs/architecture/overview.md), [parity matrix](docs/parity-matrix.md), and [roadmap](docs/roadmap.md) before working on a feature. Use the [logic template](docs/logic/_template.md) before implementing it.
