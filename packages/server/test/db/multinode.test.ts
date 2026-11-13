// ── [PCODE-214 | S15 | v0.1.0] T19.3 Several server nodes (events, presence and migrations across nodes) and a Helm chart ──
//    Why:  Orqiva on several nodes against one database, the way the Helm chart runs it: a change made
//          through one node reaches live screens connected to the other within a second, presence crosses
//          nodes, and a node that starts on a database another node migrated runs no migration again.
import type { ServerMessage } from '@orqiva/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RawWsClient } from '../wsclient.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

describe.skipIf(!hasDatabase)('several server nodes (PostgreSQL)', () => {
  let a: TestApp;
  let b: TestApp;
  let ada: Person;
  let bob: Person;
  let project = '';
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  const watch = async (node: TestApp, who: Person): Promise<RawWsClient> => {
    const c = await RawWsClient.open(node.port, { cookie: who.cookie });
    c.sendJson({ type: 'subscribe', workspaceId: ada.workspaceId });
    await c.until(() => c.messages<ServerMessage>().some((m) => m.type === 'subscribed'));
    return c;
  };

  beforeAll(async () => {
    a = await startTestApp({ live: true });
    // node B on node A's database: its migrations find everything done
    b = await startTestApp({ live: true, db: a.db });
    ada = await a.signup('Ada');
    bob = await b.signup('Bob');
    await a.call(ada, 'POST', W('/members'), { email: bob.email, role: 'member' });
    project = (
      await b.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'MN', name: 'Multi node' })
    ).body.id;
  }, 60_000);

  afterAll(async () => {
    await b.stop();
    await a.stop();
  });

  it('migrated the database once', async () => {
    const r = await a.db.pool.query<{ n: string; d: string }>(
      'SELECT count(*) AS n, count(DISTINCT version) AS d FROM schema_migrations',
    );
    expect(r.rows[0]?.n).toBe(r.rows[0]?.d);
  });

  it('brings a change made through one node to screens on the other', async () => {
    const onA = await watch(a, ada);
    const onB = await watch(b, bob);
    const created = (title: string) => (c: RawWsClient) =>
      c
        .messages<ServerMessage>()
        .some(
          (m) =>
            m.type === 'event' &&
            m.event.type === 'orqiva.item.created' &&
            (m.event.data.object.label ?? '').endsWith(title),
        );
    const t0 = performance.now();
    await a.call(ada, 'POST', W('/projects/' + project + '/items'), { title: 'made on A' });
    await onB.until(() => created('made on A')(onB));
    const aToB = performance.now() - t0;
    const t1 = performance.now();
    await b.call(bob, 'POST', W('/projects/' + project + '/items'), { title: 'made on B' });
    await onA.until(() => created('made on B')(onA));
    const bToA = performance.now() - t1;
    expect(aToB).toBeLessThan(1000);
    expect(bToA).toBeLessThan(1000);
    onA.destroy();
    onB.destroy();
  });

  it('shows who is where across nodes', async () => {
    const onA = await watch(a, ada);
    const onB = await watch(b, bob);
    onA.sendJson({
      type: 'presence',
      workspaceId: ada.workspaceId,
      projectId: project,
      itemId: null,
      state: 'viewing',
    });
    await onB.until(() =>
      onB
        .messages<ServerMessage>()
        .some(
          (m) =>
            m.type === 'presence' &&
            m.people.some((p) => p.userId === ada.id && p.projectId === project),
        ),
    );
    onA.destroy();
    onB.destroy();
  });
});
