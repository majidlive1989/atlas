# @atlas/api

Fastify serves versioned management APIs, runtime health and OpenAPI 3.1. Zod and
`fastify-type-provider-zod` share request validation, response serialization and schema transformation.
The official Fastify cookie, CORS, Helmet, rate-limit, Swagger and Swagger UI plugins provide HTTP
boundary controls and interactive documentation. PostgreSQL Testcontainers supply real database
fixtures, and Swagger Parser validates the generated contract.

The public entry point is `src/index.ts`. See the [Phase 1 runbook](../../docs/reports/phase-1.md)
for startup and integration tests.
