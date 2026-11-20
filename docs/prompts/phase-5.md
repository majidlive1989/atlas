Read AGENTS.md, prior reports. Implement PHASE 5 (first-party plugins: `plugins/editor-blocks`, `plugins/comments`, `plugins/seo`, `plugins/search`, `plugins/forms`, `plugins/mail-templates`).

SCOPE
1. Block editor (TipTap/ProseMirror or Lexical per ADR) in the admin: slash menu, drag/reorder, nested blocks, inline formatting, link/media pickers, undo/redo, autosave via the Phase 3 API, revision browser with diff, keyboard shortcuts, paste cleanup (Word/Google Docs/Markdown), RTL-aware. Core blocks: paragraph, heading, list, quote, code, image, gallery, video/embed (oEmbed allow-list), table, columns, buttons, separator, spacer, HTML (capability-gated), shortcode, reusable blocks/patterns. Plugin Block API: server definition (schema, render, sanitize) + editor component + frontend renderer; blocks are versioned with deprecation migrations.
2. Comments plugin: threaded comments on any content type, statuses (pending, approved, spam, trash), moderation queue UI, bulk moderation, guest and user comments, per-type settings (auto-close after N days, require approval, nested depth), rate limiting + honeypot + proof-of-work option, spam adapter interface with built-in heuristics (link count, blacklist, velocity) and an example external-provider adapter, reactions, author notification + reply emails with unsubscribe, comment webhooks, GDPR export/erase integration, REST + admin screens. Commerce reviews will reuse this plugin in Phase 7.
3. SEO plugin: per-content and per-term meta (title/description/robots/canonical/OG/Twitter), JSON-LD generators (Article, Breadcrumb, Organization, Product hook), XML sitemaps (index + per type, with lastmod, hreflang alternates), robots.txt editor, redirects UI (from Phase 3), SEO analysis panel in the editor (readability + keyphrase basics), filters so plugins extend schemas.
4. Search plugin: search API with ranking weights, highlight snippets, facets, suggest/autocomplete endpoint; Meilisearch adapter as a second implementation of the adapter interface with a reindex job + CLI.
5. Forms plugin (builds on the contact-form example): drag-and-drop form builder in admin, field types, validation, conditional logic, spam protection, entries management, CSV export, notifications, webhooks, embed block.
6. Mail templates: React Email (or MJML) template system, editable subject/body in admin with variables, preview, test send, per-locale templates, plugin-registrable templates.
7. RSS/Atom feeds, oEmbed provider, and a REST `/site` endpoint exposing public site info for frontends.

TESTS
Editor E2E (typing, blocks, autosave, restore revision); comments permission/spam/threading integration tests; sitemap validity tests; search relevance tests with fixtures; forms E2E; a11y checks on new screens.

ACCEPTANCE
- Compose a post with nested blocks, publish, comment as guest, moderate, see it in sitemap + RSS + search.
- A third-party example plugin registers a new block that works in editor, API and renderer without core changes. Definition of Done met. Report: docs/reports/phase-5.md
