import { AuthError } from "@atlas/auth";
import { pluginSlug } from "@atlas/contracts";
import { AtlasProblem, type Kernel } from "@atlas/kernel";
import { z } from "zod";
import type { AtlasApi, RequestSecurity } from "./server.js";

const methods = ["GET", "POST", "PUT", "DELETE"] as const;

export function registerPluginRoutes(app: AtlasApi, kernel: Kernel, security: RequestSecurity) {
  app.route({
    method: [...methods],
    url: "/v1/extensions/:slug/*",
    schema: { hide: true },
    async handler(request) {
      const scope = await security.scope(request);
      const params = z.object({ slug: pluginSlug, "*": z.string().max(179) }).parse(request.params);
      const route = kernel.services.plugins.route(
        scope.site.id,
        params.slug,
        request.method,
        "/" + params["*"],
      );
      if (!route) throw new AtlasProblem(404, "not-found");
      if (route.access !== "public") {
        await security.authenticate(request);
        if (
          typeof route.access === "object" &&
          !security.identity(request).capabilities.has(route.access.capability)
        )
          throw new AuthError("forbidden");
      }
      return route.handle(request.method === "GET" ? request.query : request.body);
    },
  });
}

export function pluginOpenApi(kernel: Kernel, siteId: string) {
  const paths: Record<string, Record<string, object>> = Object.create(null);
  for (const { slug, route } of kernel.services.plugins.routes(siteId)) {
    const path = "/v1/extensions/" + slug + route.path;
    const operations = (paths[path] ??= Object.create(null));
    const fields = z
      .object({
        properties: z.record(z.string(), z.json()).optional(),
        required: z.array(z.string()).optional(),
      })
      .parse(route.input);
    operations[route.method.toLowerCase()] = {
      security: route.access === "public" ? [] : [{ bearer: [] }],
      ...(route.method === "GET"
        ? {
            parameters: Object.entries(fields.properties ?? {}).map(([name, schema]) => ({
              name,
              in: "query",
              required: fields.required?.includes(name) ?? false,
              schema,
            })),
          }
        : {
            requestBody: {
              required: true,
              content: { "application/json": { schema: route.input } },
            },
          }),
      responses: {
        200: {
          description: "Successful response",
          content: { "application/json": { schema: route.output } },
        },
      },
    };
  }
  return paths;
}
