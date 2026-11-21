# Phase 1 lifecycle example

The `phase-one-example` trusted extension demonstrates the versioned manifest, lifecycle registration,
and database migrations. Version 1.0.0 creates an owned inventory table. Version 1.1.0 adds a label.
Version 1.2.0 deliberately collides on the label after a valid DDL statement so integration tests can
verify that the statement, migration ledger and active release roll back together. Version 1.3.0
exercises error isolation when a verified release cannot boot.
