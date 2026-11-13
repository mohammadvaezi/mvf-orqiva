// ── [PCODE-184 | S15 | v0.1.0] B6.2 Insights live: cycle time, throughput, escaped bugs, AI cost per point, agents vs people for admins, flow, per project, team load ──
//    Why:  Insights against the real database: the trigger that keeps started and finished times, cycle
//          time and throughput, escaped bugs, AI cost per point, deploys and change failure, sprint
//          accuracy, team load, snapshots, and the agents-vs-people split shown to admins only.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inSystem } from '../../src/db/pool.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

describe.skipIf(!hasDatabase)('insights (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let mo: Person;
  let project = '';
  const states: Record<string, string> = {};
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  const P = (p: string): string => W('/projects/' + project + p);
  const sys = (sql: string, args: unknown[] = []) => inSystem(t.db.pool, (c) => c.query(sql, args));
  type Insights = {
    weeks: { done: number; points: number; agentDone: number | null }[];
    cycleDays: number | null;
    escapedBugs: number;
    releases: number;
    aiCents: number;
    aiCentsPerPoint: number | null;
    agents: { agentPoints: number; peoplePoints: number } | null;
    flow: { wip: number; aging: number };
    projects: {
      key: string;
      cycleDays: number | null;
      velocity: number | null;
      accuracy: number | null;
      deploysPerWeek: number | null;
      changeFailure: number | null;
    }[];
    teams: { name: string; load: number; overbooked: { name: string; load: number }[] }[];
  };

  beforeAll(async () => {
    t = await startTestApp();
    ada = await t.signup('Ada');
    mo = await t.signup('Mo');
    await t.call(ada, 'POST', W('/members'), { email: mo.email, role: 'member' });
    project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'INS', name: 'Insights' })
    ).body.id;
    for (const st of (await t.call<{ states: { id: string; group: string }[] }>(ada, 'GET', P('')))
      .body.states)
      states[st.group] ??= st.id;
    await sys(
      "INSERT INTO fx_rates (day, usd_eur, source) VALUES (current_date, 0.5, 'test') ON CONFLICT (day) DO UPDATE SET usd_eur = 0.5",
    );
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('keeps when a task was started and finished, whoever moves it', async () => {
    const id = (
      await t.call<{ id: string }>(ada, 'POST', P('/items'), { title: 'Map', estimate: 5 })
    ).body.id;
    await t.call(ada, 'PATCH', W('/items/' + id), { stateId: states['started'] });
    const started = (await sys('SELECT started_at, completed_at FROM items WHERE id = $1', [id]))
      .rows[0] as { started_at: Date | null; completed_at: Date | null };
    expect(started.started_at).not.toBeNull();
    expect(started.completed_at).toBeNull();
    await t.call(ada, 'PATCH', W('/items/' + id), { stateId: states['completed'] });
    // two days of work
    await sys("UPDATE items SET started_at = completed_at - interval '2 days' WHERE id = $1", [id]);
    const agentTask = (
      await t.call<{ id: string }>(ada, 'POST', P('/items'), {
        title: 'Export',
        estimate: 3,
        stateId: states['completed'],
      })
    ).body.id;
    await sys("UPDATE items SET started_at = completed_at - interval '4 days' WHERE id = $1", [
      agentTask,
    ]);
    const agent = (await t.call<{ id: string }[]>(ada, 'GET', W('/agents'))).body[0]?.id;
    await sys(
      "INSERT INTO agent_runs (workspace_id, project_id, item_id, agent_id, instruction, status, model, cost_micros) VALUES ($1, $2, $3, $4, 'do it', 'succeeded', 'm', 16000000)",
      [ada.workspaceId, project, agentTask, agent],
    );
    const back = (
      await t.call<{ id: string }>(ada, 'POST', P('/items'), {
        title: 'Reopened',
        stateId: states['completed'],
      })
    ).body.id;
    await t.call(ada, 'PATCH', W('/items/' + back), { stateId: states['unstarted'] });
    expect(
      (await sys('SELECT started_at, completed_at FROM items WHERE id = $1', [back])).rows[0],
    ).toEqual({ started_at: null, completed_at: null });
  });

  it('measures flow, money, quality and delivery across projects', async () => {
    // a shipped release, then a bug: it escaped
    await sys(
      "INSERT INTO releases (workspace_id, project_id, version, state, released_at) VALUES ($1, $2, '1.0.0', 'released', now() - interval '1 day')",
      [ada.workspaceId, project],
    );
    await t.call(ada, 'POST', P('/items'), { title: 'Crash on login', kind: 'bug' });
    // a production environment with three deploys, one failed
    const env = (
      await t.call<{ id: string }>(ada, 'POST', P('/environments'), {
        key: 'production',
        name: 'Production',
        kind: 'compose',
        settings: { dir: '/srv' },
      })
    ).body.id;
    for (const st of ['succeeded', 'succeeded', 'failed'])
      await sys(
        'INSERT INTO deploy_runs (workspace_id, project_id, environment_id, status) VALUES ($1, $2, $3, $4)',
        [ada.workspaceId, project, env, st],
      );
    // a finished sprint that planned 10 points and finished 5
    const sprint = (
      await sys(
        'INSERT INTO sprints (workspace_id, project_id, number, name, status, completed_at, scope_snapshot) VALUES ($1, $2, 1, \'S1\', \'completed\', now(), \'[{"itemId": "x", "estimate": 10}]\') RETURNING id',
        [ada.workspaceId, project],
      )
    ).rows[0] as { id: string };
    await sys("UPDATE items SET sprint_id = $1 WHERE title = 'Map'", [sprint.id]);
    // work in progress for a week and more
    const old = (
      await t.call<{ id: string }>(ada, 'POST', P('/items'), {
        title: 'Aging',
        stateId: states['started'],
      })
    ).body.id;
    await sys("UPDATE items SET started_at = now() - interval '9 days' WHERE id = $1", [old]);

    const r = await t.call<Insights>(ada, 'GET', W('/insights?weeks=4'));
    expect(r.body.weeks).toHaveLength(4);
    expect(r.body.weeks.at(-1)).toMatchObject({ done: 2, points: 8, agentDone: 1 });
    expect(r.body.cycleDays).toBe(3);
    expect(r.body).toMatchObject({
      escapedBugs: 1,
      releases: 1,
      aiCents: 800,
      aiCentsPerPoint: 100,
    });
    expect(r.body.agents).toMatchObject({ agentPoints: 3, peoplePoints: 5 });
    expect(r.body.flow).toMatchObject({ wip: 1, aging: 1 });
    expect(r.body.projects.find((p) => p.key === 'INS')).toMatchObject({
      cycleDays: 3,
      velocity: 5,
      accuracy: 0.5,
      deploysPerWeek: 0.8,
      changeFailure: 0.33,
    });
    const snaps = (
      await sys('SELECT count(*)::int AS n FROM insight_snapshots WHERE project_id = $1', [project])
    ).rows[0] as { n: number };
    expect(snaps.n).toBe(3);
  });

  it('shows the agents-vs-people split to admins only', async () => {
    const r = await t.call<Insights>(mo, 'GET', W('/insights?weeks=4'));
    expect(r.body.agents).toBeNull();
    expect(r.body.weeks.at(-1)?.agentDone).toBeNull();
  });

  it('finds over-booked people in their team for the next two weeks', async () => {
    await t.call(ada, 'PUT', W('/teams'), { name: 'Delivery', memberIds: [mo.id, ada.id] });
    const today = new Date().toISOString().slice(0, 10);
    const in13 = new Date(Date.now() + 13 * 86_400_000).toISOString().slice(0, 10);
    for (const title of ['Long task', 'Parallel task'])
      await t.call(ada, 'POST', P('/items'), {
        title,
        assigneeId: mo.id,
        stateId: states['unstarted'],
        startDate: today,
        dueDate: in13,
      });
    const r = await t.call<Insights>(ada, 'GET', W('/insights?weeks=4'));
    const team = r.body.teams.find((x) => x.name === 'Delivery');
    expect(team?.overbooked.map((p) => [p.name, p.load])).toEqual([['Mo', 200]]);
    expect(team?.load).toBe(100);
  });
});
