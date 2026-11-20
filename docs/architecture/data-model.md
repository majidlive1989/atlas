# Atlas logical data model

These ER diagrams describe the target, organized by ownership. Repeated anchors identify the same logical entity. Names are logical resource names. Plugin tables receive their owner prefix in physical migrations. PostgreSQL is authoritative for durable state. The database package owns shared infrastructure and each plugin owns its data through the public migration interface.

## Core and network

```mermaid
erDiagram
  TENANT {
    uuid id PK
    string slug UK
    string state
    timestamp created_at
  }
  SITE {
    uuid id PK
    uuid tenant_id FK
    string slug
    string locale
    string time_zone
    string state
  }
  SITE_DOMAIN {
    string hostname PK
    uuid site_id FK
    boolean canonical
  }
  IDENTITY {
    uuid id PK
    string email UK
    string password_hash
    timestamp verified_at
    string state
  }
  SITE_MEMBER {
    uuid site_id PK,FK
    uuid user_id PK,FK
    string state
  }
  NETWORK_GRANT {
    uuid tenant_id PK,FK
    uuid user_id PK,FK
    uuid role_id PK,FK
  }
  ROLE {
    uuid id PK
    uuid tenant_id FK
    uuid site_id FK
    string key
    string scope
  }
  CAPABILITY {
    string key PK
    string resource
  }
  ROLE_CAPABILITY {
    uuid role_id PK,FK
    string capability_key PK,FK
  }
  MEMBER_ROLE {
    uuid site_id PK,FK
    uuid user_id PK,FK
    uuid role_id PK,FK
  }
  USER_PROFILE {
    uuid site_id PK,FK
    uuid user_id PK,FK
    string locale
    jsonb meta
  }
  SESSION {
    uuid id PK
    uuid user_id FK
    uuid tenant_id FK
    uuid site_id FK
    timestamp expires_at
    timestamp revoked_at
  }
  REFRESH_CREDENTIAL {
    uuid id PK
    uuid session_id FK
    uuid previous_id FK
    string digest UK
    timestamp consumed_at
    timestamp expires_at
  }
  API_KEY {
    uuid id PK
    uuid site_id FK
    uuid user_id FK
    string digest UK
    jsonb scopes
    timestamp revoked_at
  }
  AUTH_FACTOR {
    uuid id PK
    uuid user_id FK
    string kind
    bytes encrypted_value
  }
  ACCOUNT_CHALLENGE {
    uuid id PK
    uuid user_id FK
    string kind
    string digest UK
    timestamp expires_at
    timestamp consumed_at
  }
  SITE_SETTING {
    uuid site_id PK,FK
    string key PK
    jsonb value
    integer schema_version
    bigint version
  }
  TENANT_SETTING {
    uuid tenant_id PK,FK
    string key PK
    jsonb value
    bigint version
  }
  AUDIT_ENTRY {
    uuid id PK
    uuid site_id FK
    uuid tenant_id FK
    uuid actor_id FK
    string action
    jsonb redacted_details
    timestamp recorded_at
  }
  PLUGIN_RELEASE {
    string slug PK
    string version PK
    string digest
    jsonb manifest
  }
  PLUGIN_ACTIVATION {
    uuid site_id PK,FK
    string slug PK,FK
    string version FK
    string state
    jsonb settings
  }
  MIGRATION_ENTRY {
    string namespace PK
    string version PK
    string checksum
    timestamp applied_at
  }
  JOB_SCHEDULE {
    uuid id PK
    uuid site_id FK
    string name
    string expression
    string time_zone
    timestamp next_at
    jsonb payload
  }
  JOB_EFFECT {
    uuid site_id PK,FK
    string dedupe_key PK
    string state
    timestamp updated_at
  }
  OUTBOX_EVENT {
    uuid id PK
    uuid site_id FK
    string name
    integer schema_version
    jsonb payload
    timestamp occurred_at
    timestamp dispatched_at
  }
  WEBHOOK {
    uuid id PK
    uuid site_id FK
    string endpoint
    string secret_ref
    jsonb subscriptions
    string state
  }
  WEBHOOK_ATTEMPT {
    uuid id PK
    uuid webhook_id FK
    uuid event_id FK
    integer attempt
    string result
    timestamp next_at
  }
  THEME_RELEASE {
    string slug PK
    string version PK
    jsonb manifest
    string digest
  }
  THEME_SELECTION {
    uuid site_id PK,FK
    string slug FK
    string version FK
    bigint revision
  }
  THEME_REVISION {
    uuid site_id PK,FK
    bigint revision PK
    jsonb settings
    jsonb template_overrides
    string state
  }
  TENANT ||--o{ SITE : contains
  SITE ||--o{ SITE_DOMAIN : routes
  SITE ||--o{ SITE_MEMBER : enrolls
  IDENTITY ||--o{ SITE_MEMBER : joins
  TENANT ||--o{ NETWORK_GRANT : scopes
  IDENTITY ||--o{ NETWORK_GRANT : holds
  ROLE ||--o{ NETWORK_GRANT : assigns
  TENANT ||--o{ ROLE : owns
  SITE ||--o{ ROLE : scopes
  ROLE ||--o{ ROLE_CAPABILITY : grants
  CAPABILITY ||--o{ ROLE_CAPABILITY : defines
  SITE_MEMBER ||--o{ MEMBER_ROLE : receives
  ROLE ||--o{ MEMBER_ROLE : assigns
  SITE_MEMBER ||--o| USER_PROFILE : has
  IDENTITY ||--o{ SESSION : starts
  SITE o|--o{ SESSION : scopes
  SESSION ||--o{ REFRESH_CREDENTIAL : rotates
  IDENTITY ||--o{ AUTH_FACTOR : owns
  IDENTITY ||--o{ ACCOUNT_CHALLENGE : receives
  SITE ||--o{ API_KEY : scopes
  IDENTITY ||--o{ API_KEY : owns
  SITE ||--o{ SITE_SETTING : configures
  TENANT ||--o{ TENANT_SETTING : configures
  TENANT ||--o{ AUDIT_ENTRY : records
  SITE ||--o{ AUDIT_ENTRY : records
  PLUGIN_RELEASE ||--o{ PLUGIN_ACTIVATION : selects
  SITE ||--o{ PLUGIN_ACTIVATION : enables
  SITE ||--o{ JOB_SCHEDULE : schedules
  SITE ||--o{ JOB_EFFECT : deduplicates
  SITE ||--o{ OUTBOX_EVENT : emits
  SITE ||--o{ WEBHOOK : registers
  WEBHOOK ||--o{ WEBHOOK_ATTEMPT : sends
  OUTBOX_EVENT ||--o{ WEBHOOK_ATTEMPT : triggers
  THEME_RELEASE ||--o| THEME_SELECTION : selects
  SITE ||--o| THEME_SELECTION : applies
  THEME_SELECTION ||--o{ THEME_REVISION : revises
```

