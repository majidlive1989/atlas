# Related posts

Build the workspace and point `ATLAS_PLUGIN_ROOT` to `examples/plugins`. Add `related-posts`
to the trusted slug list. Install version 1.0.0 and activate it through the operator CLI.

Call `POST /v1/extensions/related-posts/rank` with a source `post` and candidate posts. Each
contains an `id` and `terms` array. The endpoint requires `plugin.related-posts.rank`, which
the site administrator can delegate. The rank filter removes duplicates, the original post and
candidates without shared terms. Change the result limit through the generated settings schema.

Zod defines the filter and endpoint contracts. The Atlas SDK supplies registration and settings.
The testkit verifies authorization, ranking and settings-dependent output.
