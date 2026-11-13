// ── [PCODE-314 | S15 | v0.1.0] T32.2 Runs: assignment and workload, keyboard entry, timers, reopen when the defect is done ──
//    Why:  people get cases of a running run and the workload says what each has done, failed and left,
//          with the time spent; a defect that is done reopens every case it blocked in running runs (two
//          cases of one run included), not in finished ones, and the Bugs view says so.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

interface Workload {
  people: {
    name: string;
    assigned: number;
    done: number;
    failing: number;
    left: number;
    runs: number;
    spentMs: number;
  }[];
  unassigned: number;
  runs: number;
}

describe.skipIf(!hasDatabase)('assignment, workload, timers and reopening (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let bob: Person;
  let project = '';
  let run = '';
  let done = '';
  const cases: string[] = [];
  const completed = { id: '' };
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  const P = (p: string): string => W('/projects/' + project + p);
  const result = (r: string, c: string, status: string, durationMs?: number) =>
    t.call(ada, 'PUT', W('/test-runs/' + r + '/cases/' + c), {
      status,
      ...(durationMs === undefined ? {} : { durationMs }),
    });
  const workload = async (): Promise<Workload> =>
    (await t.call<Workload>(ada, 'GET', P('/test-workload'))).body;

  beforeAll(async () => {
    t = await startTestApp();
    ada = await t.signup('Ada');
    bob = await t.signup('Bob');
    await t.call(ada, 'POST', W('/members'), { email: bob.email, role: 'member' });
    project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'SHOP', name: 'Shop' })
    ).body.id;
    for (const title of ['Cart keeps items', 'Totals round', 'Checkout works', 'Receipt mails'])
      cases.push((await t.call<{ id: string }>(ada, 'POST', P('/test-cases'), { title })).body.id);
    const states = await t.call<{ states: { id: string; group: string }[] }>(ada, 'GET', P(''));
    completed.id = states.body.states.find((s) => s.group === 'completed')?.id ?? '';
    run =
      (
        await t.call<{ id: string }[]>(ada, 'POST', P('/test-runs/plan'), {
          name: 'Release check',
          caseIds: cases,
        })
      ).body[0]?.id ?? '';
    done =
      (
        await t.call<{ id: string }[]>(ada, 'POST', P('/test-runs/plan'), {
          name: 'Last week',
          caseIds: [cases[0]],
        })
      ).body[0]?.id ?? '';
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('says per person what is assigned, done, failing and left, with the time spent', async () => {
    for (const [i, who] of [
      [0, bob],
      [1, bob],
      [2, ada],
    ] as const)
      expect(
        (
          await t.call(ada, 'PUT', W('/test-runs/' + run + '/assign'), {
            caseId: cases[i],
            userId: who.id,
          })
        ).status,
      ).toBe(200);
    expect((await result(run, cases[0] ?? '', 'passed', 90_000)).status).toBe(200);
    await result(run, cases[2] ?? '', 'failed', 30_000);
    const w = await workload();
    expect(w).toMatchObject({ runs: 2, unassigned: 2 });
    expect(w.people).toEqual([
      {
        userId: bob.id,
        name: 'Bob',
        assigned: 2,
        done: 1,
        failing: 0,
        left: 1,
        runs: 1,
        spentMs: 90_000,
      },
      {
        userId: ada.id,
        name: 'Ada',
        assigned: 1,
        done: 1,
        failing: 1,
        left: 0,
        runs: 1,
        spentMs: 30_000,
      },
    ]);
    // the time a later result brings replaces the earlier
    await result(run, cases[0] ?? '', 'passed', 120_000);
    const plan = await t.call<{ cases: { caseId: string; durationMs: number | null }[] }>(
      ada,
      'GET',
      W('/test-runs/' + run + '/plan'),
    );
    expect(plan.body.cases.find((c) => c.caseId === cases[0])?.durationMs).toBe(120_000);
  });

  it('reopens every case a done defect blocked in running runs', async () => {
    await result(run, cases[1] ?? '', 'blocked');
    const bug = await t.call<{ itemId: string; ref: string }>(
      ada,
      'POST',
      W('/test-runs/' + run + '/cases/' + (cases[1] ?? '') + '/defect'),
      { blocked: true },
    );
    // the same defect blocks a second case of the run, and a case of a finished run
    await t.call(ada, 'PUT', W('/test-runs/' + run + '/cases/' + (cases[3] ?? '')), {
      status: 'blocked',
    });
    await t.call(ada, 'POST', W('/test-runs/' + done + '/cases/' + (cases[0] ?? '') + '/defect'), {
      blocked: true,
    });
    const { inSystem } = await import('../../src/db/pool.js');
    await inSystem(t.db.pool, (c) =>
      c.query(
        'UPDATE test_results SET defect_item_id = $1, status = $2 WHERE (run_id = $3 AND case_id = $4) OR (run_id = $5 AND case_id = $6)',
        [bug.body.itemId, 'blocked', run, cases[3], done, cases[0]],
      ),
    );
    await t.call(ada, 'POST', W('/test-runs/' + done + '/finish'));

    expect(
      (await t.call(ada, 'PATCH', W('/items/' + bug.body.itemId), { stateId: completed.id }))
        .status,
    ).toBe(200);
    const plan = await t.call<{
      cases: { caseId: string; status: string; reopenedBy: string | null }[];
    }>(ada, 'GET', W('/test-runs/' + run + '/plan'));
    const of = (id: string | undefined) => plan.body.cases.find((c) => c.caseId === id);
    expect(of(cases[1])).toMatchObject({ status: 'untested', reopenedBy: bug.body.ref });
    expect(of(cases[3])).toMatchObject({ status: 'untested', reopenedBy: bug.body.ref });
    expect(of(cases[0])).toMatchObject({ status: 'passed', reopenedBy: null });
    // the finished run keeps its result
    const old = await t.call<{ cases: { status: string }[] }>(
      ada,
      'GET',
      W('/test-runs/' + done + '/plan'),
    );
    expect(old.body.cases[0]?.status).toBe('blocked');
    const bugs = await t.call<{ caseId: string; result: string }[]>(ada, 'GET', P('/test-defects'));
    expect(bugs.body.map((b) => b.result).sort()).toEqual(['blocked', 'reopened', 'reopened']);
    // run again, it reads as a result again
    await result(run, cases[1] ?? '', 'passed');
    const again = await t.call<{
      cases: { caseId: string; status: string; reopenedBy: string | null }[];
    }>(ada, 'GET', W('/test-runs/' + run + '/plan'));
    expect(again.body.cases.find((c) => c.caseId === cases[1])).toMatchObject({
      status: 'passed',
      reopenedBy: null,
    });
  });
});