## Publishing, media and navigation

```mermaid
erDiagram
  SITE {
    uuid id PK
    uuid tenant_id FK
  }
  IDENTITY {
    uuid id PK
  }
  CONTENT {
    uuid site_id PK,FK
    uuid id PK
    string type
    uuid author_id FK
    uuid parent_id FK
    uuid featured_asset_id FK
    string locale
    string slug
    string status
    string trash_origin
    string access_mode
    string secret_digest
    boolean featured
    timestamp publish_at
    timestamp trashed_at
    bigint version
    jsonb document
    jsonb meta
  }
  REVISION {
    uuid site_id PK,FK
    uuid content_id PK,FK
    bigint version PK
    uuid author_id FK
    jsonb snapshot
    timestamp created_at
  }
  AUTOSAVE {
    uuid site_id PK,FK
    uuid content_id PK,FK
    uuid author_id PK,FK
    bigint base_version
    jsonb snapshot
    timestamp saved_at
  }
  TRANSLATION {
    uuid site_id PK,FK
    uuid group_id PK
    string locale PK
    uuid content_id FK
  }
  TERM {
    uuid site_id PK,FK
    uuid id PK
    string taxonomy
    string locale
    uuid translation_group_id
    uuid parent_id FK
    string slug
    string name
    jsonb meta
  }
  CONTENT_TERM {
    uuid site_id PK,FK
    uuid content_id PK,FK
    uuid term_id PK,FK
  }
  FIELD_SCHEMA {
    uuid site_id PK,FK
    string key PK
    integer version PK
    jsonb definition
  }
  REDIRECT {
    uuid site_id PK,FK
    string source PK
    string destination
    integer status
  }
  ASSET {
    uuid site_id PK,FK
    uuid id PK
    uuid folder_id FK
    uuid owner_id FK
    string object_key UK
    string content_type
    string state
    bigint bytes
    jsonb descriptive_meta
    timestamp trashed_at
  }
  MEDIA_FOLDER {
    uuid site_id PK,FK
    uuid id PK
    uuid parent_id FK
    string name
  }
  ASSET_VARIANT {
    uuid site_id PK,FK
    uuid asset_id PK,FK
    string variant PK
    string object_key UK
    integer width
    integer height
  }
  ASSET_LINK {
    uuid site_id PK,FK
    uuid asset_id PK,FK
    string resource_kind PK
    uuid resource_id PK
    string field PK
  }
  UPLOAD {
    uuid site_id PK,FK
    uuid id PK
    uuid asset_id FK
    bigint expected_bytes
    timestamp expires_at
    string state
  }
  COMMENT {
    uuid site_id PK,FK
    uuid id PK
    uuid parent_id FK
    string target_kind
    uuid target_id
    uuid author_id FK
    string guest_ref
    string state
    text body
    timestamp created_at
    timestamp trashed_at
  }
  COMMENT_REACTION {
    uuid site_id PK,FK
    uuid comment_id PK,FK
    uuid actor_id PK,FK
    string kind PK
  }
  MENU {
    uuid site_id PK,FK
    uuid id PK
    string locale
    string label
  }
  MENU_ITEM {
    uuid site_id PK,FK
    uuid id PK
    uuid menu_id FK
    uuid parent_id FK
    uuid content_id FK
    uuid term_id FK
    string external_url
    integer position
  }
  MENU_PLACEMENT {
    uuid site_id PK,FK
    string theme_slug PK
    string location PK
    string locale PK
    uuid menu_id FK
  }
  SITE ||--o{ CONTENT : publishes
  IDENTITY ||--o{ CONTENT : authors
  CONTENT o|--o{ CONTENT : parents
  CONTENT ||--o{ REVISION : versions
  CONTENT ||--o{ AUTOSAVE : drafts
  CONTENT ||--o{ TRANSLATION : localizes
  SITE ||--o{ TERM : organizes
  TERM o|--o{ TERM : parents
  CONTENT ||--o{ CONTENT_TERM : classified
  TERM ||--o{ CONTENT_TERM : labels
  SITE ||--o{ FIELD_SCHEMA : defines
  SITE ||--o{ REDIRECT : routes
  SITE ||--o{ ASSET : stores
  MEDIA_FOLDER o|--o{ ASSET : contains
  MEDIA_FOLDER o|--o{ MEDIA_FOLDER : parents
  ASSET ||--o{ ASSET_VARIANT : derives
  ASSET ||--o{ ASSET_LINK : referenced
  ASSET ||--o{ UPLOAD : ingests
  ASSET o|--o{ CONTENT : features
  SITE ||--o{ COMMENT : moderates
  COMMENT o|--o{ COMMENT : threads
  COMMENT ||--o{ COMMENT_REACTION : receives
  SITE ||--o{ MENU : owns
  MENU ||--o{ MENU_ITEM : contains
  MENU_ITEM o|--o{ MENU_ITEM : nests
  CONTENT o|--o{ MENU_ITEM : target
  TERM o|--o{ MENU_ITEM : target
  MENU ||--o{ MENU_PLACEMENT : assigns
```

