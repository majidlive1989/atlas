import { emailSchema, passwordSchema } from "@atlas/auth";
import { pluginSlug, releaseVersion } from "@atlas/contracts";
import { AtlasProblem, settingKey, type Kernel } from "@atlas/kernel";
import { z } from "zod";
import {
  commonProblems,
  id,
  ifMatch,
  jsonSettings,
  jsonValue,
  keyPattern,
  listQuery,
  pageSchema,
  paging,
  securitySchema,
  uuidResponse,
  versionOf,
} from "./http-schemas.js";
import { type AtlasApi, type RequestSecurity } from "./server.js";

const roleKey = z
  .string()
  .min(1)
  .max(48)
  .regex(/^[a-z][a-z0-9_-]*$/);
const user = z.strictObject({ id, displayName: z.string(), email: z.email(), locale: z.string() });
const role = z.strictObject({
  id,
  key: roleKey,
  label: z.string(),
  reserved: z.boolean(),
  capabilities: z.array(z.string()),
});
const setting = z.strictObject({
  key: settingKey,
  value: jsonValue,
  version: z.number().int().nonnegative(),
});
const plugin = z.strictObject({
  slug: pluginSlug,
  version: releaseVersion,
  state: z.enum(["active", "inactive", "faulted"]),
  settingsVersion: z.number().int().positive(),
});
const available = z.strictObject({
  slug: pluginSlug,
  version: releaseVersion,
  tier: z.enum(["trusted", "untrusted"]),
});
const pluginParams = z.strictObject({ slug: pluginSlug });
const pluginSettings = z.strictObject({
  settings: jsonSettings,
  version: z.number().int().positive(),
});

