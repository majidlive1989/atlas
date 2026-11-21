# @atlas/kernel

The kernel owns application lifecycle, site settings and plugin activation. Pino emits redacted
logs, OpenTelemetry supplies trace hooks, Zod validates schemas, and Semver resolves extension
dependencies. The public plugin SDK defines the scoped API used by trusted modules and
container-hosted workers.

BullMQ delivers jobs and runs workers against dedicated Redis. PostgreSQL stores schedules,
the outbox, and completion claims. Cron Parser calculates the next occurrence in the configured
time zone. IORedis supplies the optional shared TTL cache, and Nodemailer sends plugin mail.
The default storage adapter uses site- and plugin-scoped keys on local disk.

The named entry point is `src/index.ts`. Run `pnpm build` and `pnpm test`.
See the [plugin security guide](../../docs/guides/plugin-security.md).
