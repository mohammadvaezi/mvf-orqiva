// ── [PCODE-238 | S15 | v0.1.0] T23.5 Communication exit check, docs and sprint close ──
//    Why:  the T23 exit, as one working day: a team and its client talk only in Orqiva. The client writes
//          in the shared channel and mentions the lead, who hears it live, in the inbox and by mail; the
//          lead answers in the thread; a developer asks the lead directly; the client's report becomes a
//          task; nobody sees a conversation they are not part of; and the mail goes through a mail server.
import type { ChannelJson, MessageJson, ServerMessage } from '@orqiva/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inSystem } from '../../src/db/pool.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';
import { subjectOf, TestSmtpServer, textOf } from '../smtpserver.js';
import { RawWsClient } from '../wsclient.js';
import type { MailWorker } from '../../src/mail/outbox.js';

describe.skipIf(!hasDatabase)('a day of communication inside Orqiva (PostgreSQL)', () => {
  const smtp = new TestSmtpServer();
  let t: TestApp & { mailer: MailWorker | null };
  let ada: Person;
  let bob: Person;
  let ines: Person;
  let project = '';
  let client = '';
  const sockets: RawWsClient[] = [];
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  const say = (who: Person, channel: string, body: string, parentId?: string) =>
    t.call<MessageJson>(who, 'POST', W('/channels/' + channel + '/messages'), {
      body,
      ...(parentId ? { parentId } : {}),
    });

  beforeAll(async () => {
    await smtp.start();
    t = await startTestApp({
      live: true,
      mail: { host: '127.0.0.1', port: smtp.port, security: 'none', from: 'orqiva@example.test' },
    });
    ada = await t.signup('Ada');
    bob = await t.signup('Bob');
    await t.call(ada, 'POST', W('/members'), { email: bob.email, role: 'member' });
    project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'HEL', name: 'Helio app' })
    ).body.id;
    client = (await t.call<{ id: string }>(ada, 'POST', W('/clients'), { name: 'Helio Health' }))
      .body.id;
    await t.call(ada, 'PUT', W('/projects/' + project + '/client'), { clientId: client });
    // the client contact comes by an invitation mail
    const inv = await t.call<{ invitation: { token: string; mailed: boolean } }>(
      ada,
      'POST',
      W('/clients/' + client + '/contacts'),
      { email: 'ines@helio.example', portalRole: 'approver' },
    );
    expect(inv.body.invitation.mailed).toBe(true);
    await t.mailer?.round();
    const invitationMail = smtp.received.find((m) => m.to.includes('ines@helio.example'));
    expect(subjectOf(invitationMail?.data ?? '')).toContain('invites you to follow your projects');
    const accept = await fetch(
      t.base + '/auth/invitations/' + inv.body.invitation.token + '/accept',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Ines Vogel', password: 'a client password 1' }),
      },
    );
    ines = {
      id: '',
      email: 'ines@helio.example',
      name: 'Ines Vogel',
      cookie: (accept.headers.get('set-cookie') ?? '').split(';')[0] ?? '',
      workspaceId: ada.workspaceId,
    };
    ines.id = (await t.call<{ user: { id: string } }>(ines, 'GET', '/auth/me')).body.user.id;
    // the lead wants mentions by mail as well
    await t.call(ada, 'PUT', W('/notification-rules/mentions'), {
      channels: ['in_app', 'push', 'email'],
    });
  }, 60_000);

  afterAll(async () => {
    for (const s of sockets) s.destroy();
    await t.stop();
    await smtp.stop();
  });

  it('runs a day of conversations with the client and the team, all inside Orqiva', async () => {
    // the lead opens the client's channel; the client is in it at once
    const shared = await t.call<ChannelJson>(ada, 'POST', W('/channels'), {
      name: 'helio',
      topic: 'Helio Health and the team',
      clientId: client,
    });
    const mine = (await t.call<ChannelJson[]>(ines, 'GET', W('/channels'))).body;
    expect(mine.map((c) => [c.name, c.joined])).toEqual([['helio', true]]);

    // the lead follows live
    const live = await RawWsClient.open(t.port, { cookie: ada.cookie });
    sockets.push(live);
    live.sendJson({ type: 'subscribe', workspaceId: ada.workspaceId });
    await live.until(() => live.messages<ServerMessage>().some((m) => m.type === 'subscribed'));

    // 09:12 the client reports a problem and mentions the lead
    const report = await say(
      ines,
      shared.body.id,
      'Good morning @ada, the export to PDF is empty for appointments in October.',
    );
    expect(report.status).toBe(201);
    await live.until(() =>
      live
        .messages<ServerMessage>()
        .some(
          (m) =>
            m.type === 'chat' && m.chat.op === 'message' && m.chat.message.id === report.body.id,
        ),
    );
    // in the lead's inbox, and in her mail
    const inbox = await t.call<{ items: { kind: string; title: string; url: string }[] }>(
      ada,
      'GET',
      W('/inbox'),
    );
    const mention = inbox.body.items.find((i) => i.kind === 'mention');
    expect(mention?.title).toBe('Ines Vogel mentioned you in #helio');
    expect(mention?.url).toBe('/messages/' + shared.body.id);
    for (let i = 0; i < 50; i++) {
      await t.mailer?.round();
      if (smtp.received.some((m) => m.to.includes(ada.email))) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    const mail = smtp.received.find((m) => m.to.includes(ada.email));
    expect(subjectOf(mail?.data ?? '')).toBe('Ines Vogel mentioned you in #helio');
    expect(textOf(mail?.data ?? '')).toContain('the export to PDF is empty');

    // 09:20 the lead answers in the thread, and turns the report into a task
    const answer = await say(
      ada,
      shared.body.id,
      'Thanks Ines, we are on it today.',
      report.body.id,
    );
    expect(answer.status).toBe(201);
    const task = await t.call<{ ref: string; itemId: string }>(
      ada,
      'POST',
      W('/messages/' + report.body.id + '/task'),
      { projectId: project, title: 'PDF export empty for October' },
    );
    expect(task.body.ref).toBe('HEL-1');
    const thread = await t.call<{ root: MessageJson; replies: MessageJson[] }>(
      ines,
      'GET',
      W('/messages/' + report.body.id + '/thread'),
    );
    expect(thread.body.root).toMatchObject({ replyCount: 1, itemId: task.body.itemId });
    expect(thread.body.replies.map((r) => r.body)).toEqual(['Thanks Ines, we are on it today.']);

    // 10:05 a developer asks the lead directly; the client sees none of it
    const dm = await t.call<ChannelJson>(bob, 'POST', W('/direct'), { userIds: [ada.id] });
    const question = await say(bob, dm.body.id, 'Is HEL-1 for today or can it wait until Monday?');
    expect(question.status).toBe(201);
    expect((await t.call(ines, 'GET', W('/channels/' + dm.body.id + '/messages'))).status).toBe(
      404,
    );
    expect((await t.call<MessageJson[]>(ines, 'GET', W('/messages/search?q=Monday'))).body).toEqual(
      [],
    );
    expect((await t.call(ines, 'POST', W('/direct'), { userIds: [ada.id] })).status).toBe(403);

    // the lead's view at the end of the morning: the direct message waits for her
    const channels = (await t.call<ChannelJson[]>(ada, 'GET', W('/channels'))).body;
    expect(channels.find((c) => c.id === dm.body.id)?.unread).toBe(1);

    // nothing of the conversations entered the activity feed
    const events = await inSystem(t.db.pool, (c) =>
      c.query(
        "SELECT 1 FROM activity_events WHERE workspace_id = $1 AND envelope::text LIKE '%export to PDF is empty%'",
        [ada.workspaceId],
      ),
    );
    expect(events.rowCount).toBe(0);
  });
});
