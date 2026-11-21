# Hooks and domain facts

Phase 1.

## Purpose

Extensions can observe lifecycle points and modify a value in order. [Hooks handbook](https://developer.wordpress.org/plugins/hooks/)

## Rules

Typed names and value types belong to their owners. Priority is ascending and stable on ties. Validate filter values; explicit advisory/fail-closed mode applies per dispatch.

## Lifecycle and state transitions

Register an owner-scoped handler with an idempotent disposer. Consume once before invocation. Execute sequentially. Emit committed facts using a catalogued envelope and outbox.

## Edge cases

Handle removal during dispatch, simultaneous once calls, rejected promises, added handlers and handler deadlines.

## Failure modes

Advisory failures continue with the last valid value; policy failures abort. Deadlines bound the wait for trusted cooperative hooks. Durable effects can be retried from an outbox.

## Security

Do not expose callback functions or secret parameters in inspection. Allow registrations only inside approved runtime. Correlate and redact failures.

## WordPress and WooCommerce weaknesses

Untyped shared callback registries hide mutation and error semantics. Separate actions, filters and facts and attach registrations to owners.

## Atlas design

Use typed asynchronous registries with disposer handles and metadata snapshots, bounded invocation, and a typed event bus. Store core facts with their originating transaction.

## Test scenarios

Cover priorities, concurrent once, removal, advisory and policy failure, type mismatch and dispatch throughput.
