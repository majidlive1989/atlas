# Plugin manifest, discovery and lifecycle

Phase 1.

## Purpose

Operators install, activate, upgrade, deactivate and remove extensions. [Activation and deactivation hooks](https://developer.wordpress.org/plugins/plugin-basics/activation-deactivation-hooks/)

## Rules

Validate manifests and semver dependencies before import. Discover trusted local releases in configured folders and package roots. Pin digest and validate real paths. Activate only explicitly trusted, supported release permissions.

## Lifecycle and state transitions

Install validates dependency graph and migrates in a transaction. Activate initializes register and boot, then commits durable active state. Failures unwind staged registrations. Reverse dependencies must deactivate before a dependency. Upgrade migrates in one transaction; restore active predecessor on rollback. Uninstall retains owned data.

## Edge cases

Reject cyclic/missing deps, a changed digest, inaccessible entry, or a shared-schema upgrade while another site still uses an older release.

## Failure modes

A failed extension boot is isolated and recorded as faulted without stopping other extensions. A failed migration rolls back schema, ledger and registry changes.

## Security

Only explicitly trusted releases execute in process, and unsupported permission tiers fail closed until ADR 0003 isolation is available. Treat manifests as untrusted data until validated.

## WordPress and WooCommerce weaknesses

On-request loading and opaque runtime callbacks make lifecycle failures hard to recover. Atlas loads verified versions through a persistent graph with isolated failures.

## Atlas design

Use a strict manifest contract, a trusted filesystem catalog and a site-aware lifecycle manager using advisory locking. Stage callbacks and publish events transactionally.

## Test scenarios

Check contract/path compatibility, transitions, dependency order, fault isolation, upgrade rollback and reinstall with retained data.
