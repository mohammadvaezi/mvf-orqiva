// ── [PCODE-115 | S15 | v0.1.0] Add settings and user management: profile, password, tokens, members, invitations, project settings ──
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

describe.skipIf(!hasDatabase)('account and invitations (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let bob: Person;
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  /** the password the test helper gave this person at sign-up */
  const testPassword = (p: Person): string =>
    'a test password ' + (/\.(\d+)@/.exec(p.email)?.[1] ?? '');

  /** A request without any cookie, or with the cookie a response handed out. */
  const raw = async (
    method: string,
    path: string,
    body?: unknown,
    cookie?: string,
  ): Promise<{ status: number; body: Record<string, unknown>; cookie: string }> => {
    const res = await fetch(t.base + path, {
      method,
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(cookie ? { cookie } : {}),
        origin: t.base,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    return {
      status: res.status,
      body: (text ? JSON.parse(text) : {}) as Record<string, unknown>,
      cookie: (res.headers.get('set-cookie') ?? '').split(';')[0] ?? '',
    };
  };

  beforeAll(async () => {
    t = await startTestApp();
    ada = await t.signup('Ada');
    bob = await t.signup('Bob');
    await t.call(ada, 'POST', W('/members'), { email: bob.email, role: 'member' });
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('lets a person rename themselves', async () => {
    const r = await t.call<{ name: string }>(ada, 'PATCH', '/auth/me', { name: '  Ada Lovelace ' });
    expect(r.body.name).toBe('Ada Lovelace');
    expect((await t.call<{ user: { name: string } }>(ada, 'GET', '/auth/me')).body.user.name).toBe(
      'Ada Lovelace',
    );
  });

  it('changes the password only with the current one, and signs out every other session', async () => {
    const other = await raw('POST', '/auth/login', {
      email: ada.email,
      password: testPassword(ada),
    });
    expect(other.status).toBe(200);
    const wrong = await t.call(ada, 'POST', '/auth/password', {
      current: 'not it at all',
      next: 'a brand new password',
    });
    expect(wrong.status).toBe(400);
    const ok = await t.call<{ signedOut: number }>(ada, 'POST', '/auth/password', {
      current: testPassword(ada),
      next: 'a brand new password',
    });
    expect(ok.status).toBe(200);
    expect(ok.body.signedOut).toBe(1);
    expect((await raw('GET', '/auth/me', undefined, other.cookie)).status).toBe(401);
    expect((await t.call(ada, 'GET', '/auth/me')).status).toBe(200);
    expect(
      (await raw('POST', '/auth/login', { email: ada.email, password: 'a brand new password' }))
        .status,
    ).toBe(200);
  });

  it('invites a new person, who opens the link, chooses name and password, and joins with the role', async () => {
    expect(
      (await t.call(bob, 'POST', W('/invitations'), { email: 'cy@example.test', role: 'member' }))
        .status,
    ).toBe(403);
    const inv = await t.call<{ invitation: { id: string; email: string }; token: string }>(
      ada,
      'POST',
      W('/invitations'),
      {
        email: 'Cy@Example.test',
        role: 'guest',
      },
    );
    expect(inv.status).toBe(201);
    expect(inv.body.invitation.email).toBe('cy@example.test');
    expect(inv.body.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const list = await t.call<{ email: string; invitedBy: string }[]>(
      ada,
      'GET',
      W('/invitations'),
    );
    expect(list.body).toEqual([
      expect.objectContaining({ email: 'cy@example.test', invitedBy: 'Ada Lovelace' }),
    ]);

    const seen = await raw('GET', '/auth/invitations/' + inv.body.token);
    expect(seen.body).toMatchObject({
      workspaceName: expect.any(String) as string,
      email: 'cy@example.test',
      role: 'guest',
      accountExists: false,
    });
    const missing = await raw('POST', '/auth/invitations/' + inv.body.token + '/accept', {
      name: 'Cy',
    });
    expect(missing.status).toBe(400);
    const joined = await raw('POST', '/auth/invitations/' + inv.body.token + '/accept', {
      name: 'Cy',
      password: 'cy has a long password',
    });
    expect(joined.status).toBe(200);
    expect(joined.body).toEqual({ workspaceId: ada.workspaceId, created: true });
    const me = await raw('GET', '/auth/me', undefined, joined.cookie);
    expect(me.body).toMatchObject({
      user: { name: 'Cy' },
      workspaces: [expect.objectContaining({ id: ada.workspaceId, role: 'guest' })],
    });
    // the link works once
    expect(
      (
        await raw('POST', '/auth/invitations/' + inv.body.token + '/accept', {
          name: 'X',
          password: 'another long password',
        })
      ).status,
    ).toBe(410);
    expect((await raw('GET', '/auth/invitations/' + inv.body.token)).status).toBe(410);
    expect((await t.call<unknown[]>(ada, 'GET', W('/invitations'))).body).toEqual([]);
  });

  it('lets an existing account join only when signed in as the invited address', async () => {
    const other = await t.signup('Dee');
    const inv = await t.call<{ token: string }>(ada, 'POST', W('/invitations'), {
      email: other.email,
      role: 'admin',
    });
    const anon = await raw('POST', '/auth/invitations/' + inv.body.token + '/accept', {
      name: 'Dee',
      password: 'some long password',
    });
    expect(anon.status).toBe(401);
    const asBob = await t.call(bob, 'POST', '/auth/invitations/' + inv.body.token + '/accept', {});
    expect(asBob.status).toBe(403);
    const asDee = await t.call<{ created: boolean }>(
      other,
      'POST',
      '/auth/invitations/' + inv.body.token + '/accept',
      {},
    );
    expect(asDee.body).toEqual({ workspaceId: ada.workspaceId, created: false });
    const members = await t.call<{ email: string; role: string }[]>(ada, 'GET', W('/members'));
    expect(members.body.find((m) => m.email === other.email)?.role).toBe('admin');
    expect(
      (await t.call(ada, 'POST', W('/invitations'), { email: other.email, role: 'member' })).status,
    ).toBe(409);
  });

  it('withdraws an invitation, and replaces an open one for the same address', async () => {
    const first = await t.call<{ token: string; invitation: { id: string } }>(
      ada,
      'POST',
      W('/invitations'),
      { email: 'eve@example.test', role: 'member' },
    );
    const second = await t.call<{ token: string; invitation: { id: string } }>(
      ada,
      'POST',
      W('/invitations'),
      { email: 'eve@example.test', role: 'admin' },
    );
    expect((await raw('GET', '/auth/invitations/' + first.body.token)).status).toBe(410);
    expect((await t.call<unknown[]>(ada, 'GET', W('/invitations'))).body).toHaveLength(1);
    expect(
      (await t.call(ada, 'DELETE', W('/invitations/' + second.body.invitation.id))).status,
    ).toBe(200);
    expect((await raw('GET', '/auth/invitations/' + second.body.token)).status).toBe(410);
    expect((await raw('GET', '/auth/invitations/' + 'x'.repeat(43))).status).toBe(404);
  });

  it('lets an admin set the project version, not a member', async () => {
    const p = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'VER', name: 'Versioned' })
    ).body.id;
    expect((await t.call(bob, 'PATCH', W('/projects/' + p), { version: '0.2.0' })).status).toBe(
      403,
    );
    const r = await t.call<{ version: string }>(ada, 'PATCH', W('/projects/' + p), {
      version: '0.2.0',
    });
    expect(r.body.version).toBe('0.2.0');
    expect((await t.call(ada, 'PATCH', W('/projects/' + p), { version: 'one' })).status).toBe(400);
  });
});
