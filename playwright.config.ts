import { defineConfig } from "@playwright/test";

export default defineConfig({
  projects: [
    { name: "workspace-exports", testDir: "./tests/e2e" },
    { name: "phase-1-api", testDir: "./apps/api/e2e" },
  ],
  forbidOnly: Boolean(process.env.CI),
  reporter: "list",
});
