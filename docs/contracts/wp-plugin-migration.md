# WordPress plugin migration contract draft

The Phase 8 porter inventories behavior and produces native SDK registrations, a machine-readable mapping, and a review report. It never executes PHP. Unsupported constructs retain source locations and an explicit review reason. Runtime compatibility adapters are optional and go through the public SDK. Keep generated migrations namespaced and require review of sensitive operations and mapped data.

| Source concept                            | Atlas outcome                                                      |
| ----------------------------------------- | ------------------------------------------------------------------ |
| Hooks and filters                         | Typed actions and value filters, or durable facts where applicable |
| Content types, taxonomies and metadata    | Registered schemas and scoped content services                     |
| Settings, menus and admin AJAX            | Typed settings, declared admin slots and REST                      |
| Cron, mail and HTTP                       | Scoped jobs and runtime service adapters                           |
| Database table and query usage            | Reviewed native migration and parameterized scoped data access     |
| Shortcodes, templates and enqueued assets | Block/render registrations or controlled extension assets          |
| Woo hooks and accessors                   | Commerce events, calculations and public resource contracts        |

```ts
interface PortMapping {
  readonly sourceConcept: string;
  readonly targetContract?: string;
  readonly status: "native" | "adapter" | "manual";
  readonly reviewReason?: string;
}
```
