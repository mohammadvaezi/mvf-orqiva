// ── [PCODE-413 | S15 | v0.1.0] T37 high: Activity facets answer under 1 s ──
// ── [PCODE-412 | S15 | v0.1.0] T37 high: Activity takes 10 000 events per second ──
// ── [PCODE-365 | S15 | v0.1.0] T36.1 Test suite stability ──
// ── [PCODE-355 | S15 | v0.1.0] T35.4c Activity: query autocomplete, columns, group-by, drag to zoom, heat map ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-183 | S15 | v0.1.0] B6.1 Activity at scale live: search, query language, facets, histogram, saved views, export, archive, hash chain, webhooks ──
//    Why:  Activity at scale against the real database: the query language with facets, paging and a
//          guest's narrower view; the story of an object; saved views; exports; the hash chain that shows a
//          changed event; the archive tier; and webhooks that deliver signed batches and back off on errors.
import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seal } from '../../src/agents/secrets.js';
import { archiveOld, deliverOne, signBody } from '../../src/activity/worker.js';
import { inSystem } from '../../src/db/pool.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';
import { listenFetchable } from '../ports.js'; // [PCODE-365 | S15 | v0.1.0]
import { recordEvents } from '../../src/events/outbox.js'; // [PCODE-412 | S15 | v0.1.0]

process.env['ORQIVA_SECRET_KEY'] = 'ab'.repeat(32);

