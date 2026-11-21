export function register(context) {
  const active = new Map();
  context.onEvent("extension.pluginActivated", ({ payload }) =>
    active.set(payload.slug, payload.version),
  );
  context.onDispose(() => active.clear());
}

export function boot() {
  throw new Error("Sample boot failure.");
}