## Commerce catalog, customers and rules

```mermaid
erDiagram
  SITE {
    uuid id PK
  }
  IDENTITY {
    uuid id PK
  }
  ASSET {
    uuid id PK
    uuid site_id PK,FK
  }
  PRODUCT {
    uuid site_id PK,FK
    uuid id PK
    string type
    string slug
    string state
    uuid tax_class_id FK
    uuid shipping_class_id FK
    jsonb meta
    timestamp trashed_at
  }
  OFFER {
    uuid site_id PK,FK
    uuid id PK
    uuid product_id FK
    string kind
    string sku
    string combination_key
    string state
  }
  PRODUCT_LINK {
    uuid site_id PK,FK
    uuid from_id PK,FK
    uuid to_id PK,FK
    string kind PK
  }
  CATALOG_TERM {
    uuid site_id PK,FK
    uuid id PK
    string taxonomy
    uuid parent_id FK
    string slug
  }
  PRODUCT_TERM {
    uuid site_id PK,FK
    uuid product_id PK,FK
    uuid term_id PK,FK
  }
  PRODUCT_ASSET {
    uuid site_id PK,FK
    uuid product_id PK,FK
    uuid asset_id PK,FK
    integer position
  }
  ATTRIBUTE {
    uuid site_id PK,FK
    uuid id PK
    uuid product_id FK
    string code
    string label
  }
  ATTRIBUTE_VALUE {
    uuid site_id PK,FK
    uuid id PK
    uuid attribute_id FK
    string value
  }
  PRODUCT_ATTRIBUTE {
    uuid site_id PK,FK
    uuid product_id PK,FK
    uuid value_id PK,FK
    boolean varies
  }
  OFFER_ATTRIBUTE {
    uuid site_id PK,FK
    uuid offer_id PK,FK
    uuid attribute_id PK,FK
    uuid value_id FK
  }
  PRICE_LIST {
    uuid site_id PK,FK
    uuid id PK
    string currency
    string kind
    integer priority
  }
  OFFER_PRICE {
    uuid site_id PK,FK
    uuid id PK
    uuid offer_id FK
    uuid price_list_id FK
    bigint amount_minor
    timestamp valid_from
    timestamp valid_until
  }
  STOCK {
    uuid site_id PK,FK
    uuid id PK
    uuid offer_id FK
    bigint on_hand
    bigint reserved
    bigint low_threshold
    string backorder_policy
  }
  STOCK_MOVEMENT {
    uuid site_id PK,FK
    uuid id PK
    uuid stock_id FK
    string effect_key
    bigint delta
    timestamp occurred_at
  }
  CUSTOMER {
    uuid site_id PK,FK
    uuid id PK
    uuid user_id FK
    string contact_ref
    string country
    boolean tax_exempt
    timestamp anonymized_at
  }
  CUSTOMER_ADDRESS {
    uuid site_id PK,FK
    uuid id PK
    uuid customer_id FK
    jsonb address
    string kind
  }
  COUPON {
    uuid site_id PK,FK
    uuid id PK
    string normalized_code
    string kind
    integer priority
    jsonb rule
    timestamp starts_at
    timestamp ends_at
  }
  TAX_CLASS {
    uuid site_id PK,FK
    uuid id PK
    string key
  }
  TAX_RATE {
    uuid site_id PK,FK
    uuid id PK
    uuid tax_class_id FK
    string country
    string region
    string postal_pattern
    numeric rate
    integer priority
    boolean compound
  }
  SHIPPING_CLASS {
    uuid site_id PK,FK
    uuid id PK
    string key
  }
  SHIPPING_ZONE {
    uuid site_id PK,FK
    uuid id PK
    integer priority
    string key
  }
  SHIPPING_ZONE_REGION {
    uuid site_id PK,FK
    uuid id PK
    uuid zone_id FK
    string country
    string region
    string postal_pattern
  }
  SHIPPING_METHOD {
    uuid site_id PK,FK
    uuid id PK
    uuid zone_id FK
    string adapter
    jsonb configuration
    boolean enabled
  }
  SHIPPING_CLASS_RATE {
    uuid site_id PK,FK
    uuid method_id PK,FK
    uuid class_id PK,FK
    bigint amount_minor
  }
  SITE ||--o{ PRODUCT : offers
  PRODUCT ||--o{ OFFER : sells
  PRODUCT ||--o{ PRODUCT_LINK : relates
  CATALOG_TERM o|--o{ CATALOG_TERM : parents
  CATALOG_TERM ||--o{ PRODUCT_TERM : labels
  PRODUCT ||--o{ PRODUCT_TERM : classified
  PRODUCT ||--o{ PRODUCT_ASSET : displays
  ASSET ||--o{ PRODUCT_ASSET : illustrates
  PRODUCT o|--o{ ATTRIBUTE : defines
  ATTRIBUTE ||--o{ ATTRIBUTE_VALUE : permits
  PRODUCT ||--o{ PRODUCT_ATTRIBUTE : configures
  ATTRIBUTE_VALUE ||--o{ PRODUCT_ATTRIBUTE : allows
  OFFER ||--o{ OFFER_ATTRIBUTE : selects
  ATTRIBUTE_VALUE ||--o{ OFFER_ATTRIBUTE : values
  PRICE_LIST ||--o{ OFFER_PRICE : sets
  OFFER ||--o{ OFFER_PRICE : prices
  OFFER ||--o| STOCK : tracks
  STOCK ||--o{ STOCK_MOVEMENT : records
  SITE ||--o{ CUSTOMER : serves
  IDENTITY o|--o{ CUSTOMER : claims
  CUSTOMER ||--o{ CUSTOMER_ADDRESS : stores
  SITE ||--o{ COUPON : issues
  TAX_CLASS o|--o{ PRODUCT : applies
  TAX_CLASS ||--o{ TAX_RATE : defines
  SHIPPING_CLASS o|--o{ PRODUCT : applies
  SHIPPING_ZONE ||--o{ SHIPPING_ZONE_REGION : matches
  SHIPPING_ZONE ||--o{ SHIPPING_METHOD : offers
  SHIPPING_METHOD ||--o{ SHIPPING_CLASS_RATE : prices
  SHIPPING_CLASS ||--o{ SHIPPING_CLASS_RATE : applies
```

