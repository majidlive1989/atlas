# @atlas/cli

The `atlas` executable drives builds, startup, migration, seeding, user provisioning and API-based plugin management. Zod validates command arguments and process configuration. Install via the workspace's regular `pnpm install`, or run it as `pnpm atlas`. Plugin commands use `ATLAS_API_URL` and `ATLAS_OPERATOR_TOKEN`.

The named entry point is `src/index.ts`. Run `pnpm build` and `pnpm test` in this workspace or from the repository root.
