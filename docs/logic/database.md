# Core persistence and migrations

Phase 1.

## Purpose

Operators bootstrap and update the network database. Network sites share accounts but manage independent site state. [Multisite handbook](https://developer.wordpress.org/advanced-administration/multisite/)

## Rules

Global identity belongs to site memberships; scope relationships via composite keys. Track migration versions/checksums in separate core and plugin ledgers. Use row policies for site-owned data.

## Lifecycle and state transitions

Acquire a transaction-scoped migration lock, check applied prefix, apply ordered migrations, record digest, and commit. Roll back the newest core migration explicitly. Seed tenant, site, role catalog and initial owner idempotently.

## Edge cases

Concurrent runners serialize. A tenant may have several sites. Canonical hostnames are unique. Pin migration identifiers independently of wall clock.

## Failure modes

On SQL or checksum mismatch retain previous schema and ledger. Seed never resets an existing password or silently grants access to an existing identity.

## Security

Use composite FKs and transaction-local site scope with PostgreSQL RLS. Separate migration permission from runtime permissions where deployed.

## WordPress and WooCommerce weaknesses

Runtime-driven schema evolution and site-specific table patterns increase schema drift. Shared scoped tables and checksummed migrations make drift visible.

## Atlas design

Use Drizzle queries and reviewed PostgreSQL DDL for identity, roles, profiles, credentials, scoped options, append-only audit, job metadata, outbox and plugin state.

## Test scenarios

Run migrate twice, seed twice, downgrade and reapply; test cross-scope access and migration failure inside PostgreSQL.
