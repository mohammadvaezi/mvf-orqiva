// ── [PCODE-234 | S15 | v0.1.0] T23.1 Messaging core on the server: channels, direct messages, threads, mentions, live delivery ──
//    Why:  the T23.1 exit: people talk in a channel, a thread and a direct message, live; whoever may not
//          see a conversation gets nothing of it, not in a list, not by id, not live. A client contact sees
//          only their client's channel. A mention or a direct message reaches the inbox; a message becomes a
//          task.
import type { ChannelJson, MessageJson, ServerMessage } from '@orqiva/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';
import { RawWsClient } from '../wsclient.js';

describe.skipIf(!hasDatabase)('messages (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let bob: Person;
  let eve: Person;
  let gus: Person;
  let ines: Person;
  let project = '';
  let client = '';
  const sockets: RawWsClient[] = [];
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  const channels = async (who: Person) =>
    (await t.call<ChannelJson[]>(who, 'GET', W('/channels'))).body;
  const say = (who: Person, channel: string, body: string, parentId?: string) =>
    t.call<MessageJson>(who, 'POST', W('/channels/' + channel + '/messages'), {
      body,
      ...(parentId ? { parentId } : {}),
    });
  const live = async (who: Person): Promise<RawWsClient> => {
    const c = await RawWsClient.open(t.port, { cookie: who.cookie });
    sockets.push(c);
    c.sendJson({ type: 'subscribe', workspaceId: ada.workspaceId });
    await c.until(() => c.messages<ServerMessage>().some((m) => m.type === 'subscribed'));
    return c;
  };
  const chats = (c: RawWsClient) =>
    c.messages<ServerMessage>().flatMap((m) => (m.type === 'chat' ? [m.chat] : []));
  const inbox = async (who: Person) =>
    (
      await t.call<{ items: { kind: string; title: string; objectId: string }[] }>(
        who,
        'GET',
        W('/inbox'),
      )
    ).body.items;

  async function contact(clientId: string, email: string): Promise<Person> {
    const r = await t.call<{ invitation: { token: string } | null }>(
      ada,
      'POST',
      W('/clients/' + clientId + '/contacts'),
      { email, portalRole: 'approver' },
    );
    const res = await fetch(
      t.base + '/auth/invitations/' + (r.body.invitation?.token ?? '') + '/accept',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Ines', password: 'a client password 1' }),
      },
    );
    const p: Person = {
      id: '',
      email,
      name: 'Ines',
      cookie: (res.headers.get('set-cookie') ?? '').split(';')[0] ?? '',
      workspaceId: ada.workspaceId,
    };
    p.id = (await t.call<{ user: { id: string } }>(p, 'GET', '/auth/me')).body.user.id;
    return p;
  }

  beforeAll(async () => {
    t = await startTestApp({ live: true });
    ada = await t.signup('Ada');
    bob = await t.signup('Bob');
    eve = await t.signup('Eve');
    gus = await t.signup('Gus');
    for (const p of [bob, eve])
      await t.call(ada, 'POST', W('/members'), { email: p.email, role: 'member' });
    await t.call(ada, 'POST', W('/members'), { email: gus.email, role: 'guest' });
    project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'APP', name: 'App' })
    ).body.id;
    await t.call(ada, 'POST', W('/projects/' + project + '/guests'), { userId: gus.id });
    client = (await t.call<{ id: string }>(ada, 'POST', W('/clients'), { name: 'Helio' })).body.id;
    ines = await contact(client, 'ines@helio.example');
  }, 60_000);

  afterAll(async () => {
    for (const s of sockets) s.destroy();
    await t.stop();
  });

  it('starts every workspace with #general for its members, not its guests', async () => {
    const mine = await channels(ada);
    expect(mine.map((c) => c.name)).toEqual(['general']);
    expect(mine[0]).toMatchObject({ joined: true, unread: 0 });
    expect((await channels(bob)).map((c) => c.name)).toEqual(['general']);
    expect(await channels(gus)).toEqual([]);
    expect(await channels(ines)).toEqual([]);
  });

  it('talks in a channel and a thread, live; unread counts and mentions follow', async () => {
    const general = (await channels(ada))[0]?.id ?? '';
    const bobLive = await live(bob);
    const first = await say(
      ada,
      general,
      'Morning! Release planning at 10, @bob please bring the list',
    );
    expect(first.status).toBe(201);
    await bobLive.until(() =>
      chats(bobLive).some((c) => c.op === 'message' && c.message.id === first.body.id),
    );
    // Bob has one unread message with a mention, and an inbox entry for it
    const bobs = (await channels(bob))[0];
    expect(bobs).toMatchObject({ unread: 1, mentioned: true });
    expect((await inbox(bob)).some((i) => i.kind === 'mention' && i.title.includes('Ada'))).toBe(
      true,
    );
    // a reply in the thread
    const reply = await say(bob, general, 'On it, here is the draft', first.body.id);
    expect(reply.body.parentId).toBe(first.body.id);
    const th = await t.call<{ root: MessageJson; replies: MessageJson[] }>(
      ada,
      'GET',
      W('/messages/' + first.body.id + '/thread'),
    );
    expect(th.body.root.replyCount).toBe(1);
    expect(th.body.replies.map((r) => r.body)).toEqual(['On it, here is the draft']);
    // Ada was in the thread: she hears about the reply
    expect((await inbox(ada)).some((i) => i.kind === 'message' && i.title.includes('thread'))).toBe(
      true,
    );
    // reading clears the count
    await t.call(bob, 'POST', W('/channels/' + general + '/read'));
    expect((await channels(bob))[0]).toMatchObject({ unread: 0, mentioned: false });
    // reactions, an edit, a delete
    const reacted = await t.call<MessageJson>(
      bob,
      'PUT',
      W('/messages/' + first.body.id + '/reactions/' + encodeURIComponent('👍')),
    );
    expect(reacted.body.reactions).toEqual([{ emoji: '👍', count: 1, mine: true }]);
    expect(
      (
        await t.call(
          bob,
          'PUT',
          W('/messages/' + first.body.id + '/reactions/' + encodeURIComponent('🦄')),
        )
      ).status,
    ).toBe(400);
    expect(
      (await t.call(bob, 'PATCH', W('/messages/' + first.body.id), { body: 'mine now' })).status,
    ).toBe(403);
    const edited = await t.call<MessageJson>(ada, 'PATCH', W('/messages/' + first.body.id), {
      body: 'Morning! Release planning at 11',
    });
    expect(edited.body.editedAt).not.toBeNull();
    await bobLive.until(() =>
      chats(bobLive).some((c) => c.op === 'updated' && c.message.body.endsWith('at 11')),
    );
    const gone = await t.call<MessageJson>(bob, 'DELETE', W('/messages/' + reply.body.id));
    expect(gone.body).toMatchObject({ deleted: true, body: '' });
    // search finds what is left
    const found = await t.call<MessageJson[]>(ada, 'GET', W('/messages/search?q=planning'));
    expect(found.body.map((m) => m.id)).toEqual([first.body.id]);
  });

  it('keeps private channels and direct messages to their people, also live', async () => {
    const eveLive = await live(eve);
    const bobLive = await live(bob);
    const priv = await t.call<ChannelJson>(ada, 'POST', W('/channels'), {
      name: 'Leads Only',
      private: true,
      memberIds: [bob.id],
    });
    expect(priv.body).toMatchObject({ name: 'leads-only', private: true });
    const secret = await say(ada, priv.body.id, 'Budget numbers for Q4');
    await bobLive.until(() =>
      chats(bobLive).some((c) => c.op === 'message' && c.message.id === secret.body.id),
    );
    // Eve sees nothing of it
    expect((await channels(eve)).map((c) => c.name)).not.toContain('leads-only');
    expect((await t.call(eve, 'GET', W('/channels/' + priv.body.id + '/messages'))).status).toBe(
      404,
    );
    expect((await say(eve, priv.body.id, 'let me in')).status).toBe(404);
    expect((await t.call<MessageJson[]>(eve, 'GET', W('/messages/search?q=budget'))).body).toEqual(
      [],
    );
    // a direct message between Ada and Bob, opened twice, is one conversation
    const dm = await t.call<ChannelJson>(ada, 'POST', W('/direct'), { userIds: [bob.id] });
    const again = await t.call<ChannelJson>(bob, 'POST', W('/direct'), { userIds: [ada.id] });
    expect(again.body.id).toBe(dm.body.id);
    expect(dm.body.members.map((m) => m.name).sort()).toEqual(['Ada', 'Bob']);
    const hi = await say(ada, dm.body.id, 'Can you take the release today?');
    await bobLive.until(() =>
      chats(bobLive).some((c) => c.op === 'message' && c.message.id === hi.body.id),
    );
    expect(
      (await inbox(bob)).some((i) => i.kind === 'message' && i.title === 'Ada wrote to you'),
    ).toBe(true);
    await new Promise((r) => setTimeout(r, 300));
    expect(
      chats(eveLive).some(
        (c) =>
          c.op !== 'channel' && (c.message.id === secret.body.id || c.message.id === hi.body.id),
      ),
    ).toBe(false);
    expect((await t.call(eve, 'GET', W('/channels/' + dm.body.id + '/messages'))).status).toBe(404);
    // a guest is not for direct messages
    expect((await t.call(ada, 'POST', W('/direct'), { userIds: [gus.id] })).status).toBe(400);
  });

  it('lets a project’s guest into its channel, and a client’s contact into the client’s channel only', async () => {
    const proj = await t.call<ChannelJson>(ada, 'POST', W('/channels'), {
      name: 'app',
      projectId: project,
    });
    const cli = await t.call<ChannelJson>(ada, 'POST', W('/channels'), {
      name: 'helio',
      clientId: client,
    });
    expect((await channels(gus)).map((c) => c.name)).toEqual(['app']);
    expect((await channels(ines)).map((c) => c.name)).toEqual(['helio']);
    // [PCODE-236 | S15 | v0.1.0] the client's channel is theirs without joining
    expect((await channels(ines))[0]?.joined).toBe(true);
    expect((await say(gus, proj.body.id, 'Guest here')).status).toBe(201);
    expect((await say(ines, cli.body.id, 'Hello from Helio, @ada')).status).toBe(201);
    expect((await say(ines, proj.body.id, 'sneaking in')).status).toBe(404);
    expect((await inbox(ada)).some((i) => i.title.startsWith('Ines mentioned you'))).toBe(true);
    // the general channel is not theirs
    const general = (await channels(ada)).find((c) => c.name === 'general')?.id ?? '';
    expect((await say(ines, general, 'hi all')).status).toBe(404);
  });

  it('turns a message into a task, once', async () => {
    const general = (await channels(ada)).find((c) => c.name === 'general')?.id ?? '';
    const m = await say(bob, general, 'The export button crashes on empty reports');
    const made = await t.call<{ itemId: string; ref: string; message: MessageJson }>(
      ada,
      'POST',
      W('/messages/' + m.body.id + '/task'),
      { projectId: project },
    );
    expect(made.status).toBe(201);
    expect(made.body.ref).toMatch(/^APP-\d+$/);
    expect(made.body.message.itemId).toBe(made.body.itemId);
    const item = await t.call<{ title: string; description: string }>(
      ada,
      'GET',
      W('/items/' + made.body.itemId),
    );
    expect(item.body.title).toBe('The export button crashes on empty reports');
    expect(item.body.description).toContain('#general');
    expect(
      (await t.call(ada, 'POST', W('/messages/' + m.body.id + '/task'), { projectId: project }))
        .status,
    ).toBe(409);
  });

  it('names channels sensibly and refuses doubles', async () => {
    expect((await t.call(ada, 'POST', W('/channels'), { name: '!!!' })).status).toBe(400);
    expect((await t.call(bob, 'POST', W('/channels'), { name: 'General' })).status).toBe(409);
    expect((await t.call(gus, 'POST', W('/channels'), { name: 'guests' })).status).toBe(403);
  });
});
