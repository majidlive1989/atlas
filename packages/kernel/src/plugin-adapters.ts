import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { BlockList } from "node:net";
import { sql, type DbSession } from "@atlas/db";
import type { PluginDatabase } from "@atlas/plugin-sdk";
import { z } from "zod";
import type { Release } from "./plugin-catalog.js";

export const nameSchema = z
  .string()
  .max(100)
  .regex(/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/);
export const valueSchema = z.json();

export function pluginDatabase(
  release: Release,
  siteId: string,
  run: <T>(work: (tx: DbSession) => Promise<T>) => Promise<T>,
): PluginDatabase {
  const columns = new Map<string, Map<string, string>>();
  for (const migration of release.migrations) {
    for (const operation of migration.operations) {
      const fields = columns.get(operation.table) ?? new Map<string, string>();
      for (const column of operation.action === "create-table"
        ? operation.columns
        : [operation.column])
        fields.set(column.name, column.type);
      columns.set(operation.table, fields);
    }
  }
  function table(name: string) {
    if (
      !release.manifest.permissions.some((permission) => permission.kind === "database") ||
      !columns.has(name)
    )
      throw new Error("Database permission denied.");
    return sql.identifier("plg_" + release.manifest.slug.replaceAll("-", "_") + "__" + name);
  }

  return {
    async insert(name, values) {
      const target = table(name);
      const entries = Object.entries(z.record(z.string(), valueSchema).parse(values));
      const fields = columns.get(name);
      if (entries.some(([key]) => !fields?.has(key))) throw new Error("Unknown plugin column.");
      const names = entries.map(([key]) => sql`, ${sql.identifier(key)}`);
      const parameters = entries.map(([key, value]) =>
        fields?.get(key) === "jsonb" ? sql`, ${JSON.stringify(value)}::jsonb` : sql`, ${value}`,
      );
      const [row] = await run((tx) =>
        tx.query<{ id: string }>(sql`insert into ${target}
        (site_id ${sql.join(names)}) values (${siteId} ${sql.join(parameters)}) returning id`),
      );
      if (!row) throw new Error("Plugin insert returned no identifier.");
      return row.id;
    },
    async get(name, id) {
      const target = table(name);
      const [row] = await run((tx) =>
        tx.query<{ value: unknown }>(sql`select to_jsonb(record) - 'site_id' as value
        from ${target} as record where site_id = ${siteId} and id = ${z.uuid().parse(id)}`),
      );
      return row ? z.record(z.string(), valueSchema).parse(row.value) : undefined;
    },
  };
}

const blocked = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  blocked.addSubnet(address, prefix);

export async function getPluginHttp(input: string, origins: readonly string[]) {
  const url = new URL(z.string().max(2048).parse(input));
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    !origins.includes(url.origin)
  )
    throw new Error("HTTP permission denied.");
  const addresses = await lookup(url.hostname, { family: 4, all: true });
  const first = addresses[0];
  if (!first || addresses.some(({ address }) => blocked.check(address)))
    throw new Error("HTTP destination denied.");
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const client = request(
      url,
      {
        agent: false,
        family: 4,
        lookup: (_name, _options, callback) => callback(null, first.address, 4),
        signal: AbortSignal.timeout(5_000),
      },
      (response) => {
        const status = response.statusCode ?? 500;
        if (status >= 300 && status < 400) {
          response.destroy();
          reject(new Error("HTTP redirects are disabled."));
          return;
        }
        const chunks: Buffer[] = [];
        let bytes = 0;
        response.on("data", (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > 512 * 1024) client.destroy(new Error("HTTP response exceeds limit."));
          else chunks.push(chunk);
        });
        response.once("error", reject);
        response.once("end", () =>
          resolve({ status, body: Buffer.concat(chunks).toString("utf8") }),
        );
      },
    );
    client.once("error", reject);
    client.end();
  });
}
