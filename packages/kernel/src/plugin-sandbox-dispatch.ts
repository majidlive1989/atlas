import { z } from "zod";
import type { PluginContext, SettingHandle } from "@atlas/plugin-sdk";
import { AtlasProblem } from "./problem.js";
import { nameSchema, valueSchema } from "./plugin-adapters.js";

const callback = z.number().int().positive();
const hookOptions = z.strictObject({
  priority: z.number().optional(),
  once: z.boolean().optional(),
});
const jsonSchema = z.record(z.string(), valueSchema);
function portableSchema(value: z.output<typeof jsonSchema>) {
  const pending = [value as z.output<typeof valueSchema>];
  let count = 0;
  while (pending.length) {
    const current = pending.pop();
    if (++count > 1800) throw new Error("Schema exceeds worker descriptor limits.");
    if (Array.isArray(current)) pending.push(...current);
    else if (current !== null && typeof current === "object") {
      for (const [key, child] of Object.entries(current)) {
        if (
          [
            "$ref",
            "$dynamicRef",
            "$id",
            "pattern",
            "patternProperties",
            "contentSchema",
            "allOf",
            "not",
            "if",
            "then",
            "else",
          ].includes(key)
        )
          throw new Error("Unsupported worker schema keyword.");
        pending.push(child);
      }
    }
  }
  return z.fromJSONSchema(value);
}
const declaration = z.strictObject({
  key: nameSchema,
  label: nameSchema,
  options: jsonSchema.optional(),
  schema: jsonSchema.optional(),
});
const routeAccess = z.union([
  z.literal("public"),
  z.literal("authenticated"),
  z.strictObject({ capability: nameSchema }),
]);

const job = z.strictObject({ name: nameSchema, key: z.string().max(140), payload: valueSchema });

