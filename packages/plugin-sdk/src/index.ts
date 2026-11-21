import { pluginManifest } from "@atlas/contracts";
import type { CoreEventCatalog, EventEnvelope } from "@atlas/hooks";
import { satisfies } from "semver";
import { z } from "zod";

export { pluginManifest };
export type { PluginManifest } from "@atlas/contracts";

/** A value that can cross the plugin boundary. @public */
export type PluginValue =
  null | boolean | number | string | PluginValue[] | { [key: string]: PluginValue };

/** Maps a schema to its decoded TypeScript value. @public */
export type Decoded<Schema extends z.ZodType> = z.output<Schema>;

/** Describes an owned declaration consumed by Atlas or another extension. @public */
export interface PluginDeclaration {
  readonly key: string;
  readonly label: string;
  readonly schema?: z.ZodType;
  readonly options?: Readonly<Record<string, PluginValue>>;
}

/** One family of plugin declarations. @public */
export type DeclarationKind =
  | "postTypes"
  | "taxonomies"
  | "customFields"
  | "blocks"
  | "shortcodes"
  | "emailTemplates"
  | "notifications"
  | "adminMenu"
  | "capabilities"
  | "roles";

/** Available extension route methods. @public */
export type PluginMethod = "GET" | "POST" | "PUT" | "DELETE";

/** A site-local endpoint. The host prefixes its path with the plugin slug. @public */
export interface PluginRoute<Input extends z.ZodType, Output extends z.ZodType> {
  readonly method: PluginMethod;
  readonly path: string;
  readonly access: "public" | "authenticated" | { readonly capability: string };
  readonly input: Input;
  readonly output: Output;
  readonly handle: (input: z.output<Input>) => z.input<Output> | Promise<z.input<Output>>;
}

/** A named hook whose payload is validated before dispatch. @public */
export interface Action<Input extends z.ZodType> {
  readonly name: string;
  readonly input: Input;
}

/** A named hook that validates its context and each result. @public */
export interface Filter<Value extends z.ZodType, Input extends z.ZodType> extends Action<Input> {
  readonly value: Value;
}

/** Handler ordering and error policy. @public */
export interface PluginHookOptions {
  readonly priority?: number;
  readonly once?: boolean;
}

/** A typed plugin setting and the value to use before an operator configures it. @public */
export interface PluginSetting<Schema extends z.ZodType> {
  readonly schema: Schema;
  readonly initial: z.input<Schema>;
}

/** Reads and writes settings through the host's scoped store. @public */
export interface SettingHandle<Schema extends z.ZodType> {
  get(): Promise<z.output<Schema>>;
  set(value: z.input<Schema>): Promise<void>;
  readonly uiSchema: Readonly<Record<string, unknown>>;
}

/** A dependency-scoped asynchronous service interface. @public */
export interface PluginService<Input extends z.ZodType, Output extends z.ZodType> {
  readonly name: string;
  readonly input: Input;
  readonly output: Output;
}

/** A serialized data row in a plugin-owned table. @public */
export type PluginRow = Readonly<Record<string, PluginValue>>;

/** Append and inspect records in a migrated, site-owned table. @public */
export interface PluginDatabase {
  insert(table: string, values: PluginRow): Promise<string>;
  get(table: string, id: string): Promise<PluginRow | undefined>;
}

/** Versioned migration declarations shipped in a release. @public */
export type PluginMigration =
  | {
      readonly action: "create-table";
      readonly table: string;
      readonly columns: readonly MigrationColumn[];
    }
  | { readonly action: "add-column"; readonly table: string; readonly column: MigrationColumn };

/** A column in a plugin-owned table. @public */
export interface MigrationColumn {
  readonly name: string;
  readonly type: "text" | "integer" | "bool" | "jsonb" | "timestamptz" | "uuid";
}

/** Mail submitted through the site's adapter. @public */
export interface PluginMail {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
}

/** A queued owner-scoped job. @public */
export interface PluginJob {
  readonly name: string;
  readonly key: string;
  readonly payload: PluginValue;
}

