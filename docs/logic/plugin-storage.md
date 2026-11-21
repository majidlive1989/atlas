# Plugin-owned migrations and settings

Phase 1.

## Purpose

Plugins can create storage and persist settings across lifetime transitions. [Plugin table guidance](https://developer.wordpress.org/plugins/creating-tables-with-plugins/)

## Rules

Each release ships numbered migration files. Validate declarative DDL against namespace and limits. Track checksums per owner. Keep settings in a site-and-plugin record with validated JSON and a version.

## Lifecycle and state transitions

Apply missing migrations in increasing order within lifecycle transaction. Reinstall reuses the ledger. Upgrade adds columns/tables in the owned namespace; uninstall preserves durable records and tables.

## Edge cases

Reject historical edits, duplicate or missing versions, conflicting tables, unsafe names and incompatible shared schema use.

## Failure modes

Fail closed on a migration error and preserve the original release. Operational recovery for committed schema changes uses backups and a reviewed forward migration.

## Security

Expose no raw SQL execution through plugin migrations. Quote vetted identifiers and use a fixed DDL vocabulary and composite site key. Store secrets outside settings.

## WordPress and WooCommerce weaknesses

Opaque schema changes coupled to activation complicate rollback. Atlas has ordered, transactional, owner-scoped declarations and a migration ledger.

## Atlas design

Represent create-table and add-column as JSON migration operations. Own tables use the plg prefix and site-local row policy. Use optimistic settings updates.

## Test scenarios

Install namespaced table, add a versioned column, reject a foreign target, and force an error after DDL to verify rollback.
