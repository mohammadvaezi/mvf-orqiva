// ── [PCODE-330 | S15 | v0.1.0] T33.3a Run quality: annotations, judge scores, outcomes ──
//    Why:  against the real database: people mark a run good or bad once each with known tags; the judge
//          (the demo Reviewer) scores it and the score stays on the run with the run that judged it; the
//          outcome follows the task, its pull request and a reverted commit; and the Quality board sums
//          it all up per agent.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { demoProvider, MODE_JUDGE, type ModelProvider } from '../../src/agents/provider.js';
import { inSystem } from '../../src/db/pool.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

process.env['ORQIVA_SECRET_KEY'] = 'ab'.repeat(32);

describe.skipIf(!hasDatabase)('run quality (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let cy: Person;
  let project = '';
  let item = '';
  let run = '';
  const demo = demoProvider();
  // the run answers plainly; the judge is the demo Reviewer
  const provider: ModelProvider = {
    name: 'scripted',
    complete: (req) =>
      req.system.includes(MODE_JUDGE)
        ? demo.complete(req)
        : Promise.resolve({
            content: [{ type: 'text', text: 'The export needs a header row.' }],
            stopReason: 'end_turn',
            usage: { input: 500, output: 40 },
          }),
  };
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  type Quality = {
    annotations: { name: string; verdict: string; tags: string[]; note: string }[];
    judge: { score: number; reason: string; runId: string | null } | null;
    outcome: string;
  };
  const sys = async (sql: string, params: unknown[] = []): Promise<void> => {
    await inSystem(t.db.pool, (c) => c.query(sql, params));
  };

  beforeAll(async () => {
    t = await startTestApp({ agents: { provider: () => Promise.resolve(provider) } });
    ada = await t.signup('Ada');
    cy = await t.signup('Cy');
    await t.call(ada, 'POST', W('/members'), { email: cy.email, role: 'member' });
    project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'RQ', name: 'Quality' })
    ).body.id;
    item = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects/' + project + '/items'), {
        title: 'Export as CSV',
      })
    ).body.id;
    const analyst =
      (await t.call<{ id: string; key: string }[]>(ada, 'GET', W('/agents'))).body.find(
        (a) => a.key === 'analyst',
      )?.id ?? '';
    run = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects/' + project + '/agent-runs'), {
        agentId: analyst,
        instruction: 'Check the export',
        itemId: item,
      })
    ).body.id;
    const end = Date.now() + 10_000;
    while (
      (await t.call<{ run: { status: string } }>(ada, 'GET', W('/agent-runs/' + run))).body.run
        .status !== 'succeeded'
    ) {
      if (Date.now() > end) throw new Error('run did not finish');
      await new Promise((r) => setTimeout(r, 50));
    }
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('keeps what people say, once each, with known tags only', async () => {
    const Q = W('/agent-runs/' + run);
    const fresh = await t.call<Quality>(ada, 'GET', Q + '/quality');
    expect(fresh.body).toEqual({ annotations: [], judge: null, outcome: 'open' });
    expect(
      (await t.call(ada, 'PUT', Q + '/annotation', { verdict: 'good', tags: ['brilliant'] }))
        .status,
    ).toBe(400);
    await t.call(ada, 'PUT', Q + '/annotation', { verdict: 'bad', tags: ['too slow'] });
    const r = await t.call<Quality>(ada, 'PUT', Q + '/annotation', {
      verdict: 'good',
      tags: ['saved time', 'saved time', 'well explained'],
      note: ' Clear. ',
    });
    expect(r.body.annotations).toEqual([
      expect.objectContaining({
        name: 'Ada',
        verdict: 'good',
        tags: ['saved time', 'well explained'],
        note: 'Clear.',
      }),
    ]);
    await t.call(cy, 'PUT', Q + '/annotation', { verdict: 'bad', tags: ['missed the point'] });
    expect((await t.call<Quality>(cy, 'GET', Q + '/quality')).body.annotations).toHaveLength(2);
    const back = await t.call<Quality>(cy, 'DELETE', Q + '/annotation');
    expect(back.body.annotations.map((a) => a.name)).toEqual(['Ada']);
    await t.call(cy, 'PUT', Q + '/annotation', { verdict: 'bad' });
  });

  it('has the judge score a finished run and keeps the score', async () => {
    const r = await t.call<Quality>(ada, 'POST', W('/agent-runs/' + run + '/judge'));
    expect(r.status).toBe(200);
    expect(r.body.judge?.score).toBe(4);
    expect(r.body.judge?.reason).toMatch(/answered the instruction/);
    const judgeRun = r.body.judge?.runId ?? '';
    const by = (
      await t.call<{ run: { agentName: string; instruction: string } }>(
        ada,
        'GET',
        W('/agent-runs/' + judgeRun),
      )
    ).body.run;
    expect(by.agentName).toBe('Reviewer agent');
    expect(by.instruction).toMatch(/^Judge the run of Analyst agent/);
  });

  it('follows the outcome from done to merged to reverted', async () => {
    const Q = W('/agent-runs/' + run + '/quality');
    await sys("UPDATE items SET completed_at = now() + interval '1 second' WHERE id = $1", [item]);
    expect((await t.call<Quality>(ada, 'GET', Q)).body.outcome).toBe('done');
    const conn = (
      await t.call<{ connection: { id: string } }>(
        ada,
        'POST',
        W('/projects/' + project + '/git'),
        {
          provider: 'github',
          repo: 'acme/rq',
        },
      )
    ).body.connection.id;
    await sys(
      `INSERT INTO pull_requests (workspace_id, project_id, connection_id, number, title, state, merged_at, item_id)
       VALUES ($1, $2, $3, 1, 'RQ-1 Export', 'merged', now() + interval '1 second', $4)`,
      [ada.workspaceId, project, conn, item],
    );
    expect((await t.call<Quality>(ada, 'GET', Q)).body.outcome).toBe('merged');
    // a commit for another task does not count; RQ-10 is not RQ-1
    await sys(
      `INSERT INTO git_commits (connection_id, sha, workspace_id, project_id, message, committed_at, reverted_by)
       VALUES ($1, 'aaaaaaa', $2, $3, 'RQ-10 other work', now() + interval '1 second', 'bbbbbbb')`,
      [conn, ada.workspaceId, project],
    );
    expect((await t.call<Quality>(ada, 'GET', Q)).body.outcome).toBe('merged');
    await sys(
      `INSERT INTO git_commits (connection_id, sha, workspace_id, project_id, message, committed_at, reverted_by)
       VALUES ($1, 'ccccccc', $2, $3, 'RQ-1: header row', now() + interval '1 second', 'ddddddd')`,
      [conn, ada.workspaceId, project],
    );
    expect((await t.call<Quality>(ada, 'GET', Q)).body.outcome).toBe('reverted');

    const board = await t.call<
      {
        name: string;
        good: number;
        bad: number;
        judged: number;
        judgeAvg: number | null;
        outcomes: Record<string, number>;
      }[]
    >(ada, 'GET', W('/agent-quality'));
    expect(board.body.find((b) => b.name === 'Analyst agent')).toMatchObject({
      good: 1,
      bad: 1,
      judged: 1,
      judgeAvg: 4,
      outcomes: { done: 0, merged: 0, reverted: 1, open: 0 },
    });
  });
});