/** Supported lifecycle context for a single site and release. @public */
export interface PluginContext {
  readonly siteId: string;
  readonly slug: string;
  readonly routes: {
    register<Input extends z.ZodType, Output extends z.ZodType>(
      route: PluginRoute<Input, Output>,
    ): void;
  };
  readonly hooks: {
    readonly actions: {
      register<Input extends z.ZodType>(
        action: Action<Input>,
        handler: (input: z.output<Input>) => void | Promise<void>,
        options?: PluginHookOptions,
      ): void;
      run<Input extends z.ZodType>(action: Action<Input>, input: z.input<Input>): Promise<void>;
    };
    readonly filters: {
      register<Value extends z.ZodType, Input extends z.ZodType>(
        filter: Filter<Value, Input>,
        handler: (
          value: z.output<Value>,
          input: z.output<Input>,
        ) => z.input<Value> | Promise<z.input<Value>>,
        options?: PluginHookOptions,
      ): void;
      apply<Value extends z.ZodType, Input extends z.ZodType>(
        filter: Filter<Value, Input>,
        value: z.input<Value>,
        input: z.input<Input>,
        failure?: "advisory" | "closed",
      ): Promise<z.output<Value>>;
    };
  };
  readonly events: {
    subscribe<Key extends keyof CoreEventCatalog>(
      name: Key,
      handler: (event: EventEnvelope<Key, CoreEventCatalog[Key]>) => void | Promise<void>,
    ): void;
  };
  readonly services: {
    provide<Input extends z.ZodType, Output extends z.ZodType>(
      service: PluginService<Input, Output>,
      handler: (value: z.output<Input>) => z.input<Output> | Promise<z.input<Output>>,
    ): void;
    call<Input extends z.ZodType, Output extends z.ZodType>(
      plugin: string,
      service: PluginService<Input, Output>,
      value: z.input<Input>,
    ): Promise<z.output<Output>>;
  };
  readonly db: PluginDatabase;
  readonly settings: {
    define<Schema extends z.ZodType>(setting: PluginSetting<Schema>): SettingHandle<Schema>;
  };
  readonly registry: Record<DeclarationKind, { register(declaration: PluginDeclaration): void }>;
  readonly cli: {
    register(
      command: string,
      handler: (args: readonly string[]) => Promise<PluginValue> | PluginValue,
    ): void;
  };
  readonly jobs: {
    register(name: string, handler: (payload: PluginValue) => void | Promise<void>): void;
    enqueue(job: PluginJob): Promise<void>;
    cron(job: PluginJob, pattern: string, timeZone: string): Promise<void>;
  };
  readonly i18n: {
    register(locale: string, messages: Readonly<Record<string, string>>): void;
    message(locale: string, key: string): string;
  };
  readonly logger: { info(event: string): void; warn(event: string): void };
  readonly storage: {
    read(key: string): Promise<Uint8Array>;
    write(key: string, contents: Uint8Array): Promise<void>;
  };
  readonly mail: { send(message: PluginMail): Promise<void> };
  readonly cache: {
    get(key: string): Promise<PluginValue | undefined>;
    set(key: string, value: PluginValue, ttlSeconds: number): Promise<void>;
  };
  readonly http: { get(url: string): Promise<{ status: number; body: string }> };
  onDispose(cleanup: () => void | Promise<void>): void;
}

/** Transaction-bound access during a release upgrade. @public */
export interface PluginUpgradeContext {
  readonly db: PluginDatabase;
  readSettings(): PluginValue;
  writeSettings(value: PluginValue): Promise<void>;
}

/** Named server entry accepted by the lifecycle loader. @public */
export interface PluginDefinition {
  register(context: PluginContext): void | Promise<void>;
  boot?(context: PluginContext): void | Promise<void>;
  onUpgrade?(from: string, to: string, context: PluginUpgradeContext): void | Promise<void>;
}

/** Preserves the inferred callbacks in a plugin's named server export. @public */
export function definePlugin<Definition extends PluginDefinition>(
  definition: Definition,
): Definition {
  return definition;
}

/** Preserves a typed migration declaration for serialization as a release file. @public */
export function defineMigration(
  operations: readonly PluginMigration[],
): readonly PluginMigration[] {
  return operations;
}

/** Checks whether the host version satisfies a previously validated manifest. @public */
export function supportsAtlas(manifest: z.output<typeof pluginManifest>, version: string): boolean {
  return satisfies(version, manifest.engines.atlas);
}

/** Validates a future marketplace index of immutable, verified releases. @public */
export const pluginRegistry = z
  .strictObject({
    schemaVersion: z.literal(1),
    releases: z
      .array(
        z
          .strictObject({
            manifest: pluginManifest,
            artifact: z.url({ protocol: /^https$/ }),
            sha256: z.string().regex(/^[a-f0-9]{64}$/),
            signature: z.base64().optional(),
            signingKey: z.string().min(1).max(128).optional(),
          })
          .refine((entry) => Boolean(entry.signature) === Boolean(entry.signingKey)),
      )
      .max(10_000),
  })
  .refine(
    ({ releases }) =>
      new Set(releases.map(({ manifest }) => manifest.slug + "@" + manifest.version)).size ===
      releases.length,
  );
