# ADR 0011 · Verified lazy admin modules

Status: accepted for the target architecture.

## Context

Plugins need routes, slots and configuration UI while the host owns navigation and shared services.

## Decision

Use manifest-declared immutable ESM assets, verified on install and served under controlled origins. Load trusted modules lazily through a typed host API and provide shared React, router, query, UI and i18n. Restrict untrusted extensions to declarative UI and isolated origins where custom UI is later supported.

## Alternatives considered

Bundling every plugin into admin breaks independent activation. Importing remote code directly into the admin origin grants it browser privileges.

## Consequences

Gate executable assets on trust and compatibility, use error boundaries for recoverability, and enforce a CI bundle budget.
