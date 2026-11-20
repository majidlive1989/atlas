import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export const config = tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/.turbo/**",
      "**/coverage/**",
      "**/playwright-report/**",
      "**/test-results/**",
      "**/.next/**",
      ".phase0-runtime/**",
      ".pnpm-store/**",
    ],
  },
  eslint.configs.recommended,
  { extends: tseslint.configs.strict, files: ["**/*.ts", "**/*.mts", "**/*.cts", "**/*.tsx"] },
);
