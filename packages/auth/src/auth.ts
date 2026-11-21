import {
  audit,
  recordEvent,
  scopeSession,
  sql,
  type AuditContext,
  type Database,
  type DbSession,
  type RecordedEvent,
  type Site,
} from "@atlas/db";
import { z } from "zod";
import { AuthError, loadCapabilities, verifyDelegation, type Principal } from "./access.js";
import {
  createCredentials,
  digest,
  emailSchema,
  generateRecoveryCodes,
  hashPassword,
  newTotp,
  randomToken,
  totpCounter,
  verifyPassword,
  type AccessClaims,
} from "./crypto.js";
import { type MailAdapter } from "./mail.js";
import { type OidcProvider } from "./oidc.js";

const minute = 60_000;
const day = 1_440 * minute;
type ChallengeKind = "verify" | "reset";
type Revocation = RecordedEvent<"identity.sessionRevoked", { sessionId: string }>;
type Account = {
  id: string;
  email: string;
  verified_at: Date | null;
  password_hash: string;
  failed_attempts: number;
  locked_until: Date | null;
};
type Session = {
  id: string;
  tenant_id: string;
  user_id: string;
  expires_at: Date;
  revoked_at: Date | null;
};
type Credential = { id: string; session_id: string; consumed_at: Date | null; expires_at: Date };
type Factor = { encrypted_secret: string; last_counter: string | null };

export interface SessionTokens {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly sessionId: string;
  readonly expiresIn: number;
}

export interface AuthOptions {
  readonly secret: Buffer;
  readonly issuer: string;
  readonly mail: MailAdapter;
  readonly clock?: () => Date;
  readonly mailFailure?: (error: unknown) => void;
  readonly oidc?: OidcProvider;
  readonly sessionRevoked?: (event: Revocation) => void | Promise<void>;
}

const oidcSecrets = z.object({ state: z.string(), nonce: z.string(), verifier: z.string() });
const scopesSchema = z.array(z.string());
const makeClaims = (site: Site, userId: string, sessionId: string): AccessClaims => ({
  sub: userId,
  sid: sessionId,
  site: site.id,
  tenant: site.tenantId,
});

