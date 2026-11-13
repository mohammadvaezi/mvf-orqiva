// ── [PCODE-349 | S15 | v0.1.0] T35.2b Slack and Teams bridges, personal calendar feed, CI pipeline runs ──
//    Why:  against the real database and a stand-in chat server: a bridge takes only a real Slack address,
//          then posts the chosen topics and a channel's messages once each, keeps its place when the chat
//          fails and catches up after; a person's calendar link gives their dates without sign-in and stops
//          when renewed; and CI runs report, name their tasks from the branch and fail once as an event.
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seal } from '../../src/agents/secrets.js';
import { inSystem } from '../../src/db/pool.js';
import { bridgeRound } from '../../src/integrations/bridges.js';
import { listenFetchable, startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

process.env['ORQIVA_SECRET_KEY'] = '5b'.repeat(32);

describe.skipIf(!hasDatabase)('bridges, calendar and CI (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let bob: Person;
  let project = '';
  let channel = '';
  let bridge = '';
  let failing = false;
  const posts: { text?: string }[] = [];
  const chat = createServer((req: IncomingMessage, res) => {
    let b = '';
    req.on('data', (d: Buffer) => (b += d.toString()));
    req.on('end', () => {
      if (failing) {
        res.writeHead(500).end();
        return;
      }
      posts.push(JSON.parse(b) as { text?: string });
      res.writeHead(200).end('ok');
    });
  });
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  const sys = (sql: string, args: unknown[] = []) => inSystem(t.db.pool, (c) => c.query(sql, args));
  const round = () =>
    bridgeRound(t.db.pool, { allowPrivate: true, publicUrl: 'https://orqiva.example.test' });

  beforeAll(async () => {
    await listenFetchable(chat);
    t = await startTestApp();
    ada = await t.signup('Ada');
    bob = await t.signup('Bob');
    await t.call(ada, 'POST', W('/members'), { email: bob.email, role: 'member' });
    project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'APP', name: 'The App' })
    ).body.id;
    channel = (await t.call<{ id: string }>(ada, 'POST', W('/channels'), { name: 'releases' })).body
      .id;
  }, 60_000);

  afterAll(async () => {
    await t.stop();
    await new Promise<void>((r) => {
      chat.close(() => {
        r();
      });
    });
  });

  it('takes only a real Slack address, and posts the chosen topics and the channel once', async () => {
    const add = (url: string) =>
      t.call<{ id: string }>(ada, 'POST', W('/chat-bridges'), {
        kind: 'slack',
        name: '#ops',
        url,
        topics: ['incidents'],
        channelId: channel,
      });
    expect((await add('https://example.test/hook')).status).toBe(400);
    expect(
      (
        await t.call(bob, 'POST', W('/chat-bridges'), {
          kind: 'slack',
          name: 'x',
          url: 'https://hooks.slack.com/services/T0/B0/x',
          topics: ['incidents'],
        })
      ).status,
    ).toBe(403);
    // events before the bridge are not posted
    await t.call(ada, 'POST', W('/incidents'), { title: 'Old trouble', severity: 'sev3' });
    const made = await add('https://hooks.slack.com/services/T0/B0/abc');
    expect(made.status).toBe(201);
    bridge = made.body.id;
    // the stand-in chat server takes the place of Slack
    const local = 'http://127.0.0.1:' + String((chat.address() as AddressInfo).port) + '/hook';
    await sys('UPDATE chat_bridges SET url_ciphertext = $2 WHERE id = $1', [bridge, seal(local)]);
    await t.call(ada, 'POST', W('/incidents'), {
      title: 'Booking API down',
      severity: 'sev1',
      projectId: project,
    });
    await t.call(ada, 'POST', W('/projects/' + project + '/items'), { title: 'Not a topic' });
    await t.call(bob, 'POST', W('/channels/' + channel + '/messages'), {
      body: 'Release 1.2 is out',
    });
    expect(await round()).toBe(2);
    expect(posts.map((p) => p.text?.split('\n')[0])).toEqual([
      expect.stringContaining('Booking API down'),
      '*Bob in #releases*',
    ]);
    expect(posts[1]?.text).toContain('Release 1.2 is out');
    expect(await round()).toBe(0);
  });

  it('keeps its place when the chat fails, and catches up after', async () => {
    failing = true;
    await t.call(ada, 'POST', W('/incidents'), { title: 'Payments slow', severity: 'sev2' });
    expect(await round()).toBe(0);
    const b = (
      await t.call<{ bridges: { lastError: string; active: boolean }[] }>(
        ada,
        'GET',
        W('/chat-bridges'),
      )
    ).body.bridges[0];
    expect(b).toMatchObject({ lastError: 'the chat answered 500', active: true });
    failing = false;
    expect(await round()).toBe(1);
    expect(posts.at(-1)?.text).toContain('Payments slow');
    const test = await t.call<{ ok: boolean }>(ada, 'POST', W('/chat-bridges/' + bridge + '/test'));
    expect(test.body.ok).toBe(false); // the stand-in is on localhost: the test route checks for a public address
  });

  it('gives a person their dates from a secret link', async () => {
    await t.call(ada, 'POST', W('/projects/' + project + '/items'), {
      title: 'Ship the login',
      assigneeId: bob.id,
      dueDate: '2026-12-01',
    });
    await sys(
      "INSERT INTO absences (workspace_id, user_id, starts_on, ends_on, kind, state) VALUES ($1, $2, '2026-12-21', '2026-12-23', 'holiday', 'approved')",
      [ada.workspaceId, bob.id],
    );
    const { url } = (await t.call<{ url: string }>(bob, 'POST', W('/calendar-feed'))).body;
    const path = new URL(url, 'http://x').pathname;
    expect(path).toMatch(/^\/calendar\/[0-9a-f]{40}\.ics$/);
    const r = await fetch(t.base + path);
    expect(r.headers.get('content-type')).toContain('text/calendar');
    const ics = await r.text();
    expect(ics).toContain('SUMMARY:Due: APP-');
    expect(ics).toContain('Ship the login');
    expect(ics).toContain('DTSTART;VALUE=DATE:20261221');
    expect(ics).toContain('DTEND;VALUE=DATE:20261224');
    expect(
      (await t.call<{ readAt: string | null }>(bob, 'GET', W('/calendar-feed'))).body.readAt,
    ).not.toBeNull();
    await t.call(bob, 'POST', W('/calendar-feed'));
    expect((await fetch(t.base + path)).status).toBe(404);
  });

  it('records CI runs, names their tasks, and fails once as an event', async () => {
    const send = (status: string) =>
      t.call<{ itemRefs: string[] }>(ada, 'POST', W('/projects/' + project + '/ci-runs'), {
        externalId: 'gh-1001',
        pipeline: 'build',
        status,
        branch: 'feature/APP-1-login',
        sha: 'abcdef1',
        url: 'https://ci.example.test/1001',
      });
    expect((await send('running')).body.itemRefs).toEqual(['APP-1']);
    await send('failed');
    await send('failed');
    const events = await sys(
      "SELECT 1 FROM activity_events WHERE workspace_id = $1 AND object_type = 'ci_run'",
      [ada.workspaceId],
    );
    expect(events.rowCount).toBe(1);
    const runs = (
      await t.call<{ runs: { status: string; finishedAt: string | null }[] }>(
        ada,
        'GET',
        W('/projects/' + project + '/ci-runs'),
      )
    ).body.runs;
    expect(runs).toEqual([expect.objectContaining({ status: 'failed' })]);
    expect(runs[0]?.finishedAt).not.toBeNull();
  });
});
