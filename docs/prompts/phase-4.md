Read AGENTS.md, prior reports, plugin SDK docs. Implement PHASE 4 in apps/admin and packages/ui, packages/i18n.

SCOPE
1. Design system `@atlas/ui`: tokens (CSS variables), light/dark, density modes, Radix-based accessible primitives (Button, Input, Select, Combobox, Dialog, Drawer, Dropdown, Tabs, Tooltip, Toast, DataTable with virtualization + column config + saved views, Form helpers with Zod resolver, DatePicker with calendar adapters, Empty/Error/Loading states), Storybook with a11y checks, visual regression for core components. Fully RTL-safe (logical CSS properties only).
2. Admin shell: auth screens (login, 2FA, reset), layout (collapsible sidebar, topbar, breadcrumbs), command palette (Ctrl/Cmd+K) with plugin-contributed commands, notifications center, global search, user menu, profile + sessions + 2FA management, responsive down to tablet and usable on mobile.
3. Performance budget enforced in CI: initial JS <= 150KB gzip, route-level code splitting, preloading on hover/intent, Lighthouse CI score >= 95 on the dashboard route. Bundle analysis report committed.
4. Extension mechanism (per ADR): plugins ship an admin entry (ESM) loaded lazily at runtime; shared singletons (React, router, query client, ui, i18n) provided by the host; each plugin mounts inside an error boundary + suspense; declared via manifest, validated at build and runtime. Extension points implemented and documented: menu items, routes/pages, settings panels (auto-generated from the settings schema), dashboard widgets, field UIs (custom field renderers), table columns, row/bulk actions, editor toolbar/blocks slots, command palette entries, profile tabs, notices.
5. Screens (built as first-party admin modules through the same extension API): Dashboard (customizable widgets, site health), Content list/edit (using a temporary simple editor; real block editor comes in Phase 5), Taxonomies, Media library (grid/list, upload queue, folders), Menus, Users and Roles/Capabilities matrix, Plugins (install/activate/update), Settings (general, reading, writing, permalinks, media), Audit log, Webhooks.
6. i18n `@atlas/i18n`: ICU MessageFormat, namespaced catalogs (core/plugin/theme), lazy-loaded per locale + namespace, runtime language switching, per-user locale, pluralization, Intl formatting, Jalali + Hijri calendar adapters, RTL/LTR switching of the whole UI. Ship complete catalogs for English, Persian and Arabic. Extraction CLI (`atlas i18n extract`), missing-key CI check, pseudo-locale for testing, .po/.json import/export, in-dashboard translation editor for plugin catalogs.
7. Auto-generated settings UI from plugin settings schemas, including validation, conditional fields, and secrets masking.
8. Accessibility: WCAG 2.2 AA; axe checks in Playwright; full keyboard navigation; focus management.

TESTS
Component tests, Playwright E2E for login/2FA, content CRUD, media upload, plugin activation, locale + RTL switching; axe audits on every main screen; bundle-size and Lighthouse gates in CI.

ACCEPTANCE
- Install the `contact-form` example plugin: its menu, page, settings panel and dashboard widget appear without touching admin core code.
- Switching to Persian or Arabic flips direction and formats dates/numbers; zero missing keys in the three shipped locales.
- Performance gates pass. Definition of Done met. Report: docs/reports/phase-4.md
