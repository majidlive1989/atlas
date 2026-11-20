# ADR 0005 · TipTap over ProseMirror

Status: accepted for the target architecture.

## Context

Atlas needs keyboard-aware structured editing, nested blocks and an extension API.

## Decision

Use TipTap / ProseMirror for the authoring UI. Convert its document to a versioned, Atlas-owned block tree at the API boundary. Drive validation, rendering and migrations from server block registrations.

## Alternatives considered

Adopting WordPress's serialized HTML couples storage to markup. Lexical is viable, though TipTap's ProseMirror schema offers a direct fit for this document model.

## Consequences

Provide loss-aware paste and import, test selections and RTL editing, and validate block data independently of editor state.
