// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-95 | S15 | v0.1.0] Build our own WebSocket gateway (RFC 6455) with typed protocol and SSE fallback ──
import { request } from 'node:http';
import type { ActivityEvent, ServerMessage } from '@orqiva/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';
import { RawWsClient } from '../wsclient.js';

describe.skipIf(!hasDatabase)('live gateway (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let gus: Person;
  let eve: Person;
  let ws = '';
  let app = '';
  let ops = '';
  const clients: RawWsClient[] = [];
  const W = (path: string): string => '/api/workspaces/' + ws + path;

  const connect = async (who: Person | null, origin?: string): Promise<RawWsClient> => {
    const c = await RawWsClient.open(t.port, {
      ...(who ? { cookie: who.cookie } : {}),
      ...(origin ? { origin } : {}),
    });
    clients.push(c);
    return c;
  };
  const events = (c: RawWsClient): ActivityEvent[] =>
    c.messages<ServerMessage>().flatMap((m) => (m.type === 'event' ? [m.event] : []));
  const subscribed = async (c: RawWsClient, extra: Record<string, unknown> = {}): Promise<void> => {
    const before = c.messages<ServerMessage>().filter((m) => m.type === 'subscribed').length;
    c.sendJson({ type: 'subscribe', workspaceId: ws, ...extra });
    await c.until(
      () => c.messages<ServerMessage>().filter((m) => m.type === 'subscribed').length > before,
    );
  };

  beforeAll(async () => {
    t = await startTestApp({ live: true });
    ada = await t.signup('Ada');
    gus = await t.signup('Gus');
    eve = await t.signup('Eve');
    ws = ada.workspaceId;
    await t.call(ada, 'POST', W('/members'), { email: gus.email, role: 'guest' });
    app = (await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'APP', name: 'App' }))
      .body.id;
    ops = (await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'OPS', name: 'Ops' }))
      .body.id;
    await t.call(ada, 'POST', W('/projects/' + app + '/guests'), { userId: gus.id });
  }, 60_000);

  afterAll(async () => {
    for (const c of clients) c.destroy();
    await t.stop();
  });

  it('refuses a live connection without a session, and from another website', async () => {
    expect((await connect(null)).status).toBe(401);
    expect((await connect(ada, 'https://evil.example')).status).toBe(403);
    expect((await connect(ada, 'https://orqiva.example.test')).status).toBe(101);
  });

  it('welcomes, subscribes, and streams the events of API writes as they commit', async () => {
    const c = await connect(ada);
    await c.until(() => c.messages<ServerMessage>().some((m) => m.type === 'welcome'));
    await subscribed(c);
    await t.call(ada, 'POST', W('/projects/' + app + '/items'), { title: 'Live one' });
    await c.until(() => events(c).some((e) => e.type === 'orqiva.item.created'));
    const e = events(c).find((x) => x.type === 'orqiva.item.created');
    expect(e).toMatchObject({ projectid: app, data: { object: { label: 'APP-1 Live one' } } });
  });

  it('answers a ping and refuses a message it does not understand', async () => {
    const c = await connect(ada);
    c.sendJson({ type: 'ping', id: 'p1' });
    c.sendJson({ type: 'subscribe', workspaceId: 'not-a-uuid' });
    await c.until(() => c.messages<ServerMessage>().some((m) => m.type === 'error'));
    expect(c.messages<ServerMessage>()).toEqual(
      expect.arrayContaining([
        { type: 'pong', id: 'p1' },
        expect.objectContaining({ type: 'error', code: 'invalid_message' }),
      ]),
    );
  });

  it('does not let someone outside the workspace subscribe', async () => {
    const c = await connect(eve);
    c.sendJson({ type: 'subscribe', workspaceId: ws });
    await c.until(() => c.messages<ServerMessage>().some((m) => m.type === 'error'));
    expect(c.messages<ServerMessage>().find((m) => m.type === 'error')).toMatchObject({
      code: 'not_found',
    });
  });

  it('shows a guest only the events of the projects they are invited to', async () => {
    const guest = await connect(gus);
    const member = await connect(ada);
    await subscribed(guest);
    await subscribed(member);
    await t.call(ada, 'POST', W('/projects/' + ops + '/items'), { title: 'Internal ops' });
    await t.call(ada, 'POST', W('/projects/' + app + '/items'), { title: 'Client facing' });
    await member.until(
      () => events(member).filter((e) => e.type === 'orqiva.item.created').length === 2,
    );
    await guest.until(() =>
      events(guest).some((e) => e.data.object.label?.includes('Client facing') === true),
    );
    await new Promise((r) => setTimeout(r, 200));
    expect(events(guest).map((e) => e.projectid)).not.toContain(ops);
  });

  it('filters to one project when asked', async () => {
    const c = await connect(ada);
    await subscribed(c, { projectId: ops });
    await t.call(ada, 'POST', W('/projects/' + app + '/items'), { title: 'Not for this filter' });
    await t.call(ada, 'POST', W('/projects/' + ops + '/items'), { title: 'For this filter' });
    await c.until(() => events(c).length >= 1);
    expect(events(c).every((e) => e.projectid === ops)).toBe(true);
  });

  it('replays the gap to a client that reconnects with its last sequence', async () => {
    const c = await connect(ada);
    await subscribed(c, { after: 3 });
    const seqs = events(c).map((e) => e.sequence);
    expect(seqs[0]).toBe(4);
    expect(seqs).toEqual(seqs.map((_s, i) => 4 + i));
  });

  it('ends a guest’s subscription the moment they are removed', async () => {
    const c = await connect(gus);
    await subscribed(c);
    await t.call(ada, 'DELETE', W('/members/' + gus.id));
    await c.until(() =>
      c
        .messages<ServerMessage>()
        .some((m) => m.type === 'error' && m.message.includes('no longer a member')),
    );
    await t.call(ada, 'POST', W('/projects/' + app + '/items'), { title: 'After removal' });
    await new Promise((r) => setTimeout(r, 300));
    expect(events(c).some((e) => e.data.object.label?.includes('After removal') === true)).toBe(
      false,
    );
  });

  it('delivers the same events over Server-Sent Events, from Last-Event-ID', async () => {
    const text = await new Promise<string>((resolve, reject) => {
      const req = request(
        {
          host: '127.0.0.1',
          port: t.port,
          path: W('/events/stream'),
          headers: { cookie: ada.cookie, 'last-event-id': '2' },
        },
        (res) => {
          expect(res.headers['content-type']).toContain('text/event-stream');
          let body = '';
          res.on('data', (d: Buffer) => {
            body += d.toString();
            if (body.includes('event: subscribed')) {
              req.destroy();
              resolve(body);
            }
          });
        },
      );
      req.on('error', reject);
      req.end();
    });
    const ids = [...text.matchAll(/^id: (\d+)$/gm)].map((m) => Number(m[1]));
    expect(ids[0]).toBe(3);
    expect(ids).toEqual(ids.map((_s, i) => 3 + i));
    expect(text).toContain('event: activity');
  });

  it('refuses the event stream to someone outside the workspace', async () => {
    const res = await fetch(t.base + W('/events/stream'), { headers: { cookie: eve.cookie } });
    expect(res.status).toBe(404);
  });
});
