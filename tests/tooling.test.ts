import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { config as lint } from "@atlas/eslint-config";
import { config as format } from "@atlas/prettier-config";

describe("shared tooling", () => {
  it("exposes strict TypeScript defaults", () => {
    const resolve = createRequire(import.meta.url).resolve;
    expect(readFileSync(resolve("@atlas/tsconfig"), "utf8")).toContain('"strict": true');
  });
  it("enables strict TypeScript linting", () => {
    expect(
      lint.some((entry) => entry.rules?.["@typescript-eslint/no-explicit-any"] === "error"),
    ).toBe(true);
  });
  it("shares the repository line length", () => {
    expect(format.printWidth).toBe(100);
  });
});
