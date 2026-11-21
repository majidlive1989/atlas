import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["integration/**/*.integration.ts"],
    maxWorkers: 1,
    hookTimeout: 180_000,
    testTimeout: 45_000,
  },
});
