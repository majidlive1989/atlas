import { describe, expect, it } from "vitest";
import { pluginManifest } from "../src/index.js";

const manifest = {
  schemaVersion: 1,
  slug: "test-plugin",
  version: "1.0.0",
  engines: { atlas: "^0.1.0" },
  tier: "trusted",
  entries: { server: "dist/main.mjs" },
  permissions: [{ kind: "database", scope: "own-tables" }],
};

describe("plugin manifest contract", () => {
  it("accepts versioned package-relative entries", () => {
    expect(pluginManifest.parse(manifest)).toEqual(manifest);
  });

  it.each([
    "../main.mjs",
    "/main.mjs",
    "src/../main.mjs",
    "C:/main.mjs",
    "src\\main.mjs",
    "src/main.ts",
  ])("rejects unsafe or unsupported entry %s", (server) => {
    expect(pluginManifest.safeParse({ ...manifest, entries: { server } }).success).toBe(false);
  });

  it("rejects unknown permission kinds, invalid ranges, unsupported schemas and self-dependencies", () => {
    for (const override of [
      { permissions: [{ kind: "exec" }] },
      { engines: { atlas: "latest" } },
      { schemaVersion: 2 },
      { requires: { "test-plugin": "*" } },
    ]) {
      expect(pluginManifest.safeParse({ ...manifest, ...override }).success).toBe(false);
    }
  });
});
