# ADR 0004 · Typed actions, filters and durable facts

Status: accepted for the target architecture.

## Context

Extensions need deterministic execution during a command and durable delivery after it.

## Decision

Offer ordered typed actions and filters, with owner cleanup and explicit failure policy. Emit immutable domain facts through a transactional outbox with at-least-once delivery and idempotent consumers.

## Alternatives considered

A single global callback registry mixes mutation, policy and delivery semantics. An event-only API cannot synchronously compose a value.

## Consequences

Bound plugin execution time, trace handler cost and version public event schemas.
