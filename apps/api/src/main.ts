import { startApi } from "./server.js";

try {
  const server = await startApi(process.env);
  let stopping = false;
  function stop() {
    if (stopping) return;
    stopping = true;
    server.kernel.drain();
    void server.app.close().catch(() => {
      process.exitCode = 1;
    });
  }
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
} catch (error) {
  console.error(
    error instanceof Error && error.message.startsWith("Invalid Atlas environment:")
      ? error.message
      : "Atlas API failed to start. Run atlas doctor to check configuration and migrations.",
  );
  process.exitCode = 1;
}
