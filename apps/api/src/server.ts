import { randomUUID } from "node:crypto";
import { type IncomingMessage, type ServerResponse } from "node:http";
import { AuthError, can, type Capability, type Principal } from "@atlas/auth";
import { problemSchema } from "@atlas/contracts";
import { audit, resolveSite, type AuditContext } from "@atlas/db";
import { AtlasProblem, kernelFromEnv, problem, type Kernel } from "@atlas/kernel";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import Fastify, {
  LogController,
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
  type RawServerDefault,
} from "fastify";
import {
  jsonSchemaTransform,
  jsonSchemaTransformObject,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import { z } from "zod";
import { registerAuth } from "./auth-routes.js";
import { pluginOpenApi, registerPluginRoutes } from "./plugin-routes.js";
import { registerManagement } from "./management-routes.js";

const statusSchema = z.strictObject({ status: z.enum(["live", "ready"]) });
const spans = new WeakMap<FastifyRequest, ReturnType<Kernel["startSpan"]>>();

const authStatuses = {
  "invalid-credentials": 401,
  "second-factor-required": 401,
  "verification-required": 403,
  "invalid-challenge": 400,
  "invalid-factor": 400,
  forbidden: 403,
  "not-found": 404,
  conflict: 409,
  "oidc-unavailable": 503,
} as const;

export interface RequestSecurity {
  scope(request: FastifyRequest): Promise<AuditContext>;
  identity(request: FastifyRequest): Principal;
  authenticate(request: FastifyRequest): Promise<void>;
  requireSession(request: FastifyRequest): Promise<void>;
  require(capability: Capability): (request: FastifyRequest) => Promise<void>;
}

export type AtlasApi = FastifyInstance<
  RawServerDefault,
  IncomingMessage,
  ServerResponse,
  Kernel["services"]["logger"],
  ZodTypeProvider
>;

export async function createApi(kernel: Kernel): Promise<AtlasApi> {
  const { config, services } = kernel;
  const app = Fastify({
    loggerInstance: services.logger,
    logController: new LogController({ disableRequestLogging: true }),
    genReqId: () => randomUUID(),
    requestIdHeader: false,
    trustProxy: false,
    bodyLimit: 64 * 1024,
    requestTimeout: 15_000,
  }).withTypeProvider<ZodTypeProvider>();
  const scopes = new WeakMap<FastifyRequest, AuditContext>();
  const principals = new WeakMap<FastifyRequest, Principal>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.addHook("onRequest", async (request, reply) => {
    const span = kernel.startSpan("http.request");
    span.setAttribute("http.request.method", request.method);
    span.setAttribute("atlas.request.id", request.id);
    spans.set(request, span);
    reply.header("x-request-id", request.id);
    if (request.url.startsWith("/v1/")) reply.header("cache-control", "private, no-store");
  });
  app.addHook("onResponse", async (request, reply) => {
    const span = spans.get(request);
    span?.setAttribute("http.response.status_code", reply.statusCode);
    if (request.routeOptions.url) span?.setAttribute("http.route", request.routeOptions.url);
    span?.end();
    spans.delete(request);
    services.logger.info(
      {
        method: request.method,
        route: request.routeOptions.url,
        status: reply.statusCode,
        requestId: request.id,
        elapsedMs: reply.elapsedTime,
      },
      "Request complete",
    );
  });
  app.addHook("onRequestAbort", async (request) => {
    spans.get(request)?.end();
    spans.delete(request);
  });
  await app.register(helmet);
  await app.register(cors, {
    origin: [...config.ATLAS_ALLOWED_ORIGINS],
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Authorization", "Content-Type", "If-Match"],
  });
  await app.register(cookie);
  await app.register(rateLimit, { max: 120, timeWindow: "1 minute" });
  await app.register(swagger, {
    openapi: {
      openapi: "3.1.0",
      info: { title: "Atlas API", version: "0.1.0" },
      components: { securitySchemes: { bearer: { type: "http", scheme: "bearer" } } },
    },
    transform: jsonSchemaTransform,
    transformObject: jsonSchemaTransformObject,
  });
  await app.register(swaggerUi, { routePrefix: "/docs", staticCSP: true });

  function sendProblem(request: FastifyRequest, reply: FastifyReply, status: number, code: string) {
    return reply
      .code(status)
      .type("application/problem+json")
      .send(problem(status, code, request.id, scopes.get(request)?.site.locale));
  }

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AtlasProblem) return sendProblem(request, reply, error.status, error.code);
    if (error instanceof AuthError)
      return sendProblem(request, reply, authStatuses[error.code], error.code);
    if (error instanceof z.ZodError) return sendProblem(request, reply, 400, "invalid-request");
    if (
      error instanceof Error &&
      "statusCode" in error &&
      typeof error.statusCode === "number" &&
      error.statusCode >= 400 &&
      error.statusCode < 500
    ) {
      return sendProblem(
        request,
        reply,
        error.statusCode,
        error.statusCode === 429 ? "rate-limited" : "invalid-request",
      );
    }
    services.logger.error(
      { requestId: request.id, route: request.routeOptions.url },
      "Request failed",
    );
    return sendProblem(request, reply, 500, "internal-error");
  });
  app.setNotFoundHandler((request, reply) => sendProblem(request, reply, 404, "not-found"));

  const security: RequestSecurity = {
    async scope(request) {
      const known = scopes.get(request);
      if (known) return known;
      const site = await resolveSite(services.database, request.host);
      if (!site) throw new AtlasProblem(404, "site-not-found");
      const context = { site, correlationId: request.id };
      scopes.set(request, context);
      return context;
    },
    identity(request) {
      const authenticated = principals.get(request);
      if (!authenticated) throw new AuthError("invalid-credentials");
      return authenticated;
    },
    async authenticate(request) {
      const ctx = await security.scope(request);
      const authorization = request.headers.authorization;
      const token = authorization?.match(/^Bearer ([a-zA-Z0-9_.-]{32,4096})$/i)?.[1];
      try {
        if (!token) throw new AuthError("invalid-credentials");
        const principal = await kernel.inSpan("identity.authenticate", () =>
          services.auth.principal(ctx, token),
        );
        principals.set(request, principal);
        scopes.set(request, { ...ctx, actorId: principal.userId });
      } catch (error) {
        if (error instanceof AuthError) {
          await services.database.scoped(ctx.site.id, (tx) =>
            audit(tx, ctx, "identity.request.denied"),
          );
        }
        throw error;
      }
    },
    async requireSession(request) {
      await security.authenticate(request);
      if (!security.identity(request).sessionId) throw new AuthError("forbidden");
    },
    require(capability) {
      return async (request) => {
        await security.authenticate(request);
        const ctx = await security.scope(request);
        if (can(security.identity(request), capability, { siteId: ctx.site.id })) return;
        await services.database.scoped(ctx.site.id, (tx) =>
          audit(tx, ctx, "identity.policy.denied", { capability }),
        );
        throw new AuthError("forbidden");
      };
    },
  };

  app.get("/health/live", { schema: { response: { 200: statusSchema } } }, async () => ({
    status: "live" as const,
  }));
  app.get(
    "/health/ready",
    { schema: { response: { 200: statusSchema, 503: problemSchema } } },
    async (request, reply) => {
      if (!(await kernel.isReady())) return sendProblem(request, reply, 503, "not-ready");
      return { status: "ready" as const };
    },
  );
  app.get("/openapi.json", { schema: { hide: true } }, async (request) => {
    const document = app.swagger();
    const site = await resolveSite(services.database, request.host);
    return site && "openapi" in document
      ? { ...document, paths: { ...document.paths, ...pluginOpenApi(kernel, site.id) } }
      : document;
  });
  registerAuth(app, kernel, security);
  registerManagement(app, kernel, security);
  registerPluginRoutes(app, kernel, security);
  app.addHook("onClose", async () => kernel.shutdown());
  return app;
}

export async function startApi(
  env: Readonly<Record<string, string | undefined>>,
): Promise<{ app: AtlasApi; kernel: Kernel; address: string }> {
  const kernel = kernelFromEnv(env);
  let app: AtlasApi | undefined;
  try {
    app = await createApi(kernel);
    await kernel.boot();
    const address = await app.listen({
      host: kernel.config.ATLAS_HOST,
      port: kernel.config.ATLAS_PORT,
    });
    return { app, kernel, address };
  } catch (error) {
    if (app) await app.close();
    else await kernel.shutdown();
    throw error;
  }
}
