// ── [PCODE-348 | S15 | v0.1.0] T35.2a Integrations hub; email-in for replies to messages and ideas by email ──
//    Why:  against the real database and a local SMTP server: with email-in set up, a mailed notice about a
//          direct message carries a Reply-To address; a reply from that person posts into the conversation
//          without the quoted mail; a reply from someone else, a bad key and an unknown address are refused
//          and logged; mail from a member to a project's ideas address becomes an idea; and the hub says
//          what is connected.
import type { ChannelJson } from '@orqiva/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inSystem } from '../../src/db/pool.js';
import type { MailWorker } from '../../src/mail/outbox.js';
import { headerOf, TestSmtpServer } from '../smtpserver.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

describe.skipIf(!hasDatabase)('email in and the integrations hub (PostgreSQL)', () => {
  const smtp = new TestSmtpServer();
  let t: TestApp & { mailer: MailWorker | null };
  let ada: Person;
  let bob: Person;
  let webhook = '';
  let dm = '';
  let replyTo = '';
  let project = '';
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  const mailIn = async (body: Record<string, unknown>, url = webhook) => {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: r.status, body: (await r.json()) as { outcome: string; detail: string } };
  };

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
    project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'APP', name: 'The App' })
    ).body.id;
  }, 60_000);

  afterAll(async () => {
    await t.stop();
    await smtp.stop();
  });

  it('sets up email in with a key shown once', async () => {
    expect((await t.call(bob, 'PUT', W('/email-in'), { domain: 'in.example.test' })).status).toBe(
      403,
    );
    expect((await t.call(ada, 'PUT', W('/email-in'), { domain: 'not a domain' })).status).toBe(400);
    const r = await t.call<{ webhook: string; key: string }>(ada, 'PUT', W('/email-in'), {
      domain: 'In.Example.test',
    });
    expect(r.body.webhook).toMatch(/\/hooks\/email\/[0-9a-f-]{36}\?key=[0-9a-f]{48}$/);
    webhook = t.base + r.body.webhook.replace(/^https?:\/\/[^/]+/, '');
    const s = (await t.call<{ domain: string; webhook: string }>(ada, 'GET', W('/email-in'))).body;
    expect(s.domain).toBe('in.example.test');
    expect(s.webhook).not.toContain('key=');
  });

  it('mails a notice with a Reply-To, and posts the reply into the conversation', async () => {
    await t.call(bob, 'PUT', W('/notification-rules/mentions'), { channels: ['in_app', 'email'] });
    dm = (await t.call<ChannelJson>(ada, 'POST', W('/direct'), { userIds: [bob.id] })).body.id;
    await t.call(ada, 'POST', W('/channels/' + dm + '/messages'), {
      body: 'Can you check the release notes?',
    });
    for (let i = 0; i < 50; i++) {
      const n = await inSystem(t.db.pool, (c) =>
        c.query("SELECT 1 FROM mail_outbox WHERE kind = 'notice' AND to_address = $1", [bob.email]),
      );
      if (n.rowCount) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    await t.mailer?.round();
    const mail = smtp.received.filter((m) => m.to.includes(bob.email)).at(-1);
    replyTo = headerOf(mail?.data ?? '', 'Reply-To');
    expect(replyTo).toMatch(/^reply\+[0-9a-f]{32}@in\.example\.test$/);
    // the reply, Postmark-style, with the quoted mail below
    const got = await mailIn({
      FromFull: { Email: bob.email.toUpperCase() },
      ToFull: [{ Email: replyTo }],
      Subject: 'Re: Ada wrote to you',
      TextBody:
        'Yes, this afternoon.\n\nOn Thu, 15 Oct 2026 at 10:00, Orqiva wrote:\n> Can you check the release notes?',
    });
    expect(got.body).toEqual({ outcome: 'message', detail: 'Posted as Bob' });
    const msgs = (
      await t.call<{ messages: { body: string; author: { name: string } | null }[] }>(
        ada,
        'GET',
        W('/channels/' + dm + '/messages'),
      )
    ).body.messages;
    expect(msgs.map((m) => m.body)).toContain('Yes, this afternoon.');
  });

  it('refuses a reply from someone else, a bad key and an unknown address, and logs them', async () => {
    expect(
      (
        await mailIn({
          from: 'mallory@evil.example',
          to: [replyTo],
          subject: 'Re',
          text: 'Let me in',
        })
      ).body.outcome,
    ).toBe('refused');
    expect(
      (await mailIn({ from: bob.email, to: ['someone@in.example.test'], subject: 'x', text: 'y' }))
        .body.outcome,
    ).toBe('refused');
    expect(
      (
        await mailIn(
          { from: bob.email, to: [replyTo], text: 'x' },
          webhook.replace(/key=\w+/, 'key=nope'),
        )
      ).status,
    ).toBe(401);
    const recent = (
      await t.call<{ recent: { outcome: string; detail: string }[] }>(ada, 'GET', W('/email-in'))
    ).body.recent;
    expect(recent.map((r) => r.outcome)).toEqual(['refused', 'refused', 'message']);
    expect(recent[1]?.detail).toBe('The reply did not come from the person it was sent to');
  });

  it('turns mail from a member into an idea of the project', async () => {
    const made = await t.call<{ address: string }>(
      ada,
      'POST',
      W('/projects/' + project + '/email-ideas'),
    );
    expect(made.body.address).toMatch(/^ideas\+[0-9a-f]{24}@in\.example\.test$/);
    const got = await mailIn({
      from: 'Bob <' + bob.email + '>',
      to: 'team@example.test, ' + made.body.address,
      subject: 'Dark mode for the driver app',
      text: 'Drivers work at night.\n-- \nBob',
    });
    expect(got.body).toEqual({ outcome: 'idea', detail: 'Idea APP #1' });
    const ideas = (
      await t.call<{ title: string; body: string }[]>(
        ada,
        'GET',
        W('/projects/' + project + '/ideas'),
      )
    ).body;
    expect(ideas).toEqual([
      expect.objectContaining({
        title: 'Dark mode for the driver app',
        body: 'Drivers work at night.',
      }),
    ]);
    expect(
      (
        await mailIn({
          from: 'stranger@example.test',
          to: [made.body.address],
          subject: 'Hi',
          text: 'x',
        })
      ).body.detail,
    ).toBe('Ideas come by mail only from members of the team');
  });

  it('shows what the workspace is connected to', async () => {
    expect((await t.call(bob, 'GET', W('/integrations'))).status).toBe(403);
    const list = (
      await t.call<{ integrations: { key: string; state: string; detail: string }[] }>(
        ada,
        'GET',
        W('/integrations'),
      )
    ).body.integrations;
    const by = Object.fromEntries(list.map((i) => [i.key, i]));
    expect(by['email-in']).toMatchObject({
      state: 'connected',
      detail: 'Replies and ideas arrive at in.example.test',
    });
    expect(by['mail']?.state).toBe('connected');
    expect(by['git']?.state).toBe('off');
    expect(by['calendar']?.state).toBe('built-in');
  });
});
