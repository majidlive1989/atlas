# ADR 0001 · Fastify and Zod at the HTTP boundary

Status: accepted for the target architecture.

## Context

Atlas needs a small API host with predictable request validation and schema evolution.

## Decision

Use Fastify for routing, encapsulated registration and lifecycle hooks. Derive validation and OpenAPI 3.1 from Zod schemas, including response projections. Use Pino and OpenTelemetry instrumentation at the boundary.

## Alternatives considered

Express leaves more of this lifecycle to conventions. Nest introduces a larger application framework and an additional abstraction layer.

## Consequences

Test generated schemas and route behavior together. Keep domain services independent of Fastify.
