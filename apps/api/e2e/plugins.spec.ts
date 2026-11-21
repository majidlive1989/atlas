import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createPublicKey, generateKeyPairSync } from "node:crypto";
import { promisify } from "node:util";
import { expect, test } from "@playwright/test";

const run = promisify(execFile);

test("verifies the CLI's signed ZIP and TGZ plugin artifacts", async () => {
  const root = await mkdtemp(join(tmpdir(), "atlas-plugin-pack-"));
  try {
    const cli = join(process.cwd(), "packages/cli/dist/main.js");
    const source = join(process.cwd(), "examples/plugins/contact-form");
    const { privateKey } = generateKeyPairSync("ed25519");
    const pem = join(root, "signing.pem");
    const pub = join(root, "verify.pem");
    await writeFile(pem, privateKey.export({ type: "pkcs8", format: "pem" }));
    await writeFile(pub, createPublicKey(privateKey).export({ type: "spki", format: "pem" }));
    for (const extension of ["zip", "tgz"]) {
      const path = join(root, "contact-form." + extension);
      await run(process.execPath, [cli, "plugin", "pack", source, path, "--sign", pem]);
      const verification = await run(process.execPath, [
        cli,
        "plugin",
        "verify",
        path,
        "--key",
        pub,
      ]);
      expect(JSON.parse(verification.stdout)).toMatchObject({
        slug: "contact-form",
        version: "1.0.0",
        signed: true,
      });
      await writeFile(path, Buffer.concat([await readFile(path), Buffer.from([42])]));
      await expect(
        run(process.execPath, [cli, "plugin", "verify", path, "--key", pub]),
      ).rejects.toThrow("Plugin checksum mismatch");
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("scaffolds a plugin which builds and passes its tests unchanged", async () => {
  test.setTimeout(90_000);
  const root = await mkdtemp(join(tmpdir(), "atlas-plugin-scaffold-"));
  try {
    const generated = join(root, "sample-plugin");
    const cli = join(process.cwd(), "packages/create-atlas-plugin/dist/main.js");
    await run(process.execPath, [
      cli,
      "sample-plugin",
      "--directory",
      generated,
      "--admin",
      "--frontend",
    ]);
    const pnpmEntry = process.env.npm_execpath;
    if (!pnpmEntry) throw new Error("Run this suite through pnpm.");
    await run(process.execPath, [pnpmEntry, "install", "--no-frozen-lockfile"], {
      cwd: generated,
      timeout: 60_000,
    });
    await run(process.execPath, [pnpmEntry, "build"], { cwd: generated });
    await run(process.execPath, [pnpmEntry, "test"], { cwd: generated });
    expect(JSON.parse(await readFile(join(generated, "plugin.json"), "utf8"))).toMatchObject({
      entries: { server: "dist/index.js", admin: "dist/admin.js", frontend: "dist/frontend.js" },
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
