# Plugin manifest draft

An installed release contains a versioned `plugin.json`, its verified artifact digest, and immutable entry paths relative to the release directory. Validate with Zod before any code executes. Reject unknown manifest versions, unsafe paths or symlink escapes, incompatible Atlas versions, dependency cycles, missing dependencies and unknown permissions. Parse version ranges as semver. A release records its permission request and activation is blocked if required grants are absent. Upgrades that expand permissions require approval before activation. Registration happens in dependency order, with reverse-order disposal on failure. No credentials are stored in this manifest.

```ts
interface PluginManifest {
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
```

Tier denotes the requested execution mode. The operator's trust policy determines whether that mode is granted. HTTP origins, storage prefixes and declared hook access are checked on scoped APIs. See [ADR 0003](../adr/0003-plugin-isolation.md).

Phase 2 adds an optional frontend entry, scoped mail, cache and job declarations, and higher-trust
approval for releases that expand their privileges. Trusted slug approval covers the permissions
on initial installation. Untrusted activation requires a release-specific digest approval and a
configured sandbox image. The SDK checks engine ranges and the kernel enforces grants.

Separate archive receipts carry SHA-256 and optional Ed25519 signatures. The static
[registry schema](plugin-registry.schema.json) describes an index for a future distribution service.
Runtime validation additionally verifies unique release coordinates and requires signatures and
signing key IDs to appear together.
