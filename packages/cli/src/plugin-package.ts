import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
  type KeyObject,
} from "node:crypto";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join, resolve, relative, isAbsolute, sep } from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";
import { zipSync, unzipSync } from "fflate";
import { pluginManifest } from "@atlas/plugin-sdk";
import { z } from "zod";

const limit = 32 * 1024 * 1024;
const maxArchive = limit + 2 * 1024 * 1024;
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const fileName = z
  .string()
  .max(240)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*(?:\/[a-zA-Z0-9][a-zA-Z0-9._-]*)*$/);
const sha256 = (buffer: Uint8Array) => createHash("sha256").update(buffer).digest("hex");
const signatureSchema = z.base64().refine((value) => Buffer.from(value, "base64").length === 64);
const receipt = z.strictObject({ sha256: digest, signature: signatureSchema.optional() });

type Files = Map<string, Buffer>;

function manifest(files: Files) {
  const data = files.get("plugin.json");
  if (!data || data.length > 32_768) throw new Error("Missing or oversized plugin manifest.");
  const result = pluginManifest.parse(JSON.parse(data.toString("utf8")));
  for (const entry of Object.values(result.entries)) {
    if (entry && !files.has(entry)) throw new Error("Archive is missing a plugin entry.");
  }
  if (
    result.migrations &&
    ![...files.keys()].some((name) => name.startsWith(result.migrations + "/"))
  )
    throw new Error("Archive is missing plugin migrations.");
  return result;
}

function add(files: Files, name: string, data: Buffer) {
  const key = fileName.parse(name);
  if (
    [...files.keys()].some((prior) => {
      const left = prior.toLowerCase(),
        right = key.toLowerCase();
      return left === right || left.startsWith(right + "/") || right.startsWith(left + "/");
    })
  )
    throw new Error("Archive contains conflicting paths.");
  if (files.size >= 2048) throw new Error("Archive has too many files.");
  files.set(key, data);
}

async function releaseFiles(root: string) {
  const files: Files = new Map();
  let total = 0;
  async function scan(directory: string) {
    const items = await readdir(directory, { withFileTypes: true });
    for (const entry of items.sort((left, right) =>
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
    )) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await scan(path);
      else if (entry.isFile()) {
        total += (await stat(path)).size;
        if (total > limit) throw new Error("Release exceeds size limit.");
        add(files, relative(root, path).split(sep).join("/"), await readFile(path));
      } else throw new Error("Release contains a link or special file.");
    }
  }
  await scan(root);
  return files;
}

function tar(files: Files) {
  const chunks: Buffer[] = [];
  for (const [path, contents] of files) {
    const header = Buffer.alloc(512);
    const slash = path.lastIndexOf("/");
    const [prefix, name] =
      path.length > 100 ? [path.slice(0, slash), path.slice(slash + 1)] : ["", path];
    if (name.length > 100 || prefix.length > 155 || (!prefix && path.length > 100))
      throw new Error("Release path exceeds USTAR limits.");
    header.write(name, 0, 100, "ascii");
    header.write("0000644\0", 100, "ascii");
    header.write("0000000\0", 108, "ascii");
    header.write("0000000\0", 116, "ascii");
    header.write(contents.length.toString(8).padStart(11, "0") + "\0", 124, "ascii");
    header.write("00000000000\0", 136, "ascii");
    header.fill(32, 148, 156);
    header.write("0", 156, "ascii");
    header.write("ustar\0" + "00", 257, "ascii");
    header.write(prefix, 345, 155, "ascii");
    header.write(
      header
        .reduce((sum, value) => sum + value, 0)
        .toString(8)
        .padStart(6, "0") + "\0 ",
      148,
      "ascii",
    );
    chunks.push(header, contents, Buffer.alloc((512 - (contents.length % 512)) % 512));
  }
  chunks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(chunks));
}

