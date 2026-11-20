# ADR 0008 · Tenant and site scopes in one database

Status: accepted for the target architecture.

## Context

Network operators can manage related sites while each site's data and settings remain scoped.

## Decision

Use shared tables keyed by tenant and site. Resolve scope from trusted domains and auth claims. Enforce composite foreign keys and scoped query interfaces, with PostgreSQL row-level security as another layer. Model network roles independently.

## Alternatives considered

Database-per-site simplifies some isolation cases but complicates updates and aggregation. Table-per-site adds schema drift and migration fan-out.

## Consequences

Threat-test pooled connection reuse, background tasks, privileged routes and domain reassignment. Introduce dedicated deployments where required by operators.
