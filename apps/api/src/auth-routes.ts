import {
  AuthError,
  codeSchema,
  credentialSchema,
  emailSchema,
  passwordInputSchema,
  passwordSchema,
  randomToken,
  type SessionTokens,
} from "@atlas/auth";
import { AtlasProblem, type Kernel } from "@atlas/kernel";
import { type FastifyReply, type FastifyRequest } from "fastify";
import { z } from "zod";
import {
  commonProblems,
  date,
  id,
  keyPattern,
  listQuery,
  pageSchema,
  paging,
  securitySchema,
  uuidResponse,
} from "./http-schemas.js";
import { type AtlasApi, type RequestSecurity } from "./server.js";

const cookieName = "__Secure-atlas-refresh";
const cookiePath = "/v1/auth";
const tokenResponse = z.strictObject({
  sessionId: id,
  accessToken: z.string(),
  refreshToken: z.string().optional(),
  expiresIn: z.number(),
});
const challengeResponse = z.strictObject({ accepted: z.literal(true) });
const rateLimit = { max: 12, timeWindow: "1 minute" };
const authConfig = { rateLimit };
const keyResult = z.strictObject({
  id,
  label: z.string(),
  scopes: z.array(z.string()),
  createdAt: date,
  lastUsedAt: date.nullable(),
  revokedAt: date.nullable(),
});
const sessionResult = z.strictObject({
  id,
  createdAt: date,
  expiresAt: date,
  revokedAt: date.nullable(),
});

function requireOrigin(kernel: Kernel, request: FastifyRequest) {
  if (
    !request.headers.origin ||
    !kernel.config.ATLAS_ALLOWED_ORIGINS.includes(request.headers.origin)
  ) {
    throw new AtlasProblem(403, "invalid-origin");
  }
}

function sendTokens(reply: FastifyReply, tokens: SessionTokens, browser: boolean) {
  if (!browser) return tokens;
  const { refreshToken, ...publicTokens } = tokens;
  reply.setCookie(cookieName, refreshToken, {
    path: cookiePath,
    secure: true,
    httpOnly: true,
    sameSite: "strict",
    maxAge: 30 * 24 * 60 * 60,
  });
  return publicTokens;
}