export function createAuth(database: Database, options: AuthOptions) {
  const clock = options.clock ?? (() => new Date());
  const credentials = createCredentials(options.secret, options.issuer, clock);
  const dummyHash = hashPassword(randomToken());

  function scoped<T>(context: AuditContext, work: (tx: DbSession) => Promise<T>) {
    return database.scoped(context.site.id, work);
  }

  async function activeMember(tx: DbSession, siteId: string, userId: string) {
    const [member] =
      await tx.query(sql`select m.user_id from site_members m join identities u on u.id = m.user_id
      where m.site_id = ${siteId} and m.user_id = ${userId} and m.state = 'active' and u.state = 'active'
      and u.verified_at is not null`);
    return Boolean(member);
  }

  async function createSession(
    tx: DbSession,
    ctx: AuditContext,
    userId: string,
  ): Promise<SessionTokens> {
    const expires = new Date(clock().getTime() + 30 * day);
    const [session] = await tx.query<{
      id: string;
    }>(sql`insert into sessions (tenant_id, site_id, user_id, expires_at)
      values (${ctx.site.tenantId}, ${ctx.site.id}, ${userId}, ${expires}) returning id`);
    if (!session) throw new Error("Session insertion failed.");
    const refreshToken = randomToken();
    await tx.query(sql`insert into refresh_credentials (site_id, session_id, digest, expires_at)
      values (${ctx.site.id}, ${session.id}, ${digest(refreshToken)}, ${expires})`);
    await audit(tx, { ...ctx, actorId: userId }, "identity.session.started", {
      sessionId: session.id,
    });
    return {
      sessionId: session.id,
      refreshToken,
      expiresIn: 300,
      accessToken: await credentials.sign(makeClaims(ctx.site, userId, session.id)),
    };
  }

  async function revokeSession(
    tx: DbSession,
    ctx: AuditContext,
    sessionId: string,
    reason: string,
  ) {
    await tx.query(
      sql`update sessions set revoked_at = ${clock()} where site_id = ${ctx.site.id} and id = ${sessionId}`,
    );
    await audit(tx, ctx, "identity.session.revoked", { sessionId, reason });
    return recordEvent(tx, ctx, "identity.sessionRevoked", { sessionId });
  }

  function notifyRevocation(event: Revocation) {
    void Promise.resolve()
      .then(() => options.sessionRevoked?.(event))
      .catch(() => undefined);
  }

  async function secondFactor(tx: DbSession, userId: string, token: string, factor: Factor) {
    if (/^[a-f0-9]{20}$/.test(token)) {
      const rows = await tx.query(sql`delete from recovery_codes where user_id = ${userId}
        and digest = ${digest(token)} returning digest`);
      return rows.length === 1;
    }
    const secret = credentials.decrypt(factor.encrypted_secret, "totp:" + userId);
    const current = totpCounter(secret, token, clock().getTime());
    if (current === null) return false;
    const allowed = await tx.query(sql`update auth_factors set last_counter = ${current}
      where user_id = ${userId} and (last_counter is null or last_counter < ${current}) returning user_id`);
    return allowed.length === 1;
  }

  async function failure(tx: DbSession, ctx: AuditContext, account?: Account) {
    if (account) {
      const attempt = account.failed_attempts + 1;
      const delay = attempt < 3 ? 0 : Math.min(15 * minute, 250 * 2 ** Math.min(attempt - 3, 9));
      const lock = attempt >= 5 ? Math.max(delay, minute) : delay;
      await tx.query(sql`update identities set failed_attempts = ${attempt},
        locked_until = ${lock ? new Date(clock().getTime() + lock) : null} where id = ${account.id}`);
    }
    await audit(tx, account ? { ...ctx, actorId: account.id } : ctx, "identity.login.denied");
    return new AuthError("invalid-credentials");
  }

  async function issueChallenge(
    tx: DbSession,
    ctx: AuditContext,
    kind: ChallengeKind,
    userId: string,
  ) {
    const token = randomToken();
    await tx.query(sql`update account_challenges set consumed_at = ${clock()}
      where site_id = ${ctx.site.id} and user_id = ${userId} and kind = ${kind} and consumed_at is null`);
    await tx.query(sql`insert into account_challenges (digest, site_id, user_id, kind, expires_at)
      values (${digest(token)}, ${ctx.site.id}, ${userId}, ${kind}, ${new Date(clock().getTime() + 30 * minute)})`);
    await audit(tx, { ...ctx, actorId: userId }, "identity.challenge.issued", { kind });
    return token;
  }

  function deliverChallenge(ctx: AuditContext, kind: ChallengeKind, email: string, token: string) {
    // Keep SMTP delivery latency and failures separate from the public response.
    void options.mail
      .send({ to: email, locale: ctx.site.locale, kind, token })
      .catch((error: unknown) => {
        options.mailFailure?.(error);
      });
  }

  async function sendChallenge(ctx: AuditContext, kind: ChallengeKind, email: string) {
    const result = await scoped(ctx, async (tx) => {
      const [user] = await tx.query<{ id: string; verified_at: Date | null }>(sql`
        select u.id, u.verified_at from identities u join site_members m on m.user_id = u.id
        where m.site_id = ${ctx.site.id} and u.email = ${email} and u.state = 'active'
        and m.state = 'active' for update of u`);
      if (!user || (kind === "verify" && user.verified_at)) return null;
      return issueChallenge(tx, ctx, kind, user.id);
    });
    if (result) {
      deliverChallenge(ctx, kind, email, result);
    }
  }

  async function consumeChallenge(
    tx: DbSession,
    ctx: AuditContext,
    kind: ChallengeKind,
    token: string,
  ) {
    const [candidate] = await tx.query<{ user_id: string }>(sql`
      select c.user_id from account_challenges c join identities u on u.id = c.user_id
      join site_members m on m.site_id = c.site_id and m.user_id = c.user_id
      where c.site_id = ${ctx.site.id} and c.digest = ${digest(token)} and c.kind = ${kind}
      and m.state = 'active' and u.state = 'active' for update of u`);
    if (!candidate) throw new AuthError("invalid-challenge");
    const [row] = await tx.query<{ user_id: string }>(sql`
      update account_challenges set consumed_at = ${clock()}
      where site_id = ${ctx.site.id} and digest = ${digest(token)} and kind = ${kind}
      and consumed_at is null and expires_at > ${clock()} returning user_id`);
    if (!row) throw new AuthError("invalid-challenge");
    return row.user_id;
  }

  return {
    async login(
      ctx: AuditContext,
      input: { email: string; password: string; code?: string | undefined },
    ): Promise<SessionTokens> {
      const result = await scoped(ctx, async (tx) => {
        const [account] =
          await tx.query<Account>(sql`select u.id, u.email, u.verified_at, u.password_hash,
          u.failed_attempts, u.locked_until from identities u join site_members m on m.user_id = u.id
          where m.site_id = ${ctx.site.id} and m.state = 'active' and u.state = 'active'
          and u.email = ${emailSchema.parse(input.email)} for update of u`);
        const matching = await verifyPassword(
          account?.password_hash ?? (await dummyHash),
          input.password,
        );
        if (!account) return failure(tx, ctx);
        if (account.locked_until && account.locked_until > clock())
          return failure(tx, { ...ctx, actorId: account.id });
        if (!matching) return failure(tx, ctx, account);
        if (!account.verified_at) return new AuthError("verification-required");
        const [factor] = await tx.query<Factor>(sql`select encrypted_secret, last_counter
          from auth_factors where user_id = ${account.id} for update`);
        if (factor && !input.code) return new AuthError("second-factor-required");
        if (factor && input.code && !(await secondFactor(tx, account.id, input.code, factor)))
          return failure(tx, ctx, account);
        await tx.query(
          sql`update identities set failed_attempts = 0, locked_until = null where id = ${account.id}`,
        );
        return createSession(tx, ctx, account.id);
      });
      if (result instanceof AuthError) throw result;
      return result;
    },

    async refresh(ctx: AuditContext, token: string): Promise<SessionTokens> {
      const result = await scoped(ctx, async (tx) => {
        const hash = digest(token);
        const [lookup] = await tx.query<{
          session_id: string;
        }>(sql`select session_id from refresh_credentials
          where site_id = ${ctx.site.id} and digest = ${hash}`);
        if (!lookup) return null;
        const [session] =
          await tx.query<Session>(sql`select id, tenant_id, user_id, expires_at, revoked_at from sessions
          where site_id = ${ctx.site.id} and id = ${lookup.session_id} for update`);
        if (
          !session ||
          session.tenant_id !== ctx.site.tenantId ||
          session.revoked_at ||
          session.expires_at <= clock()
        )
          return null;
        const [current] =
          await tx.query<Credential>(sql`select id, session_id, consumed_at, expires_at
          from refresh_credentials where site_id = ${ctx.site.id} and digest = ${hash}`);
        if (!current || current.expires_at <= clock()) return null;
        if (current.consumed_at) {
          return revokeSession(
            tx,
            { ...ctx, actorId: session.user_id },
            session.id,
            "refresh-reuse",
          );
        }
        if (!(await activeMember(tx, ctx.site.id, session.user_id))) return null;
        const refreshToken = randomToken();
        await tx.query(
          sql`update refresh_credentials set consumed_at = ${clock()} where id = ${current.id}`,
        );
        await tx.query(sql`insert into refresh_credentials (site_id, session_id, previous_id, digest, expires_at)
          values (${ctx.site.id}, ${session.id}, ${current.id}, ${digest(refreshToken)}, ${session.expires_at})`);
        await audit(tx, { ...ctx, actorId: session.user_id }, "identity.session.rotated", {
          sessionId: session.id,
        });
        return {
          refreshToken,
          sessionId: session.id,
          expiresIn: 300,
          accessToken: await credentials.sign(makeClaims(ctx.site, session.user_id, session.id)),
        };
      });
      if (!result) throw new AuthError("invalid-credentials");
      if ("payload" in result) {
        notifyRevocation(result);
        throw new AuthError("invalid-credentials");
      }
      return result;
    },

    async principal(ctx: AuditContext, token: string): Promise<Principal> {
      if (token.startsWith("atlas_key_")) {
        const principal = await scoped(ctx, async (tx) => {
          const [key] = await tx.query<{
            id: string;
            user_id: string;
            scopes: unknown;
          }>(sql`select id, user_id, scopes
            from api_keys where site_id = ${ctx.site.id} and digest = ${digest(token)} and revoked_at is null`);
          if (!key || !(await activeMember(tx, ctx.site.id, key.user_id))) return null;
          const grants = await loadCapabilities(tx, ctx.site.id, key.user_id);
          await tx.query(
            sql`update api_keys set last_used_at = ${clock()} where site_id = ${ctx.site.id} and id = ${key.id}`,
          );
          return {
            siteId: ctx.site.id,
            tenantId: ctx.site.tenantId,
            userId: key.user_id,
            keyId: key.id,
            capabilities: new Set(
              scopesSchema.parse(key.scopes).filter((scope) => grants.has(scope)),
            ),
          };
        });
        if (!principal) throw new AuthError("invalid-credentials");
        return principal;
      }
      let claims: AccessClaims;
      try {
        claims = await credentials.verify(token);
      } catch {
        throw new AuthError("invalid-credentials");
      }
      if (claims.site !== ctx.site.id || claims.tenant !== ctx.site.tenantId)
        throw new AuthError("invalid-credentials");
      return scoped(ctx, async (tx) => {
        const [session] =
          await tx.query(sql`select id from sessions where id = ${claims.sid} and user_id = ${claims.sub}
          and site_id = ${ctx.site.id} and tenant_id = ${ctx.site.tenantId}
          and revoked_at is null and expires_at > ${clock()}`);
        if (!session || !(await activeMember(tx, ctx.site.id, claims.sub)))
          throw new AuthError("invalid-credentials");
        return {
          siteId: ctx.site.id,
          tenantId: ctx.site.tenantId,
          userId: claims.sub,
          sessionId: claims.sid,
          capabilities: await loadCapabilities(tx, ctx.site.id, claims.sub),
        };
      });
    },

    sessions(ctx: AuditContext, userId: string, after: string | null, limit: number) {
      return scoped(ctx, (tx) =>
        tx.query<{ id: string; createdAt: Date; expiresAt: Date; revokedAt: Date | null }>(sql`
        select id, created_at as "createdAt", expires_at as "expiresAt", revoked_at as "revokedAt"
        from sessions where site_id = ${ctx.site.id} and user_id = ${userId}
          and (${after}::uuid is null or id > ${after}::uuid) order by id limit ${limit}`),
      );
    },

    async revoke(ctx: AuditContext, userId: string, sessionId: string) {
      const event = await scoped(ctx, async (tx) => {
        const [session] = await tx.query<{
          revoked_at: Date | null;
        }>(sql`select revoked_at from sessions
          where site_id = ${ctx.site.id} and user_id = ${userId} and id = ${sessionId} for update`);
        if (!session) throw new AuthError("not-found");
        if (!session.revoked_at) return revokeSession(tx, ctx, sessionId, "operator");
      });
      if (event) notifyRevocation(event);
    },

    createApiKey(ctx: AuditContext, principal: Principal, label: string, scopes: string[]) {
      if (principal.siteId !== ctx.site.id || !principal.sessionId)
        throw new AuthError("forbidden");
      verifyDelegation(principal, scopes);
      return scoped(ctx, async (tx) => {
        const key = "atlas_key_" + randomToken();
        const [row] = await tx.query<{
          id: string;
        }>(sql`insert into api_keys (site_id, user_id, label, scopes, digest)
          values (${ctx.site.id}, ${principal.userId}, ${label}, ${JSON.stringify([...new Set(scopes)])}::jsonb,
            ${digest(key)}) returning id`);
        if (!row) throw new Error("Key insertion failed.");
        await audit(tx, ctx, "identity.key.created", { keyId: row.id });
        return { id: row.id, key };
      });
    },

    apiKeys(ctx: AuditContext, userId: string, after: string | null, limit: number) {
      return scoped(ctx, (tx) =>
        tx.query<{
          id: string;
          label: string;
          scopes: string[];
          createdAt: Date;
          lastUsedAt: Date | null;
          revokedAt: Date | null;
        }>(sql`
        select id, label, scopes, created_at as "createdAt", last_used_at as "lastUsedAt", revoked_at as "revokedAt"
        from api_keys where site_id = ${ctx.site.id} and user_id = ${userId}
          and (${after}::uuid is null or id > ${after}::uuid) order by id limit ${limit}`),
      );
    },

    revokeApiKey(ctx: AuditContext, userId: string, keyId: string) {
      return scoped(ctx, async (tx) => {
        const [key] =
          await tx.query(sql`update api_keys set revoked_at = coalesce(revoked_at, ${clock()})
          where site_id = ${ctx.site.id} and user_id = ${userId} and id = ${keyId} returning id`);
        if (!key) throw new AuthError("not-found");
        await audit(tx, ctx, "identity.key.revoked", { keyId });
      });
    },

    async createUser(ctx: AuditContext, email: string, password: string, displayName: string) {
      const address = emailSchema.parse(email);
      const hashed = await hashPassword(password);
      const created = await scoped(ctx, async (tx) => {
        const [user] = await tx.query<{
          id: string;
        }>(sql`insert into identities (email, password_hash)
          values (${address}, ${hashed}) on conflict (email) do nothing returning id`);
        if (!user) throw new AuthError("conflict");
        await tx.query(
          sql`insert into site_members (site_id, user_id) values (${ctx.site.id}, ${user.id})`,
        );
        await tx.query(sql`insert into user_profiles (site_id, user_id, display_name, locale)
          values (${ctx.site.id}, ${user.id}, ${displayName}, ${ctx.site.locale})`);
        await tx.query(sql`insert into member_roles (site_id, user_id, role_id) select site_id, ${user.id}, id
          from roles where site_id = ${ctx.site.id} and key = 'subscriber'`);
        await audit(tx, ctx, "identity.user.created", { userId: user.id });
        return { id: user.id, token: await issueChallenge(tx, ctx, "verify", user.id) };
      });
      deliverChallenge(ctx, "verify", address, created.token);
      return created.id;
    },

    user(ctx: AuditContext, userId: string) {
      return scoped(ctx, async (tx) => {
        const [profile] = await tx.query<{
          id: string;
          email: string;
          displayName: string;
          locale: string;
        }>(sql`
          select u.id, u.email, p.display_name as "displayName", p.locale
          from user_profiles p join identities u on u.id = p.user_id
          where p.site_id = ${ctx.site.id} and p.user_id = ${userId}`);
        if (!profile) throw new AuthError("not-found");
        return profile;
      });
    },

    users(ctx: AuditContext, after: string | null, limit: number) {
      return scoped(ctx, (tx) =>
        tx.query<{ id: string; email: string; displayName: string; locale: string }>(sql`
        select u.id, u.email, p.display_name as "displayName", p.locale from site_members m
        join identities u on u.id = m.user_id join user_profiles p on p.site_id = m.site_id and p.user_id = m.user_id
        where m.site_id = ${ctx.site.id} and (${after}::uuid is null or u.id > ${after}::uuid) order by u.id limit ${limit}`),
      );
    },

    sendChallenge,

    async verifyEmail(ctx: AuditContext, token: string, password?: string) {
      const hash = password === undefined ? null : await hashPassword(password);
      return scoped(ctx, async (tx) => {
        const userId = await consumeChallenge(tx, ctx, "verify", token);
        const [verified] = await tx.query(
          sql`update identities set verified_at = ${clock()}, password_hash = coalesce(${hash}, password_hash)
            where id = ${userId} and verified_at is null returning id`,
        );
        if (!verified) throw new AuthError("invalid-challenge");
        await audit(tx, { ...ctx, actorId: userId }, "identity.email.verified");
      });
    },

    async resetPassword(ctx: AuditContext, token: string, password: string) {
      const hash = await hashPassword(password);
      const events = await scoped(ctx, async (tx) => {
        const revoked: Revocation[] = [];
        const userId = await consumeChallenge(tx, ctx, "reset", token);
        await tx.query(sql`update identities set password_hash = ${hash},
          failed_attempts = 0, locked_until = null where id = ${userId}`);
        const sites = await tx.query<Site>(
          sql`select id, tenant_id as "tenantId", slug, locale from sites order by id`,
        );
        for (const site of sites) {
          await scopeSession(tx, site.id);
          const scopedContext = { ...ctx, site, actorId: userId };
          const sessions = await tx.query<{ id: string }>(sql`select id from sessions
            where site_id = ${site.id} and user_id = ${userId} and revoked_at is null for update`);
          for (const session of sessions) {
            revoked.push(await revokeSession(tx, scopedContext, session.id, "password-reset"));
          }
          await tx.query(sql`update api_keys set revoked_at = ${clock()} where site_id = ${site.id}
            and user_id = ${userId} and revoked_at is null`);
          await tx.query(sql`update account_challenges set consumed_at = ${clock()} where site_id = ${site.id}
            and user_id = ${userId} and kind = 'reset' and consumed_at is null`);
        }
        await scopeSession(tx, ctx.site.id);
        await audit(tx, { ...ctx, actorId: userId }, "identity.password.reset");
        return revoked;
      });
      for (const event of events) notifyRevocation(event);
    },

    beginTotp(ctx: AuditContext, userId: string, password: string, currentCode?: string) {
      return scoped(ctx, async (tx) => {
        const [account] = await tx.query<{ email: string; password_hash: string }>(sql`
          select email, password_hash from identities where id = ${userId} for update`);
        if (!account || !(await verifyPassword(account.password_hash, password)))
          throw new AuthError("invalid-credentials");
        const [active] = await tx.query<Factor>(
          sql`select encrypted_secret, last_counter from auth_factors where user_id = ${userId}`,
        );
        if (active && (!currentCode || !(await secondFactor(tx, userId, currentCode, active))))
          throw new AuthError("invalid-factor");
        const enrollment = newTotp(account.email);
        const encrypted = credentials.encrypt(enrollment.secret, "totp:" + userId);
        await tx.query(sql`insert into pending_factors (user_id, encrypted_secret, expires_at)
          values (${userId}, ${encrypted}, ${new Date(clock().getTime() + 10 * minute)})
          on conflict (user_id) do update set encrypted_secret = excluded.encrypted_secret, expires_at = excluded.expires_at`);
        await audit(tx, ctx, "identity.factor.enrollment-started");
        return enrollment;
      });
    },

    confirmTotp(ctx: AuditContext, userId: string, token: string) {
      return scoped(ctx, async (tx) => {
        await tx.query(sql`select id from identities where id = ${userId} for update`);
        const [pending] = await tx.query<Factor>(sql`select encrypted_secret from pending_factors
          where user_id = ${userId} and expires_at > ${clock()} for update`);
        if (!pending) throw new AuthError("invalid-factor");
        const counter = totpCounter(
          credentials.decrypt(pending.encrypted_secret, "totp:" + userId),
          token,
          clock().getTime(),
        );
        if (counter === null) throw new AuthError("invalid-factor");
        await tx.query(sql`insert into auth_factors (user_id, encrypted_secret, confirmed_at, last_counter)
          values (${userId}, ${pending.encrypted_secret}, ${clock()}, ${counter})
          on conflict (user_id) do update set encrypted_secret = excluded.encrypted_secret,
            confirmed_at = excluded.confirmed_at, last_counter = excluded.last_counter`);
        await tx.query(sql`delete from pending_factors where user_id = ${userId}`);
        await tx.query(sql`delete from recovery_codes where user_id = ${userId}`);
        const recoveryCodes = generateRecoveryCodes();
        for (const code of recoveryCodes) {
          await tx.query(
            sql`insert into recovery_codes (user_id, digest) values (${userId}, ${digest(code)})`,
          );
        }
        await audit(tx, ctx, "identity.factor.enabled");
        return { recoveryCodes };
      });
    },

    async startOidc(ctx: AuditContext, principal?: Principal): Promise<string> {
      const provider = options.oidc;
      if (!provider) throw new AuthError("oidc-unavailable");
      if (principal && (!principal.sessionId || principal.siteId !== ctx.site.id))
        throw new AuthError("forbidden");
      const flow = { state: randomToken(), nonce: randomToken(), verifier: randomToken() };
      const url = await provider.authorize(flow);
      await scoped(ctx, async (tx) => {
        await tx.query(
          sql`delete from oidc_flows where site_id = ${ctx.site.id} and expires_at <= ${clock()}`,
        );
        await tx.query(sql`insert into oidc_flows (digest, site_id, user_id, encrypted_payload, expires_at)
          values (${digest(flow.state)}, ${ctx.site.id}, ${principal?.userId ?? null},
            ${credentials.encrypt(JSON.stringify(flow), "oidc:" + ctx.site.id)}, ${new Date(clock().getTime() + 10 * minute)})`);
      });
      return url.href;
    },

    async finishOidc(ctx: AuditContext, url: URL): Promise<SessionTokens | null> {
      const provider = options.oidc;
      if (!provider) throw new AuthError("oidc-unavailable");
      const state = url.searchParams.get("state");
      if (!state || state.length !== 43) throw new AuthError("invalid-challenge");
      const row = await scoped(ctx, async (tx) => {
        const [result] = await tx.query<{ user_id: string | null; encrypted_payload: string }>(sql`
          delete from oidc_flows where site_id = ${ctx.site.id} and digest = ${digest(state)}
            and expires_at > ${clock()} returning user_id, encrypted_payload`);
        return result;
      });
      if (!row) throw new AuthError("invalid-challenge");
      const flow = oidcSecrets.parse(
        JSON.parse(credentials.decrypt(row.encrypted_payload, "oidc:" + ctx.site.id)),
      );
      const providerIdentity = await provider.exchange(url, flow).catch(() => {
        throw new AuthError("invalid-challenge");
      });
      return scoped(ctx, async (tx) => {
        const { issuer, subject } = providerIdentity;
        if (row.user_id) {
          if (!(await activeMember(tx, ctx.site.id, row.user_id))) throw new AuthError("forbidden");
          const linked =
            await tx.query(sql`insert into external_identities (issuer, subject, user_id)
            values (${issuer}, ${subject}, ${row.user_id}) on conflict do nothing returning user_id`);
          if (!linked.length) throw new AuthError("conflict");
          await audit(tx, { ...ctx, actorId: row.user_id }, "identity.oidc.linked");
          return null;
        }
        const [linked] = await tx.query<{
          user_id: string;
        }>(sql`select user_id from external_identities
          where issuer = ${issuer} and subject = ${subject}`);
        if (!linked || !(await activeMember(tx, ctx.site.id, linked.user_id)))
          throw new AuthError("invalid-credentials");
        const [factor] = await tx.query(
          sql`select user_id from auth_factors where user_id = ${linked.user_id}`,
        );
        // This phase cannot establish the external provider's MFA assurance from a generic ID token.
        if (factor) throw new AuthError("second-factor-required");
        return createSession(tx, ctx, linked.user_id);
      });
    },
  };
}

export type AuthService = ReturnType<typeof createAuth>;
