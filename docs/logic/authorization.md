# Roles and resource policy

Phase 1.

## Purpose

Admins assign roles, editors work across content, and authors and contributors have narrower rights. [Roles and capabilities](https://wordpress.org/documentation/article/roles-and-capabilities/)

## Rules

Grant explicit capabilities per site. Default deny. Evaluate ownership, scope and resource state in addition to a grant. A grantor may delegate only permissions they hold. A site retains an immutable administrator role and at least one administrator.

## Lifecycle and state transitions

Seed predefined site roles. Edit custom role grants atomically. Assign roles to an existing site member. Re-resolve live grants for requests. Audit changes and protected denials.

## Edge cases

Ignore roles from other sites and disabled accounts. Integrations can delegate only within their narrowed key scopes. Reject cross-site resource references.

## Failure modes

Deny if a referenced role or capability is unknown. Failed edits leave grants unchanged. Keep role assignment and audit writes in one transaction.

## Security

Check site and resource owner; never derive permissions from client-supplied role names. Protect account/role management routes through Fastify pre-handlers.

## WordPress and WooCommerce weaknesses

A role name alone cannot safely express authorization. Atlas combines capability sets and resource policy with delegated grant validation.

## Atlas design

Expose role catalogue and custom create/update, capability listing, and membership assignment. Register core capability keys and initially reserve shop roles.

## Test scenarios

Test owner versus editor, unknown scope and restricted published edits, limited delegation, and site isolation.
