import process from "node:process";
import { URL } from "node:url";
import { readFileSync, writeFileSync } from "node:fs";
import ts from "typescript";

const root = new URL("../../../", import.meta.url);
function parse(path) {
  return ts.createSourceFile(
    path,
    readFileSync(new URL(path, root), "utf8"),
    ts.ScriptTarget.ESNext,
    true,
  );
}
const sdk = parse("packages/plugin-sdk/src/index.ts");
const hookPackage = parse("packages/hooks/src/index.ts");
const wanted = new Set(["Action", "Filter", "PluginHookOptions"]);
const declarations = sdk.statements.filter(
  (node) => ts.isInterfaceDeclaration(node) && wanted.has(node.name.text),
);
const context = sdk.statements.find(
  (node) => ts.isInterfaceDeclaration(node) && node.name.text === "PluginContext",
);
const members = context.members.filter(
  (node) => node.name.getText() === "hooks" || node.name.getText() === "events",
);
const events = hookPackage.statements.find(
  (node) => ts.isTypeAliasDeclaration(node) && node.name.text === "CoreEventCatalog",
);
const types = [
  ...declarations.map((node) => node.getText()),
  "interface PluginHooks {\n  " + members.map((node) => node.getText()).join("\n  ") + "\n}",
  events.getText(),
];
const examples = ["contact-form", "related-posts"].flatMap((slug) => {
  const file = parse("examples/plugins/" + slug + "/src/index.ts");
  return file.statements.flatMap((statement) =>
    ts.isVariableStatement(statement) &&
    statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
      ? statement.declarationList.declarations.flatMap(({ initializer }) =>
          initializer && ts.isObjectLiteralExpression(initializer)
            ? initializer.properties.flatMap((property) =>
                ts.isPropertyAssignment(property) &&
                property.name.getText() === "name" &&
                ts.isStringLiteral(property.initializer)
                  ? ["- `" + property.initializer.text + "`"]
                  : [],
              )
            : [],
        )
      : [],
  );
});
const output =
  "# Plugin hooks reference\n\n" +
  "Generated from the SDK and the core event catalog by `pnpm --filter @atlas/plugin-sdk hooks:reference`.\n\n" +
  "Register callbacks during activation. Lower priorities run first and ties keep registration order. " +
  "A filter can fail closed or retain the last valid value after an advisory failure. Event subscriptions receive committed facts scoped to the active site.\n\n" +
  types.map((source) => "```ts\n" + source + "\n```\n").join("\n") +
  "\n## Example hook names\n\n" +
  examples.join("\n") +
  "\n";
const destination = new URL("docs/guides/hooks-reference.md", root);
if (process.argv.includes("--check")) {
  if (readFileSync(destination, "utf8").replaceAll("\r\n", "\n") !== output)
    throw new Error("Plugin hooks reference is out of date.");
} else {
  writeFileSync(destination, output);
}
