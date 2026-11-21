#!/usr/bin/env node
import { runCli } from "./cli.js";

try {
  process.loadEnvFile();
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}
try {
  process.exitCode = await runCli(process.argv.slice(2), process.env);
} catch (error) {
  process.stderr.write((error instanceof Error ? error.message : "Atlas command failed.") + "\n");
  process.exitCode = 1;
}
