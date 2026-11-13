// ── [PCODE-224 | S15 | v0.1.0] T21.1 Phone sign-in by pairing code, device tokens, QR code in the web app ──
//    Why:  the phone's sign-in. A code works once, within its 10 minutes, only for a member; the token it
//          gives reads and writes the workspace (also over the live connection), shows in the token list
//          and stops at once when revoked.
import type { ServerMessage } from '@orqiva/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inSystem } from '../../src/db/pool.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';
import { RawWsClient } from '../wsclient.js';

interface Paired {
  token: string;
  tokenId: string;
  expiresAt: string | null;
  workspace: { id: string; name: string };
  user: { id: string; name: string; email: string };
}

describe.skipIf(!hasDatabase)('pairing a phone (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let bob: Person;
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  const bearer = async (token: string, method: string, path: string, body?: unknown) => {
    const r = await fetch(t.base + path, {
      method,
      headers: {
        authorization: 'Bearer ' + token,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: r.status, body: (await r.json()) as Record<string, unknown> };
  };
  const pair = (code: string, device = 'Ada’s iPhone') =>
    t.call<Paired & { message?: string }>(null, 'POST', '/auth/devices/pair', { code, device });

  beforeAll(async () => {
    t = await startTestApp({ live: true });
    ada = await t.signup('Ada');
    bob = await t.signup('Bob');
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('turns a pairing code into a device token, once', async () => {
    const made = await t.call<{ code: string; expiresAt: string; minutes: number }>(
      ada,
      'POST',
      W('/devices/pairing'),
    );
    expect(made.status).toBe(201);
    expect(made.body.code).toMatch(/^[2-9A-HJKMNP-TW-Z]{8}$/);
    expect(made.body.minutes).toBe(10);

    // typed in lower case with a dash
    const typed = (made.body.code.slice(0, 4) + '-' + made.body.code.slice(4)).toLowerCase();
    const p = await pair(typed);
    expect(p.status).toBe(200);
    expect(p.body).toMatchObject({
      workspace: { id: ada.workspaceId },
      user: { id: ada.id, email: ada.email },
    });
    expect(p.body.token).toMatch(/^orq_pat_/);
    // the default policy wants an expiry: 90 days
    expect(new Date(p.body.expiresAt ?? 0).getTime()).toBeGreaterThan(Date.now() + 89 * 86_400_000);

    expect((await pair(made.body.code)).status).toBe(400);

    // it reads and writes the workspace
    const project = await bearer(p.body.token, 'POST', W('/projects'), {
      key: 'MOB',
      name: 'Mobile',
    });
    expect(project.status).toBe(201);
    expect((await bearer(p.body.token, 'GET', W('/projects'))).status).toBe(200);
    // but not another workspace
    expect(
      (await bearer(p.body.token, 'GET', '/api/workspaces/' + bob.workspaceId + '/projects'))
        .status,
    ).toBe(404);

    // it shows in the token list, named after the phone, with read and write only
    const list = await t.call<{ id: string; name: string; scopes: string[] }[]>(
      ada,
      'GET',
      W('/access-tokens'),
    );
    expect(list.body.find((x) => x.id === p.body.tokenId)).toMatchObject({
      name: 'Phone: Ada’s iPhone',
      scopes: ['read', 'write'],
    });
  });

  it('opens the live connection with the device token, and revoking it ends both', async () => {
    const code = (await t.call<{ code: string }>(ada, 'POST', W('/devices/pairing'))).body.code;
    const p = (await pair(code, 'Pixel')).body;
    const c = await RawWsClient.open(t.port, { bearer: p.token });
    expect(c.status).toBe(101);
    await c.until(() => c.messages<ServerMessage>().some((m) => m.type === 'welcome'));
    c.destroy();

    // the phone signs itself out
    expect(
      (await bearer(p.token, 'POST', W('/access-tokens/' + p.tokenId + '/revoke'))).status,
    ).toBe(200);
    expect((await bearer(p.token, 'GET', W('/projects'))).status).toBe(401);
    const refused = await RawWsClient.open(t.port, { bearer: p.token });
    expect(refused.status).toBe(401);
    refused.destroy();
  });

  it('refuses unknown, replaced, foreign and expired codes', async () => {
    expect((await pair('2222-2222')).status).toBe(400);
    expect((await pair('not a code')).status).toBe(400);

    // a new code replaces the earlier unused one
    const first = (await t.call<{ code: string }>(ada, 'POST', W('/devices/pairing'))).body.code;
    const second = (await t.call<{ code: string }>(ada, 'POST', W('/devices/pairing'))).body.code;
    expect((await pair(first)).status).toBe(400);

    // a code made before its maker left the workspace
    const bobsCode = (
      await t.call<{ code: string }>(
        bob,
        'POST',
        '/api/workspaces/' + bob.workspaceId + '/devices/pairing',
      )
    ).body.code;
    await inSystem(t.db.pool, (c) =>
      c.query('DELETE FROM workspace_members WHERE user_id = $1', [bob.id]),
    );
    expect((await pair(bobsCode)).status).toBe(400);

    // older than 10 minutes
    await inSystem(t.db.pool, (c) =>
      c.query(
        "UPDATE device_pairings SET expires_at = now() - interval '1 second' WHERE used_at IS NULL",
      ),
    );
    expect((await pair(second)).status).toBe(400);

    // only members make codes
    expect((await t.call(null, 'POST', W('/devices/pairing'))).status).toBe(401);
    expect((await t.call(bob, 'POST', W('/devices/pairing'))).status).toBe(404);
  });

  it('slows down guessing per address', async () => {
    let last = 0;
    for (let i = 0; i < 12; i++) last = (await pair('3333-3333')).status;
    expect(last).toBe(429);
  });
});
