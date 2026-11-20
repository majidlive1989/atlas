# ADR 0012 · Contract-first theme resolution

Status: accepted for the target architecture.

## Context

Editors need templates and preview, while storefront and headless users need a stable API.

## Decision

Resolve typed template keys with site overrides and parent fallback. Use Next.js App Router for the reference renderer through the frontend SDK, keeping manifests and REST contract framework-neutral. Keep preview private and sign revalidation.

## Alternatives considered

Executing arbitrary templates in the API would tie rendering to server internals. A client-only renderer would complicate preview, SEO and initial paint.

## Consequences

Ship conformance checks and an alternate consumer. Validate manifest paths, locale catalogs, parent dependencies and fallbacks.
