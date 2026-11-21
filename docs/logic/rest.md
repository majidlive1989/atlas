# HTTP API and operational security

Phase 1.

## Purpose

Clients manage accounts, roles, options and extensions and discover versioned API capabilities. [REST API Handbook](https://developer.wordpress.org/rest-api/)

## Rules

Validate route inputs and serialize declared outputs with shared Zod schemas. Authenticate Bearer or scoped API key against resolved hostname. Protect privileged routes via pre-handlers. Paginate by stable cursor.

## Lifecycle and state transitions

Apply request IDs, CORS, security headers and rate limits. Public health and OpenAPI work without a site context. A mutation commits before success and privileged writes are audited.

## Edge cases

Handle invalid JSON, expired credentials, invalid host, unknown route, stale versions and policy denials consistently. Rate-limit auth before expensive hashing.

## Failure modes

Return RFC 9457 with stable machine code and generic localized title. Readiness returns 503 while draining or after dependency failures. Share generated docs and runtime schemas.

## Security

Use response projection, redaction, small body limits, explicit allowed browser origins, session no-store and transport security.

## WordPress and WooCommerce weaknesses

Version and response semantics should be consistent across resources. Atlas uses one schema per endpoint and audits management writes.

## Atlas design

Provide versioned auth, account, roles, settings and plugin endpoints. Serve OpenAPI 3.1 and an interactive local docs view. Test against the built server.

## Test scenarios

Validate the generated spec, problem responses, rates/origin, stale versions, route auth and process lifecycle.
