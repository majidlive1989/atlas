# @atlas/auth

`@node-rs/argon2` supplies Argon2id, `jose` handles access-token verification, `otpauth` provides TOTP, `openid-client` implements the OIDC code flow, Nodemailer sends account challenges over SMTP, and Zod validates credential formats. The service owns identity, API keys, sessions, second factors and site-scoped role policy.

The named entry point is `src/index.ts`. Run `pnpm build` and `pnpm test` in this workspace or from the repository root.
