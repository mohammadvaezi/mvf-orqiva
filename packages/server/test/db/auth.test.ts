// ── [PCODE-365 | S15 | v0.1.0] T36.1 Test suite stability ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-88 | S15 | v0.1.0] Implement authentication: email and password, sessions, OIDC login ──
//    Why:  the account flows end to end over HTTP against a real database, and company login against an
//          identity provider of our own that signs real RS256 tokens. Every log line of the run is kept and
//          searched for the secrets that passed through.
import { createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { OidcClient } from '../../src/auth/oidc.js';
import { RateLimiter } from '../../src/auth/ratelimit.js';
import { migrate } from '../../src/db/migrate.js';
import { inSystem } from '../../src/db/pool.js';
import type { HttpServer } from '../../src/http/server.js';
import { createTestDb, hasDatabase, type TestDb } from './testdb.js';
import { listenFetchable } from '../ports.js'; // [PCODE-365 | S15 | v0.1.0]

// ── a minimal OpenID provider: discovery, keys and a token endpoint that checks PKCE ──────────────────
interface PendingCode {
  challenge: string;
  claims: Record<string, unknown>;
}

class TestIdp {
  readonly server: Server;
  url = '';
  private readonly key: KeyObject;
  readonly jwk: Record<string, unknown>;
  readonly codes = new Map<string, PendingCode>();
  readonly seenCodes: string[] = [];

  constructor() {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    this.key = privateKey;
    this.jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', use: 'sig', alg: 'RS256' };
    this.server = createServer((req, res) => {
      const path = (req.url ?? '').split('?')[0];
      const json = (status: number, body: unknown): void => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      if (path === '/.well-known/openid-configuration') {
        json(200, {
          issuer: this.url,
          authorization_endpoint: this.url + '/authorize',
          token_endpoint: this.url + '/token',
          jwks_uri: this.url + '/jwks',
        });
      } else if (path === '/jwks') {
        json(200, { keys: [this.jwk] });
      } else if (path === '/token') {
        let raw = '';
        req.on('data', (d: Buffer) => (raw += d.toString()));
        req.on('end', () => {
          const form = new URLSearchParams(raw);
          const code = form.get('code') ?? '';
          const pending = this.codes.get(code);
          this.codes.delete(code);
          const verifier = form.get('code_verifier') ?? '';
          const challenge = createHash('sha256').update(verifier).digest('base64url');
          if (!pending || pending.challenge !== challenge) {
            json(400, { error: 'invalid_grant' });
            return;
          }
          json(200, { id_token: this.sign(pending.claims), token_type: 'Bearer' });
        });
      } else json(404, {});
    });
  }

  sign(
    claims: Record<string, unknown>,
    header: Record<string, unknown> = { alg: 'RS256', kid: 'k1', typ: 'JWT' },
  ): string {
    const h = Buffer.from(JSON.stringify(header)).toString('base64url');
    const p = Buffer.from(JSON.stringify(claims)).toString('base64url');
    return (
      h + '.' + p + '.' + sign('sha256', Buffer.from(h + '.' + p), this.key).toString('base64url')
    );
  }

  /** What the provider would do after the user signs in: issue a code bound to the PKCE challenge. */
  issueCode(
    authorizeUrl: string,
    claims: Record<string, unknown>,
  ): { code: string; state: string } {
    const u = new URL(authorizeUrl);
    const code =
      'code-' + String(this.seenCodes.length + 1) + '-' + Math.random().toString(36).slice(2);
    this.seenCodes.push(code);
    const now = Math.floor(Date.now() / 1000);
    this.codes.set(code, {
      challenge: u.searchParams.get('code_challenge') ?? '',
      claims: {
        iss: this.url,
        aud: 'orqiva-test',
        iat: now,
        exp: now + 300,
        nonce: u.searchParams.get('nonce'),
        ...claims,
      },
    });
    return { code, state: u.searchParams.get('state') ?? '' };
  }
}

describe.skipIf(!hasDatabase)('authentication over HTTP (PostgreSQL)', () => {
  let db: TestDb;
  let app: HttpServer;
  let base = '';
  const idp = new TestIdp();
  const logs: string[] = [];
  const PASSWORD = 'a long enough passphrase';

  beforeAll(async () => {
    await listenFetchable(idp.server); // [PCODE-365 | S15 | v0.1.0]
    idp.url = 'http://127.0.0.1:' + String((idp.server.address() as AddressInfo).port);
    db = await createTestDb();
    await migrate(db.pool);
    const logger = {
      info: (msg: string, f?: Record<string, unknown>) =>
        logs.push(msg + ' ' + JSON.stringify(f ?? {})),
      error: (msg: string, f?: Record<string, unknown>) =>
        logs.push(msg + ' ' + JSON.stringify(f ?? {})),
    };
    app = createApp({
      logger,
      checkResponses: true,
      auth: {
        pool: db.pool,
        secureCookies: false,
        limiter: new RateLimiter(5, 60_000),
        oidc: new OidcClient({
          issuer: idp.url,
          clientId: 'orqiva-test',
          redirectUri: 'http://localhost/auth/oidc/callback',
        }),
      },
    });
    await listenFetchable(app.server); // [PCODE-365 | S15 | v0.1.0]
    base = 'http://127.0.0.1:' + String((app.server.address() as AddressInfo).port);
  }, 60_000);

  afterAll(async () => {
    await app.close(100);
    await new Promise((r) => idp.server.close(r));
    await db.drop();
  });

  const post = (path: string, body?: unknown, cookie?: string): Promise<Response> =>
    fetch(base + path, {
      method: 'POST',
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(cookie ? { cookie } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  const get = (path: string, cookie?: string): Promise<Response> =>
    fetch(base + path, { redirect: 'manual', headers: cookie ? { cookie } : {} });
  const cookieOf = (res: Response): string =>
    (res.headers.get('set-cookie') ?? '').split(';')[0] ?? '';

  let ada = '';

  it('signs up: account, first workspace as owner, session cookie, activity events', async () => {
    const res = await post('/auth/signup', {
      email: 'Ada@Example.com',
      name: 'Ada',
      password: PASSWORD,
      workspaceName: 'Analytical Engines',
    });
    expect(res.status).toBe(201);
    expect(res.headers.get('set-cookie')).toMatch(
      /^orq_session=[\w-]{43}; Path=\/; HttpOnly; SameSite=Lax/,
    );
    ada = cookieOf(res);
    const me = (await (await get('/auth/me', ada)).json()) as {
      user: { email: string };
      workspaces: { slug: string; role: string; id: string }[];
    };
    expect(me.user.email).toBe('ada@example.com');
    expect(me.workspaces).toEqual([
      expect.objectContaining({
        role: 'owner',
        slug: expect.stringMatching(/^analytical-engines-[0-9a-f]{6}$/) as unknown,
      }),
    ]);
    const events = await inSystem(db.pool, async (c) =>
      (
        await c.query<{ type: string }>('SELECT type FROM activity_events ORDER BY sequence')
      ).rows.map((r) => r.type),
    );
    expect(events).toEqual(['orqiva.workspace.created', 'orqiva.member.created']);
  });

  it('refuses a second account for the same email', async () => {
    const res = await post('/auth/signup', {
      email: 'ada@example.com',
      name: 'Ada 2',
      password: PASSWORD,
      workspaceName: 'Dup',
    });
    expect(res.status).toBe(409);
  });

  it('refuses a weak password and a malformed email with field paths', async () => {
    const res = await post('/auth/signup', {
      email: 'not-an-email',
      name: 'X',
      password: 'short',
      workspaceName: 'W',
    });
    const body = (await res.json()) as { error: { details: { path: string }[] } };
    expect(body.error.details.map((d) => d.path)).toEqual(['body.email', 'body.password']);
  });

  it('logs out: the old cookie stops working at once', async () => {
    expect((await post('/auth/logout', undefined, ada)).headers.get('set-cookie')).toContain(
      'Max-Age=0',
    );
    expect((await get('/auth/me', ada)).status).toBe(401);
  });

  it('logs in with the right password and answers both kinds of failure the same', async () => {
    const wrong = await post('/auth/login', {
      email: 'ada@example.com',
      password: 'not the password',
    });
    const unknown = await post('/auth/login', {
      email: 'nobody@example.com',
      password: 'not the password',
    });
    expect(wrong.status).toBe(401);
    expect(await wrong.json()).toMatchObject({ error: { message: 'Email or password is wrong' } });
    expect(await unknown.json()).toMatchObject({
      error: { message: 'Email or password is wrong' },
    });
    const ok = await post('/auth/login', { email: 'ADA@example.com', password: PASSWORD });
    expect(ok.status).toBe(200);
    expect((await get('/auth/me', cookieOf(ok))).status).toBe(200);
  });

  it('slows guessing down: after the limit even the right password waits', async () => {
    for (let i = 0; i < 5; i++)
      await post('/auth/login', {
        email: 'ada@example.com',
        password: 'guess number ' + String(i),
      });
    const blocked = await post('/auth/login', { email: 'ada@example.com', password: PASSWORD });
    expect(blocked.status).toBe(429);
  });

  it('signs a new person in through OIDC and creates their account and workspace', async () => {
    const start = await get('/auth/oidc/start');
    expect(start.status).toBe(302);
    const location = start.headers.get('location') ?? '';
    expect(location).toContain('code_challenge_method=S256');
    const { code, state } = idp.issueCode(location, {
      sub: 'grace-1',
      email: 'grace@example.com',
      email_verified: true,
      name: 'Grace',
    });
    const cb = await get('/auth/oidc/callback?code=' + code + '&state=' + state);
    expect(cb.status).toBe(302);
    expect(cb.headers.get('location')).toBe('/');
    const me = (await (await get('/auth/me', cookieOf(cb))).json()) as {
      user: { name: string };
      workspaces: unknown[];
    };
    expect(me.user.name).toBe('Grace');
    expect(me.workspaces).toHaveLength(1);
  });

  it('finds the same person again by provider identity, and refuses a reused login', async () => {
    const location = (await get('/auth/oidc/start')).headers.get('location') ?? '';
    const { code, state } = idp.issueCode(location, {
      sub: 'grace-1',
      email: 'grace@example.com',
      email_verified: true,
    });
    expect((await get('/auth/oidc/callback?code=' + code + '&state=' + state)).status).toBe(302);
    const count = await inSystem(
      db.pool,
      async (c) =>
        (await c.query("SELECT 1 FROM users WHERE email = 'grace@example.com'")).rowCount,
    );
    expect(count).toBe(1);
    expect((await get('/auth/oidc/callback?code=' + code + '&state=' + state)).status).toBe(401);
  });

  it('refuses to link an account through an email the provider did not verify', async () => {
    const location = (await get('/auth/oidc/start')).headers.get('location') ?? '';
    const { code, state } = idp.issueCode(location, {
      sub: 'mallory',
      email: 'ada@example.com',
      email_verified: false,
    });
    expect((await get('/auth/oidc/callback?code=' + code + '&state=' + state)).status).toBe(403);
  });

  it('rejects ID tokens with a bad signature, another audience, an old date or another nonce', async () => {
    const client = new OidcClient({
      issuer: idp.url,
      clientId: 'orqiva-test',
      redirectUri: 'x',
    });
    const now = Math.floor(Date.now() / 1000);
    const good = {
      iss: idp.url,
      sub: 's',
      aud: 'orqiva-test',
      iat: now,
      exp: now + 60,
      nonce: 'n1',
    };
    await expect(client.verifyIdToken(idp.sign(good), 'n1')).resolves.toMatchObject({ sub: 's' });
    const tampered = idp
      .sign(good)
      .replace(
        /\.[^.]+\./,
        '.' + Buffer.from(JSON.stringify({ ...good, sub: 'admin' })).toString('base64url') + '.',
      );
    await expect(client.verifyIdToken(tampered, 'n1')).rejects.toThrow(/signature/);
    await expect(
      client.verifyIdToken(idp.sign({ ...good, aud: 'someone-else' }), 'n1'),
    ).rejects.toThrow(/another client/);
    await expect(
      client.verifyIdToken(idp.sign({ ...good, exp: now - 3600 }), 'n1'),
    ).rejects.toThrow(/expired/);
    await expect(client.verifyIdToken(idp.sign(good), 'n2')).rejects.toThrow(/another login/);
    await expect(
      client.verifyIdToken(idp.sign(good, { alg: 'none', kid: 'k1' }), 'n1'),
    ).rejects.toThrow(/not accepted/);
  });

  it('never writes a password, session token or OIDC code to the log', () => {
    const all = logs.join('\n');
    expect(logs.length).toBeGreaterThan(10);
    expect(all).not.toContain(PASSWORD);
    expect(all).not.toContain(ada.split('=')[1] ?? 'unreachable');
    for (const code of idp.seenCodes) expect(all).not.toContain(code);
  });
});
