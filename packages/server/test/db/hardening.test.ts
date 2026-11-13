// ── [PCODE-312 | S15 | v0.1.0] T31.10 T31 exit check, docs and sprint close ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-150 | S15 | v0.1.0] Add the cloud tenant and harden sign-in, rate limits and headers ──
//    Why:  the second factor against the RFC's own test vectors and in real sign-ins, the limits and
//          headers on real answers, and the cloud trial.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { base32Decode, base32Encode, hotp, matchTotp, totp } from '../../src/auth/totp.js';
import { inSystem } from '../../src/db/pool.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

process.env['ORQIVA_SECRET_KEY'] = '56'.repeat(32);

describe('TOTP as RFC 6238 specifies it', () => {
  const sha1 = Buffer.from('12345678901234567890');
  const sha256 = Buffer.from('12345678901234567890123456789012');
  const sha512 = Buffer.from('1234567890123456789012345678901234567890123456789012345678901234');
  const at = (s: number): Date => new Date(s * 1000);

  it('matches the test vectors of appendix B', () => {
    expect(totp(sha1, at(59), 8)).toBe('94287082');
    expect(totp(sha1, at(1111111109), 8)).toBe('07081804');
    expect(totp(sha1, at(1111111111), 8)).toBe('14050471');
    expect(totp(sha1, at(1234567890), 8)).toBe('89005924');
    expect(totp(sha1, at(2000000000), 8)).toBe('69279037');
    expect(totp(sha1, at(20000000000), 8)).toBe('65353130');
    expect(totp(sha256, at(59), 8, 'sha256')).toBe('46119246');
    expect(totp(sha512, at(59), 8, 'sha512')).toBe('90693936');
    // RFC 4226 appendix D, counter 0 and 9
    expect(hotp(sha1, 0)).toBe('755224');
    expect(hotp(sha1, 9)).toBe('520489');
  });

  it('accepts one step either side, and never the same step twice', () => {
    const now = at(1_800_000_000);
    const code = totp(sha1, at(1_800_000_000 - 30));
    const step = matchTotp(sha1, code, now, null);
    expect(step).toBe(Math.floor((1_800_000_000 - 30) / 30));
    expect(matchTotp(sha1, code, now, step)).toBeNull();
    expect(matchTotp(sha1, totp(sha1, at(1_800_000_000 - 90)), now, null)).toBeNull();
    expect(matchTotp(sha1, 'abcdef', now, null)).toBeNull();
  });

  it('reads and writes base32 as RFC 4648', () => {
    expect(base32Encode(Buffer.from('foobar'))).toBe('MZXW6YTBOI');
    expect(base32Decode('MZXW6YTBOI======').toString()).toBe('foobar');
    expect(base32Decode('mzxw 6ytb oi').toString()).toBe('foobar');
  });
});

