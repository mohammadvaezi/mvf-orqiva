// ── [PCODE-328 | S15 | v0.1.0] T33.1b Cost estimate before a run, chargeback per client and cost centre, unit costs ──
//    Why:  against the real database: an estimate before a run, rough without history and from the
//          agent's finished runs once there are some; the month's AI cost per client and cost centre (an
//          admin's project setting), as JSON and as the CSV for booking; and what a finished task and a
//          merged pull request cost, each task's runs counted once.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inSystem } from '../../src/db/pool.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

process.env['ORQIVA_SECRET_KEY'] = 'ab'.repeat(32);

describe.skipIf(!hasDatabase)('chargeback and unit costs (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let cy: Person;
  let app = '';
  let web = '';
  let analyst = '';
  const items: Record<string, string> = {};
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  const sys = async <T>(sql: string, params: unknown[] = []): Promise<T[]> =>
    inSystem(t.db.pool, async (c) => (await c.query(sql, params)).rows as T[]);

  type Estimate = {
    lowCents: number;
    midCents: number;
    highCents: number;
    basis: string;
    runs: number;
  };

  beforeAll(async () => {
    t = await startTestApp();
    ada = await t.signup('Ada');
    cy = await t.signup('Cy');
    await t.call(ada, 'POST', W('/members'), { email: cy.email, role: 'member' });
    app = (await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'APP', name: 'App' }))
      .body.id;
    web = (await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'WEB', name: 'Web' }))
      .body.id;
    for (const [k, p] of [
      ['APP-1', app],
      ['APP-2', app],
      ['WEB-1', web],
    ] as const)
      items[k] = (
        await t.call<{ id: string }>(ada, 'POST', W('/projects/' + p + '/items'), {
          title: k + ' work',
        })
      ).body.id;
    analyst =
      (await t.call<{ id: string; key: string }[]>(ada, 'GET', W('/agents'))).body.find(
        (a) => a.key === 'analyst',
      )?.id ?? '';
    await t.call(ada, 'PUT', W('/agents/provider'), {
      provider: 'demo',
      inputPricePerMillion: 2,
      outputPricePerMillion: 10,
    });
    const client = (
      await sys<{ id: string }>(
        "INSERT INTO clients (workspace_id, name, short_name) VALUES ($1, 'Helio Health AG', 'Helio') RETURNING id",
        [ada.workspaceId],
      )
    )[0]?.id;
    await sys('UPDATE projects SET client_id = $2 WHERE id = $1', [app, client]);
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('an admin names the cost centre of a project', async () => {
    expect((await t.call(cy, 'PATCH', W('/projects/' + app), { costCentre: '4711' })).status).toBe(
      403,
    );
    const r = await t.call<{ costCentre: string }>(ada, 'PATCH', W('/projects/' + app), {
      costCentre: ' 4711 Product ',
    });
    expect(r.status).toBe(200);
    expect(r.body.costCentre).toBe('4711 Product');
    expect(
      (await t.call<{ costCentre: string }>(ada, 'GET', W('/projects/' + web))).body.costCentre,
    ).toBe('');
  });

  it('estimates roughly when the agent has no finished runs', async () => {
    const e = await t.call<Estimate>(ada, 'POST', W('/projects/' + app + '/agent-runs/estimate'), {
      agentId: analyst,
      instruction: 'Summarise the open bugs. '.repeat(40),
      itemId: items['APP-1'],
    });
    expect(e.status).toBe(200);
    expect(e.body.basis).toBe('rough');
    expect(e.body.runs).toBe(0);
    expect(e.body.midCents).toBeGreaterThan(0);
    expect(e.body.highCents).toBeGreaterThanOrEqual(e.body.midCents * 2 - 1);
    expect(
      (
        await t.call(ada, 'POST', W('/projects/' + app + '/agent-runs/estimate'), {
          agentId: app,
          instruction: 'x',
        })
      ).status,
    ).toBe(404);
  });

  it('charges the month back per client and cost centre and prices a result', async () => {
    // dollars at the rate of each run's day: 1 + 1 € on APP-1, 1 € on APP-2, 2 € on WEB-1
    for (const [item, project, micros, rate] of [
      ['APP-1', app, 2_000_000, 0.5],
      ['APP-1', app, 2_000_000, 0.5],
      ['APP-2', app, 1_000_000, 1],
      ['WEB-1', web, 4_000_000, 0.5],
    ] as const)
      await sys(
        `INSERT INTO agent_runs (workspace_id, project_id, item_id, agent_id, requested_by, instruction, status, model,
                                 cost_micros, usd_eur)
         VALUES ($1, $2, $3, $4, $5, 'work', 'succeeded', 'demo', $6, $7)`,
        [ada.workspaceId, project, items[item], analyst, ada.id, micros, rate],
      );
    await sys('UPDATE items SET completed_at = now() WHERE id = ANY($1)', [
      [items['APP-1'], items['WEB-1']],
    ]);
    const conn = (
      await t.call<{ connection: { id: string } }>(ada, 'POST', W('/projects/' + app + '/git'), {
        provider: 'github',
        repo: 'acme/app',
      })
    ).body.connection.id;
    // two pull requests for one task: its runs count once
    for (const n of [1, 2])
      await sys(
        `INSERT INTO pull_requests (workspace_id, project_id, connection_id, number, title, state, merged_at, item_id)
         VALUES ($1, $2, $3, $4, 'APP-1 part', 'merged', now(), $5)`,
        [ada.workspaceId, app, conn, n, items['APP-1']],
      );

    const r = await t.call<{
      byClient: { group: string; projects: string[]; runs: number; cents: number }[];
      byCostCentre: { group: string; cents: number }[];
      units: { tasksDone: number; perTaskCents: number; prsMerged: number; perPrCents: number };
      projectUnits: {
        key: string;
        tasksDone: number;
        perTaskCents: number | null;
        prsMerged: number;
        perPrCents: number | null;
      }[];
    }>(ada, 'GET', W('/agent-costs'));
    expect(r.status).toBe(200);
    expect(r.body.byClient).toEqual([
      { group: 'Helio Health AG', projects: ['APP'], runs: 3, cents: 300 },
      { group: 'No client', projects: ['WEB'], runs: 1, cents: 200 },
    ]);
    expect(r.body.byCostCentre.map((x) => [x.group, x.cents])).toEqual([
      ['4711 Product', 300],
      ['No cost centre', 200],
    ]);
    expect(r.body.units).toEqual({
      tasksDone: 2,
      perTaskCents: 200,
      prsMerged: 2,
      perPrCents: 100,
    });
    expect(r.body.projectUnits).toEqual([
      { id: app, key: 'APP', tasksDone: 1, perTaskCents: 200, prsMerged: 2, perPrCents: 100 },
      { id: web, key: 'WEB', tasksDone: 1, perTaskCents: 200, prsMerged: 0, perPrCents: null },
    ]);

    const csv = await fetch(t.base + W('/agent-costs/chargeback?by=cost-centre'), {
      headers: { cookie: ada.cookie },
    });
    expect(csv.headers.get('content-type')).toContain('text/csv');
    expect(csv.headers.get('content-disposition')).toContain('ai-chargeback-');
    const text = await csv.text();
    expect(text).toContain('"Month","Cost centre","Projects","Runs","AI cost (EUR)"');
    expect(text).toContain('"4711 Product","APP","3","3.00"');
    expect((await t.call(ada, 'GET', W('/agent-costs/chargeback?by=team'))).status).toBe(400);
  });

  it('estimates from the agent’s finished runs once there are enough', async () => {
    const e = await t.call<Estimate>(ada, 'POST', W('/projects/' + app + '/agent-runs/estimate'), {
      agentId: analyst,
      instruction: 'Again',
    });
    expect(e.body.basis).toBe('history');
    expect(e.body.runs).toBe(4);
    // quartiles of $1, $2, $2, $4: 1.75, 2 and 2.5 dollars at today's rate
    expect(e.body.lowCents / e.body.midCents).toBeCloseTo(0.875, 1);
    expect(e.body.highCents / e.body.midCents).toBeCloseTo(1.25, 1);
  });
});
