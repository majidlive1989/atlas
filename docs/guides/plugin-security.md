# Plugin security

Atlas treats trusted extensions as application code. A trusted slug must appear in `ATLAS_TRUSTED_PLUGINS`. Review trusted code and dependencies before adding it. Use declarative manifest permissions even in trusted code so callers can rely on the SDK's scope.

Untrusted modules run in a non-root Linux container with no network interface beyond loopback, a read-only root, a bounded temporary filesystem, resource limits and dropped Linux capabilities. A Node worker processes plugin callbacks within that container. The trusted container image should contain Node 22 and be installed locally. Set `ATLAS_PLUGIN_SANDBOX_IMAGE` to its immutable image reference. Configure the Docker-compatible CLI and endpoint in the host environment. The container receives release files and its site and plugin identifiers over stdin.

Use `atlas plugin list` to find the catalog's release digest. Set `ATLAS_PLUGIN_RELEASE_GRANTS` to the approved comma-separated digests. Approval covers that release's requested permission set and tier. A release that requests broader permissions on upgrade needs an approved digest. Archive checksums apply to transport bytes and catalog digests apply to the release tree. Review both when they are relevant to the deployment.

The host checks every RPC against the activation's site, release and permissions. The database facade accepts table and column names from verified migrations. Storage matches full path segments below approved prefixes. Outbound HTTPS requires a declared origin, publicly routable IPv4 resolution and a pinned connection. The HTTPS broker rejects redirects. The container itself has no direct outbound network access.

Untrusted plugins must bundle runtime dependencies or supply them as relative ESM modules in the immutable release. Routes and declaration schemas must convert to portable JSON Schema, and callback data must serialize as JSON. Transactional upgrade callbacks require trusted execution. Settings, jobs and injected services can use the same context API when their payloads and schemas satisfy the RPC limits. Both tiers can use declarative migration files. Untrusted admin and frontend code is not activated by the server runtime.

Queue Redis is configured through `ATLAS_PLUGIN_QUEUE_URL`. Use a separately provisioned Redis service for queue state. Set `ATLAS_PLUGIN_STORAGE` to an operator-controlled directory for local objects. Keep credential material outside release files, plugin settings and log fields. [Isolation ADR](../adr/0003-plugin-isolation.md)
