import { expect, test } from "vitest";
import {
  defineMigration,
  definePlugin,
  pluginManifest,
  pluginRegistry,
  supportsAtlas,
} from "../src/index.js";

const manifest = {
  schemaVersion: 1,
  slug: "sample-plugin",
  version: "1.0.0",
  engines: { atlas: "^1.0.0" },
  tier: "trusted",
  entries: { server: "dist/index.mjs" },
  permissions: [],
};

test("validates the manifest and host compatibility before loading a server", () => {
  const release = pluginManifest.parse(manifest);
  expect(supportsAtlas(release, "1.1.0")).toBe(true);
  expect(supportsAtlas(release, "2.0.0")).toBe(false);
  expect(pluginManifest.safeParse({ ...manifest, entries: { server: "../bad.mjs" } }).success).toBe(
    false,
  );
  expect(
    pluginManifest.safeParse({
      ...manifest,
      permissions: [{ kind: "http", origins: ["https://example.test/elsewhere"] }],
    }).success,
  ).toBe(false);
});

test("validates registry coordinates and archive digests", () => {
  const release = { manifest, artifact: "https://example.test/plugin.tgz", sha256: "a".repeat(64) };
  expect(pluginRegistry.safeParse({ schemaVersion: 1, releases: [release] }).success).toBe(true);
  expect(pluginRegistry.safeParse({ schemaVersion: 1, releases: [release, release] }).success).toBe(
    false,
  );
  expect(
    pluginRegistry.safeParse({ schemaVersion: 1, releases: [{ ...release, signature: "AAAA" }] })
      .success,
  ).toBe(false);
});

test("preserves named server and migration declarations", () => {
  const register = () => undefined;
  expect(definePlugin({ register }).register).toBe(register);
  expect(defineMigration([{ action: "create-table", table: "message", columns: [] }])).toHaveLength(
    1,
  );
});
