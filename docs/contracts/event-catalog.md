# Event catalog draft

Use `domain.pastTenseFact`, version its payload independently and document the owner, commit point, and redaction policy. The transport may redeliver and reorder. Dedupe by event ID per subscriber. Use aggregate versions when consumers require ordered effects. Serialize only data needed by subscribers. External webhooks use explicit public projections and signed delivery.

| Event                       | Owner and commit point                | Payload fields          |
| --------------------------- | ------------------------------------- | ----------------------- |
| `identity.sessionRevoked`   | Auth records revocation               | sessionId               |
| `extension.pluginActivated` | Kernel publishes activation           | slug, version           |
| `content.published`         | Content publishes a version           | contentId, revision     |
| `content.trashed`           | Content removes public visibility     | contentId               |
| `media.assetReady`          | Media commits validated asset         | assetId                 |
| `comment.approved`          | Comments commits public approval      | commentId, targetId     |
| `theme.published`           | Themes publish a revision             | themeId, revision       |
| `commerce.orderPlaced`      | Checkout commits order                | orderId                 |
| `commerce.paymentCaptured`  | Payments records capture              | orderId, paymentId      |
| `commerce.orderRefunded`    | Orders commits full or partial credit | orderId, refundId, full |

```ts
interface EventEnvelope<Name extends string, Payload> {
  readonly id: string;
  readonly name: Name;
  readonly schemaVersion: number;
  readonly siteId: string;
  readonly occurredAt: string;
  readonly correlationId: string;
  readonly payload: Readonly<Payload>;
}
```
