# Theme manifest draft

`theme.json` declares inheritance, compatible releases, templates and customization schema. Paths are package-relative entry keys with the same path-containment requirement as plugin entries. Template keys include `home`, `single:{type}`, `page:{slug}`, `archive:{type}`, `taxonomy:{taxonomy}`, `author`, `search`, `404` and `default`. Commerce adds product, product archive, cart, checkout and account keys. A parent may fulfill required keys. Reject cycles, unresolved dependencies and incomplete fallbacks. Site overrides are versioned and validated against manifest declarations. Signed preview authorization selects a draft.

```ts
interface ThemeManifest {
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
  readonly requiredPlugins?: Readonly<Record<string, string>>;
}
```

The companion type also reserves supported features, style variations and a JSON Schema customizer definition. See the [template resolution flow](../architecture/overview.md#theme-resolution).
