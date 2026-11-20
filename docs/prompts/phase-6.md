Read AGENTS.md, prior reports, docs/contracts/theme-manifest.md. Implement PHASE 6.

SCOPE
1. Public data contract: stable TypeScript types + OpenAPI for everything a frontend needs (site, menus, content, terms, media, comments, search, SEO metadata, forms, i18n). Publish as `@atlas/contracts` with semver and a changelog; add a public read API tier (API keys optional, aggressive caching, ETags, cache tags).
2. `theme.json` manifest (Zod + JSON Schema published): id, version, `engines.atlas`, parent theme (child themes), supported features (commerce, comments, multilingual, dark-mode), design tokens (colors, typography, spacing, radii), template map, slots/regions, menu locations, block style variations, customizer schema, i18n namespaces, required plugins.
3. Typed template hierarchy resolver: home, single (per type), page, archive, taxonomy, author, search, 404, plus reserved commerce templates (product, product-archive, cart, checkout, account) for Phase 7; child-theme override resolution; documented resolution order with a debug endpoint.
4. `@atlas/frontend-sdk`: typed client generated from the contract, React hooks + server loaders for Next.js App Router, i18n + hreflang helpers, SEO/metadata helpers (generateMetadata integration), draft/preview mode with signed preview tokens, on-demand revalidation via cache-tag webhooks, block renderer registry (core blocks + plugin blocks), shortcode renderer, slot/region renderer, image component with variants/focal point.
5. Customizer: the theme's customizer schema auto-generates a live-preview customizer in the admin (iframe preview, postMessage protocol), saving to theme settings with revisions/publish/discard.
6. Themes: `themes/reference` (blog + pages + search + comments + forms + multilingual + dark mode, accessible, Lighthouse >= 95) and a minimal `themes/starter` for developers. Child-theme example.
7. Theme conformance test suite (`atlas theme test <path>`): validates manifest, runs required-template checks, SEO/a11y checks, contract-compat checks against a running API. Reference theme must pass.
8. Alternative-framework proof: a tiny Astro (or plain Node SSR) example consuming only `@atlas/contracts` to prove the contract is framework-neutral.
9. docs/guides/theme-development.md, docs/guides/headless-guide.md.

ACCEPTANCE
- Install reference theme, switch theme from admin, edit customizer live, publish; preview of a draft works; editing content triggers revalidation.
- Conformance suite passes for both themes; the Astro/Node proof renders a post using only the contract. Definition of Done met. Report: docs/reports/phase-6.md
