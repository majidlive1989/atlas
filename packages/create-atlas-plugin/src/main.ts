#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import { scaffoldPlugin } from "./index.js";

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      slug: { type: "string" },
      directory: { type: "string" },
      "atlas-root": { type: "string" },
      admin: { type: "boolean" },
      frontend: { type: "boolean" },
      help: { type: "boolean" },
    },
  });
  if (values.help) {
    process.stdout.write(
      "create-atlas-plugin [slug] [--directory <path>] [--atlas-root <path>] [--admin] [--frontend]\n",
    );
    return;
  }
  if (positionals.length > 1 || (values.slug && positionals.length))
    throw new Error("Provide one plugin slug.");
  let slug = values.slug ?? positionals[0];
  let admin = values.admin;
  let frontend = values.frontend;
  if (!slug && process.stdin.isTTY) {
    const prompt = createInterface({ input: process.stdin, output: process.stdout });
    try {
      slug = (await prompt.question("Plugin slug: ")).trim();
      admin ??= /^y(?:es)?$/i.test(
        (await prompt.question("Include an admin entry? [y/N] ")).trim(),
      );
      frontend ??= /^y(?:es)?$/i.test(
        (await prompt.question("Include a frontend entry? [y/N] ")).trim(),
      );
    } finally {
      prompt.close();
    }
  }
  if (!slug) throw new Error("A plugin slug is required.");
  const directory = await scaffoldPlugin({
    slug,
    directory: values.directory,
    atlasRoot: values["atlas-root"],
    admin,
    frontend,
  });
  process.stdout.write(directory + "\n");
}

void main().catch((error: unknown) => {
  process.stderr.write(
    (error instanceof Error ? error.message : "Plugin generation failed.") + "\n",
  );
  process.exitCode = 1;
});