function untar(archive: Buffer): Files {
  const tar = gunzipSync(archive, { maxOutputLength: maxArchive });
  const files: Files = new Map();
  const read = (header: Buffer, start: number, end: number) =>
    header.subarray(start, end).toString("latin1").split("\0", 1)[0] ?? "";
  let offset = 0;
  let total = 0;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((value) => value === 0)) {
      if (offset + 1024 <= tar.length && tar.subarray(offset).every((value) => value === 0))
        return files;
      break;
    }
    const sizeField = read(header, 124, 136).trim();
    const expected = read(header, 148, 156).trim();
    const checksum = header.reduce(
      (sum, value, index) => sum + (index >= 148 && index < 156 ? 32 : value),
      0,
    );
    if (
      read(header, 257, 263) !== "ustar" ||
      read(header, 156, 157) !== "0" ||
      !/^[0-7]+$/.test(sizeField) ||
      !/^[0-7]+$/.test(expected) ||
      Number.parseInt(expected, 8) !== checksum
    )
      throw new Error("Unsupported TAR member.");
    const size = Number.parseInt(sizeField, 8);
    const prefix = read(header, 345, 500);
    const name = read(header, 0, 100);
    const start = offset + 512;
    total += size;
    if (total > limit || start + size > tar.length) throw new Error("Invalid TAR member size.");
    add(files, prefix ? prefix + "/" + name : name, tar.subarray(start, start + size));
    offset = start + Math.ceil(size / 512) * 512;
  }
  throw new Error("Invalid TAR terminator.");
}

function unzip(archive: Buffer): Files {
  const files: Files = new Map();
  const expected = new Map<string, number>();
  let bytes = 0;
  const decoded = unzipSync(archive, {
    filter({ name, originalSize }) {
      if (expected.has(name) || expected.size >= 2048) throw new Error("Invalid ZIP entry count.");
      fileName.parse(name);
      bytes += originalSize;
      if (bytes > limit) throw new Error("ZIP exceeds size limit.");
      expected.set(name, originalSize);
      return true;
    },
  });
  for (const [name, contents] of Object.entries(decoded)) {
    if (expected.get(name) !== contents.length) throw new Error("ZIP entry size mismatch.");
    add(files, name, Buffer.from(contents));
  }
  if (files.size !== expected.size) throw new Error("ZIP entries are missing.");
  return files;
}

function format(path: string) {
  if (path.endsWith(".zip")) return "zip";
  if (path.endsWith(".tgz") || path.endsWith(".tar.gz")) return "tgz";
  throw new Error("Expected ZIP or TGZ archive path.");
}

function ed25519(key: KeyObject) {
  if (key.asymmetricKeyType !== "ed25519") throw new Error("Expected an Ed25519 key.");
  return key;
}

export async function packPlugin(directory: string, destination: string, privateKey?: string) {
  const root = resolve(directory);
  const output = resolve(destination);
  const relation = relative(root, output);
  if (!isAbsolute(relation) && relation !== ".." && !relation.startsWith(".." + sep))
    throw new Error("Write the archive outside the release directory.");
  if (privateKey) {
    const keyLocation = relative(root, resolve(privateKey));
    if (!isAbsolute(keyLocation) && keyLocation !== ".." && !keyLocation.startsWith(".." + sep))
      throw new Error("Keep the private signing key outside the release directory.");
  }
  const files = await releaseFiles(root);
  const plugin = manifest(files);
  const archive =
    format(output) === "zip"
      ? zipSync(
          Object.fromEntries(
            [...files].map(([name, data]) => [name, [data, { mtime: new Date(2000, 0, 1) }]]),
          ),
        )
      : tar(files);
  const signature = privateKey
    ? sign(null, archive, ed25519(createPrivateKey(await readFile(privateKey)))).toString("base64")
    : undefined;
  const integrity = { sha256: sha256(archive), ...(signature ? { signature } : {}) };
  await writeFile(output, archive, { flag: "wx" });
  await writeFile(output + ".json", JSON.stringify(integrity, null, 2) + "\n", { flag: "wx" });
  return { ...integrity, slug: plugin.slug, version: plugin.version };
}

export async function verifyPlugin(path: string, publicKey?: string) {
  if ((await stat(path)).size > maxArchive || (await stat(path + ".json")).size > 1024)
    throw new Error("Plugin archive or receipt exceeds size limit.");
  const archive = await readFile(path);
  const integrity = receipt.parse(JSON.parse(await readFile(path + ".json", "utf8")));
  if (sha256(archive) !== integrity.sha256) throw new Error("Plugin checksum mismatch.");
  if (publicKey) {
    if (
      !integrity.signature ||
      !verify(
        null,
        archive,
        ed25519(createPublicKey(await readFile(publicKey))),
        Buffer.from(integrity.signature, "base64"),
      )
    )
      throw new Error("Plugin signature verification failed.");
  } else if (integrity.signature) throw new Error("Provide a public key to verify the signature.");
  const plugin = manifest(format(path) === "zip" ? unzip(archive) : untar(archive));
  return {
    slug: plugin.slug,
    version: plugin.version,
    sha256: integrity.sha256,
    signed: Boolean(publicKey),
  };
}
