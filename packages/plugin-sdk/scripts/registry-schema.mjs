import process from "node:process";
import { URL } from "node:url";
import { readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";
import { pluginRegistry } from "../dist/index.js";

const target = new URL("../../../docs/contracts/plugin-registry.schema.json", import.meta.url);
const source = JSON.stringify(z.toJSONSchema(pluginRegistry), null, 2) + "\n";
if (process.argv.includes("--check")) {
  if (readFileSync(target, "utf8").replaceAll("\r\n", "\n") !== source)
    throw new Error("The plugin registry schema is out of date.");
} else {
  writeFileSync(target, source);
}
