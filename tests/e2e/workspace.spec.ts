import { execFileSync } from "node:child_process";
import { test } from "@playwright/test";

for (const app of ["api", "admin", "site"]) {
  test(`${app} loads through its built package export`, () => {
    execFileSync(
      process.execPath,
      ["--input-type=module", "--eval", `await import("@atlas/${app}");`],
      {
        cwd: new URL(`../../apps/${app}/`, import.meta.url),
      },
    );
  });
}
