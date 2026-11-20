import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import process from "node:process";

const { fetch, AbortSignal } = globalThis;

const compose = (...args) =>
  execFileSync("docker", ["compose", ...args], {
    encoding: "utf8",
    timeout: 20_000,
  }).trim();

assert.equal(
  compose(
    "exec",
    "-T",
    "postgres",
    "sh",
    "-ec",
    'PGPASSWORD="$POSTGRES_PASSWORD" psql -h 127.0.0.1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atqc "select 1"',
  ),
  "1",
);
assert.equal(compose("exec", "-T", "redis", "redis-cli", "ping"), "PONG");

for (const [service, containerPort, path] of [
  ["mailpit", "8025", "/readyz"],
  ["minio", "9000", "/minio/health/ready"],
]) {
  const address = compose("port", service, containerPort);
  const response = await fetch(`http://${address}${path}`, { signal: AbortSignal.timeout(5_000) });
  assert.ok(response.ok, `${service} returned ${response.status}`);
}
process.stdout.write("PostgreSQL, Redis, Mailpit and MinIO responded.\n");
