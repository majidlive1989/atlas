export interface HandlerOptions {
  readonly owner: string;
  readonly priority?: number;
  readonly once?: boolean;
}

export interface HandlerInfo {
  readonly id: number;
  readonly owner: string;
  readonly priority: number;
  readonly once: boolean;
}

export interface Subscription {
  readonly dispose: () => void;
}

export interface DispatchOptions {
  readonly failure?: "advisory" | "closed";
  readonly timeoutMs?: number;
}

type Result<Value> = Value | Promise<Value>;
type Actions<Inputs> = { [Key in keyof Inputs]: (input: Readonly<Inputs[Key]>) => Result<void> };
type Filters<Inputs> = {
  [Key in keyof Inputs]: Inputs[Key] extends { value: infer Value; context: infer Context }
    ? (value: Value, context: Readonly<Context>) => Result<Value>
    : never;
};
type Entry = HandlerInfo & { readonly handler: unknown };
export type HookMonitor = (name: string, handler: HandlerInfo, error: unknown) => void;

class Registry<Handlers extends object> {
  private sequence = 0;
  private readonly entries = new Map<keyof Handlers, Map<number, Entry>>();

  register<Key extends keyof Handlers>(
    name: Key,
    handler: Handlers[Key],
    options: HandlerOptions,
  ): Subscription {
    if (!options.owner || (options.priority !== undefined && !Number.isFinite(options.priority))) {
      throw new TypeError("Invalid hook registration.");
    }
    const entry: Entry = {
      id: ++this.sequence,
      owner: options.owner,
      priority: options.priority ?? 10,
      once: options.once ?? false,
      handler,
    };
    const current = this.entries.get(name) ?? new Map<number, Entry>();
    current.set(entry.id, entry);
    this.entries.set(name, current);
    return {
      dispose: () => {
        current.delete(entry.id);
      },
    };
  }

  removeOwner(owner: string): void {
    for (const list of this.entries.values()) {
      for (const [id, entry] of list) if (entry.owner === owner) list.delete(id);
    }
  }

  private ordered(name: keyof Handlers): Entry[] {
    return [...(this.entries.get(name)?.values() ?? [])].sort(
      (a, b) => a.priority - b.priority || a.id - b.id,
    );
  }

  inspect(name: keyof Handlers): readonly HandlerInfo[] {
    return this.ordered(name).map(({ id, owner, priority, once }) => ({
      id,
      owner,
      priority,
      once,
    }));
  }

  async dispatch<Key extends keyof Handlers>(
    name: Key,
    invoke: (handler: Handlers[Key], signal: AbortSignal) => Result<void>,
    options: DispatchOptions,
    monitor: HookMonitor,
  ): Promise<void> {
    for (const entry of this.ordered(name)) {
      const list = this.entries.get(name);
      if (!list?.has(entry.id)) continue;
      if (entry.once) list.delete(entry.id);
      let timer: ReturnType<typeof setTimeout> | undefined;
      const lifetime = new AbortController();
      try {
        await Promise.race([
          Promise.resolve().then(() => invoke(entry.handler as Handlers[Key], lifetime.signal)),
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => {
              lifetime.abort();
              reject(new Error("Hook deadline exceeded."));
            }, options.timeoutMs ?? 5_000);
          }),
        ]);
      } catch (error) {
        const { id, owner, priority, once } = entry;
        monitor(String(name), { id, owner, priority, once }, error);
        if (options.failure === "closed") throw error;
      } finally {
        clearTimeout(timer);
      }
    }
  }
}

export function createHooks<ActionInputs extends object, FilterInputs extends object>(
  monitor: HookMonitor = () => undefined,
) {
  const actions = new Registry<Actions<ActionInputs>>();
  const filters = new Registry<Filters<FilterInputs>>();
  return {
    actions: {
      register: actions.register.bind(actions),
      inspect: actions.inspect.bind(actions),
      run<Key extends keyof ActionInputs>(
        name: Key,
        input: Readonly<ActionInputs[Key]>,
        options: DispatchOptions = {},
      ) {
        return actions.dispatch(name, (handler) => handler(input), options, monitor);
      },
    },
    filters: {
      register: filters.register.bind(filters),
      inspect: filters.inspect.bind(filters),
      async run<
        Key extends keyof FilterInputs,
        Value extends (FilterInputs[Key] extends { value: infer V } ? V : never),
        Context extends (FilterInputs[Key] extends { context: infer C } ? C : never),
      >(
        name: Key,
        initial: Value,
        context: Readonly<Context>,
        validate: (value: unknown) => Value,
        options: DispatchOptions = {},
      ): Promise<Value> {
        let current = validate(initial);
        await filters.dispatch(
          name,
          async (registered, signal) => {
            const handler = registered as (
              value: Value,
              context: Readonly<Context>,
            ) => Result<Value>;
            const value = await handler(current, context);
            if (!signal.aborted) current = validate(value);
          },
          options,
          monitor,
        );
        return current;
      },
    },
    removeOwner(owner: string) {
      actions.removeOwner(owner);
      filters.removeOwner(owner);
    },
  };
}

export interface EventEnvelope<Name extends string, Payload> {
  readonly id: string;
  readonly name: Name;
  readonly siteId: string;
  readonly correlationId: string;
  readonly occurredAt: string;
  readonly schemaVersion: number;
  readonly payload: Readonly<Payload>;
}

export type CoreEventCatalog = {
  "identity.sessionRevoked": { sessionId: string };
  "extension.pluginActivated": { slug: string; version: string };
};

export function createEventBus<Catalog extends object>(monitor?: HookMonitor) {
  type Events = { [Key in keyof Catalog & string]: EventEnvelope<Key, Catalog[Key]> };
  const hooks = createHooks<Events, Record<never, never>>(monitor);
  return {
    subscribe<Key extends keyof Events>(
      name: Key,
      handler: (event: Readonly<Events[Key]>) => Result<void>,
      options: HandlerOptions,
    ) {
      return hooks.actions.register(name, handler as Actions<Events>[Key], options);
    },
    removeOwner: hooks.removeOwner,
    emit<Key extends keyof Events>(name: Key, event: Readonly<Events[Key]>): Promise<void> {
      return hooks.actions.run(name, event);
    },
  };
}
