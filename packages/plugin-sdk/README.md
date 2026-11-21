# @atlas/plugin-sdk

Typed server extension contract for both Atlas execution tiers. The named public surface is
`src/index.ts` and [API Extractor records it](etc/plugin-sdk.api.md). Use `definePlugin` for a
named release entry, and `defineMigration` for typed migration operations destined for release files.

Zod validates contracts and produces JSON Schemas. Semver checks compatible Atlas versions.
The contracts workspace owns manifest validation, and the hooks workspace owns the core fact types.

Run `pnpm build`, `pnpm test` and `pnpm test:api`. See the [authoring guide](../../docs/guides/plugin-development.md).
