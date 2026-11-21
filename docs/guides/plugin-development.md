# Develop an Atlas plugin

From the Atlas checkout, use Node 22 and pnpm 10. Build the SDK, generator and testkit first.

```sh
pnpm install --frozen-lockfile
pnpm build
node packages/create-atlas-plugin/dist/main.js my-plugin --directory ../my-plugin --admin
cd ../my-plugin
pnpm install
pnpm build
pnpm test
```

Run the generator without arguments for prompts. The generated project uses its `.atlas-sdk` link to the Atlas checkout. The included workflow checks out the same source through the `ATLAS_SOURCE_REPOSITORY` and `ATLAS_SOURCE_REF` repository variables. Commit the project files and lockfile.

Export a named `plugin` from the compiled server entry. Use `register` for declarations and `boot` for setup. Both receive a context for one site. Register settings once with a Zod object and initial values. The management endpoint exposes the generated JSON Schema alongside settings and an ETag. Send that ETag with updates. Use `onUpgrade(from, to, ctx)` to transform data in the release transaction. SQL changes use consecutively numbered JSON files, starting with `0001.json`. [Manifest contract](../contracts/plugin-manifest.md)

Point `ATLAS_PLUGIN_ROOT` at the parent of the built plugin directory and add `my-plugin` to `ATLAS_TRUSTED_PLUGINS` before starting the API. Log in and give the CLI the operator's Bearer token through `ATLAS_OPERATOR_TOKEN`.

```sh
pnpm atlas plugin list
pnpm atlas plugin install my-plugin 1.0.0
pnpm atlas plugin activate my-plugin
curl http://localhost:3000/v1/extensions/my-plugin/status
```

The active site's `/openapi.json` includes its plugin endpoints. Authenticated routes require a Bearer credential. Queries supply GET input and JSON supplies input for other methods. Each handler returns the value described by its output schema. Read site identity from the context and never trust site identifiers supplied by request input.

In tests, create a harness with `createPluginHarness`, start the plugin and call `request`. Read captured mail, logs, declarations or namespaced rows to assert effects. Use `startPluginPostgres` for tests requiring real PostgreSQL, and close it during teardown.

Build a release directory with the manifest, compiled entries, package metadata and migration files. Publish the archive, checksum receipt and public signing key through independently trusted channels.

```sh
pnpm atlas plugin pack examples/plugins/contact-form contact-form.tgz --sign signing.pem
pnpm atlas plugin verify contact-form.tgz --key public.pem
```

Both `.tgz` and `.zip` are supported. Verification accepts an unsigned receipt when no verification key is supplied. To deploy a verified archive, place its extracted release directory below the catalog root on the host and use `atlas plugin install`. Use a release directory writable by the deployment operator only. [Plugin security](plugin-security.md)
