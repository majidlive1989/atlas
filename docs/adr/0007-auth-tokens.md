# ADR 0007 · Short access tokens and rotating credentials

Status: accepted for the target architecture.

## Context

API clients, browser sessions, integrations and administrators have different credential lifecycles.

## Decision

Use short-lived signed JWT access tokens with issuer, audience and key IDs, opaque hashed rotating refresh tokens, and family revocation on reuse. Use secure HttpOnly browser cookies for refresh and anti-CSRF controls. Hash API keys, scope them, and expose last-used and revocation.

## Alternatives considered

Long-lived bearer credentials enlarge the exposure window. Server-only opaque access sessions add a lookup to each request.

## Consequences

Check current security state for sensitive writes, distinguish token audiences, and test rotation under concurrency. Never log credentials.
