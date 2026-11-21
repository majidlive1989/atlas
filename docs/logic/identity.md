# Identity, credentials and second factors

Phase 1.

## Purpose

Users authenticate, verify addresses, recover access and manage sessions. Integration credentials support application access. [Users documentation](https://wordpress.org/documentation/article/users-your-profile-screen/)

## Rules

Normalize email, hash passwords with Argon2id and use generic failures. Verify a second factor after password for enrolled users. Times and expiries are UTC. API keys inherit both explicit scope and current grants.

## Lifecycle and state transitions

Issue an audience- and site-bound short JWT and opaque hashed refresh token. Rotate using a locked session row, revoke the family on replay, and reject expired/revoked sessions. A verification/reset challenge is single use. Reset revokes sessions and API keys. Enrollment confirms a current TOTP before replacing the factor.

## Edge cases

Handle overlapping refreshes as replay, clock drift within one TOTP step, recovery-code exhaustion, concurrent login failures, and verifications racing with reset.

## Failure modes

Commit authentication failure counters and replay revocation before returning a failure. Rate limit with bounded backoff. Return generic reset/verification responses; log mail dispatch errors without credentials.

## Security

Store pending and active TOTP secrets encrypted, consume recovery codes once and reject repeated TOTP counters. Bind OIDC authorization to configured issuer, subject, PKCE, nonce and state. Never link identities by email automatically. Cookies are HttpOnly and Secure; cookie writes validate origin.

## WordPress and WooCommerce weaknesses

Cookie-focused sessions and broadly scoped application passwords make API revocation and scope less explicit. Atlas uses live scope checks, rotating refresh and per-key capabilities.

## Atlas design

Use an auth service over scoped storage, mail adapter, JWT and TOTP libraries, and a generic configured OIDC provider implementing discovery/code flow. Link an external identity through authenticated enrollment.

## Test scenarios

Prove password and fault handling, concurrent rotation/replay, lockout progression, MFA enroll/recovery replay, scoped keys and reset revocation.