## Commerce transaction and delivery

```mermaid
erDiagram
  SITE {
    uuid id PK
  }
  CUSTOMER {
    uuid site_id PK,FK
    uuid id PK
  }
  OFFER {
    uuid site_id PK,FK
    uuid id PK
  }
  COUPON {
    uuid site_id PK,FK
    uuid id PK
  }
  STOCK {
    uuid site_id PK,FK
    uuid id PK
  }
  ASSET {
    uuid site_id PK,FK
    uuid id PK
  }
  CART {
    uuid site_id PK,FK
    uuid id PK
    uuid customer_id FK
    string token_digest
    string currency
    string state
    bigint version
    timestamp expires_at
  }
  CART_ITEM {
    uuid site_id PK,FK
    uuid id PK
    uuid cart_id FK
    uuid offer_id FK
    integer quantity
    jsonb options
  }
  CART_COUPON {
    uuid site_id PK,FK
    uuid cart_id PK,FK
    uuid coupon_id PK,FK
  }
  CHECKOUT {
    uuid site_id PK,FK
    uuid id PK
    uuid cart_id FK
    string state
    string idempotency_key
    string request_digest
    jsonb quote
    timestamp expires_at
  }
  RESERVATION {
    uuid site_id PK,FK
    uuid id PK
    uuid stock_id FK
    uuid checkout_id FK
    integer quantity
    string state
    timestamp expires_at
  }
  SALE_ORDER {
    uuid site_id PK,FK
    uuid id PK
    uuid checkout_id FK
    uuid customer_id FK
    string number
    string currency
    string state
    bigint total_minor
    jsonb address_snapshot
    timestamp placed_at
    bigint version
  }
  ORDER_LINE {
    uuid site_id PK,FK
    uuid id PK
    uuid order_id FK
    uuid offer_id FK
    string label
    integer quantity
    bigint subtotal_minor
    bigint discount_minor
    jsonb snapshot
  }
  ORDER_ADJUSTMENT {
    uuid site_id PK,FK
    uuid id PK
    uuid order_id FK
    uuid order_line_id FK
    string kind
    string rate_ref
    bigint signed_minor
    jsonb snapshot
  }
  ORDER_NOTE {
    uuid site_id PK,FK
    uuid id PK
    uuid order_id FK
    string visibility
    text body
    timestamp created_at
  }
  ORDER_TRANSITION {
    uuid site_id PK,FK
    uuid id PK
    uuid order_id FK
    string from_state
    string to_state
    timestamp created_at
  }
  COUPON_REDEMPTION {
    uuid site_id PK,FK
    uuid id PK
    uuid coupon_id FK
    uuid order_id FK
    string customer_key
    string state
  }
  PAYMENT {
    uuid site_id PK,FK
    uuid id PK
    uuid order_id FK
    string gateway
    string provider_ref
    string state
    bigint authorized_minor
    bigint captured_minor
  }
  PAYMENT_OPERATION {
    uuid site_id PK,FK
    uuid id PK
    uuid payment_id FK
    string idempotency_key
    string kind
    string state
    bigint amount_minor
  }
  PAYMENT_EVENT {
    uuid site_id PK,FK
    string gateway PK
    string provider_event_id PK
    uuid payment_id FK
    string payload_digest
    timestamp received_at
  }
  SAVED_PAYMENT_METHOD {
    uuid site_id PK,FK
    uuid id PK
    uuid customer_id FK
    string gateway
    string token_ref
    string display_label
  }
  REFUND {
    uuid site_id PK,FK
    uuid id PK
    uuid order_id FK
    uuid payment_id FK
    string state
    bigint amount_minor
    timestamp created_at
  }
  REFUND_ALLOCATION {
    uuid site_id PK,FK
    uuid id PK
    uuid refund_id FK
    uuid order_line_id FK
    uuid adjustment_id FK
    integer quantity
    bigint amount_minor
    boolean restock
  }
  SHIPMENT {
    uuid site_id PK,FK
    uuid id PK
    uuid order_id FK
    string method_key
    string tracking_ref
    string state
  }
  SHIPMENT_ITEM {
    uuid site_id PK,FK
    uuid shipment_id PK,FK
    uuid line_id PK,FK
    integer quantity
  }
  DIGITAL_ASSET {
    uuid site_id PK,FK
    uuid id PK
    uuid offer_id FK
    uuid asset_id FK
    integer revision
    integer limit_count
  }
  DOWNLOAD_GRANT {
    uuid site_id PK,FK
    uuid id PK
    uuid line_id FK
    uuid digital_asset_id FK
    uuid customer_id FK
    integer used_count
    timestamp expires_at
    timestamp revoked_at
  }
  DOWNLOAD_ACCESS {
    uuid site_id PK,FK
    uuid id PK
    uuid grant_id FK
    string token_digest UK
    timestamp expires_at
    timestamp used_at
  }
  ORDER_DOCUMENT {
    uuid site_id PK,FK
    uuid id PK
    uuid order_id FK
    uuid refund_id FK
    uuid asset_id FK
    string kind
    string number
  }
  SALES_ROLLUP {
    uuid site_id PK,FK
    date day PK
    string currency PK
    string dimension PK
    string dimension_id PK
    bigint net_minor
    bigint tax_minor
    bigint orders
  }
  SITE ||--o{ CART : scopes
  CUSTOMER o|--o{ CART : owns
  CART ||--o{ CART_ITEM : contains
  OFFER ||--o{ CART_ITEM : selected
  CART ||--o{ CART_COUPON : applies
  COUPON ||--o{ CART_COUPON : entered
  CART ||--o{ CHECKOUT : quotes
  CHECKOUT ||--o{ RESERVATION : holds
  STOCK ||--o{ RESERVATION : allocated
  CHECKOUT ||--o| SALE_ORDER : creates
  CUSTOMER o|--o{ SALE_ORDER : places
  SALE_ORDER ||--o{ ORDER_LINE : contains
  OFFER o|--o{ ORDER_LINE : snapshot
  SALE_ORDER ||--o{ ORDER_ADJUSTMENT : balances
  ORDER_LINE o|--o{ ORDER_ADJUSTMENT : allocates
  SALE_ORDER ||--o{ ORDER_NOTE : annotates
  SALE_ORDER ||--o{ ORDER_TRANSITION : tracks
  COUPON ||--o{ COUPON_REDEMPTION : limited
  SALE_ORDER ||--o{ COUPON_REDEMPTION : redeems
  SALE_ORDER ||--o{ PAYMENT : funded
  PAYMENT ||--o{ PAYMENT_OPERATION : attempts
  PAYMENT o|--o{ PAYMENT_EVENT : reconciles
  CUSTOMER ||--o{ SAVED_PAYMENT_METHOD : tokens
  SALE_ORDER ||--o{ REFUND : credits
  PAYMENT o|--o{ REFUND : reimburses
  REFUND ||--o{ REFUND_ALLOCATION : allocates
  ORDER_LINE ||--o{ REFUND_ALLOCATION : returns
  SALE_ORDER ||--o{ SHIPMENT : fulfills
  SHIPMENT ||--o{ SHIPMENT_ITEM : contains
  ORDER_LINE ||--o{ SHIPMENT_ITEM : ships
  OFFER ||--o{ DIGITAL_ASSET : entitles
  ASSET ||--o{ DIGITAL_ASSET : stores
  DIGITAL_ASSET ||--o{ DOWNLOAD_GRANT : permits
  ORDER_LINE ||--o{ DOWNLOAD_GRANT : licenses
  CUSTOMER ||--o{ DOWNLOAD_GRANT : receives
  DOWNLOAD_GRANT ||--o{ DOWNLOAD_ACCESS : authorizes
  SALE_ORDER ||--o{ ORDER_DOCUMENT : documents
  SITE ||--o{ SALES_ROLLUP : aggregates
```

