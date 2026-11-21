# @atlas/plugin-testkit

`createPluginHarness` runs a plugin's registration and boot against in-memory adapters. It provides
a route client, tables, captured mail and logs, hook inspection and core event delivery.
Use a live Atlas API to test manifest permission enforcement and isolation.

`startPluginPostgres` runs real PostgreSQL migrations in a Testcontainers-managed PostgreSQL
instance. It returns a database, JDBC-free connection URL and teardown callback. Set
`ATLAS_TEST_POSTGRES_IMAGE` to select an official image mirror. The PostgreSQL Testcontainers
module provides ephemeral database lifecycle, while Zod enforces inputs and fixture outputs.
The DB and hooks workspaces provide core migration and dispatch behavior.

The named entry point is `src/index.ts`. Run `pnpm build` and `pnpm test`.
