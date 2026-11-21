# Contact form

Build the workspace and point `ATLAS_PLUGIN_ROOT` to `examples/plugins`. Add `contact-form`
to the trusted slug list. Install version 1.0.0 and activate it through the operator CLI.

Set a real `recipient` and preferred `locale` using the plugin settings API before accepting
submissions. Send JSON containing `email` and `message` to
`POST /v1/extensions/contact-form/submit`. The spam filter can reject the submission before it
is persisted. Accepted submissions are private, site-scoped records and trigger text email.
Operators can inspect an accepted submission with `atlas plugin command contact-form submission.get <id>`.

Zod defines input, output and settings contracts. The Atlas SDK supplies lifecycle and the adapters.
The testkit checks persistence, rejection and localized notification.
