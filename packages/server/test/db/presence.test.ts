// ── [PCODE-196 | S15 | v0.1.0] B8.4 VS Code: ideation interview, and presence per file and block (workspace switch, off by default) ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-101 | S15 | v0.1.0] Add presence: heartbeats, avatars on cards, who-is-where ──
import type { PresenceEntry, ServerMessage } from '@orqiva/shared';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { PresenceHub } from '../../src/live/presence.js';
import { RawWsClient } from '../wsclient.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { createTestDb, hasDatabase, type TestDb } from './testdb.js';

/** The latest presence snapshot a client received for a workspace. */
const latest = (c: RawWsClient): PresenceEntry[] | null => {
  const all = c.messages<ServerMessage>().flatMap((m) => (m.type === 'presence' ? [m.people] : []));
  return all.at(-1) ?? null;
};
const where = (c: RawWsClient): string[] =>
  (latest(c) ?? [])
    .map((p) => p.name + '@' + (p.itemId ?? p.projectId ?? 'workspace') + ':' + p.state)
    .sort();

describe.skipIf(!hasDatabase)('presence between people (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let bob: Person;
  let gus: Person;
  let ws = '';
  let app = '';
  let ops = '';
  let item1 = '';
  let item2 = '';
  const clients: RawWsClient[] = [];
  const W = (p: string): string => '/api/workspaces/' + ws + p;

  const connect = async (who: Person): Promise<RawWsClient> => {
    const c = await RawWsClient.open(t.port, { cookie: who.cookie });
    clients.push(c);
    c.sendJson({ type: 'subscribe', workspaceId: ws });
    await c.until(() => c.messages<ServerMessage>().some((m) => m.type === 'subscribed'));
    return c;
  };
  const at = (
    c: RawWsClient,
    projectId: string | null,
    itemId: string | null,
    state: 'viewing' | 'editing' = 'viewing',
  ): void => {
    c.sendJson({ type: 'presence', workspaceId: ws, projectId, itemId, state });
  };

  beforeAll(async () => {
    t = await startTestApp({ live: true });
    ada = await t.signup('Ada');
    bob = await t.signup('Bob');
    gus = await t.signup('Gus');
    ws = ada.workspaceId;
    await t.call(ada, 'POST', W('/members'), { email: bob.email, role: 'member' });
    await t.call(ada, 'POST', W('/members'), { email: gus.email, role: 'guest' });
    app = (await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'APP', name: 'App' }))
      .body.id;
    ops = (await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'OPS', name: 'Ops' }))
      .body.id;
    await t.call(ada, 'POST', W('/projects/' + app + '/guests'), { userId: gus.id });
    item1 = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects/' + app + '/items'), { title: 'One' })
    ).body.id;
    item2 = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects/' + app + '/items'), { title: 'Two' })
    ).body.id;
  }, 60_000);

  // every test starts with nobody connected: leftover connections would still be present
  afterEach(async () => {
    for (const c of clients.splice(0)) c.destroy();
    await new Promise((r) => setTimeout(r, 100));
  });

  afterAll(async () => {
    await t.stop();
  });

  it('shows two people each other moving between tasks, live', async () => {
    const a = await connect(ada);
    const b = await connect(bob);
    at(a, app, item1);
    at(b, app, item1);
    await a.until(() => where(a).includes('Bob@' + item1 + ':viewing'));
    await b.until(() => where(b).includes('Ada@' + item1 + ':viewing'));
    at(b, app, item2, 'editing');
    await a.until(() => where(a).includes('Bob@' + item2 + ':editing'));
    expect(where(a)).toEqual(['Ada@' + item1 + ':viewing', 'Bob@' + item2 + ':editing'].sort());
  });

  // [PCODE-230 | S15 | v0.1.0] the manager on the phone, the developer on the web, on the same task
  it('tells the web who is there from the phone, and the phone who is there from the web', async () => {
    const web = await connect(bob);
    const phone = await connect(ada);
    at(web, app, item1);
    phone.sendJson({
      type: 'presence',
      workspaceId: ws,
      projectId: app,
      itemId: item1,
      state: 'viewing',
      device: 'phone',
    });
    await web.until(() =>
      (latest(web) ?? []).some(
        (p) => p.name === 'Ada' && p.itemId === item1 && p.device === 'phone',
      ),
    );
    await phone.until(() =>
      (latest(phone) ?? []).some((p) => p.name === 'Bob' && p.itemId === item1 && !p.device),
    );
  });

  it('keeps when someone arrived when only the heartbeat repeats', async () => {
    const a = await connect(ada);
    at(a, app, item1);
    await a.until(() => (latest(a) ?? []).some((p) => p.name === 'Ada' && p.itemId === item1));
    const since = (latest(a) ?? []).find((p) => p.name === 'Ada')?.since;
    at(a, app, item1);
    await new Promise((r) => setTimeout(r, 150));
    expect((latest(a) ?? []).find((p) => p.name === 'Ada')?.since).toBe(since);
  });

  it('shows a guest only the people on their projects, and refuses their report from another project', async () => {
    const g = await connect(gus);
    const b = await connect(bob);
    at(b, ops, null);
    at(g, ops, null);
    await new Promise((r) => setTimeout(r, 200));
    expect(where(g).filter((x) => x.startsWith('Bob'))).toEqual([]);
    expect((latest(b) ?? []).some((p) => p.name === 'Gus')).toBe(false);
    at(b, app, item2);
    await g.until(() => where(g).includes('Bob@' + item2 + ':viewing'));
  });

  it('removes someone the moment their connection closes', async () => {
    const watcher = await connect(ada);
    const leaving = await connect(bob);
    at(leaving, app, item1, 'editing');
    await watcher.until(() =>
      (latest(watcher) ?? []).some((p) => p.name === 'Bob' && p.state === 'editing'),
    );
    leaving.destroy();
    await watcher.until(() => !(latest(watcher) ?? []).some((p) => p.name === 'Bob'));
  });

  it('shares nothing once an admin switches presence off', async () => {
    const a = await connect(ada);
    const b = await connect(bob);
    at(b, app, item1);
    await a.until(() => (latest(a) ?? []).some((p) => p.name === 'Bob'));
    const r = await t.call<{ presenceEnabled: boolean }>(ada, 'PATCH', W(''), {
      presenceEnabled: false,
    });
    expect(r.body.presenceEnabled).toBe(false);
    await a.until(() => (latest(a) ?? ['x']).length === 0);
    at(b, app, item2);
    await new Promise((r2) => setTimeout(r2, 200));
    expect(latest(a)).toEqual([]);
    await t.call(ada, 'PATCH', W(''), { presenceEnabled: true });
  });

  // [PCODE-196 | S15 | v0.1.0] the file: only once an admin shares files, never to a guest, never a bad path
  it('names the file only when the workspace shares files, and never to a guest', async () => {
    const a = await connect(ada);
    const b = await connect(bob);
    const g = await connect(gus);
    const inFile = (file: string): void => {
      b.sendJson({
        type: 'presence',
        workspaceId: ws,
        projectId: app,
        itemId: item1,
        state: 'editing',
        file,
      });
    };
    const bobOf = (c: RawWsClient): PresenceEntry | undefined =>
      (latest(c) ?? []).find((p) => p.name === 'Bob');
    inFile('src/a.ts');
    await a.until(() => bobOf(a)?.itemId === item1);
    expect(bobOf(a)?.file).toBeUndefined();
    const r = await t.call<{ presenceFiles: boolean }>(ada, 'PATCH', W(''), {
      presenceFiles: true,
    });
    expect(r.body.presenceFiles).toBe(true);
    // the switch reaches each connection with the workspace's event
    const switched = (c: RawWsClient): boolean =>
      c
        .messages<ServerMessage>()
        .some((m) => m.type === 'event' && m.event.data.changes?.['presenceFiles'] !== undefined);
    await a.until(() => switched(a));
    await b.until(() => switched(b));
    inFile('src/b.ts');
    await a.until(() => bobOf(a)?.file === 'src/b.ts');
    await g.until(() => bobOf(g)?.itemId === item1);
    expect(bobOf(g)?.file).toBeUndefined();
    inFile('../etc/passwd');
    await new Promise((r2) => setTimeout(r2, 200));
    expect(bobOf(a)?.file).toBe('src/b.ts');
    await t.call(ada, 'PATCH', W(''), { presenceFiles: false });
    await a.until(() => bobOf(a) !== undefined && bobOf(a)?.file === undefined);
  }, 20_000);
});

