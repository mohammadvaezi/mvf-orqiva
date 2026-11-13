// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-88 | S15 | v0.1.0] Implement authentication: email and password, sessions, OIDC login ──
import { describe, expect, it } from 'vitest';
import { DUMMY_HASH, hashPassword, verifyPassword } from '../src/auth/password.js';
import { RateLimiter } from '../src/auth/ratelimit.js';
import { parseCookies, sessionCookie, sessionFromCookies } from '../src/auth/sessions.js';

describe('passwords', () => {
  it('hashes with a fresh salt and verifies only the right password', async () => {
    const a = await hashPassword('correct horse battery');
    const b = await hashPassword('correct horse battery');
    expect(a).not.toBe(b);
    expect(a).toMatch(/^scrypt\$32768\$8\$1\$/);
    expect(a).not.toContain('correct horse');
    expect(await verifyPassword('correct horse battery', a)).toBe(true);
    expect(await verifyPassword('correct horse battery!', a)).toBe(false);
  });

  it('treats a malformed hash and the dummy hash as no match', async () => {
    expect(await verifyPassword('anything at all', 'md5$abc')).toBe(false);
    expect(await verifyPassword('anything at all', DUMMY_HASH)).toBe(false);
  });
});

describe('rate limiter', () => {
  it('allows max failures per window, then refuses until they age out', () => {
    let now = 0;
    const r = new RateLimiter(3, 1000, () => now);
    for (let i = 0; i < 3; i++) {
      expect(r.allowed('k')).toBe(true);
      r.fail('k');
    }
    expect(r.allowed('k')).toBe(false);
    expect(r.allowed('other')).toBe(true);
    now = 1001;
    expect(r.allowed('k')).toBe(true);
  });
});

describe('session cookie', () => {
  it('is HttpOnly and SameSite=Lax, Secure when asked', () => {
    expect(sessionCookie('t', true)).toBe(
      'orq_session=t; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000; Secure',
    );
    expect(sessionCookie('t', false)).not.toContain('Secure');
  });

  it('parses a cookie header', () => {
    expect(parseCookies('a=1; pe_session=abc%3D; b')).toEqual({ a: '1', pe_session: 'abc=' });
  });

  // [PCODE-192 | S15 | v0.1.0] a session made before the rename still signs in
  it('reads the session under the new name, else the old one', () => {
    expect(sessionFromCookies('orq_session=new; pe_session=old')).toBe('new');
    expect(sessionFromCookies('pe_session=old')).toBe('old');
    expect(sessionFromCookies(undefined)).toBeUndefined();
  });
});
