# Job metadata and transactional events

Phase 1.

## Purpose

Operators schedule site-specific work and dispatch asynchronous effects. [Scheduling handbook](https://developer.wordpress.org/plugins/cron/)

## Rules

Use site and UTC instant for durable keys. Record schedule metadata, job effects and outbox entries in PostgreSQL with the originating business change.

## Lifecycle and state transitions

Enqueue and delivery workers are introduced by feature phases. Phase 1 records committed session and activation facts and exposes an in-process typed notification bus.

## Edge cases

Require an idempotency key for durable effects. Redelivery consumers will use aggregate and event IDs.

## Failure modes

A failed write rolls back its outbox record. A subscriber failure does not alter an already committed fact.

## Security

Payloads contain redacted IDs, not secrets. Jobs carry site scope and actor context where applicable.

## WordPress and WooCommerce weaknesses

Visitor-driven scheduling is unreliable at low traffic. Durable metadata can later drive independent BullMQ workers.

## Atlas design

Store JSONB envelopes with version, correlation ID and delivery timestamps; reserve schedule and job-effect tables.

## Test scenarios

Validate outbox records commit with state; assert a failed transaction leaves no event.
