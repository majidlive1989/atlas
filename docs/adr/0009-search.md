# ADR 0009 · PostgreSQL FTS behind an adapter

Status: accepted for the target architecture.

## Context

Search should be useful on a minimal install and scale independently when needed.

## Decision

Use Postgres FTS with language configuration, weighted fields and GIN indexes. Define query and indexing contracts and offer Meilisearch as a later adapter. Feed updates from outbox events and scope by site.

## Alternatives considered

An external engine for every install adds cost and setup. Embedding Postgres query syntax in client contracts locks in the backend.

## Consequences

Support blue-green rebuild and index lag visibility. Guard access with visibility filters and never index secrets.
