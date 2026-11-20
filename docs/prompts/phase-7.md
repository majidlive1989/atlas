Read AGENTS.md, prior reports, the commerce section of data-model.md and the commerce rows of the parity matrix. FIRST write a `docs/logic/<area>.md` for each commerce area below (catalog, inventory, pricing, cart totals, coupons, tax, shipping, checkout, payments, orders, refunds, customers, downloads, reports, emails): describe WooCommerce's behavior and business rules in your own words, list what it handles poorly, and define the improved Atlas design. Implement from those documents, not from WooCommerce's code or schema. Then implement PHASE 7 as first-party plugins using ONLY the public SDK: `commerce-core`, `commerce-catalog`, `commerce-cart`, `commerce-checkout`, `commerce-orders`, `commerce-payments`, `commerce-shipping`, `commerce-tax`, `commerce-coupons`, `commerce-customers`, `commerce-reports`, `commerce-emails`, `commerce-downloads`.

SCOPE
1. Catalog: product types simple, variable, grouped, external, digital/downloadable; attributes (global + custom), variations with own SKU/price/stock/images, categories/tags/brands, gallery, product meta/custom fields, sale scheduling, visibility, related/upsell/cross-sell, reviews (via the comments plugin, verified-buyer flag), bulk edit, CSV import/export (WooCommerce CSV column compatibility mapper).
2. Inventory: stock management per product/variation, low-stock thresholds, backorders, concurrency-safe reservations (row locks / atomic updates), reservation expiry job, stock history ledger.
3. Pricing: price lists engine (regular/sale), currency handling with minor units (no floats), multi-currency with pluggable rate providers and per-currency rounding rules, price display (incl/excl tax) rules.
4. Cart: server-side cart for guests and users (cart token), merge on login, line item validation, totals pipeline implemented as an ordered, hook-extensible calculation pipeline (subtotal -> discounts -> shipping -> tax -> fees -> total) with full unit tests; cart REST API + Store-API-like public endpoints.
5. Coupons/discount engine: percentage, fixed cart, fixed product, free shipping, BOGO rules, usage limits (global/per user), date ranges, min/max spend, product/category inclusion/exclusion, stacking rules, rule priority; extension hook for custom rule types.
6. Tax: tax classes, rates by country/region/postcode, compound taxes, inclusive/exclusive, tax-exempt customers, VAT ID validation adapter, rate import (CSV).
7. Shipping: zones, methods (flat rate, free shipping with conditions, local pickup, weight/price-table), shipping classes, rate-provider adapter interface (example carrier adapter), packages splitting, delivery estimates hook.
8. Checkout: guest + account, address validation + country-specific formats, order notes, terms acceptance, idempotent order creation, fraud/risk hook, checkout REST API and a state machine for the checkout session.
9. Payments: gateway contract (`PaymentGateway` interface: init, authorize, capture, refund, webhook verify, status sync), hosted-fields/redirect flows only (no raw card data touches Atlas), idempotency keys, webhook ingestion with signature verification and replay protection, reconciliation job. Implement Stripe and PayPal gateways, a manual/bank-transfer/COD gateway, and a documented example for a local/regional gateway. Saved payment methods via gateway tokens.
10. Orders: order state machine (pending, on-hold, processing, completed, cancelled, refunded, failed) with guarded transitions and hooks, order items/fees/taxes/shipping lines, notes (internal/customer), partial and full refunds (with restock option), invoices/credit notes as PDF (templateable, per-locale), order editing in admin, order search/filters, custom order statuses via plugins.
11. Customers: accounts, address book, order history, downloads, GDPR export/erase including orders (with legal-retention handling), guest-to-account conversion.
12. Digital products: secure expiring download links, download limits, license-key hook.
13. Subscriptions/bundles readiness: documented extension contracts (recurring billing hooks, bundle pricing hook) plus a minimal reference extension plugin to prove the contracts.
14. Reports: sales over time, by product/category/country, top customers, coupons usage, stock report, taxes report; data model optimized with rollup tables updated by jobs; CSV export; dashboard widgets.
15. Emails: all transactional emails (new order, processing, completed, refunded, failed, customer note, new account, password reset, low stock) as templates through the mail-templates plugin, per-locale.
16. Admin screens (through extension API): Products, Variations editor, Attributes, Categories, Inventory, Orders (list + detail), Coupons, Customers, Shipping, Taxes, Payments settings, Reports, Store setup wizard.
17. Storefront: extend `themes/reference` (or `themes/storefront`) with product archive, filters (facets), product page, cart, checkout, account area, order tracking, search integration, multi-currency switcher, fully accessible; Lighthouse >= 90 on product page.
18. Webhooks for all commerce events; REST + OpenAPI complete; hooks reference updated.

TESTS
- Property-based tests (fast-check) for totals pipeline, coupon stacking, tax rounding (totals must always reconcile to the cent).
- Concurrency test: 200 parallel checkouts on 10 units of stock never oversell.
- Integration tests for each gateway using recorded/mock providers; webhook replay and signature tests.
- E2E (Playwright): guest checkout, account checkout with coupon + tax + shipping, refund from admin, digital download, variable product purchase, multi-currency.
- Security tests: price tampering, coupon abuse, IDOR on orders/addresses, rate limits.

ACCEPTANCE
- A store can be created end-to-end via the setup wizard and a real test-mode payment completes with Stripe test keys.
- WooCommerce product CSV sample imports with a mapping report.
- All property/concurrency tests green. Definition of Done met. Report: docs/reports/phase-7.md
