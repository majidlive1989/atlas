import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));
const parents = ["apps", "packages", "plugins", "themes", ...children("examples")];
const workspaces = parents
  .flatMap(children)
  .filter((path) => existsSync(join(root, path, "package.json")))
  .map((path) => ({
    path,
    manifest: JSON.parse(readFileSync(join(root, path, "package.json"), "utf8")),
  }));
const byName = new Map(workspaces.map(({ path, manifest }) => [manifest.name, path]));
const graph = new Map();
const errors = [];

for (const { path, manifest } of workspaces) {
  const deps = Object.assign(
    {},
    manifest.dependencies,
    manifest.devDependencies,
    manifest.optionalDependencies,
    manifest.peerDependencies,
  );
  graph.set(
    manifest.name,
    Object.keys(deps).filter((name) => byName.has(name)),
  );

  for (const [name, range] of Object.entries(deps)) {
    if (range.startsWith("workspace:") && !byName.has(name)) {
      errors.push(`${path} declares an unknown workspace ${name}`);
    }
  }

  for (const file of ts.sys.readDirectory(
    join(root, path),
    [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"],
    ["**/node_modules/**", "**/dist/**"],
  )) {
    const source = ts.createSourceFile(
      file,
      readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    function visit(node) {
      const imported =
        ts.isImportDeclaration(node) || ts.isExportDeclaration(node)
          ? node.moduleSpecifier
          : ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)
            ? node.argument.literal
            : ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword
              ? node.arguments[0]
              : undefined;
      if (imported && ts.isStringLiteralLike(imported)) {
        checkImport(imported.text, file, path, deps);
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
}

const visiting = new Set();
const visited = new Set();
for (const name of graph.keys()) visitWorkspace(name, []);
if (errors.length > 0) {
  process.stderr.write(errors.join("\n") + "\n");
  process.exitCode = 1;
}

function children(parent) {
  return readdirSync(join(root, parent), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(parent, entry.name));
}

function checkImport(specifier, file, workspace, deps) {
  if (specifier.startsWith(".")) {
    const destination = relative(root, resolve(dirname(file), specifier));
    if (destination !== workspace && !destination.startsWith(workspace + sep)) {
      errors.push(`${relative(root, file)} imports outside its workspace: ${specifier}`);
    }
    return;
  }
  const name = specifier
    .split("/")
    .slice(0, specifier.startsWith("@") ? 2 : 1)
    .join("/");
  if (!byName.has(name) && !name.startsWith("@atlas/")) return;
  if (byName.get(name) !== workspace && !Object.hasOwn(deps, name)) {
    errors.push(`${relative(root, file)} imports undeclared workspace ${name}`);
  }
  if (name !== specifier) {
    const target = workspaces.find(({ manifest }) => manifest.name === name);
    const subpath = "." + specifier.slice(name.length);
    if (!Object.hasOwn(target?.manifest.exports ?? {}, subpath)) {
      errors.push(`${relative(root, file)} imports a private workspace path: ${specifier}`);
    }
  }
}

function visitWorkspace(name, path) {
  if (visiting.has(name)) {
    errors.push(
      `Workspace dependency cycle: ${[...path.slice(path.indexOf(name)), name].join(" -> ")}`,
    );
    return;
  }
  if (visited.has(name)) return;
  visiting.add(name);
  for (const dep of graph.get(name)) visitWorkspace(dep, [...path, name]);
  visiting.delete(name);
  visited.add(name);
}
