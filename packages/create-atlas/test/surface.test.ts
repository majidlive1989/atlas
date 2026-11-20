import { expect, it } from "vitest";
import * as surface from "../src/index.js";

it("loads the named ESM public surface", () => {
  expect(Object.hasOwn(surface, "default")).toBe(false);
});
