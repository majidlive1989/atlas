import { createHash, type Hash } from "node:crypto";
import { readFile, readdir, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { pluginManifest, type PluginManifest } from "@atlas/contracts";
import { readMigrations } from "./plugin-migrations.js";

export type Release = {
  readonly manifest: PluginManifest;
  readonly digest: string;
  readonly server: string;
  readonly migrations: Awaited<ReturnType<typeof readMigrations>>;
};

async function directoryNames(path: string): Promise<string[]> {
  try {
    const entries = await readdir(path, { withFileTypes: true });
    return entries
      .filter(
        (entry) => !entry.name.startsWith(".") && (entry.isDirectory() || entry.isSymbolicLink()),
      )
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (
      (error as NodeJS.ErrnoException).code === "ENOENT" ||
      (error as NodeJS.ErrnoException).code === "ENOTDIR"
    )
      return false;
    throw error;
  }
}

async function contained(root: string, subpath: string) {
  const path = await realpath(join(root, ...subpath.split("/")));
  const relativePath = relative(root, path);
  if (
    !relativePath ||
    relativePath === ".." ||
    relativePath.startsWith(".." + sep) ||
    isAbsolute(relativePath)
  ) {
    throw new Error("Plugin entry escapes its release.");
  }
  return path;
}

async function hashTree(
  root: string,
  folder: string,
  hash: Hash,
  limits: { files: number; bytes: number },
): Promise<void> {
  const entries = await readdir(folder, { withFileTypes: true });
  for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : a.name === b.name ? 0 : 1))) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const path = join(folder, entry.name);
    if (entry.isSymbolicLink()) throw new Error("Plugin releases cannot contain symlinks.");
    if (entry.isDirectory()) {
      await hashTree(root, path, hash, limits);
      continue;
    }
    if (!entry.isFile()) throw new Error("Plugin release contains an unsupported entry.");
    limits.files += 1;
    limits.bytes += (await stat(path)).size;
    if (limits.files > 2048 || limits.bytes > 32 * 1024 * 1024)
      throw new Error("Plugin release exceeds size limits.");
    const data = await readFile(path);
    hash.update(JSON.stringify([relative(root, path).split(sep).join("/"), data.length]));
    hash.update(data);
  }
}

export async function readRelease(path: string): Promise<Release> {
  const root = await realpath(path);
  const manifestFile = await contained(root, "plugin.json");
  if ((await stat(manifestFile)).size > 32_768)
    throw new Error("Plugin manifest exceeds size limits.");
  const manifest = pluginManifest.parse(JSON.parse(await readFile(manifestFile, "utf8")));
  const server = await contained(root, manifest.entries.server);
  if (!(await stat(server)).isFile()) throw new Error("Invalid server entry.");
  if (manifest.entries.admin) await contained(root, manifest.entries.admin);
  const hash = createHash("sha256");
  await hashTree(root, root, hash, { files: 0, bytes: 0 });
  const migrations = manifest.migrations
    ? await readMigrations(await contained(root, manifest.migrations))
    : [];
  return { manifest, digest: hash.digest("hex"), server, migrations };
}

export async function discoverPlugins(
  root: string,
  nodeModules: string,
  report: (path: string) => void,
): Promise<Release[]> {
  const directories: string[] = [];
  for (const name of await directoryNames(root)) {
    const base = resolve(root, name);
    directories.push(base);
    for (const version of await directoryNames(base)) directories.push(join(base, version));
  }
  for (const name of await directoryNames(nodeModules)) {
    const base = resolve(nodeModules, name);
    if (!name.startsWith("@")) directories.push(base);
    else for (const scoped of await directoryNames(base)) directories.push(join(base, scoped));
  }
  const releases: Release[] = [];
  for (const directory of directories) {
    if (!(await exists(join(directory, "plugin.json")))) continue;
    try {
      releases.push(await readRelease(directory));
    } catch {
      report(directory);
    }
  }
  return releases;
}
