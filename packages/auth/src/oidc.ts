import * as oidc from "openid-client";

export interface OidcFlow {
  readonly state: string;
  readonly nonce: string;
  readonly verifier: string;
}
export interface OidcIdentity {
  readonly issuer: string;
  readonly subject: string;
}
export interface OidcProvider {
  authorize(flow: OidcFlow): Promise<URL>;
  exchange(callback: URL, flow: OidcFlow): Promise<OidcIdentity>;
}

export function createOidcProvider(
  issuer: string,
  clientId: string,
  redirectUri: string,
  secret?: string,
): OidcProvider {
  let configuration: Promise<oidc.Configuration> | undefined;
  function discover() {
    // Clear transient discovery failures to allow a later login to retry.
    configuration ??= oidc.discovery(new URL(issuer), clientId, secret).catch((error: unknown) => {
      configuration = undefined;
      throw error;
    });
    return configuration;
  }
  return {
    async authorize(flow) {
      return oidc.buildAuthorizationUrl(await discover(), {
        redirect_uri: redirectUri,
        scope: "openid",
        response_type: "code",
        state: flow.state,
        nonce: flow.nonce,
        code_challenge: await oidc.calculatePKCECodeChallenge(flow.verifier),
        code_challenge_method: "S256",
      });
    },
    async exchange(callback, flow) {
      const expected = new URL(redirectUri);
      if (callback.origin !== expected.origin || callback.pathname !== expected.pathname)
        throw new Error("Invalid OIDC callback.");
      const result = await oidc.authorizationCodeGrant(await discover(), callback, {
        expectedState: flow.state,
        expectedNonce: flow.nonce,
        pkceCodeVerifier: flow.verifier,
        idTokenExpected: true,
      });
      const identity = result.claims();
      if (!identity || identity.iss !== issuer || !identity.sub)
        throw new Error("Invalid OIDC identity.");
      return { issuer: identity.iss, subject: identity.sub };
    },
  };
}
