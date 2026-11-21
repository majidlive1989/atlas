import { z } from "zod";

const origins = z
  .string()
  .default("")
  .transform((value, ctx) => {
    const result: string[] = [];
    for (const item of value
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)) {
      try {
        const url = new URL(item);
        if (!["https:", "http:"].includes(url.protocol) || item !== url.origin) throw new Error();
        result.push(url.origin);
      } catch {
        ctx.addIssue({ code: "custom", message: "Expected comma-separated HTTP origins" });
        return z.NEVER;
      }
    }
    return result;
  });

const oidcSecret = z.string().min(1).optional();
const schema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    DATABASE_URL: z.url({ protocol: /^postgres(?:ql)?$/ }),
    ATLAS_AUTH_SECRET: z
      .string()
      .regex(/^[a-zA-Z0-9_-]{43}$/)
      .transform((value) => Buffer.from(value, "base64url")),
    ATLAS_ISSUER: z.url().default("http://localhost:3000"),
    ATLAS_HOST: z.string().default("127.0.0.1"),
    ATLAS_PORT: z.coerce.number().int().min(0).max(65535).default(3000),
    ATLAS_SITE_HOST: z.string().min(1).max(255).default("localhost"),
    ATLAS_ALLOWED_ORIGINS: origins,
    ATLAS_LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),
    ATLAS_MAIL_URL: z.url({ protocol: /^smtps?$/ }).default("smtp://127.0.0.1:1025"),
    ATLAS_MAIL_FROM: z.email().default("atlas@localhost.test"),
    ATLAS_TRUSTED_PLUGINS: z
      .string()
      .default("")
      .transform((value) =>
        value
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
      ),
    ATLAS_PLUGIN_STORAGE: z.string().min(1).default(".atlas-plugin-storage"),
    ATLAS_PLUGIN_CACHE_URL: z.url({ protocol: /^rediss?$/ }).optional(),
    ATLAS_PLUGIN_QUEUE_URL: z.url({ protocol: /^rediss?$/ }).optional(),
    ATLAS_PLUGIN_SANDBOX_IMAGE: z
      .string()
      .regex(/^[a-z0-9][a-z0-9._/:@-]+$/)
      .optional(),
    ATLAS_PLUGIN_RELEASE_GRANTS: z
      .string()
      .default("")
      .transform((value) =>
        value
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
      )
      .pipe(z.array(z.string().regex(/^[a-f0-9]{64}$/))),
    ATLAS_PLUGIN_ROOT: z.string().min(1).default("plugins"),
    ATLAS_OIDC_ISSUER: z.url({ protocol: /^https$/ }).optional(),
    ATLAS_OIDC_CLIENT_ID: z.string().min(1).optional(),
    ATLAS_OIDC_CLIENT_SECRET: oidcSecret,
  })
  .refine(
    (env) =>
      Boolean(env.ATLAS_OIDC_ISSUER) === Boolean(env.ATLAS_OIDC_CLIENT_ID) &&
      (!env.ATLAS_OIDC_CLIENT_SECRET || Boolean(env.ATLAS_OIDC_ISSUER)),
    {
      path: ["ATLAS_OIDC_ISSUER"],
      message: "OIDC issuer and client ID are configured together",
    },
  );

export type AtlasConfig = Readonly<z.output<typeof schema>>;

export function readConfig(env: Readonly<Record<string, string | undefined>>): AtlasConfig {
  const result = schema.safeParse(env);
  if (!result.success) {
    throw new Error(
      "Invalid Atlas environment: " +
        result.error.issues.map((issue) => issue.path.join(".")).join(", "),
    );
  }
  return Object.freeze(result.data);
}
