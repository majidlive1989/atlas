# Hook naming draft

Use `domain.beforeVerb` or `domain.afterVerb` for actions and `domain.valueName` for filters, such as `content.beforeSave`, `content.afterSave` and `commerce.shippingQuote`. Third-party declarations use an owner-qualified domain. Names are stable across releases. Emit past-tense durable facts through [events](event-catalog.md). The hook owner chooses advisory or fail-closed execution at definition, and documents phase, side effects and timeout.

```ts
type ActionHandler<Input> = (input: Readonly<Input>) => void | Promise<void>;
type FilterHandler<Value, Context> = (
  value: Value,
  context: Readonly<Context>,
) => Value | Promise<Value>;
interface Subscription {
  readonly dispose: () => void;
}
```

Lower numeric priority runs first. Break ties by registration order. Removing an owner disposes all its hooks. Apply once semantics even if concurrent calls overlap. Fail-closed hooks propagate structured failures without a partial write. Validate filter results and preserve the last valid value after an advisory failure.