## Keys and integrity

Use UUID identities unless the aggregate has a natural composite key. Site-owned references include `site_id` on both sides. Tenant-level references also constrain the parent tenant when a site or identity assignment is involved. Site-scoped settings, inventories, payloads and events carry explicit scope even when joined by globally unique IDs. Match role scope to its assignment and require exactly one canonical active domain per live site. The migration ledger keys a core or plugin namespace and migration version, with a recorded checksum.

Use deferred or transactional constraints for invariants involving multiple rows, such as a single active theme, per-order currency, order total reconciliation, exactly one menu item target, and valid product/attribute combinations. Shared media-use and comment targets are polymorphic: the registering domain validates the reference and publishes a lifecycle event for cleanup. These relations are intentionally absent as physical foreign keys. Cross-owner references use identifiers and compensating jobs where plugin uninstall would otherwise create a hard dependency. Database permissions scope plugin writers to their own tables.

## JSONB strategies

Use typed JSONB for sparse extension metadata, block trees, catalog rules, settings, address snapshots, immutable event payloads and document revisions. Validate versioned schemas at command boundaries and select only explicitly exposed fields for REST. Qualify custom keys by owner, allow controlled evolution and migrate before retiring old readers. Store secret references or encrypted values separately. Put relational constraints, money, visibility, ownership, expiry and hot sorting/filtering fields in columns. Store monetary amounts as integer minor units with a separate ISO currency, and use precise decimal rates with explicit rounding rules. Snapshot the evaluated line, address, rate and discount at checkout so historical documents survive catalog and rule changes.

