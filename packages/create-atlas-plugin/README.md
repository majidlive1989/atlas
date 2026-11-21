# @atlas/create-atlas-plugin

Generate an independent TypeScript ESM plugin with `create-atlas-plugin my-plugin`. Omit the
slug for prompts. Use `--directory`, `--atlas-root`, `--admin` and `--frontend` to select the
location, SDK checkout and optional entries. The named generation function is in `src/index.ts`.

The SDK validates the generated manifest. The generated test uses the Atlas testkit. The
generator needs a built Atlas checkout for the SDK and testkit links.
See the [authoring guide](../../docs/guides/plugin-development.md) for CI setup.