describe.skipIf(!hasDatabase)('sign-in, limits, headers and trials (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  const login = (body: Record<string, unknown>) =>
    fetch(t.base + '/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: ada.email, password: 'a test password 1', ...body }),
    });

  beforeAll(async () => {
    t = await startTestApp({ hsts: true });
    ada = await t.signup('Ada');
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('asks for a code once the second factor is on, takes each code once, and recovery codes once', async () => {
    const setup = await t.call<{ secret: string; uri: string }>(ada, 'POST', '/auth/totp/setup');
    expect(setup.body.uri).toMatch(
      /^otpauth:\/\/totp\/Orqiva%3Aada\.1%40example\.test\?secret=[A-Z2-7]+&issuer=Orqiva/,
    );
    const secret = base32Decode(setup.body.secret);
    expect((await t.call(ada, 'POST', '/auth/totp/enable', { code: '000000' })).status).toBe(400);
    // [PCODE-312 | S15 | v0.1.0] one moment for the codes: a run that crosses a 30-second step stays the same
    const t0 = Date.now();
    const first = totp(secret, new Date(t0));
    const on = await t.call<{ recoveryCodes: string[] }>(ada, 'POST', '/auth/totp/enable', {
      code: first,
    });
    expect(on.body.recoveryCodes).toHaveLength(10);
    // the code used to enable is spent; a password alone is not enough
    const bare = await login({});
    expect(bare.status).toBe(401);
    expect(
      ((await bare.json()) as { error: { details: { path: string }[] } }).error.details[0]?.path,
    ).toBe('body.code');
    expect((await login({ code: first })).status).toBe(401);
    const next = totp(secret, new Date(t0 + 30_000));
    expect((await login({ code: next })).status).toBe(200);
    expect((await login({ code: next })).status).toBe(401);
    const recovery = on.body.recoveryCodes[0] ?? '';
    expect((await login({ recoveryCode: recovery.toUpperCase() })).status).toBe(200);
    expect((await login({ recoveryCode: recovery })).status).toBe(401);
    // the API-token exchange asks the same
    const token = await fetch(t.base + '/auth/tokens', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'cli', email: ada.email, password: 'a test password 1' }),
    });
    expect(token.status).toBe(401);
    expect(
      (await t.call<{ enabled: boolean; recoveryLeft: number }>(ada, 'GET', '/auth/totp')).body,
    ).toEqual({ enabled: true, recoveryLeft: 9 });
    expect(
      (await t.call(ada, 'POST', '/auth/totp/disable', { password: 'wrong password' })).status,
    ).toBe(401);
    expect(
      (await t.call(ada, 'POST', '/auth/totp/disable', { password: 'a test password 1' })).status,
    ).toBe(200);
    expect((await login({})).status).toBe(200);
  });

  it('sends the hardening headers on every answer', async () => {
    const res = await fetch(t.base + '/auth/me');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    expect(res.headers.get('cross-origin-resource-policy')).toBe('same-origin');
    expect(res.headers.get('strict-transport-security')).toBe(
      'max-age=31536000; includeSubDomains',
    );
  });

  it('starts cloud workspaces on a trial that runs out', async () => {
    process.env['ORQIVA_MODE'] = 'cloud';
    const cloud = await t.signup('Cleo');
    delete process.env['ORQIVA_MODE'];
    const W = '/api/workspaces/' + cloud.workspaceId + '/licence';
    const r = await t.call<{ status: string; plan: string; seats: number; expires: string }>(
      cloud,
      'GET',
      W,
    );
    expect(r.body).toMatchObject({ status: 'trial', plan: 'business', seats: 25 });
    expect(Date.parse(r.body.expires) - Date.now()).toBeGreaterThan(13 * 86_400_000);
    await inSystem(t.db.pool, (c) =>
      c.query("UPDATE workspaces SET trial_ends_at = now() - interval '1 day' WHERE id = $1", [
        cloud.workspaceId,
      ]),
    );
    expect((await t.call<{ status: string }>(cloud, 'GET', W)).body.status).toBe('free');
    // self-hosted sign-ups have no trial
    expect(
      (
        await t.call<{ status: string }>(
          ada,
          'GET',
          '/api/workspaces/' + ada.workspaceId + '/licence',
        )
      ).body.status,
    ).toBe('free');
  });
});

describe.skipIf(!hasDatabase)('rate limits (PostgreSQL)', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await startTestApp({ rateLimit: { requestsPerMinute: 6, writesPerMinute: 2 } });
  }, 60_000);
  afterAll(async () => {
    await t.stop();
  });

  it('answer 429 with Retry-After past the share, writes first, and never on /health', async () => {
    const write = () => fetch(t.base + '/auth/logout', { method: 'POST' });
    expect((await write()).status).not.toBe(429);
    expect((await write()).status).not.toBe(429);
    const third = await write();
    expect(third.status).toBe(429);
    expect(third.headers.get('retry-after')).toBe('60');
    for (let i = 0; i < 4; i++) expect((await fetch(t.base + '/auth/providers')).status).toBe(200);
    expect((await fetch(t.base + '/auth/providers')).status).toBe(429);
    expect((await fetch(t.base + '/health')).status).toBe(200);
  });
});