## Indexing

- Lead tenant/site list indexes with scope. Use deterministic sort and ID tie-breaks for cursor paging. Index child-side foreign keys used for joins and deferred cleanup.
- Add partial uniqueness for active slugs per site/type/locale/parent, active SKU per site, canonical domain per site, code per store, and published price intervals where overlap is forbidden. Normalize case at write time with format rules that match the corresponding public URL or identifier.
- Index publication jobs by due time and claim state, outbox by undispatched time, stock reservations by expiry, and webhook attempts by retry time. Use operational indexes for order number, customer history, status/date, reconciliation provider ID and checkout idempotency key. Enforce uniqueness of stock effect, payment operation and provider event keys.
- Maintain weighted search documents with a GIN index and language configuration. Add targeted JSON expression indexes from observed query plans. Keep broad JSONB indexes off high-write tables unless a supported query needs one.
- Stream large histories and snapshots. Evaluate partitioning audit and delivery logs only after workload measurements.

## Trash, retention and revisions

User-facing deletions for content, media and catalog first capture a timestamp and prior state. Remove trashed resources from public reads immediately. Restore rechecks uniqueness, permissions and dependencies. Purge only after retention and dependency checks, and emit cleanup effects transactionally. Comments use moderation states and a separate trash policy. Order and tax evidence are retained under configurable policy, and erasure anonymizes personal data where retention requires preserving financial facts. Audit entries are append-only. Subject data in exports and logs follows separate retention policies.

