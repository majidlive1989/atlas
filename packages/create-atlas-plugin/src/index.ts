import { access, mkdir, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pluginManifest } from "@atlas/plugin-sdk";

export interface ScaffoldOptions {
  readonly slug: string;
  readonly directory?: string | undefined;
  readonly atlasRoot?: string | undefined;
  readonly admin?: boolean | undefined;
  readonly frontend?: boolean | undefined;
}

const generatedServer = String.raw`import { definePlugin } from "@atlas/plugin-sdk";
import { z } from "zod";
import { messages } from "./messages.js";

export const plugin = definePlugin({
  register(ctx) {
    ctx.i18n.register("en", messages);
    ctx.routes.register({
      method: "GET",
      path: "/status",
      access: "public",
      input: z.strictObject({}),
      output: z.strictObject({ message: z.string() }),
      handle: () => ({ message: ctx.i18n.message("en", "status.ready") }),
    });
  },
});
`;

const generatedTest = String.raw`import { createPluginHarness } from "@atlas/plugin-testkit";
import { expect, test } from "vitest";
import { plugin } from "../src/index.js";

test("serves the localized status message", async () => {
  const harness = createPluginHarness();
  await harness.start(plugin);
  try {
    expect(await harness.request("GET", "/status", {})).toEqual({
      status: 200,
      body: { message: "The plugin is active." },
    });
  } finally {
    await harness.stop();
  }
});
`;

const workflow = `name: Plugin CI
on: [push, pull_request]
permissions:
  contents: read
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/checkout@v5
        with:
          repository: ${"$"}{{ vars.ATLAS_SOURCE_REPOSITORY }}
          ref: ${"$"}{{ vars.ATLAS_SOURCE_REF }}
          path: .atlas-sdk
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v5
        with:
          node-version: 22
      - run: pnpm --dir .atlas-sdk install --frozen-lockfile
        env:
          HUSKY: "0"
      - run: pnpm --dir .atlas-sdk exec turbo run build --filter=@atlas/plugin-testkit
      - run: pnpm install --no-frozen-lockfile
      - run: pnpm build
      - run: pnpm test
`;

export async function scaffoldPlugin(options: ScaffoldOptions): Promise<string> {
  const manifest = pluginManifest.parse({
    schemaVersion: 1,
    slug: options.slug,
    version: "1.0.0",
    engines: { atlas: "*" },
    tier: "trusted",
    entries: {
      server: "dist/index.js",
      ...(options.admin ? { admin: "dist/admin.js" } : {}),
      ...(options.frontend ? { frontend: "dist/frontend.js" } : {}),
    },
    permissions: [],
  });
  const directory = resolve(options.directory ?? manifest.slug);
  const source = options.atlasRoot
    ? resolve(options.atlasRoot)
    : fileURLToPath(new URL("../../../", import.meta.url));
  await Promise.all([
    access(join(source, "packages/plugin-sdk/dist/index.js")),
    access(join(source, "packages/plugin-testkit/dist/index.js")),
  ]);
  await mkdir(directory);
  const json = (value: object) => JSON.stringify(value, null, 2) + "\n";
  const files = new Map([
    [
      "package.json",
      json({
        name: manifest.slug,
        version: manifest.version,
        private: true,
        type: "module",
        packageManager: "pnpm@10.34.9",
        engines: { node: ">=22.13 <23" },
        scripts: { build: "tsc", test: "vitest run" },
        dependencies: { "@atlas/plugin-sdk": "link:.atlas-sdk/packages/plugin-sdk", zod: "^4.3.6" },
        devDependencies: {
          "@atlas/plugin-testkit": "link:.atlas-sdk/packages/plugin-testkit",
          "@types/node": "^22.19.0",
          typescript: "~5.9.3",
          vitest: "^3.2.4",
        },
      }),
    ],
    [
      "tsconfig.json",
      json({
        compilerOptions: {
          target: "ES2023",
          module: "NodeNext",
          strict: true,
          rootDir: "src",
          outDir: "dist",
          declaration: true,
          skipLibCheck: true,
          verbatimModuleSyntax: true,
        },
        include: ["src/**/*.ts"],
      }),
    ],
    ["plugin.json", json(manifest)],
    ["src/index.ts", generatedServer],
    ["src/messages.ts", 'export const messages = { "status.ready": "The plugin is active." };\n'],
    ["test/plugin.test.ts", generatedTest],
    [
      "vitest.config.ts",
      'import { defineConfig } from "vitest/config";\n\nexport default defineConfig({ test: { include: ["test/**/*.test.ts"] } });\n',
    ],
    [".github/workflows/ci.yml", workflow],
    [".gitignore", ".atlas-sdk/\nnode_modules/\ndist/\n"],
    [
      "README.md",
      "# " +
        manifest.slug +
        "\n\nRun `pnpm install`, `pnpm build` and `pnpm test`. The local `.atlas-sdk` link points to a built Atlas checkout.\n\nSet the GitHub repository variables `ATLAS_SOURCE_REPOSITORY` and `ATLAS_SOURCE_REF` to the Atlas source repository and its matching release or commit.\n",
    ],
  ]);
  if (options.admin) files.set("src/admin.ts", 'export const admin = { key: "status" };\n');
  if (options.frontend)
    files.set("src/frontend.ts", 'export const frontend = { statusPath: "/status" };\n');
  await Promise.all(
    ["src", "test", ".github/workflows"].map((path) =>
      mkdir(join(directory, path), { recursive: true }),
    ),
  );
  await symlink(
    source,
    join(directory, ".atlas-sdk"),
    process.platform === "win32" ? "junction" : "dir",
  );
  await Promise.all(
    [...files].map(([file, contents]) =>
      writeFile(join(directory, file), contents, { flag: "wx" }),
    ),
  );
  return directory;
}
