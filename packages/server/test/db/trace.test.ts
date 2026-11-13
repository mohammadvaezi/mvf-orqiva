// ── [PCODE-277 | S15 | v0.1.0] T28.6 PRD approval by named approvers, reopen on edit, promote to an epic with stories, client in ideation ──
// ── [PCODE-147 | S15 | v0.1.0] Show the traceability graph from idea to deploy ──
//    Why:  the chain from a signed idea to a deploy, and its gaps, against the real database.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { scriptedProvider } from '../../src/agents/provider.js';
import { inSystem } from '../../src/db/pool.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

describe.skipIf(!hasDatabase)('traceability (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let gus: Person;
  let project = '';
  let idea = '';
  let items: { id: string; ref: string }[] = [];
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  type Trace = {
    nodes: { id: string; kind: string; label: string; status: string }[];
    edges: { from: string; to: string }[];
    gaps: { node: string; text: string }[];
  };

  beforeAll(async () => {
    t = await startTestApp({
      agents: {
        provider: () =>
          Promise.resolve(
            scriptedProvider([
              {
                content: [{ type: 'text', text: 'READY: ok' }],
                stopReason: 'end_turn',
                usage: { input: 1, output: 1 },
              },
            ]),
          ),
      },
    });
    ada = await t.signup('Ada Lovelace');
    gus = await t.signup('Gus');
    await t.call(ada, 'POST', W('/members'), { email: gus.email, role: 'guest' });
    project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'APP', name: 'App' })
    ).body.id;
    idea = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects/' + project + '/ideas'), {
        title: 'CSV export',
      })
    ).body.id;
    await t.call(ada, 'POST', W('/ideas/' + idea + '/interview'), {});
    await t.call(ada, 'POST', W('/ideas/' + idea + '/proposals'), {
      content: {
        summary: 'CSV',
        problem: 'Retyping',
        goals: [],
        scopeIn: [],
        scopeOut: [],
        risks: [],
        tasks: [
          { title: 'Export endpoint', estimate: 3 },
          { title: 'Export button', estimate: 1 },
        ],
      },
    });
    await t.call(ada, 'POST', W('/ideas/' + idea + '/sign'), {
      version: 1,
      decision: 'approve',
      name: 'Ada Lovelace',
      consent: true,
    });
    // [PCODE-277 | S15 | v0.1.0] promotion makes the epic with the tasks under it
    const promoted = await t.call<{ items: { id: string; ref: string }[] }>(
      ada,
      'POST',
      W('/ideas/' + idea + '/promote'),
    );
    items = promoted.body.items;
    const first = items[0]?.id ?? '';
    await t.call(ada, 'POST', W('/items/' + first + '/criteria'), { text: 'One header row' });
    await t.call(ada, 'POST', W('/items/' + first + '/criteria'), { text: 'ISO dates' });
    await t.call(ada, 'POST', W('/items/' + first + '/test-cases/from-criteria'));
    await t.call(ada, 'DELETE', W('/test-cases/' + (await caseOf('ISO dates'))));
    // code written for it, then a deploy that shipped it
    await inSystem(t.db.pool, async (c) => {
      await c.query(
        `INSERT INTO item_fingerprints (workspace_id, project_id, item_id, path, line, kind, sprint_code, version, recorded_at)
         VALUES ($1, $2, $3, 'src/export.ts', 1, 'header', 'S01', '0.1.0', now() - interval '1 hour')`,
        [ada.workspaceId, project, first],
      );
      const env = (
        await c.query<{ id: string }>(
          "INSERT INTO environments (workspace_id, project_id, key, name, kind) VALUES ($1, $2, 'staging', 'Staging', 'compose') RETURNING id",
          [ada.workspaceId, project],
        )
      ).rows[0]?.id;
      await c.query(
        "INSERT INTO deploy_runs (workspace_id, project_id, environment_id, status, finished_at) VALUES ($1, $2, $3, 'succeeded', now())",
        [ada.workspaceId, project, env],
      );
    });
  }, 60_000);

  const caseOf = async (title: string): Promise<string> =>
    (
      await t.call<{ id: string; title: string }[]>(
        ada,
        'GET',
        W('/projects/' + project + '/test-cases'),
      )
    ).body.find((c) => c.title === title)?.id ?? '';

  afterAll(async () => {
    await t.stop();
  });

  it('traces an idea through its signed proposal to tasks, tests, code and the deploy', async () => {
    const r = await t.call<Trace>(ada, 'GET', W('/trace?ideaId=' + idea));
    expect(r.status).toBe(200);
    const kinds = r.body.nodes.map((n) => n.kind + ':' + n.label);
    expect(kinds).toEqual([
      'idea:APP-I1',
      'proposal:Proposal v1',
      // the epic the idea was promoted to, then its tasks
      'item:APP-1',
      'item:APP-2',
      'criterion:One header row',
      'test:One header row',
      'criterion:ISO dates',
      'file:export.ts',
      'deploy:Staging',
      'item:APP-3',
    ]);
    const has = (from: string, to: string): boolean =>
      r.body.edges.some(
        (e) =>
          r.body.nodes.find((n) => n.id === e.from)?.label === from &&
          r.body.nodes.find((n) => n.id === e.to)?.label === to,
      );
    expect(has('APP-I1', 'Proposal v1')).toBe(true);
    expect(has('Proposal v1', 'APP-2')).toBe(true);
    expect(has('export.ts', 'Staging')).toBe(true);
    expect(r.body.gaps.map((g) => g.text)).toEqual([
      'No test checks this criterion',
      'No acceptance criteria',
      'No test cases',
    ]);
  });

  it('traces one task within its idea, and keeps guests to their projects', async () => {
    const r = await t.call<Trace>(ada, 'GET', W('/trace?itemId=' + (items[1]?.id ?? '')));
    expect(r.body.nodes.map((n) => n.label)).toEqual(['APP-I1', 'Proposal v1', 'APP-3']);
    expect((await t.call(gus, 'GET', W('/trace?ideaId=' + idea))).status).toBe(404);
    expect((await t.call(ada, 'GET', W('/trace'))).status).toBe(400);
  });
});