Every content edit compares an expected version, persists the next version and records an immutable revision. Autosaves are private per author and record their base version. Conflicting writes return a current version for retry or explicit merge. Restoring a revision creates a new head and preserves history. Retention may prune old revisions after a policy window while keeping the current head and publish markers. Theme settings use separate revisions, with draft previews scoped by signed authorization.

## Order state machine

```mermaid
stateDiagram-v2
  [*] --> Pending
  Pending --> OnHold: manual or asynchronous payment
  Pending --> Processing: payment confirmed
  Pending --> Failed: terminal payment failure
  Pending --> Cancelled: expiry or cancellation
  OnHold --> Processing: payment confirmed
  OnHold --> Failed: terminal payment failure
  OnHold --> Cancelled: authorized cancellation
  Failed --> Pending: explicit retry
  Processing --> Completed: fulfillment complete
  Processing --> Refunded: fully credited
  Completed --> Refunded: fully credited
  Processing --> Cancelled: authorized cancellation and financial reconciliation
```

Checkout revalidates the cart and reserves stock, then links an order at most once per idempotency key. Payment and shipping each have their own state, and verified provider transitions are deduplicated and reconciled. A partial refund records allocations without marking the entire order refunded. Refunding requires a durable operation, amount/currency checks, and an explicit stock-restoration effect. No terminal commerce state is inferred solely from client navigation or a timeout.
