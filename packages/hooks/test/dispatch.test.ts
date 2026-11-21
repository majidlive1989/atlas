import { performance } from "node:perf_hooks";
import { describe, expect, it, vi } from "vitest";
import { createEventBus, createHooks } from "../src/index.js";

type Actions = { "test.beforeSave": { count: number } };
type Filters = { "test.price": { value: number; context: { scale: number } } };
const names = { save: "test.beforeSave", price: "test.price" } as const;
const number = (value: unknown) => {
  if (typeof value !== "number") throw new TypeError("Expected a number.");
  return value;
};

describe("typed hook dispatch", () => {
  it("orders priority and registration, disposes handlers, and exposes metadata", async () => {
    const hooks = createHooks<Actions, Filters>();
    const calls: string[] = [];
    hooks.actions.register(
      names.save,
      () => {
        calls.push("second");
      },
      { owner: "b" },
    );
    hooks.actions.register(
      names.save,
      () => {
        calls.push("first");
      },
      { owner: "a", priority: 0 },
    );
    hooks.actions.register(
      names.save,
      () => {
        calls.push("third");
      },
      { owner: "a" },
    );
    hooks.actions
      .register(
        names.save,
        () => {
          calls.push("disposed");
        },
        { owner: "a" },
      )
      .dispose();
    expect(hooks.actions.inspect(names.save).map((handler) => handler.priority)).toEqual([
      0, 10, 10,
    ]);
    await hooks.actions.run(names.save, { count: 1 });
    expect(calls).toEqual(["first", "second", "third"]);
    hooks.removeOwner("a");
    expect(hooks.actions.inspect(names.save)).toHaveLength(1);
  });

  it("consumes once handlers before concurrent invocations", async () => {
    const hooks = createHooks<Actions, Filters>();
    const handler = vi.fn();
    hooks.actions.register(names.save, handler, { owner: "test", once: true });
    await Promise.all([
      hooks.actions.run(names.save, { count: 1 }),
      hooks.actions.run(names.save, { count: 2 }),
    ]);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("preserves the last valid value on advisory failure and propagates closed failures", async () => {
    const monitor = vi.fn();
    const hooks = createHooks<Actions, Filters>(monitor);
    hooks.filters.register(names.price, (amount, ctx) => amount * ctx.scale, { owner: "price" });
    hooks.filters.register(
      names.price,
      () => {
        throw new Error("fail");
      },
      { owner: "broken" },
    );
    hooks.filters.register(names.price, (v) => v + 2, { owner: "fee" });
    expect(await hooks.filters.run(names.price, 5, { scale: 3 }, number)).toBe(17);
    await expect(
      hooks.filters.run(names.price, 5, { scale: 3 }, number, { failure: "closed" }),
    ).rejects.toThrow("fail");
    expect(monitor).toHaveBeenCalledTimes(2);
  });

  it("runs 1,000 dispatches with ten handlers within the smoke budget", async () => {
    const hooks = createHooks<Actions, Filters>();
    let count = 0;
    for (let index = 0; index < 10; index++) {
      hooks.actions.register(
        names.save,
        () => {
          count++;
        },
        { owner: "perf" },
      );
    }
    const before = performance.now();
    for (let index = 0; index < 1_000; index++)
      await hooks.actions.run(names.save, { count: index });
    expect(count).toBe(10_000);
    expect(performance.now() - before).toBeLessThan(2_000);
  });

  it("publishes catalogued events", async () => {
    const events = createEventBus<{ "test.saved": { count: number } }>();
    const listener = vi.fn();
    events.subscribe("test.saved", listener, { owner: "test" });
    await events.emit("test.saved", {
      id: "event",
      siteId: "site",
      name: "test.saved",
      schemaVersion: 1,
      occurredAt: "2026-11-21T00:00:00Z",
      correlationId: "request",
      payload: { count: 10 },
    });
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ payload: { count: 10 } }));
  });
});

// Kept as an uncalled function so TypeScript verifies the negative contract without dispatching it.
export function actionTypeContract() {
  const hooks = createHooks<Actions, Filters>();
  // @ts-expect-error Hook names are constrained by the action catalog.
  void hooks.actions.run("test.unknown", { count: 0 });
  // @ts-expect-error The registered action requires a numeric count.
  void hooks.actions.run(names.save, { count: "zero" });
  // @ts-expect-error A numeric filter must return a number.
  hooks.filters.register(names.price, () => "invalid", { owner: "test" });
}
