// ── [PCODE-331 | S15 | v0.1.0] T33.3b Evals: saved cases with checks, eval runs per model or prompt version, pass rates over time ──
//    Why:  against the real database and worker: an eval set's cases run in the playground with the
//          settings of each eval run; checks and the judge decide each case; a better model shows as a
//          higher pass rate in the set's history; a run is saved as a case; and the set goes with its runs.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { demoProvider, MODE_JUDGE, type ModelProvider } from '../../src/agents/provider.js';
import { inSystem } from '../../src/db/pool.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

process.env['ORQIVA_SECRET_KEY'] = 'ab'.repeat(32);

describe.skipIf(!hasDatabase)('agent evals (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let project = '';
  let analyst = '';
  let set = '';
  const demo = demoProvider();
  // the better model names what is missing; the agent's own says it looks fine
  const provider: ModelProvider = {
    name: 'scripted',
    complete: (req) =>
      req.system.includes(MODE_JUDGE)
        ? demo.complete(req)
        : Promise.resolve({
            content: [
              {
                type: 'text',
                text:
                  req.model === 'good-model'
                    ? 'The export needs a header row and UTF-8.'
                    : 'Looks fine to me.',
              },
            ],
            stopReason: 'end_turn',
            usage: { input: 300, output: 20 },
          }),
  };
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  type EvalRun = {
    id: string;
    passRate: number | null;
    passed: number;
    failed: number;
    pending: number;
    judgeAvg: number | null;
    cases: { result: string; judge: number | null; checks: { check: string; ok: boolean }[] }[];
  };
  const settled = async (id: string): Promise<EvalRun> => {
    const end = Date.now() + 15_000;
    for (;;) {
      const r = (await t.call<EvalRun>(ada, 'GET', W('/agent-eval-runs/' + id))).body;
      if (!r.cases.some((k) => k.result === 'running')) return r;
      if (Date.now() > end) throw new Error('eval run did not settle');
      await new Promise((res) => setTimeout(res, 100));
    }
  };

  beforeAll(async () => {
    t = await startTestApp({ agents: { provider: () => Promise.resolve(provider) } });
    ada = await t.signup('Ada');
    project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'EVL', name: 'Evals' })
    ).body.id;
    analyst =
      (await t.call<{ id: string; key: string }[]>(ada, 'GET', W('/agents'))).body.find(
        (a) => a.key === 'analyst',
      )?.id ?? '';
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('keeps a set with its cases, from scratch or from a run', async () => {
    const e = await t.call<{ id: string; agentName: string }>(
      ada,
      'POST',
      W('/projects/' + project + '/agent-eval-sets'),
      { agentId: analyst, name: 'Export reviews' },
    );
    expect(e.status).toBe(201);
    expect(e.body.agentName).toBe('Analyst agent');
    set = e.body.id;
    const S = W('/agent-eval-sets/' + set);
    expect((await t.call(ada, 'POST', S + '/runs', {})).status).toBe(409);
    await t.call(ada, 'POST', S + '/cases', {
      instruction: 'Review the CSV export',
      mustContain: ['header row', 'header row', ' '],
      mustNotContain: ['looks fine'],
    });
    await t.call(ada, 'POST', S + '/cases', {
      instruction: 'Which encoding should the export use?',
      mustContain: ['utf-8'],
      minJudge: 4,
    });
    // a real run saved as a case takes its instruction
    const run = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects/' + project + '/agent-runs'), {
        agentId: analyst,
        instruction: 'Summarise the export bugs',
      })
    ).body.id;
    const k = await t.call<{ id: string; instruction: string; mustContain: string[] }>(
      ada,
      'POST',
      S + '/cases',
      { fromRunId: run },
    );
    expect(k.status).toBe(201);
    expect(k.body.instruction).toBe('Summarise the export bugs');
    expect((await t.call(ada, 'DELETE', S + '/cases/' + k.body.id)).status).toBe(200);
    expect((await t.call(ada, 'POST', S + '/cases', {})).status).toBe(400);
    const got = await t.call<{ cases: { mustContain: string[] }[] }>(ada, 'GET', S);
    expect(got.body.cases.map((c) => c.mustContain)).toEqual([['header row'], ['utf-8']]);
  });

  it('runs every case per eval run and shows which settings do better', async () => {
    const S = W('/agent-eval-sets/' + set);
    const first = await t.call<EvalRun>(ada, 'POST', S + '/runs', { label: 'as is' });
    expect(first.status).toBe(201);
    expect(first.body.cases).toHaveLength(2);
    const a = await settled(first.body.id);
    expect(a.cases.map((k) => k.result)).toEqual(['fail', 'fail']);
    expect(a.cases[0]?.checks).toEqual([
      { check: 'says “header row”', ok: false },
      { check: 'does not say “looks fine”', ok: false },
    ]);
    expect(a.passRate).toBe(0);

    const better = await t.call<EvalRun>(ada, 'POST', S + '/runs', {
      label: 'good model',
      model: 'good-model',
    });
    const b = await settled(better.body.id);
    expect(b.cases.map((k) => k.result)).toEqual(['pass', 'needs judge']);
    expect(b.passRate).toBe(1);
    expect(b.pending).toBe(1);
    const judged = await t.call<EvalRun>(ada, 'POST', W('/agent-eval-runs/' + b.id + '/judge'));
    expect(judged.status).toBe(200);
    expect(judged.body.cases.map((k) => [k.result, k.judge])).toEqual([
      ['pass', 4],
      ['pass', 4],
    ]);
    expect(judged.body.judgeAvg).toBe(4);

    const history = await t.call<{
      runs: { passRate: number | null; settings: { model: string | null } }[];
    }>(ada, 'GET', S);
    expect(history.body.runs.map((r) => [r.settings.model, r.passRate])).toEqual([
      ['good-model', 1],
      [null, 0],
    ]);

    // the set goes with its eval runs and their runs
    expect((await t.call(ada, 'DELETE', S)).status).toBe(200);
    const left = await inSystem(t.db.pool, async (c) =>
      Number(
        (
          await c.query<{ n: string }>(
            'SELECT count(*) AS n FROM agent_runs WHERE eval_run_id = ANY($1)',
            [[first.body.id, better.body.id]],
          )
        ).rows[0]?.n,
      ),
    );
    expect(left).toBe(0);
  });
});
