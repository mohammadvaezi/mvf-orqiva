// ── [PCODE-339 | S15 | v0.1.0] T34.1d Portal magic-link sign-in and passwordless invitations, MFA required per client ──
//    Why:  against the real database: a contact joins without a password and signs in by an emailed link
//          that works once; asking never tells whether an address has an account and the team gets no
//          links; a client that requires a second factor has its contact set one up during the link sign-in
//          and asks for the code afterwards; and a password sign-in without one is refused.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { base32Decode, totp } from '../../src/auth/totp.js';
import { inSystem } from '../../src/db/pool.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

process.env['ORQIVA_SECRET_KEY'] = 'ab'.repeat(32);

describe.skipIf(!hasDatabase)('magic links for client contacts (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let helio = '';
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  const post = (path: string, body: unknown, cookie = '') =>
    fetch(t.base + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body),
    });
  const mails = async (to: string): Promise<string[]> =>
    inSystem(t.db.pool, async (c) =>
      (
        await c.query<{ text_body: string }>(
          "SELECT text_body FROM mail_outbox WHERE to_address = $1 AND kind = 'signin' ORDER BY created_at",
          [to],
        )
      ).rows.map((r) => r.text_body),
    );
  const lastToken = async (to: string): Promise<string> =>
    /token=([A-Za-z0-9_-]+)/.exec((await mails(to)).at(-1) ?? '')?.[1] ?? '';
  const invite = async (email: string): Promise<string> =>
    (
      await t.call<{ invitation: { token: string } | null }>(
        ada,
        'POST',
        W('/clients/' + helio + '/contacts'),
        {
          email,
          portalRole: 'approver',
        },
      )
    ).body.invitation?.token ?? '';

  beforeAll(async () => {
    t = await startTestApp();
    ada = await t.signup('Ada');
    helio = (await t.call<{ id: string }>(ada, 'POST', W('/clients'), { name: 'Helio' })).body.id;
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('lets a contact join without a password and sign in by a link that works once', async () => {
    const team = await post(
      '/auth/invitations/' + (await invite('ines@helio.example')) + '/accept',
      { name: 'Ines' },
    );
    expect(team.status).toBe(200);
    expect(team.headers.get('set-cookie')).toContain('=');
    // no password: the password sign-in finds nothing to check
    expect(
      (await post('/auth/login', { email: 'ines@helio.example', password: 'anything at all 1' }))
        .status,
    ).toBe(401);
    expect((await post('/auth/link', { email: 'Ines@Helio.example' })).status).toBe(202);
    // the same answer for an unknown address and for the team, and no mail
    expect((await post('/auth/link', { email: 'nobody@helio.example' })).status).toBe(202);
    expect((await post('/auth/link', { email: ada.email })).status).toBe(202);
    expect(await mails('nobody@helio.example')).toEqual([]);
    expect(await mails(ada.email)).toEqual([]);
    const token = await lastToken('ines@helio.example');
    expect(token.length).toBeGreaterThan(20);
    const ok = await post('/auth/link/consume', { token });
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as { user: { email: string }; enrol: unknown };
    expect(body).toMatchObject({ user: { email: 'ines@helio.example' }, enrol: null });
    const cookie = (ok.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    const me = await fetch(t.base + '/auth/me', { headers: { cookie } });
    expect(me.status).toBe(200);
    expect((await post('/auth/link/consume', { token })).status).toBe(410);
  });

  it('has the contact set up a second factor when the client requires one', async () => {
    const r = await t.call<{ requireMfa: boolean }>(ada, 'PATCH', W('/clients/' + helio), {
      requireMfa: true,
    });
    expect(r.body.requireMfa).toBe(true);
    await post('/auth/link', { email: 'ines@helio.example' });
    const first = await post('/auth/link/consume', {
      token: await lastToken('ines@helio.example'),
    });
    const setup = (await first.json()) as {
      user: null;
      enrol: { token: string; secret: string; uri: string };
    };
    expect(first.headers.get('set-cookie')).toBeNull();
    expect(setup.enrol.uri).toMatch(/^otpauth:\/\/totp\//);
    const secret = base32Decode(setup.enrol.secret);
    expect(
      (await post('/auth/link/enrol', { token: setup.enrol.token, code: '000000' })).status,
    ).toBe(400);
    const done = await post('/auth/link/enrol', {
      token: setup.enrol.token,
      code: totp(secret, new Date()),
    });
    expect(done.status).toBe(200);
    expect(((await done.json()) as { recoveryCodes: string[] }).recoveryCodes).toHaveLength(10);
    // from now on the link asks for the code
    await post('/auth/link', { email: 'ines@helio.example' });
    const token = await lastToken('ines@helio.example');
    expect((await post('/auth/link/consume', { token })).status).toBe(401);
    const signed = await post('/auth/link/consume', {
      token,
      code: totp(secret, new Date(Date.now() + 30_000)),
    });
    expect(signed.status).toBe(200);
  });

  it('refuses a password sign-in without the required second factor', async () => {
    await post('/auth/invitations/' + (await invite('tom@helio.example')) + '/accept', {
      name: 'Tom',
      password: 'a client password 1',
    });
    const r = await post('/auth/login', {
      email: 'tom@helio.example',
      password: 'a client password 1',
    });
    expect(r.status).toBe(401);
    expect(((await r.json()) as { error: { message: string } }).error.message).toMatch(
      /requires a second factor/,
    );
    await t.call(ada, 'PATCH', W('/clients/' + helio), { requireMfa: false });
    expect(
      (await post('/auth/login', { email: 'tom@helio.example', password: 'a client password 1' }))
        .status,
    ).toBe(200);
  });
});
