// ── [PCODE-317 | S15 | v0.1.0] T32.4a AI triage of test failures and impacted tests first ──
//    Why:  the Tester agent (the demo model here) triages a failure from its message and history and the
//          answer is kept with the result and shown in the run; a whole run's failures are triaged at
//          once; a passed result is not triaged; a pull request's files rank the cases that cover them.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { demoProvider } from '../../src/agents/provider.js';
import { inSystem } from '../../src/db/pool.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

describe.skipIf(!hasDatabase)('failure triage and impacted tests (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let project = '';
  let story = '';
  let run = '';
  const cases: Record<string, string> = {};
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  const P = (p: string): string => W('/projects/' + project + p);
  const sys = <T>(sql: string, args: unknown[] = []): Promise<T[]> =>
    inSystem(t.db.pool, async (c) => (await c.query(sql, args)).rows as T[]);

  beforeAll(async () => {
    t = await startTestApp({ agents: { provider: () => Promise.resolve(demoProvider()) } });
    ada = await t.signup('Ada');
    project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'SHOP', name: 'Shop' })
    ).body.id;
    story = (await t.call<{ id: string }>(ada, 'POST', P('/items'), { title: 'Cart keeps items' }))
      .body.id;
    for (const [k, title] of [
      ['pay', 'Pays by card'],
      ['cart', 'Cart keeps items'],
      ['total', 'Totals round'],
      ['ok', 'Receipt mails'],
    ] as const)
      cases[k] = (
        await t.call<{ id: string }>(ada, 'POST', P('/test-cases'), {
          title,
          ...(k === 'cart' ? { itemId: story } : {}),
        })
      ).body.id;
    run =
      (
        await t.call<{ id: string }[]>(ada, 'POST', P('/test-runs/plan'), {
          name: 'Nightly',
          caseIds: Object.values(cases),
        })
      ).body[0]?.id ?? '';
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  const put = (k: string, status: string, message = '') =>
    t.call(ada, 'PUT', W('/test-runs/' + run + '/cases/' + (cases[k] ?? '')), {
      status,
      ...(message ? { message } : {}),
    });

  it('triages one failure and keeps the answer with the result', async () => {
    await put('pay', 'failed', 'ConnectionError: payment sandbox not reachable');
    const r = await t.call<{ category: string; confidence: number; reason: string; next: string }>(
      ada,
      'POST',
      W('/test-runs/' + run + '/cases/' + (cases['pay'] ?? '') + '/triage'),
    );
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ category: 'environment', confidence: 0.6 });
    const plan = await t.call<{ cases: { caseId: string; triage: { category: string } | null }[] }>(
      ada,
      'GET',
      W('/test-runs/' + run + '/plan'),
    );
    expect(plan.body.cases.find((c) => c.caseId === cases['pay'])?.triage?.category).toBe(
      'environment',
    );
    await put('ok', 'passed');
    expect(
      (
        await t.call(
          ada,
          'POST',
          W('/test-runs/' + run + '/cases/' + (cases['ok'] ?? '') + '/triage'),
        )
      ).status,
    ).toBe(409);
  });

  it('triages the rest of the run’s failures at once', async () => {
    await put('cart', 'failed', 'The cart is empty after reload');
    await put('total', 'blocked', 'Element .total not found');
    const r = await t.call<{ triaged: number; left: number; counts: Record<string, number> }>(
      ada,
      'POST',
      W('/test-runs/' + run + '/triage'),
    );
    expect(r.body).toEqual({ triaged: 2, left: 0, counts: { product_bug: 1, test_bug: 1 } });
    // the agent's runs are recorded as the Tester's
    const runs = await sys<{ n: string }>(
      "SELECT count(*) AS n FROM agent_runs r JOIN agents a ON a.id = r.agent_id WHERE a.key = 'tester' AND r.workspace_id = $1",
      [ada.workspaceId],
    );
    expect(Number(runs[0]?.n)).toBe(3);
  });

  it('ranks the cases a pull request touches', async () => {
    await sys(
      `INSERT INTO item_fingerprints (workspace_id, project_id, item_id, path, line, kind, sprint_code, version)
       VALUES ($1, $2, $3, 'src/cart.ts', 1, 'header', 'S1', '0.1.0')`,
      [ada.workspaceId, project, story],
    );
    const conn = (
      await t.call<{ connection: { id: string } }>(ada, 'POST', P('/git'), {
        provider: 'github',
        repo: 'acme/shop',
      })
    ).body.connection.id;
    const pr =
      (
        await sys<{ id: string }>(
          `INSERT INTO pull_requests (workspace_id, project_id, connection_id, number, title) VALUES ($1, $2, $3, 9, 'Cart fix') RETURNING id`,
          [ada.workspaceId, project, conn],
        )
      )[0]?.id ?? '';
    await sys(
      `INSERT INTO pull_request_files (pull_request_id, path, workspace_id, position, status, patch_hash)
       VALUES ($1, 'src/cart.ts', $2, 0, 'modified', 'h'), ($1, 'src/totals.ts', $2, 1, 'modified', 'h2')`,
      [pr, ada.workspaceId],
    );
    const r = await t.call<{
      changed: number;
      cases: { title: string; score: number; reasons: string[] }[];
    }>(ada, 'POST', P('/test-cases/impacted'), { pullRequestId: pr });
    expect(r.body.changed).toBe(2);
    expect(r.body.cases).toEqual([
      {
        caseId: cases['cart'],
        title: 'Cart keeps items',
        score: 5,
        reasons: ['SHOP-1 wrote src/cart.ts', 'named after src/cart.ts'],
      },
      {
        caseId: cases['total'],
        title: 'Totals round',
        score: 2,
        reasons: ['named after src/totals.ts'],
      },
    ]);
    const byPath = await t.call<{ cases: { title: string }[] }>(
      ada,
      'POST',
      P('/test-cases/impacted'),
      {
        paths: ['src/receipt.ts'],
      },
    );
    expect(byPath.body.cases.map((c) => c.title)).toEqual(['Receipt mails']);
    expect((await t.call(ada, 'POST', P('/test-cases/impacted'), {})).status).toBe(400);
  });
});
