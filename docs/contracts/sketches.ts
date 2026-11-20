export interface PluginManifest {
  readonly schemaVersion: 1;
  readonly slug: string;
  readonly version: string;
  readonly engines: { readonly atlas: string };
  readonly tier: "trusted" | "untrusted";
  readonly entries: { readonly server: string; readonly admin?: string };
  readonly requires?: Readonly<Record<string, string>>;
  readonly permissions: readonly PluginPermission[];
  readonly migrations?: string;
}

export interface ThemeManifest {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly version: string;
  readonly engines: { readonly atlas: string };
  readonly parent?: { readonly id: string; readonly version: string };
  readonly templates: Readonly<Record<string, string>>;
  readonly tokens: Readonly<Record<string, string>>;
  readonly slots: readonly string[];
  readonly menuLocations: readonly string[];
  readonly i18nNamespaces: readonly string[];
  readonly supports?: readonly string[];
  readonly blockStyleVariations?: Readonly<Record<string, readonly string[]>>;
  readonly customizerSchema?: Readonly<Record<string, unknown>>;
  readonly requiredPlugins?: Readonly<Record<string, string>>;
}

export type ActionHandler<Input> = (input: Readonly<Input>) => void | Promise<void>;
export type FilterHandler<Value, Context> = (
  value: Value,
  context: Readonly<Context>,
) => Value | Promise<Value>;
export interface Subscription {
  readonly dispose: () => void;
}

export interface Page<T> {
  readonly data: readonly T[];
  readonly nextCursor: string | null;
}
export interface Problem {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly code: string;
  readonly detail?: string;
  readonly instance?: string;
}

export interface EventEnvelope<Name extends string, Payload> {
  readonly id: string;
  readonly name: Name;
  readonly schemaVersion: number;
  readonly siteId: string;
  readonly occurredAt: string;
  readonly correlationId: string;
  readonly payload: Readonly<Payload>;
}

export type CapabilityKey = `${string}.${string}.${string}`;
export interface AuthorizationRequest {
  readonly capability: CapabilityKey;
  readonly actorId: string;
  readonly tenantId: string;
  readonly siteId?: string;
  readonly resourceId?: string;
}

export type MessageKey = `${string}:${string}.${string}`;
export type MessageValue = string | number | Date;
export type Translate = (
  key: MessageKey,
  values?: Readonly<Record<string, MessageValue>>,
) => string;

export interface PortMapping {
  readonly sourceConcept: string;
  readonly targetContract?: string;
  readonly status: "native" | "adapter" | "manual";
  readonly reviewReason?: string;
}

export type PluginPermission =
  | { readonly kind: "http"; readonly origins: readonly string[] }
  | { readonly kind: "storage"; readonly prefixes: readonly string[] }
  | { readonly kind: "hooks"; readonly names: readonly string[] }
  | { readonly kind: "database"; readonly scope: "own-tables" };

export interface CatalogEventPayloads {
  readonly "identity.sessionRevoked": { readonly sessionId: string };
  readonly "extension.pluginActivated": { readonly slug: string; readonly version: string };
  readonly "content.published": { readonly contentId: string; readonly revision: number };
  readonly "content.trashed": { readonly contentId: string };
  readonly "media.assetReady": { readonly assetId: string };
  readonly "comment.approved": { readonly commentId: string; readonly targetId: string };
  readonly "theme.published": { readonly themeId: string; readonly revision: number };
  readonly "commerce.orderPlaced": { readonly orderId: string };
  readonly "commerce.paymentCaptured": { readonly orderId: string; readonly paymentId: string };
  readonly "commerce.orderRefunded": {
    readonly orderId: string;
    readonly refundId: string;
    readonly full: boolean;
  };
}

export type AtlasEvent = {
  [Name in keyof CatalogEventPayloads]: EventEnvelope<Name, CatalogEventPayloads[Name]>;
}[keyof CatalogEventPayloads];
