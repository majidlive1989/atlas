Read AGENTS.md, prior reports, data-model.md. Implement PHASE 3 as first-party plugins (`plugins/content`, `plugins/media`, `plugins/menus`) using ONLY the public plugin SDK.

SCOPE
1. Content engine: content types (post, page built in; custom types registrable via SDK), statuses (draft, pending, scheduled, published, private, trash), slugs + permalink structures (configurable patterns), redirects manager, hierarchical content (parent/child), sticky/featured, author, excerpt, featured media, password-protected content, scheduling via queue, trash + restore + purge job, bulk actions API.
2. Taxonomies: hierarchical (categories) and flat (tags), custom taxonomies, term meta, term translation-ready schema.
3. Custom fields: schema-defined typed fields (text, number, bool, select, date, relation, media, repeater, group, json), validation (Zod generated), exposure in REST, field groups attachable to content types/taxonomies/users/options pages.
4. Revisions: automatic revisions with diff API, restore, retention policy, autosave endpoint with conflict detection (ETag / version vector).
5. Content document format: block tree stored as JSONB with a schema version; server-side block registry with validation; HTML/Markdown renderers; sanitization pipeline (allow-list) applied on save and render.
6. Media: upload (chunked/resumable), storage adapters (local, S3 with presigned URLs), image processing pipeline (sharp: resizes, WebP/AVIF, focal point, EXIF strip), folders, alt/caption/title, usage tracking (where a media item is used), safe-file validation (magic-byte check, size/type policy), virus-scan hook, signed private file delivery for downloads.
7. Menus: menu trees with item types (content, term, custom link), locations, REST.
8. Search v1: Postgres FTS for content + a search adapter interface.
9. Import/Export: WXR (WordPress XML) importer (posts, pages, terms, authors, media references, comments, meta) as streamed job with progress + dry-run + mapping report; Atlas JSON export/import.
10. REST API: complete CRUD + list endpoints with pagination, filtering, sorting, field selection, include/expand, ETags, conditional requests, cache headers; OpenAPI fully generated; cursor pagination for large collections.
11. Webhooks v1: content events -> signed webhooks with retries/backoff and delivery log.
12. Audit + hooks: emit typed events/actions/filters at every lifecycle point (`content.beforeSave`, `content.published`, etc.) and document them in the hooks reference.

TESTS
Integration tests for every endpoint and permission matrix (author can edit own, editor can edit all, etc.); revision/autosave conflict tests; media pipeline tests with fixtures; WXR import test with a realistic sample file; performance test for 100k posts listing with filters (query plans checked, indexes added).

ACCEPTANCE
- Create/edit/publish/schedule/trash/restore content via API; media upload with variants; WXR import of the sample file reports >= 95% items mapped, remainder itemized.
- OpenAPI contract tests green; hooks reference regenerated. Definition of Done met. Report: docs/reports/phase-3.md
