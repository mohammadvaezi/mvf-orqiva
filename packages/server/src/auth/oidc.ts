// ── [PCODE-88 | S15 | v0.1.0] Implement authentication: email and password, sessions, OIDC login ──
//    Why:  company login through any OpenID Connect provider (Entra ID, Google, Keycloak, Authentik …) with
//          the authorization code flow and PKCE. Discovery, the code exchange and the ID token check are
//          ours, on fetch and node:crypto: signature against the provider's published keys, issuer,
//          audience, expiry and the nonce of this very login.
import {
  createHash,
  createPublicKey,
  randomBytes,
  verify,
  type JsonWebKey,
  type KeyObject,
} from 'node:crypto';

export interface OidcConfig {
  issuer: string;
  clientId: string;
  /** confidential clients only; PKCE protects public ones */
  clientSecret?: string;
  /** where the provider sends the browser back: {publicUrl}/auth/oidc/callback */
  redirectUri: string;
}

interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}

export interface IdClaims {
  iss: string;
  sub: string;
  aud: string | string[];
  exp: number;
  iat: number;
  nonce?: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
}

export class OidcError extends Error {}

const b64url = (buf: Buffer): string => buf.toString('base64url');

export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = b64url(randomBytes(32));
  return { verifier, challenge: b64url(createHash('sha256').update(verifier).digest()) };
}

export class OidcClient {
  private discovery: Discovery | null = null;
  private keys = new Map<string, KeyObject>();
  private keysFetchedAt = 0;

  constructor(
    readonly config: OidcConfig,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => number = () => Date.now(),
  ) {}

  private async getJson(url: string, init?: RequestInit): Promise<Record<string, unknown>> {
    const res = await this.fetchImpl(url, { ...init, signal: AbortSignal.timeout(10_000) });
    if (!res.ok)
      throw new OidcError(
        'The identity provider answered ' + String(res.status) + ' for ' + new URL(url).pathname,
      );
    return (await res.json()) as Record<string, unknown>;
  }

  async discover(): Promise<Discovery> {
    if (this.discovery) return this.discovery;
    const doc = await this.getJson(
      this.config.issuer.replace(/\/$/, '') + '/.well-known/openid-configuration',
    );
    for (const k of ['issuer', 'authorization_endpoint', 'token_endpoint', 'jwks_uri'] as const) {
      if (typeof doc[k] !== 'string')
        throw new OidcError('The provider discovery document has no ' + k);
    }
    if (doc['issuer'] !== this.config.issuer)
      throw new OidcError(
        'The provider calls itself ' + String(doc['issuer']) + ', expected ' + this.config.issuer,
      );
    this.discovery = doc as unknown as Discovery;
    return this.discovery;
  }

  /** The URL to send the browser to. */
  async authorizeUrl(state: string, nonce: string, challenge: string): Promise<string> {
    const d = await this.discover();
    const url = new URL(d.authorization_endpoint);
    url.search = new URLSearchParams({
      response_type: 'code',
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      scope: 'openid email profile',
      state,
      nonce,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    }).toString();
    return url.toString();
  }

  /** Exchanges the code and returns the checked claims of the ID token. */
  async finish(code: string, verifier: string, nonce: string): Promise<IdClaims> {
    const d = await this.discover();
    const form = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.config.redirectUri,
      client_id: this.config.clientId,
      code_verifier: verifier,
    });
    const headers: Record<string, string> = {
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
    };
    if (this.config.clientSecret) {
      headers['authorization'] =
        'Basic ' +
        Buffer.from(
          encodeURIComponent(this.config.clientId) +
            ':' +
            encodeURIComponent(this.config.clientSecret),
        ).toString('base64');
    }
    const tokens = await this.getJson(d.token_endpoint, {
      method: 'POST',
      headers,
      body: form.toString(),
    });
    if (typeof tokens['id_token'] !== 'string')
      throw new OidcError('The provider returned no ID token');
    return this.verifyIdToken(tokens['id_token'], nonce);
  }

  private async key(kid: string | undefined): Promise<KeyObject> {
    const pick = (): KeyObject | undefined =>
      kid ? this.keys.get(kid) : this.keys.size === 1 ? [...this.keys.values()][0] : undefined;
    let k = pick();
    // an unknown kid means the provider rotated its keys: fetch again, at most once a minute
    if (!k && this.now() - this.keysFetchedAt > 60_000) {
      const d = await this.discover();
      const jwks = await this.getJson(d.jwks_uri);
      this.keys = new Map();
      for (const jwk of (Array.isArray(jwks['keys']) ? jwks['keys'] : []) as (JsonWebKey & {
        kid?: string;
        use?: string;
      })[]) {
        if (jwk.use && jwk.use !== 'sig') continue;
        if (jwk.kty !== 'RSA' && jwk.kty !== 'EC') continue;
        this.keys.set(jwk.kid ?? 'default', createPublicKey({ key: jwk, format: 'jwk' }));
      }
      this.keysFetchedAt = this.now();
      k = pick();
    }
    if (!k) throw new OidcError('The ID token is signed with a key the provider does not publish');
    return k;
  }

  async verifyIdToken(jwt: string, nonce: string): Promise<IdClaims> {
    const parts = jwt.split('.');
    if (parts.length !== 3) throw new OidcError('The ID token is not a JWT');
    const [h, p, sig] = parts as [string, string, string];
    let header: { alg?: string; kid?: string };
    let claims: IdClaims;
    try {
      header = JSON.parse(Buffer.from(h, 'base64url').toString('utf8')) as {
        alg?: string;
        kid?: string;
      };
      claims = JSON.parse(Buffer.from(p, 'base64url').toString('utf8')) as IdClaims;
    } catch {
      throw new OidcError('The ID token cannot be read');
    }
    if (header.alg !== 'RS256' && header.alg !== 'ES256')
      throw new OidcError('ID token algorithm ' + String(header.alg) + ' is not accepted');
    const key = await this.key(header.kid);
    const ok = verify(
      'sha256',
      Buffer.from(h + '.' + p),
      header.alg === 'ES256' ? { key, dsaEncoding: 'ieee-p1363' } : key,
      Buffer.from(sig, 'base64url'),
    );
    if (!ok) throw new OidcError('The ID token signature is not valid');

    const now = Math.floor(this.now() / 1000);
    const skew = 60;
    if (claims.iss !== this.config.issuer)
      throw new OidcError('The ID token comes from another issuer');
    const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!aud.includes(this.config.clientId))
      throw new OidcError('The ID token is meant for another client');
    if (typeof claims.exp !== 'number' || claims.exp + skew < now)
      throw new OidcError('The ID token has expired');
    if (typeof claims.iat !== 'number' || claims.iat - skew > now)
      throw new OidcError('The ID token is dated in the future');
    if (claims.nonce !== nonce) throw new OidcError('The ID token belongs to another login');
    if (typeof claims.sub !== 'string' || !claims.sub)
      throw new OidcError('The ID token has no subject');
    return claims;
  }
}