describe.skipIf(!hasDatabase)('presence hub across nodes (PostgreSQL)', () => {
  let db: TestDb;
  const hubs: PresenceHub[] = [];
  const entry = (name: string, itemId: string | null): PresenceEntry => ({
    userId: name,
    name,
    kind: 'user',
    projectId: 'p',
    itemId,
    state: 'viewing',
    since: new Date().toISOString(),
  });

  beforeAll(async () => {
    db = await createTestDb();
  }, 60_000);
  afterAll(async () => {
    await Promise.all(hubs.map((h) => h.stop()));
    await db.drop();
  });
  const hub = async (now?: () => number): Promise<PresenceHub> => {
    const h = new PresenceHub({ connectionString: db.url, debounceMs: 5, ...(now ? { now } : {}) });
    await h.start();
    hubs.push(h);
    return h;
  };
  const until = async (cond: () => boolean): Promise<void> => {
    const end = Date.now() + 5000;
    while (!cond()) {
      if (Date.now() > end) throw new Error('timed out');
      await new Promise((r) => setTimeout(r, 10));
    }
  };

  it('shares a report with the other node, and tells a node that starts later', async () => {
    const n1 = await hub();
    const n2 = await hub();
    n1.set('ws', 'conn-a', entry('Ada', 'i1'));
    await until(() => n2.people('ws').some((p) => p.name === 'Ada'));
    const n3 = await hub();
    await until(() => n3.people('ws').some((p) => p.name === 'Ada'));
    n1.leave('ws', 'conn-a');
    await until(() => n2.people('ws').length === 0 && n3.people('ws').length === 0);
  });

  it('expires an entry whose heartbeat stopped', async () => {
    let now = Date.now();
    const h = await hub(() => now);
    h.set('ws2', 'conn-b', entry('Bob', 'i2'));
    expect(h.people('ws2')).toHaveLength(1);
    now += 46_000;
    h.expire();
    expect(h.people('ws2')).toEqual([]);
  });
});
