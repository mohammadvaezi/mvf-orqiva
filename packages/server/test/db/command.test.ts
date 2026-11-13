// ── [PCODE-209 | S15 | v0.1.0] T18.1 Portfolio on the server: health, risk heatmap, gates, cards in progress with people and agents, alerts, 24 h replay ──
//    Why:  the command center against PostgreSQL: every visible project with its health and the reasons,
//          the heatmap, gates and the cards in progress with the agent on them; open alerts; the replay of
//          the last day with the moves of cards; a guest sees only the projects shared with them.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inSystem } from '../../src/db/pool.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

describe.skipIf(!hasDatabase)('command center (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  const ids: Record<string, string> = {};
  let card = '';
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  const sys = (sql: string, args: unknown[] = []) => inSystem(t.db.pool, (c) => c.query(sql, args));
  type Portfolio = {
    projects: {
      key: string;
      phase: string | null;
      gates: { key: string; status: string }[];
      health: string;
      reasons: string[];
      heat: Record<string, { level: string; note: string }>;
      counts: { open: number; inProgress: number };
      cards: {
        ref: string;
        assignee: { name: string } | null;
        agents: { name: string; status: string }[];
      }[];
    }[];
    alerts: { projectKey: string | null; severity: string; title: string }[];
  };

  beforeAll(async () => {
    t = await startTestApp();
    ada = await t.signup('Ada');
    const states: Record<string, { id: string; name: string }[]> = {};
    for (const key of ['APP', 'API']) {
      const p = (
        await t.call<{ id: string; states: { id: string; name: string }[] }>(
          ada,
          'POST',
          W('/projects'),
          {
            key,
            name: key + ' project',
          },
        )
      ).body;
      ids[key] = p.id;
      states[key] = p.states;
    }
    await t.call(ada, 'POST', W('/projects/' + (ids['APP'] ?? '') + '/lifecycle'), {});
    const progress = states['APP']?.find((x) => x.name === 'In Progress')?.id;
    card = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects/' + (ids['APP'] ?? '') + '/items'), {
        title: 'Live map',
        assigneeId: ada.id,
      })
    ).body.id;
    await t.call(ada, 'PATCH', W('/items/' + card), {
      stateId: progress,
    });
    await t.call(ada, 'POST', W('/projects/' + (ids['APP'] ?? '') + '/items'), {
      title: 'Late one',
      dueDate: '2026-01-02',
    });
    const ws = ada.workspaceId;
    await sys(
      "INSERT INTO findings (workspace_id, project_id, tool, rule, severity, title, fingerprint) VALUES ($1, $2, 'scan', 'r', 'critical', 'SQL injection', 'f1')",
      [ws, ids['API']],
    );
    const agent = (await t.call<{ id: string; key: string }[]>(ada, 'GET', W('/agents'))).body.find(
      (x) => x.key === 'developer',
    )?.id;
    await sys(
      "INSERT INTO agent_runs (workspace_id, project_id, item_id, agent_id, instruction, model, status) VALUES ($1, $2, $3, $4, 'x', 'm', 'running')",
      [ws, ids['APP'], card, agent],
    );
    await t.call(ada, 'POST', W('/alerts'), {
      source: 'grafana',
      key: 'api-5xx',
      severity: 'sev3',
      title: 'API 5xx above 2 %',
      projectKey: 'API',
    });
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('shows every project with health, reasons, heatmap, gates and moving cards', async () => {
    const r = await t.call<Portfolio>(ada, 'GET', W('/command-center'));
    expect(r.status).toBe(200);
    const [api, app] = r.body.projects;
    expect([api?.key, app?.key]).toEqual(['API', 'APP']);
    expect(api).toMatchObject({
      health: 'critical',
      reasons: ['1 critical finding'],
    });
    expect(api?.heat['security']).toEqual({ level: 'bad', note: '1 critical finding' });
    // a SEV-3 alert is listed, but only SEV-1/2 opens an incident
    expect(api?.heat['operations']?.level).toBe('ok');
    expect(api?.phase).toBeNull();
    expect(app).toMatchObject({
      health: 'at-risk',
      reasons: ['1 task overdue'],
      counts: { open: 2, inProgress: 1 },
    });
    expect(app?.phase).toBe('Discover');
    expect(app?.gates.map((g) => g.key)).toEqual(['g1', 'g2', 'g3']);
    expect(app?.cards).toEqual([
      expect.objectContaining({
        ref: 'APP-1',
        assignee: expect.objectContaining({ name: 'Ada' }) as unknown,
        agents: [{ name: 'Developer agent', status: 'running' }],
      }),
    ]);
    expect(r.body.alerts).toEqual([
      expect.objectContaining({ projectKey: 'API', severity: 'sev3', title: 'API 5xx above 2 %' }),
    ]);
    expect((await t.call<unknown[]>(ada, 'GET', W('/alerts'))).body).toHaveLength(1);
  });

  it('replays the last day with the moves of cards', async () => {
    const r = await t.call<{
      cut: boolean;
      events: {
        object: string;
        verb: string;
        label: string;
        state: { to: string | null } | null;
        actor: string;
      }[];
    }>(ada, 'GET', W('/command-center/replay'));
    expect(r.body.cut).toBe(false);
    const move = r.body.events.find((e) => e.verb === 'moved');
    expect(move).toMatchObject({
      object: 'item',
      label: expect.stringContaining('APP-1') as unknown,
      actor: 'Ada',
    });
    expect(move?.state?.to).toBe('In Progress');
    const tooLong = await t.call(
      ada,
      'GET',
      W('/command-center/replay?from=2026-01-01T00:00:00Z&to=2026-01-03T00:00:00Z'),
    );
    expect(tooLong.status).toBe(400);
    const empty = await t.call<{ events: unknown[] }>(
      ada,
      'GET',
      W('/command-center/replay?from=2026-01-01T00:00:00Z&to=2026-01-01T12:00:00Z'),
    );
    expect(empty.body.events).toEqual([]);
  });
});
