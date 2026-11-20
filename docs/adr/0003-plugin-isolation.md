# ADR 0003 · Trusted and untrusted plugin tiers

Status: accepted for the target architecture.

## Context

Extensions must share one SDK surface with clear trust and resource boundaries.

## Decision

Run approved trusted plugins in process. Run untrusted plugins in worker threads within a separately sandboxed OS process or container, with resource caps, no ambient credentials or network, and a narrow permission-checked RPC channel. A worker thread supplies concurrency, not a security sandbox. Apply least privilege to database and filesystem access. Fail closed when isolation is unavailable.

## Alternatives considered

In-process permission checks alone can be bypassed by code with host access. Isolating every trusted extension would add unnecessary latency for synchronous hooks.

## Consequences

Phase 2 must test isolation at the OS boundary as well as denial through RPC. Keep isolation behind the same SDK contract and publish tier-specific limitations.

Node's permission model treats code as trusted and is not a malicious-code sandbox. [Node.js permission model](https://nodejs.org/docs/latest-v22.x/api/permissions.html)
