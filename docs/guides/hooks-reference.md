# Plugin hooks reference

Generated from the SDK and the core event catalog by `pnpm --filter @atlas/plugin-sdk hooks:reference`.

Register callbacks during activation. Lower priorities run first and ties keep registration order. A filter can fail closed or retain the last valid value after an advisory failure. Event subscriptions receive committed facts scoped to the active site.

```ts
export interface Action<Input extends z.ZodType> {
  readonly name: string;
  readonly input: Input;
}
```

```ts
export interface Filter<Value extends z.ZodType, Input extends z.ZodType> extends Action<Input> {
  readonly value: Value;
}
```

```ts
export interface PluginHookOptions {
  readonly priority?: number;
  readonly once?: boolean;
}
```

```ts
interface PluginHooks {
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
}
```

```ts
export type CoreEventCatalog = {
  "identity.sessionRevoked": { sessionId: string };
  "extension.pluginActivated": { slug: string; version: string };
};
```

## Example hook names

- `contact-form.spam`
- `related-posts.rank`
