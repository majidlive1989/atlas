# ADR 0010 · BullMQ with PostgreSQL outbox and schedules

Status: accepted for the target architecture.

## Context

Scheduled work needs recoverable enqueue, retries and repeatability across workers.

## Decision

Use BullMQ for delivery and workers. Use SQL for schedules and an outbox, deduplication of durable effects, and operational job audit. Give queue Redis independent eviction and durability settings from cache Redis.

## Alternatives considered

An in-request cron trigger depends on traffic. A SQL-only queue would add delivery, backoff and observability code.

## Consequences

Assume duplicate delivery, test redrives and shutdown, and track queue lag plus failed effects.