describe.skipIf(!hasDatabase)('activity at scale (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let gus: Person;
  let app = '';
  let ops = '';
  let item = '';
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  type Ev = {
    event: { id: string; type: string; data: { verb: string; object: { label?: string } } };
  };
  type Search = {
    events: Ev[];
    next: string | null;
    total: number;
    facets: Record<string, { key: string; count: number }[]>;
    histogram: { bins: number[] };
    heat: number[][]; // [PCODE-355 | S15 | v0.1.0]
    timeZone: string;
  };
  const search = (who: Person, q: string, extra = '') =>
    t.call<Search>(who, 'GET', W('/activity/search?q=' + encodeURIComponent(q) + extra));

  beforeAll(async () => {
    t = await startTestApp();
    ada = await t.signup('Ada');
    gus = await t.signup('Gus');
    await t.call(ada, 'POST', W('/members'), { email: gus.email, role: 'guest' });
    app = (await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'APP', name: 'App' }))
      .body.id;
    ops = (await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'OPS', name: 'Ops' }))
      .body.id;
    await t.call(ada, 'POST', W('/projects/' + app + '/guests'), { userId: gus.id });
    item = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects/' + app + '/items'), {
        title: 'Live tracking map',
      })
    ).body.id;
    await t.call(ada, 'POST', W('/projects/' + app + '/items'), { title: 'Export tours' });
    await t.call(ada, 'POST', W('/projects/' + ops + '/items'), { title: 'Rotate certificates' });
    await t.call(ada, 'POST', W('/items/' + item + '/comments'), { body: 'Looks good' });
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('finds events by the query language, with facets, a histogram and pages', async () => {
    const items = await search(ada, 'project:APP type:item');
    expect(items.body.total).toBe(2);
    expect(items.body.facets['project']).toEqual([{ key: 'APP', count: 2 }]);
    expect(items.body.histogram.bins.reduce((a, b) => a + b, 0)).toBe(2);
    // [PCODE-355 | S15 | v0.1.0] the same events by weekday and hour
    expect(items.body.heat).toHaveLength(7);
    expect(items.body.heat.every((d) => d.length === 24)).toBe(true);
    expect(items.body.heat.flat().reduce((a, b) => a + b, 0)).toBe(2);
    expect(items.body.timeZone).toBe('Europe/Berlin');
    expect(
      (await search(ada, 'track')).body.events.map((e) => e.event.data.object.label),
    ).toContain('APP-1 Live tracking map');
    expect((await search(ada, 'type:item -project:app')).body.total).toBe(1);
    expect((await search(ada, 'actor:agent')).body.total).toBe(0);
    expect((await search(ada, 'colour:red')).status).toBe(400);
    const first = await search(ada, '', '&limit=2');
    expect(first.body.events).toHaveLength(2);
    const second = await search(
      ada,
      '',
      '&limit=2&cursor=' + encodeURIComponent(first.body.next ?? ''),
    );
    expect(second.body.events.map((e) => e.event.id)).not.toContain(first.body.events[0]?.event.id);
    expect((await search(gus, 'project:OPS')).body.total).toBe(0);
    expect((await search(gus, 'type:item')).body.total).toBe(2);
  });

  // [PCODE-413 | S15 | v0.1.0]
  it('counts the same from the hourly rows as from the events', async () => {
    for (const q of ['', 'type:item', 'actor:user -verb:moved']) {
      // the hourly rows alone, the hourly rows with the edges of a window, and the events alone
      const fast = (await search(ada, q)).body;
      const window = (await search(ada, (q + ' since:2w').trim())).body;
      const slow = (await search(ada, (q + ' since:30m').trim())).body;
      expect([q, fast.total, fast.facets]).toEqual([q, slow.total, slow.facets]);
      expect([q, window.total, window.facets]).toEqual([q, slow.total, slow.facets]);
      expect(fast.heat.flat().reduce((x, y) => x + y, 0)).toBe(fast.total);
    }
  });

  it('tells the story of an object and explains a busy stretch', async () => {
    const story = await t.call<Ev[]>(ada, 'GET', W('/activity/story/item/' + item));
    expect(story.body.map((e) => e.event.type)).toEqual([
      'orqiva.item.created',
      'orqiva.comment.commented',
    ]);
    const why = await t.call<{ sentence: string; total: number }>(
      ada,
      'GET',
      W('/activity/explain?q=type:item'),
    );
    expect(why.body.sentence).toMatch(
      /^Ada made 100 % of the 3 events, most of them item created \(3\)\.$/,
    );
    const one = await t.call<{ hash: string; event: { id: string } }>(
      ada,
      'GET',
      W('/activity/events/' + (story.body[0]?.event.id ?? '')),
    );
    expect(one.body.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('keeps saved views, mine or shared', async () => {
    expect(
      (await t.call(ada, 'POST', W('/activity/views'), { name: 'Bad', query: 'colour:red' }))
        .status,
    ).toBe(400);
    await t.call(ada, 'POST', W('/activity/views'), {
      name: 'App tasks',
      query: 'project:APP type:item',
      shared: true,
    });
    await t.call(ada, 'POST', W('/activity/views'), { name: 'Private', query: 'verb:created' });
    expect(
      (await t.call<{ name: string }[]>(gus, 'GET', W('/activity/views'))).body.map((v) => v.name),
    ).toEqual(['App tasks']);
  });

  it('exports any query as CSV or JSON and logs it', async () => {
    const csv = await fetch(
      t.base + W('/activity/export?format=csv&q=' + encodeURIComponent('project:APP')),
      { headers: { cookie: ada.cookie } },
    );
    expect(csv.headers.get('content-type')).toContain('text/csv');
    const text = await csv.text();
    expect(text.split('\r\n')[0]).toBe(
      '"time","actor","actor kind","verb","object type","object","parent","project","event id"',
    );
    expect(text).toContain('"APP-1 Live tracking map"');
    const json = await fetch(t.base + W('/activity/export?format=json&q=type:comment'), {
      headers: { cookie: ada.cookie },
    });
    expect(((await json.json()) as unknown[]).length).toBe(1);
    expect((await t.call(gus, 'GET', W('/activity/export?format=csv'))).status).toBe(403);
  });

  // [PCODE-412 | S15 | v0.1.0]
  it('keeps the chain and the numbers when events go in as a batch', async () => {
    const before = (await t.call<{ checked: number }>(ada, 'GET', W('/activity/verify'))).body
      .checked;
    const made = await inSystem(t.db.pool, (c) =>
      recordEvents(
        c,
        ada.workspaceId,
        ['one', 'two', 'three'].map((label) => ({
          data: {
            actor: { kind: 'user', id: ada.id, name: 'Ada' },
            verb: 'created',
            object: { type: 'item', id: label, label },
          },
        })),
      ),
    );
    expect(made[1]?.sequence).toBe((made[0]?.sequence ?? 0) + 1);
    const after = (
      await t.call<{ intact: boolean; checked: number }>(ada, 'GET', W('/activity/verify'))
    ).body;
    expect(after).toMatchObject({ intact: true, checked: before + 3 });
  });

  it('shows a changed event in the audit chain', async () => {
    expect(
      (await t.call<{ intact: boolean; checked: number }>(ada, 'GET', W('/activity/verify'))).body,
    ).toMatchObject({ intact: true });
    const seq = await inSystem(
      t.db.pool,
      async (c) =>
        (
          await c.query<{ sequence: string }>(
            "UPDATE activity_events SET envelope = jsonb_set(envelope, '{data,verb}', '\"deleted\"') WHERE workspace_id = $1 AND sequence = 3 RETURNING sequence",
            [ada.workspaceId],
          )
        ).rows[0]?.sequence,
    );
    const broken = await t.call<{ intact: boolean; firstBreak: number }>(
      ada,
      'GET',
      W('/activity/verify'),
    );
    expect(broken.body).toEqual(
      expect.objectContaining({ intact: false, firstBreak: Number(seq) }),
    );
    await inSystem(t.db.pool, (c) =>
      c.query(
        "UPDATE activity_events SET envelope = jsonb_set(envelope, '{data,verb}', '\"created\"') WHERE workspace_id = $1 AND sequence = 3",
        [ada.workspaceId],
      ),
    );
    expect((await t.call<{ intact: boolean }>(ada, 'GET', W('/activity/verify'))).body.intact).toBe(
      true,
    );
  });

  it('moves old events to the archive, which a search can include', async () => {
    await t.call(ada, 'PUT', W('/activity/settings'), { retentionDays: 7 });
    await inSystem(t.db.pool, (c) =>
      c.query(
        "UPDATE activity_events SET time = time - interval '30 days' WHERE workspace_id = $1 AND object_type = 'project'",
        [ada.workspaceId],
      ),
    );
    // [PCODE-413 | S15 | v0.1.0] and their hourly counts with them, as if they had happened then
    await inSystem(t.db.pool, (c) =>
      c.query(
        "UPDATE activity_rollup SET hour = hour - interval '30 days' WHERE workspace_id = $1 AND object_type = 'project'",
        [ada.workspaceId],
      ),
    );
    expect(await archiveOld(t.db.pool, ada.workspaceId)).toBe(2);
    const settings = await t.call<{ archived: number }>(ada, 'GET', W('/activity/settings'));
    expect(settings.body.archived).toBe(2);
    expect((await search(ada, 'type:project')).body.total).toBe(0);
    expect((await search(ada, 'type:project in:archive')).body.total).toBe(2);
    expect((await t.call<{ intact: boolean }>(ada, 'GET', W('/activity/verify'))).body.intact).toBe(
      true,
    );
    await t.call(ada, 'POST', W('/projects/' + app + '/items'), { title: 'After the archive' });
    expect((await t.call<{ intact: boolean }>(ada, 'GET', W('/activity/verify'))).body.intact).toBe(
      true,
    );
  });

  it('delivers signed batches to a webhook and backs off on errors', async () => {
    expect(
      (await t.call(ada, 'POST', W('/webhooks'), { name: 'Local', url: 'http://localhost:9/x' }))
        .status,
    ).toBe(400);
    const got: { body: string; sig: string }[] = [];
    let answer = 200;
    const server: Server = createServer((req, res) => {
      let body = '';
      req.on('data', (d: Buffer) => (body += d.toString()));
      req.on('end', () => {
        got.push({ body, sig: String(req.headers['x-orqiva-signature']) });
        res.statusCode = answer;
        res.end();
      });
    });
    await listenFetchable(server); // [PCODE-365 | S15 | v0.1.0]
    const port = (server.address() as { port: number }).port;
    const hook = await inSystem(
      t.db.pool,
      async (c) =>
        (
          await c.query<{
            id: string;
            workspace_id: string;
            url: string;
            secret_ciphertext: string;
            event_types: string[];
            query: string;
            cursor: string;
            failures: number;
          }>(
            "INSERT INTO webhooks (workspace_id, name, url, secret_ciphertext, event_types, query, cursor) VALUES ($1, 'SIEM', $2, $3, '{item}', 'project:APP', 0) RETURNING *",
            [ada.workspaceId, 'http://127.0.0.1:' + String(port) + '/hook', seal('whsec_test')],
          )
        ).rows[0],
    );
    if (!hook) throw new Error('no hook');
    expect(await deliverOne(t.db.pool, hook, { allowPrivate: true })).toBe(true);
    const sent = JSON.parse(got[0]?.body ?? '{}') as { events: { type: string }[] };
    expect(sent.events.map((e) => e.type)).toEqual([
      'orqiva.item.created',
      'orqiva.item.created',
      'orqiva.item.created',
    ]);
    expect(got[0]?.sig).toBe(signBody('whsec_test', got[0]?.body ?? ''));
    const after = await inSystem(
      t.db.pool,
      async (c) =>
        (await c.query<{ cursor: string }>('SELECT cursor FROM webhooks WHERE id = $1', [hook.id]))
          .rows[0],
    );
    expect(
      await deliverOne(
        t.db.pool,
        { ...hook, cursor: after?.cursor ?? '0' },
        { allowPrivate: true },
      ),
    ).toBe(false);
    await t.call(ada, 'POST', W('/projects/' + app + '/items'), { title: 'One more' });
    answer = 500;
    expect(
      await deliverOne(
        t.db.pool,
        { ...hook, cursor: after?.cursor ?? '0' },
        { allowPrivate: true },
      ),
    ).toBe(false);
    const list = await t.call<
      { failures: number; lastDelivery: { status: string; error: string } }[]
    >(ada, 'GET', W('/webhooks'));
    expect(list.body[0]).toMatchObject({
      failures: 1,
      lastDelivery: { status: 'failed', error: 'answered 500' },
    });
    await new Promise<void>((r) =>
      server.close(() => {
        r();
      }),
    );
  });
});
