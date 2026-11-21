import { valid, validRange } from "semver";
import { z } from "zod";

export const pluginSlug = z
  .string()
  .max(32)
  .regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/);
export const releaseVersion = z
  .string()
  .max(64)
  .refine((value) => valid(value) === value);
const range = z
  .string()
  .min(1)
  .max(128)
  .refine((value) => validRange(value) !== null);
const packagePath = z
  .string()
  .max(240)
  .refine((path) =>
    path.split("/").every((segment) => /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(segment)),
  );
const serverPath = packagePath.refine((value) => /\.(?:mjs|js)$/.test(value));
const permission = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("database"), scope: z.literal("own-tables") }),
  z.strictObject({ kind: z.literal("hooks"), names: z.array(z.string().min(3).max(128)).max(64) }),
  z.strictObject({
    kind: z.literal("http"),
    origins: z
      .array(
        z.url().refine((value) => {
          const url = new URL(value);
          return url.protocol === "https:" && url.origin === value;
        }),
      )
      .max(32),
  }),
  z.strictObject({ kind: z.literal("mail") }),
  z.strictObject({ kind: z.literal("cache") }),
  z.strictObject({ kind: z.literal("jobs") }),
  z.strictObject({ kind: z.literal("storage"), prefixes: z.array(packagePath).max(32) }),
]);

export const pluginManifest = z
  .strictObject({
    schemaVersion: z.literal(1),
    slug: pluginSlug,
    version: releaseVersion,
    engines: z.strictObject({ atlas: range }),
    tier: z.enum(["trusted", "untrusted"]),
    entries: z.strictObject({
      server: serverPath,
      admin: serverPath.optional(),
      frontend: serverPath.optional(),
    }),
    requires: z.record(pluginSlug, range).optional(),
    permissions: z.array(permission).max(16),
    migrations: packagePath.optional(),
  })
  .refine((manifest) => !Object.hasOwn(manifest.requires ?? {}, manifest.slug), {
    path: ["requires"],
  });

export type PluginManifest = z.infer<typeof pluginManifest>;

export const problemSchema = z.strictObject({
  type: z.url(),
  title: z.string(),
  status: z.number().int().min(400).max(599),
  code: z.string(),
  instance: z.string(),
});

export type Problem = z.infer<typeof problemSchema>;
