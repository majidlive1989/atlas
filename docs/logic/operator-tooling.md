# CLI and diagnostics

Phase 1.

## Purpose

Operators need scripted bootstrap, user provisioning, extension management and readiness diagnostics. [WordPress developer handbook](https://developer.wordpress.org/advanced-administration/)

## Rules

Use the same core services for CLI and HTTP. CLI database access is operator access. Passwords come from explicit process environment or interactive provision rather than argv.

## Lifecycle and state transitions

Development/build invoke workspace build and run the API; start loads built API. Manage migration status, seed, users and plugin lifecycle. Doctor probes configured dependencies and schema.

## Edge cases

Reject missing required args, invalid release, missing bootstrap secrets and unknown host. Support PowerShell and POSIX.

## Failure modes

Return nonzero on failed commands, sanitize diagnostics, and close resources before returning control.

## Security

Never show credentials. Doctor reports readiness without revealing database URL. Audit operator mutations with distinct actor context.

## WordPress and WooCommerce weaknesses

Ad hoc shell SQL bypasses the application invariants. Atlas CLI commands reuse the same services and lifecycle checks.

## Atlas design

Expose executable atlas, command validation, JSON machine output, operator seed and explicit db rollback.

## Test scenarios

Run real migrate, seed, user create, plugin lifecycle and doctor through the executable.
