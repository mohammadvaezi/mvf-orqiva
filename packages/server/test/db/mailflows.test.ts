// ── [PCODE-365 | S15 | v0.1.0] T36.1 Test suite stability ──
// ── [PCODE-237 | S15 | v0.1.0] T23.4 Email as a channel: own SMTP sender, password reset, invitations, digests ──
//    Why:  the T23.4 exit against a local mail server: a reset mail arrives and works once (and ends the old
//          sessions), the answer never tells whether an address has an account, an invitation is mailed and
//          signs a new person up, an admin's link works only for accounts they fully administer, a mail the
//          server refuses for now is tried again, a direct message reaches whoever chose email, a digest sums
//          up a day, and a token about to run out is announced once.
import type { ChannelJson } from '@orqiva/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inSystem } from '../../src/db/pool.js';
import { MailWorker } from '../../src/mail/outbox.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';
import { headerOf, subjectOf, TestSmtpServer, textOf } from '../smtpserver.js';
import type { MailWorker as Worker } from '../../src/mail/outbox.js';

describe.skipIf(!hasDatabase)('mail (PostgreSQL)', () => {
  const smtp = new TestSmtpServer();
  let t: TestApp & { mailer: Worker | null };
  let ada: Person;
  let bob: Person;
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  const send = async (): Promise<void> => {
    await t.mailer?.round();
  };
  const last = (to: string) => smtp.received.filter((m) => m.to.includes(to)).at(-1);
  const linkIn = (data: string, path: string): string =>
    new RegExp('https://orqiva\\.example\\.test(' + path + '[A-Za-z0-9_-]+)').exec(
      textOf(data),
    )?.[1] ?? '';

  beforeAll(async () => {
    await smtp.start();
    t = await startTestApp({
      live: true,
      mail: {
        host: '127.0.0.1',
        port: smtp.port,
        security: 'none',
        from: 'Orqiva <orqiva@example.test>',
        timeoutMs: 3000,
      },
    });
    ada = await t.signup('Ada');
    bob = await t.signup('Bob');
    await t.call(ada, 'POST', W('/members'), { email: bob.email, role: 'member' });
  }, 60_000);

  afterAll(async () => {
    await t.stop();
    await smtp.stop();
  });

  it('mails a reset link that works once and ends the old sessions', async () => {
    const asked = await t.call<{ ok: boolean; mail: boolean }>(
      null,
      'POST',
      '/auth/password/forgot',
      {
        email: ada.email.toUpperCase(),
      },
    );
    expect(asked.body).toEqual({ ok: true, mail: true });
    // an address without an account gets the same answer, and no mail
    const before = smtp.received.length;
    const nobody = await t.call(null, 'POST', '/auth/password/forgot', {
      email: 'nobody@example.test',
    });
    expect(nobody.body).toEqual({ ok: true, mail: true });
    await send();
    expect(smtp.received.length).toBe(before + 1);
    const mail = last(ada.email);
    expect(headerOf(mail?.data ?? '', 'Subject')).toBe('Reset your Orqiva password');
    const path = linkIn(mail?.data ?? '', '/reset/');
    expect(path).toMatch(/^\/reset\/.{40,}/);
    const token = path.slice('/reset/'.length);
    expect(
      (
        await t.call(null, 'POST', '/auth/password/reset', {
          token,
          password: 'a brand new password',
        })
      ).status,
    ).toBe(200);
    // the old session is gone; the new password signs in; the link does not work twice
    expect((await t.call(ada, 'GET', '/auth/me')).status).toBe(401);
    const login = await fetch(t.base + '/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: ada.email, password: 'a brand new password' }),
    });
    expect(login.status).toBe(200);
    ada = { ...ada, cookie: (login.headers.get('set-cookie') ?? '').split(';')[0] ?? '' };
    expect(
      (
        await t.call(null, 'POST', '/auth/password/reset', {
          token,
          password: 'yet another password',
        })
      ).status,
    ).toBe(400);
  });

  it('mails an invitation that signs a new person up', async () => {
    const inv = await t.call<{ token: string; mailed: boolean }>(ada, 'POST', W('/invitations'), {
      email: 'carla@example.test',
      role: 'member',
    });
    expect(inv.body.mailed).toBe(true);
    await send();
    const mail = last('carla@example.test');
    expect(headerOf(mail?.data ?? '', 'Subject')).toContain('invites you to');
    const path = linkIn(mail?.data ?? '', '/invite/');
    expect(path).toBe('/invite/' + inv.body.token);
    const accept = await fetch(t.base + '/auth/invitations/' + inv.body.token + '/accept', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Carla', password: 'carla password 1' }),
    });
    expect(accept.status).toBe(200);
  });

  it('gives an admin a reset link only for accounts they fully administer', async () => {
    // Bob signed up himself: he also owns his own workspace, which Ada does not administer
    const members = await t.call<{ userId: string; email: string }[]>(ada, 'GET', W('/members'));
    expect((await t.call(ada, 'POST', W('/members/' + bob.id + '/reset-link'))).status).toBe(403);
    // Carla came by invitation and belongs only here
    const carla = members.body.find((m) => m.email === 'carla@example.test')?.userId ?? '';
    const link = await t.call<{ url: string }>(ada, 'POST', W('/members/' + carla + '/reset-link'));
    expect(link.status).toBe(201);
    expect(link.body.url).toMatch(/^https:\/\/orqiva\.example\.test\/reset\//);
    const token = link.body.url.split('/reset/')[1] ?? '';
    expect(
      (
        await t.call(null, 'POST', '/auth/password/reset', {
          token,
          password: 'carla new password',
        })
      ).status,
    ).toBe(200);
    // not for oneself, and only for admins
    expect((await t.call(ada, 'POST', W('/members/' + ada.id + '/reset-link'))).status).toBe(409);
    expect((await t.call(bob, 'POST', W('/members/' + carla + '/reset-link'))).status).toBe(403);
  });

  it('tries a refused mail again later, and shows it to the admin', async () => {
    smtp.refuse = ['451 4.3.0 try later'];
    expect((await t.call(ada, 'POST', W('/mail/test'))).status).toBe(202);
    await send();
    let state = await t.call<{
      configured: boolean;
      recent: { kind: string; status: string; attempts: number; error: string }[];
    }>(ada, 'GET', W('/mail'));
    expect(state.body.configured).toBe(true);
    expect(state.body.recent[0]).toMatchObject({ kind: 'test', status: 'pending', attempts: 1 });
    expect(state.body.recent[0]?.error).toContain('451');
    // a round a few minutes later sends it
    const later = new MailWorker({
      pool: t.db.pool,
      config: {
        host: '127.0.0.1',
        port: smtp.port,
        security: 'none',
        from: 'orqiva@example.test',
        timeoutMs: 3000,
      },
      publicUrl: 'https://orqiva.example.test',
      now: () => new Date(Date.now() + 2 * 60_000),
    });
    await later.round();
    state = await t.call(ada, 'GET', W('/mail'));
    expect(state.body.recent[0]).toMatchObject({ kind: 'test', status: 'sent', attempts: 2 });
    expect(headerOf(last(ada.email)?.data ?? '', 'Subject')).toBe('Orqiva can send mail');
    // reset mails never show in the list: they carry a working link
    expect(state.body.recent.some((r) => r.kind === 'reset')).toBe(false);
  });

  it('mails a direct message to whoever chose email for mentions and messages', async () => {
    await t.call(bob, 'PUT', W('/notification-rules/mentions'), { channels: ['in_app', 'email'] });
    const dm = await t.call<ChannelJson>(ada, 'POST', W('/direct'), { userIds: [bob.id] });
    await t.call(ada, 'POST', W('/channels/' + dm.body.id + '/messages'), {
      body: 'Can you look at the release notes today?',
    });
    // the notice goes after the answer: wait for it, then send
    for (let i = 0; i < 50; i++) {
      const n = await inSystem(t.db.pool, (c) =>
        c.query("SELECT 1 FROM mail_outbox WHERE kind = 'notice' AND to_address = $1", [bob.email]),
      );
      if (n.rowCount) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    await send();
    const mail = last(bob.email);
    expect(headerOf(mail?.data ?? '', 'Subject')).toBe('Ada wrote to you');
    expect(textOf(mail?.data ?? '')).toContain('Can you look at the release notes today?');
    expect(textOf(mail?.data ?? '')).toContain(
      'https://orqiva.example.test/messages/' + dm.body.id,
    );
  });

  it('sums up the day at 07:00 where people live, once, and announces a token that runs out', async () => {
    const token = await t.call<{ id: string }>(bob, 'POST', W('/access-tokens'), {
      name: 'CI deploys',
      scopes: ['read'],
      expiresInDays: 3,
    });
    expect(token.status).toBe(201);
    const at7 = new Date();
    at7.setUTCHours(7, 5, 0, 0);
    const morning = new MailWorker({
      pool: t.db.pool,
      config: {
        host: '127.0.0.1',
        port: smtp.port,
        security: 'none',
        from: 'orqiva@example.test',
        timeoutMs: 3000,
      },
      publicUrl: 'https://orqiva.example.test',
      now: () => at7,
    });
    await morning.daily();
    await morning.daily();
    // queued now: the worker on the real clock sends them
    await send();
    const digests = smtp.received.filter(
      (m) => m.to.includes(bob.email) && headerOf(m.data, 'Subject').startsWith('Your day in'),
    );
    expect(digests).toHaveLength(1);
    expect(textOf(digests[0]?.data ?? '')).toContain('in your inbox');
    const expiring = smtp.received.filter(
      (m) =>
        m.to.includes(bob.email) && subjectOf(m.data) === 'Your token “CI deploys” runs out soon',
    );
    expect(expiring).toHaveLength(1);
  });

  // [PCODE-365 | S15 | v0.1.0]
  it('leaves the day open after a quiet morning check, so a later digest that hour still goes', async () => {
    const quiet = await t.signup('Quinn');
    const at7 = new Date();
    at7.setUTCHours(7, 1, 0, 0);
    const worker = new MailWorker({
      pool: t.db.pool,
      config: {
        host: '127.0.0.1',
        port: smtp.port,
        security: 'none',
        from: 'orqiva@example.test',
        timeoutMs: 3000,
      },
      publicUrl: 'https://orqiva.example.test',
      now: () => at7,
    });
    await worker.daily();
    const claimed = await inSystem(t.db.pool, (c) =>
      c.query('SELECT 1 FROM mail_digests WHERE user_id = $1', [quiet.id]),
    );
    expect(claimed.rowCount).toBe(0);
  });

  it('says when this server sends no mail', async () => {
    const plain = await startTestApp();
    const p = await plain.signup('Pia');
    expect(
      (await plain.call(null, 'POST', '/auth/password/forgot', { email: p.email })).body,
    ).toEqual({
      ok: true,
      mail: false,
    });
    const inv = await plain.call<{ mailed: boolean }>(
      p,
      'POST',
      '/api/workspaces/' + p.workspaceId + '/invitations',
      { email: 'x@example.test', role: 'member' },
    );
    expect(inv.body.mailed).toBe(false);
    expect(
      (await plain.call(p, 'POST', '/api/workspaces/' + p.workspaceId + '/mail/test')).status,
    ).toBe(409);
    await plain.stop();
    // [PCODE-238 | S15 | v0.1.0] T23.5 Communication exit check, docs and sprint close
    // a second server starts inside this test; on a busy machine that alone can take 5 seconds
  }, 30_000);
});
