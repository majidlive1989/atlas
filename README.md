# Atlas

Atlas is a TypeScript CMS and commerce platform designed around public REST, plugin and theme contracts.
Phase 0 contains the architecture and workspace tooling.

## Start locally

Use Node 22 and the pnpm version pinned in `package.json`. Install Docker with the Compose plugin for service checks.

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

Compose runs on loopback with local development credentials. Copy `.env.example` to `.env` to override ports or credentials. Named volumes survive `pnpm services:down`. The Mailpit UI defaults to port 8025 and the MinIO console to port 9001. `pnpm dev` runs the three app compile watchers.

## Workspace tooling

pnpm and Turborepo provide workspace linking and task scheduling. TypeScript builds ESM and declarations. ESLint and typescript-eslint check source, Prettier checks formatting, and Husky with lint-staged checks staged source and configuration. Vitest covers workspace surfaces and shared tooling. Playwright follows the public export path of each built app from a separate Node process. Changesets records workspace release intent. The ESLint, Prettier, and TypeScript configurations are separate workspace packages.

Read the [architecture](docs/architecture/overview.md), [parity matrix](docs/parity-matrix.md), and [roadmap](docs/roadmap.md) before working on a feature. Use the [logic template](docs/logic/_template.md) before implementing it.
