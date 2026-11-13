// ── [PCODE-262 | S15 | v0.1.0] T27.4 Canvas views: timeline, mind map, portfolio; agents as resources and heat map; scenario diff; commits on bars ──
//    Why:  what the Canvas views read from the server, against PostgreSQL: a scenario's diff task by task
//          with the knock-on moves, an agent loaded in the workload by its tasks, the commits and pull
//          requests of a task for the team and not for a client, and every project on one portfolio axis.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inSystem } from '../../src/db/pool.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

describe.skipIf(!hasDatabase)('canvas views (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let project = '';
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  const P = (p: string): string => W('/projects/' + project + p);
  const add = async (body: Record<string, unknown>): Promise<string> =>
    (await t.call<{ id: string }>(ada, 'POST', P('/items'), body)).body.id;

  beforeAll(async () => {
    t = await startTestApp();
    ada = await t.signup('Ada');
    project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'VUE', name: 'Views' })
    ).body.id;
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('lists what a scenario changes task by task, the knock-on moves included', async () => {
    const a = await add({ title: 'Design', startDate: '2027-02-01', durationDays: 2 });
    const b = await add({ title: 'Build', durationDays: 3 });
    const c = await add({ title: 'Docs', startDate: '2027-02-01', durationDays: 1 });
    await t.call(ada, 'POST', P('/dependencies'), { predecessorId: a, successorId: b });
    const sc = (await t.call<{ id: string }>(ada, 'POST', P('/scenarios'), { name: 'Longer' })).body
      .id;
    await t.call(ada, 'PATCH', W('/scenarios/' + sc), { changes: { [a]: { durationDays: 4 } } });
    const p = await t.call<{
      scenario: {
        diff: {
          itemId: string;
          durationFrom: number;
          durationTo: number;
          startTo: string;
          direct: boolean;
        }[];
      };
    }>(ada, 'GET', P('/plan?scenarioId=' + sc));
    const diff = p.body.scenario.diff;
    expect(diff.map((d) => d.itemId).sort()).toEqual([a, b].sort());
    expect(diff.find((d) => d.itemId === a)).toMatchObject({
      durationFrom: 2,
      durationTo: 4,
      direct: true,
    });
    expect(diff.find((d) => d.itemId === b)).toMatchObject({
      startTo: '2027-02-05',
      direct: false,
    });
    expect(diff.some((d) => d.itemId === c)).toBe(false);
  });

  it('loads an agent by its tasks, several a day', async () => {
    const agent = await inSystem(
      t.db.pool,
      async (cl) =>
        (
          await cl.query<{ id: string }>(
            "INSERT INTO agents (workspace_id, key, name, model) VALUES ($1, 'coder', 'Coder', 'demo') RETURNING id",
            [ada.workspaceId],
          )
        ).rows[0]?.id,
    );
    for (const n of [1, 2, 3, 4])
      await add({
        title: 'Agent job ' + String(n),
        startDate: '2027-03-01',
        durationDays: 1,
        agentId: agent,
      });
    await t.call(ada, 'PUT', W('/settings/planning.agent_parallel_tasks'), {
      scope: 'workspace',
      value: 2,
    });
    const w = await t.call<{
      people: {
        userId: string;
        name: string;
        kind: string;
        tasksPerDay: number;
        days: { date: string; percent: number }[];
      }[];
    }>(ada, 'GET', P('/workload?from=2027-03-01&to=2027-03-05'));
    expect(w.status).toBe(200);
    const row = w.body.people.find((x) => x.kind === 'agent');
    expect(row).toMatchObject({ name: 'Coder', tasksPerDay: 2, userId: 'agent:' + String(agent) });
    expect(row?.days.find((d) => d.date === '2027-03-01')?.percent).toBe(200);
  });

  it('shows commits and pull requests on the bars to the team, not to a client', async () => {
    const item = await add({ title: 'Checkout', startDate: '2027-04-05', durationDays: 3 });
    const conn = (
      await t.call<{ connection: { id: string } }>(ada, 'POST', P('/git'), {
        provider: 'github',
        repo: 'acme/views',
      })
    ).body.connection.id;
    await inSystem(t.db.pool, async (cl) => {
      await cl.query(
        `INSERT INTO item_git_links (workspace_id, item_id, connection_id, kind, ref, title, url, state, at)
         VALUES ($1, $2, $3, 'commit', 'abc1234', 'Add the checkout', 'https://example.test/c', 'main', '2027-04-06 10:00+02'),
                ($1, $2, $3, 'pull_request', '12', 'Checkout', 'https://example.test/p', 'merged', '2027-04-07 16:00+02')`,
        [ada.workspaceId, item, conn],
      );
    });
    const p = await t.call<{ git: { itemId: string; kind: string; date: string }[] }>(
      ada,
      'GET',
      P('/plan'),
    );
    expect(p.body.git.filter((g) => g.itemId === item).map((g) => g.kind + ' ' + g.date)).toEqual([
      'pull_request 2027-04-07',
      'commit 2027-04-06',
    ]);
    // a guest invited to the project sees the plan without the code
    const gus = await t.signup('Gus');
    await t.call(ada, 'POST', W('/members'), { email: gus.email, role: 'guest' });
    await t.call(ada, 'POST', P('/guests'), { userId: gus.id });
    const asGuest = await t.call<{ git: unknown[]; tasks: unknown[] }>(
      { ...gus, workspaceId: ada.workspaceId },
      'GET',
      P('/plan'),
    );
    expect(asGuest.status).toBe(200);
    expect(asGuest.body.git).toEqual([]);
    expect(asGuest.body.tasks.length).toBeGreaterThan(0);
  });

  it('puts every open project on one portfolio axis', async () => {
    const other = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'OTH', name: 'Other' })
    ).body.id;
    await t.call(ada, 'POST', W('/projects/' + other + '/items'), {
      title: 'Launch',
      kind: 'milestone',
      startDate: '2027-06-01',
    });
    await t.call(ada, 'POST', P('/baselines'), { name: 'Plan A' });
    const r = await t.call<{
      today: string;
      projects: {
        key: string;
        tasks: number;
        milestones: { title: string; date: string }[];
        baseline: { slip: number } | null;
      }[];
    }>(ada, 'GET', W('/plan/portfolio'));
    expect(r.status).toBe(200);
    expect(r.body.projects.map((x) => x.key)).toEqual(['OTH', 'VUE']);
    expect(r.body.projects[0]?.milestones).toEqual([
      expect.objectContaining({ title: 'Launch', date: '2027-06-01' }),
    ]);
    expect(r.body.projects[1]?.baseline).toMatchObject({ slip: 0 });
  });
});
