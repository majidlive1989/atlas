# Kernel, configuration and options

Phase 1.

## Purpose

Operators set defaults while each site controls its own settings. WordPress exposes site options, locale and time zone through administration and code. [Settings documentation](https://wordpress.org/documentation/article/settings-general-screen/)

## Rules

Validate environment and database configuration at startup. Resolve site from a canonical host mapping before reading site settings. Validate known keys and JSON values. Require optimistic versions on writes.

## Lifecycle and state transitions

Boot validates env, opens dependencies, checks schema and restores active extensions. Readiness follows successful boot and drops while draining. Shutdown disposes extensions then closes PostgreSQL.

## Edge cases

Handle IPv4, IPv6 and an explicit port on host names. Reject unknown hosts. Preserve credentials outside settings and support explicit locale/time-zone defaults.

## Failure modes

Config errors fail startup without revealing values. Failed version checks leave settings unchanged. Failed writes roll back the audit entry with their mutation.

## Security

Read site scope from the domain registry. Use bounded requests, structured redacted logs and parameterized persistence.

## WordPress and WooCommerce weaknesses

Global option lookup makes dependency and scope implicit. Atlas uses explicit services, scope and typed setting values.

## Atlas design

Use Zod, Pino, an explicit typed service container and lifecycle, readiness/liveness, RFC 9457 errors and OpenTelemetry start/end hooks.

## Test scenarios

Reject invalid config; resolve a registered site; reject an unknown host; test stale writes, dependency failure and shutdown.