export function registerManagement(app: AtlasApi, kernel: Kernel, security: RequestSecurity) {
  const { auth, access, plugins, settings } = kernel.services;
  app.get(
    "/v1/users/:id",
    {
      preHandler: security.require("identity.user.read"),
      schema: {
        security: securitySchema,
        params: uuidResponse,
        response: { 200: user, ...commonProblems },
      },
    },
    async (request) => auth.user(await security.scope(request), request.params.id),
  );
  app.get(
    "/v1/users",
    {
      preHandler: security.require("identity.user.read"),
      schema: {
        security: securitySchema,
        querystring: listQuery,
        response: { 200: pageSchema(user), ...commonProblems },
      },
    },
    async (request) => {
      const ctx = await security.scope(request);
      const pagination = paging(
        kernel.config.ATLAS_AUTH_SECRET,
        ctx.site.id + ":users",
        request.query,
      );
      return pagination.page(await auth.users(ctx, pagination.after, pagination.limit));
    },
  );

  app.post(
    "/v1/users",
    {
      preHandler: security.require("identity.user.create"),
      schema: {
        security: securitySchema,
        body: z.strictObject({
          email: emailSchema,
          password: passwordSchema,
          displayName: z.string().trim().min(1).max(100),
        }),
        response: { 201: uuidResponse, ...commonProblems },
      },
    },
    async (request, reply) => {
      const { email, password, displayName } = request.body;
      const userId = await auth.createUser(
        await security.scope(request),
        email,
        password,
        displayName,
      );
      return reply
        .code(201)
        .header("location", "/v1/users/" + userId)
        .send({ id: userId });
    },
  );

  app.get(
    "/v1/roles",
    {
      preHandler: security.require("identity.role.read"),
      schema: {
        security: securitySchema,
        response: { 200: z.array(role), ...commonProblems },
      },
    },
    async (request) => access.roles(await security.scope(request)),
  );

  app.get(
    "/v1/capabilities",
    {
      preHandler: security.require("identity.role.read"),
      schema: {
        security: securitySchema,
        response: {
          200: z.array(z.strictObject({ key: keyPattern, label: z.string() })),
          ...commonProblems,
        },
      },
    },
    async () => access.capabilities(),
  );

  app.put(
    "/v1/roles/:key",
    {
      preHandler: security.require("identity.role.manage"),
      schema: {
        security: securitySchema,
        params: z.strictObject({ key: roleKey }),
        body: z.strictObject({
          label: z.string().trim().min(1).max(100),
          capabilities: z.array(keyPattern).max(64),
        }),
        response: { 200: uuidResponse, ...commonProblems },
      },
    },
    async (request) => ({
      id: await access.writeRole(await security.scope(request), security.identity(request), {
        key: request.params.key,
        ...request.body,
      }),
    }),
  );

  app.put(
    "/v1/users/:id/roles/:key",
    {
      preHandler: security.require("identity.role.manage"),
      schema: {
        security: securitySchema,
        params: z.strictObject({ id, key: roleKey }),
        body: z.strictObject({ assigned: z.boolean() }),
        response: { 204: z.null(), ...commonProblems },
      },
    },
    async (request, reply) => {
      await access.assignRole(
        await security.scope(request),
        security.identity(request),
        request.params.id,
        request.params.key,
        request.body.assigned,
      );
      return reply.code(204).send(null);
    },
  );

  app.get(
    "/v1/options",
    {
      preHandler: security.require("system.setting.read"),
      schema: {
        security: securitySchema,
        response: { 200: z.array(setting), ...commonProblems },
      },
    },
    async (request) => settings.list(await security.scope(request)),
  );

  app.put(
    "/v1/options/:key",
    {
      preHandler: security.require("system.setting.write"),
      schema: {
        security: securitySchema,
        headers: ifMatch,
        params: z.strictObject({ key: settingKey }),
        body: z.strictObject({ value: jsonValue }),
        response: { 200: setting, ...commonProblems },
      },
    },
    async (request, reply) => {
      const result = await settings.write(
        await security.scope(request),
        request.params.key,
        request.body.value,
        versionOf(request.headers["if-match"]),
      );
      reply.header("etag", '"' + result.version + '"');
      return result;
    },
  );

  app.get(
    "/v1/plugins",
    {
      preHandler: security.require("extension.plugin.read"),
      schema: {
        security: securitySchema,
        response: {
          200: z.strictObject({ installed: z.array(plugin), available: z.array(available) }),
          ...commonProblems,
        },
      },
    },
    async (request) => plugins.list(await security.scope(request)),
  );

  app.post(
    "/v1/plugins/:slug/:operation",
    {
      preHandler: security.require("extension.plugin.manage"),
      schema: {
        security: securitySchema,
        params: pluginParams.extend({
          operation: z.enum(["install", "activate", "deactivate", "upgrade", "uninstall"]),
        }),
        body: z.strictObject({ version: releaseVersion.optional() }),
        response: { 204: z.null(), ...commonProblems },
      },
    },
    async (request, reply) => {
      const { operation, slug } = request.params;
      if ((operation === "install" || operation === "upgrade") !== Boolean(request.body.version)) {
        throw new AtlasProblem(400, "invalid-plugin-version");
      }
      await plugins.change(await security.scope(request), operation, slug, request.body.version);
      return reply.code(204).send(null);
    },
  );

  app.get(
    "/v1/plugins/:slug/settings",
    {
      preHandler: security.require("extension.plugin.manage"),
      schema: {
        security: securitySchema,
        params: pluginParams,
        response: { 200: pluginSettings, ...commonProblems },
      },
    },
    async (request, reply) => {
      const result = await plugins.readSettings(await security.scope(request), request.params.slug);
      reply.header("etag", '"' + result.version + '"');
      return { settings: jsonSettings.parse(result.settings), version: result.version };
    },
  );

  app.put(
    "/v1/plugins/:slug/settings",
    {
      preHandler: security.require("extension.plugin.manage"),
      schema: {
        security: securitySchema,
        params: pluginParams,
        headers: ifMatch,
        body: z.strictObject({ settings: jsonSettings }),
        response: { 200: pluginSettings, ...commonProblems },
      },
    },
    async (request, reply) => {
      const result = await plugins.writeSettings(
        await security.scope(request),
        request.params.slug,
        versionOf(request.headers["if-match"]),
        request.body.settings,
      );
      reply.header("etag", '"' + result.version + '"');
      return { settings: jsonSettings.parse(result.settings), version: result.version };
    },
  );
}