export function createSandboxDispatch(ctx: PluginContext) {
  let settings: SettingHandle<z.ZodType> | undefined;
  return async function dispatchSandbox(
    operation: string,
    args: unknown[],
    invoke: (id: number, ...args: unknown[]) => Promise<unknown>,
  ): Promise<unknown> {
    switch (operation) {
      case "insert":
        return ctx.db.insert(...z.tuple([nameSchema, jsonSchema]).parse(args));
      case "get":
        return ctx.db.get(...z.tuple([nameSchema, z.uuid()]).parse(args));
      case "log":
        return ctx.logger.info(...z.tuple([nameSchema]).parse(args));
      case "read":
        return Array.from(await ctx.storage.read(...z.tuple([z.string()]).parse(args)));
      case "write": {
        const [key, contents] = z
          .tuple([z.string(), z.array(z.number().int().min(0).max(255)).max(262_144)])
          .parse(args);
        return ctx.storage.write(key, Uint8Array.from(contents));
      }
      case "http":
        return ctx.http.get(...z.tuple([z.string()]).parse(args));
      case "cacheGet":
        return ctx.cache.get(...z.tuple([nameSchema]).parse(args));
      case "cacheSet":
        return ctx.cache.set(...z.tuple([nameSchema, valueSchema, z.number()]).parse(args));
      case "mail":
        return ctx.mail.send(
          ...z
            .tuple([z.strictObject({ to: z.email(), subject: z.string(), text: z.string() })])
            .parse(args),
        );
      case "action": {
        const [name, options, id] = z.tuple([nameSchema, hookOptions, callback]).parse(args);
        return ctx.hooks.actions.register(
          { name, input: valueSchema },
          async (input) => {
            await invoke(id, input);
          },
          {
            ...(options.priority === undefined ? {} : { priority: options.priority }),
            ...(options.once === undefined ? {} : { once: options.once }),
          },
        );
      }
      case "actionRun": {
        const [name, value] = z.tuple([nameSchema, valueSchema]).parse(args);
        return ctx.hooks.actions.run({ name, input: valueSchema }, value);
      }
      case "filter": {
        const [name, options, id] = z.tuple([nameSchema, hookOptions, callback]).parse(args);
        return ctx.hooks.filters.register(
          { name, input: valueSchema, value: valueSchema },
          async (value, input) => valueSchema.parse(await invoke(id, value, input)),
          {
            ...(options.priority === undefined ? {} : { priority: options.priority }),
            ...(options.once === undefined ? {} : { once: options.once }),
          },
        );
      }
      case "filterRun": {
        const [name, value, input, policy] = z
          .tuple([nameSchema, valueSchema, valueSchema, z.enum(["closed", "advisory"])])
          .parse(args);
        return ctx.hooks.filters.apply(
          { name, input: valueSchema, value: valueSchema },
          value,
          input,
          policy,
        );
      }
      case "event": {
        const [name, id] = z
          .tuple([z.enum(["extension.pluginActivated", "identity.sessionRevoked"]), callback])
          .parse(args);
        return ctx.events.subscribe(name, async (event) => {
          await invoke(id, event);
        });
      }
      case "route": {
        const [method, path, access, input, output, id] = z
          .tuple([
            z.enum(["GET", "POST", "PUT", "DELETE"]),
            z.string(),
            routeAccess,
            jsonSchema,
            jsonSchema,
            callback,
          ])
          .parse(args);
        return ctx.routes.register({
          method,
          path,
          access,
          input: portableSchema(input),
          output: portableSchema(output),
          async handle(value) {
            const result = z
              .object({ valid: z.boolean(), value: valueSchema.optional() })
              .parse(await invoke(id, value));
            if (!result.valid) throw new AtlasProblem(400, "invalid-request");
            return result.value;
          },
        });
      }
      case "settingsDefine": {
        const [schema, initial] = z.tuple([jsonSchema, valueSchema]).parse(args);
        settings = ctx.settings.define({ schema: portableSchema(schema), initial });
        return;
      }
      case "settingsGet":
        z.tuple([]).parse(args);
        if (!settings) throw new Error("Settings unavailable.");
        return settings.get();
      case "settingsSet":
        if (!settings) throw new Error("Settings unavailable.");
        return settings.set(...z.tuple([valueSchema]).parse(args));
      case "provide": {
        const [name, input, output, id] = z
          .tuple([nameSchema, jsonSchema, jsonSchema, callback])
          .parse(args);
        return ctx.services.provide(
          { name, input: portableSchema(input), output: portableSchema(output) },
          (value) => invoke(id, value),
        );
      }
      case "service": {
        const [plugin, name, input, output, value] = z
          .tuple([nameSchema, nameSchema, jsonSchema, jsonSchema, valueSchema])
          .parse(args);
        return ctx.services.call(
          plugin,
          { name, input: portableSchema(input), output: portableSchema(output) },
          value,
        );
      }
      case "job": {
        const [name, id] = z.tuple([nameSchema, callback]).parse(args);
        return ctx.jobs.register(name, async (payload) => {
          await invoke(id, payload);
        });
      }
      case "enqueue":
        return ctx.jobs.enqueue(...z.tuple([job]).parse(args));
      case "cron":
        return ctx.jobs.cron(
          ...z.tuple([job, z.string().max(120), z.string().max(100)]).parse(args),
        );
      case "cli": {
        const [name, id] = z.tuple([nameSchema, callback]).parse(args);
        return ctx.cli.register(name, async (values) =>
          valueSchema.parse(await invoke(id, values)),
        );
      }
      case "declaration": {
        const [kind, value] = z
          .tuple([
            z.enum([
              "postTypes",
              "taxonomies",
              "customFields",
              "blocks",
              "shortcodes",
              "emailTemplates",
              "notifications",
              "adminMenu",
              "capabilities",
              "roles",
            ]),
            declaration,
          ])
          .parse(args);
        return ctx.registry[kind].register({
          key: value.key,
          label: value.label,
          ...(value.options ? { options: value.options } : {}),
          ...(value.schema ? { schema: portableSchema(value.schema) } : {}),
        });
      }
      default:
        throw new Error("Unsupported sandbox operation.");
    }
  };
}