export function registerAuth(app: AtlasApi, kernel: Kernel, security: RequestSecurity) {
  const { auth } = kernel.services;
  const user = (request: FastifyRequest) => security.identity(request).userId;
  app.post(
    "/v1/auth/register",
    {
      config: authConfig,
      schema: {
        body: z.strictObject({
          email: emailSchema,
          displayName: z.string().trim().min(1).max(100),
        }),
        response: { 202: challengeResponse, ...commonProblems },
      },
    },
    async (request, reply) => {
      const ctx = await security.scope(request);
      if (!(await kernel.services.settings.registrationEnabled(ctx)))
        throw new AtlasProblem(403, "registration-disabled");
      try {
        await auth.createUser(ctx, request.body.email, randomToken(), request.body.displayName);
      } catch (error) {
        if (!(error instanceof AuthError && error.code === "conflict")) throw error;
      }
      return reply.code(202).send({ accepted: true });
    },
  );
  app.post(
    "/v1/auth/login",
    {
      config: authConfig,
      schema: {
        body: z.strictObject({
          email: emailSchema,
          password: passwordInputSchema,
          code: codeSchema.optional(),
          client: z.enum(["browser", "native"]).default("native"),
        }),
        response: { 200: tokenResponse, ...commonProblems },
      },
    },
    async (request, reply) => {
      const browser = request.body.client === "browser";
      if (browser) requireOrigin(kernel, request);
      const context = await security.scope(request);
      const result = await kernel.inSpan("identity.login", () => auth.login(context, request.body));
      return sendTokens(reply, result, browser);
    },
  );

  app.post(
    "/v1/auth/refresh",
    {
      config: authConfig,
      schema: {
        body: z.strictObject({ refreshToken: credentialSchema.optional() }),
        response: { 200: tokenResponse, ...commonProblems },
      },
    },
    async (request, reply) => {
      const browser = !request.body.refreshToken;
      if (browser) requireOrigin(kernel, request);
      const refreshToken = request.body.refreshToken ?? request.cookies[cookieName];
      if (!credentialSchema.safeParse(refreshToken).success || !refreshToken)
        throw new AtlasProblem(401, "invalid-credentials");
      const ctx = await security.scope(request);
      return sendTokens(reply, await auth.refresh(ctx, refreshToken), browser);
    },
  );

  app.post(
    "/v1/auth/logout",
    {
      preHandler: security.requireSession,
      schema: {
        security: securitySchema,
        response: { 204: z.null(), ...commonProblems },
      },
    },
    async (request, reply) => {
      const sessionId = security.identity(request).sessionId;
      if (!sessionId) throw new AtlasProblem(401, "invalid-credentials");
      await auth.revoke(await security.scope(request), user(request), sessionId);
      reply.clearCookie(cookieName, {
        path: cookiePath,
        secure: true,
        httpOnly: true,
        sameSite: "strict",
      });
      return reply.code(204).send(null);
    },
  );

  for (const kind of ["verify", "reset"] as const) {
    app.post(
      "/v1/auth/" + kind + "/request",
      {
        config: authConfig,
        schema: {
          body: z.strictObject({ email: emailSchema }),
          response: { 202: challengeResponse, ...commonProblems },
        },
      },
      async (request, reply) => {
        await auth.sendChallenge(await security.scope(request), kind, request.body.email);
        return reply.code(202).send({ accepted: true });
      },
    );
  }

  app.post(
    "/v1/auth/verify/confirm",
    {
      config: authConfig,
      schema: {
        body: z.strictObject({ token: credentialSchema, password: passwordSchema.optional() }),
        response: { 204: z.null(), ...commonProblems },
      },
    },
    async (request, reply) => {
      await auth.verifyEmail(
        await security.scope(request),
        request.body.token,
        request.body.password,
      );
      return reply.code(204).send(null);
    },
  );

  app.post(
    "/v1/auth/reset/confirm",
    {
      config: authConfig,
      schema: {
        body: z.strictObject({ token: credentialSchema, password: passwordSchema }),
        response: { 204: z.null(), ...commonProblems },
      },
    },
    async (request, reply) => {
      await auth.resetPassword(
        await security.scope(request),
        request.body.token,
        request.body.password,
      );
      return reply.code(204).send(null);
    },
  );

  app.post(
    "/v1/auth/totp/enroll",
    {
      preHandler: security.requireSession,
      config: authConfig,
      schema: {
        security: securitySchema,
        body: z.strictObject({ password: passwordInputSchema, currentCode: codeSchema.optional() }),
        response: {
          200: z.strictObject({ secret: z.string(), uri: z.string() }),
          ...commonProblems,
        },
      },
    },
    async (request) =>
      auth.beginTotp(
        await security.scope(request),
        user(request),
        request.body.password,
        request.body.currentCode,
      ),
  );

  app.post(
    "/v1/auth/totp/confirm",
    {
      preHandler: security.requireSession,
      config: authConfig,
      schema: {
        security: securitySchema,
        body: z.strictObject({ code: z.string().regex(/^[0-9]{6}$/) }),
        response: {
          200: z.strictObject({ recoveryCodes: z.array(z.string()) }),
          ...commonProblems,
        },
      },
    },
    async (request) =>
      auth.confirmTotp(await security.scope(request), user(request), request.body.code),
  );

  app.get(
    "/v1/auth/sessions",
    {
      preHandler: security.requireSession,
      schema: {
        security: securitySchema,
        querystring: listQuery,
        response: { 200: pageSchema(sessionResult), ...commonProblems },
      },
    },
    async (request) => {
      const ctx = await security.scope(request);
      const page = paging(
        kernel.config.ATLAS_AUTH_SECRET,
        ctx.site.id + ":" + user(request) + ":sessions",
        request.query,
      );
      const rows = await auth.sessions(ctx, user(request), page.after, page.limit);
      return page.page(
        rows.map((row) => ({
          id: row.id,
          createdAt: row.createdAt.toISOString(),
          expiresAt: row.expiresAt.toISOString(),
          revokedAt: row.revokedAt?.toISOString() ?? null,
        })),
      );
    },
  );

  app.delete(
    "/v1/auth/sessions/:id",
    {
      preHandler: security.requireSession,
      schema: {
        security: securitySchema,
        params: uuidResponse,
        response: { 204: z.null(), ...commonProblems },
      },
    },
    async (request, reply) => {
      await auth.revoke(await security.scope(request), user(request), request.params.id);
      return reply.code(204).send(null);
    },
  );

  app.get(
    "/v1/auth/keys",
    {
      preHandler: security.requireSession,
      schema: {
        security: securitySchema,
        querystring: listQuery,
        response: { 200: pageSchema(keyResult), ...commonProblems },
      },
    },
    async (request) => {
      const ctx = await security.scope(request);
      const page = paging(
        kernel.config.ATLAS_AUTH_SECRET,
        ctx.site.id + ":" + user(request) + ":keys",
        request.query,
      );
      const rows = await auth.apiKeys(ctx, user(request), page.after, page.limit);
      return page.page(
        rows.map((row) => ({
          ...row,
          createdAt: row.createdAt.toISOString(),
          lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
          revokedAt: row.revokedAt?.toISOString() ?? null,
        })),
      );
    },
  );

  app.post(
    "/v1/auth/keys",
    {
      preHandler: security.requireSession,
      schema: {
        security: securitySchema,
        body: z.strictObject({
          label: z.string().trim().min(1).max(100),
          scopes: z.array(keyPattern).max(32),
        }),
        response: { 201: z.strictObject({ id, key: z.string() }), ...commonProblems },
      },
    },
    async (request, reply) => {
      const result = await auth.createApiKey(
        await security.scope(request),
        security.identity(request),
        request.body.label,
        request.body.scopes,
      );
      return reply
        .code(201)
        .header("location", "/v1/auth/keys/" + result.id)
        .send(result);
    },
  );

  app.delete(
    "/v1/auth/keys/:id",
    {
      preHandler: security.requireSession,
      schema: {
        security: securitySchema,
        params: uuidResponse,
        response: { 204: z.null(), ...commonProblems },
      },
    },
    async (request, reply) => {
      await auth.revokeApiKey(await security.scope(request), user(request), request.params.id);
      return reply.code(204).send(null);
    },
  );

  const oidcResponse = z.strictObject({ url: z.url() });
  app.post(
    "/v1/auth/oidc/start",
    {
      config: authConfig,
      schema: {
        response: { 200: oidcResponse, ...commonProblems },
      },
    },
    async (request) => ({ url: await auth.startOidc(await security.scope(request)) }),
  );

  app.post(
    "/v1/auth/oidc/link",
    {
      config: authConfig,
      preHandler: security.requireSession,
      schema: {
        security: securitySchema,
        response: { 200: oidcResponse, ...commonProblems },
      },
    },
    async (request) => ({
      url: await auth.startOidc(await security.scope(request), security.identity(request)),
    }),
  );

  app.get(
    "/v1/auth/oidc/callback",
    {
      config: authConfig,
      schema: {
        querystring: z.object({
          state: z.string().length(43),
          code: z.string().max(4096).optional(),
          error: z.string().max(256).optional(),
          iss: z.string().max(512).optional(),
        }),
        response: { 200: tokenResponse, 204: z.null(), ...commonProblems },
      },
    },
    async (request, reply) => {
      const ctx = await security.scope(request);
      const url = new URL("/v1/auth/oidc/callback", kernel.config.ATLAS_ISSUER);
      for (const [key, value] of Object.entries(request.query))
        if (value !== undefined) url.searchParams.set(key, value);
      const result = await auth.finishOidc(ctx, url);
      if (!result) return reply.code(204).send(null);
      return sendTokens(reply, result, true);
    },
  );
}
