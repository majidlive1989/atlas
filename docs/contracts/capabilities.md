# Capability naming draft

Use `domain.resource.action` in lowercase, with kebab-case segments where needed. Examples include `content.post.publish`, `commerce.order.refund` and `network.site.suspend`. Extension domains are owner-qualified by registry. Define the display label, scope, policy metadata and audit classification at registration. Roles aggregate explicit capabilities and may be edited under a separately audited grant policy. Restrict which capabilities a manager can delegate. New capabilities are denied by default.

```ts
type CapabilityKey = `${string}.${string}.${string}`;
interface AuthorizationRequest {
  readonly capability: CapabilityKey;
  readonly actorId: string;
  readonly tenantId: string;
  readonly siteId?: string;
  readonly resourceId?: string;
}
```

A capability grant is necessary. Resource policies also check ownership, state and scope. Keep network grants distinct from site membership and avoid implicit privilege escalation through wildcard strings.
