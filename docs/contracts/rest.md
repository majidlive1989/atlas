# REST conventions draft

Use HTTPS and `/v1` for the first stable HTTP contract. Represent resources as nouns and scope all state to the resolved site. Generate OpenAPI 3.1 from the same Zod schemas that validate inputs and project outputs. Return 201 plus Location for create, 204 for no-content success, and 202 with a job resource for deferred work. Use `If-Match` for optimistic updates, 412 on stale versions, and 304 for matching cacheable conditional GET. Bind idempotency keys to site, caller, operation and canonical request digest. A changed payload with the same key returns a conflict.

Lists take an allowlisted `filter[field]`, `sort` with optional descending prefix, `fields`, `include`, `limit` and an opaque `cursor`. Use a deterministic ID tie-break and bind cursor to the query shape and site. Set limits per route. Explicitly select allowed related resources, even for an authorized parent. Session responses use private/no-store cache policy. Version breaking changes and document migration and deprecation windows.

```ts
interface Page<T> {
  readonly data: readonly T[];
  readonly nextCursor: string | null;
}
interface Problem {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly code: string;
  readonly detail?: string;
  readonly instance?: string;
}
```

Return errors as `application/problem+json` per RFC 9457. Machine clients use the stable `type` URI and `code`. Keep error details and field paths safe to disclose and omit stack traces. Respond with the same structure for validation, authorization and operational failures. [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457.html)
