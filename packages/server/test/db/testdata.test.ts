// ── [PCODE-318 | S15 | v0.1.0] T32.4b Masking of personal data in test results and the test-data vault ──
//    Why:  the vault keeps values sealed and lists only open ones; revealing a sensitive one is a tester's
//          step that is kept; a run's steps get open values filled in and sensitive ones left as
//          references; results, step notes, imports and evidence notes are masked (personal data and the
//          vault's values) unless the project switched it off.
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inSystem } from '../../src/db/pool.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

process.env['ORQIVA_SECRET_KEY'] = 'ab'.repeat(32);

interface Data {
  name: string;
  sensitive: boolean;
  value: string | null;
  revealedBy: string | null;
}

describe.skipIf(!hasDatabase)('test data and masking (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let gus: Person;
  let project = '';
  let tc = '';
  let run = '';
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  const P = (p: string): string => W('/projects/' + project + p);
  const sys = <T>(sql: string, args: unknown[] = []): Promise<T[]> =>
    inSystem(t.db.pool, async (c) => (await c.query(sql, args)).rows as T[]);

  beforeAll(async () => {
    t = await startTestApp();
    ada = await t.signup('Ada');
    gus = await t.signup('Gus');
    await t.call(ada, 'POST', W('/members'), { email: gus.email, role: 'guest' });
    project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'SHOP', name: 'Shop' })
    ).body.id;
    await t.call(ada, 'POST', P('/guests'), { userId: gus.id });
    tc = (await t.call<{ id: string }>(ada, 'POST', P('/test-cases'), { title: 'Admin signs in' }))
      .body.id;
    await t.call(ada, 'PATCH', W('/test-cases/' + tc + '/design'), {
      steps: [
        { action: 'Open {{data:shop.url}}', expected: '' },
        {
          action: 'Sign in as {{data:admin.user}} with {{data:admin.password}}',
          expected: 'The board shows',
        },
      ],
    });
    run =
      (
        await t.call<{ id: string }[]>(ada, 'POST', P('/test-runs/plan'), {
          name: 'Release check',
          caseIds: [tc],
        })
      ).body[0]?.id ?? '';
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('keeps values sealed, lists only open ones and records who revealed one', async () => {
    for (const [name, value, sensitive] of [
      ['shop.url', 'https://staging.shop.test', false],
      ['admin.user', 'qa-admin', true],
      ['admin.password', 'Sup3r-secret!', true],
    ] as const)
      expect((await t.call(ada, 'PUT', P('/test-data/' + name), { value, sensitive })).status).toBe(
        200,
      );
    expect((await t.call(ada, 'PUT', P('/test-data/Bad Name'), { value: 'x' })).status).toBe(400);
    const stored = await sys<{ value_sealed: string }>(
      "SELECT value_sealed FROM test_data WHERE name = 'admin.password'",
    );
    expect(stored[0]?.value_sealed).not.toContain('Sup3r');
    const list = await t.call<Data[]>(ada, 'GET', P('/test-data'));
    expect(list.body.map((d) => [d.name, d.value])).toEqual([
      ['admin.password', null],
      ['admin.user', null],
      ['shop.url', 'https://staging.shop.test'],
    ]);
    expect((await t.call(gus, 'GET', P('/test-data'))).status).toBe(403);
    const shown = await t.call<{ value: string }>(
      ada,
      'POST',
      P('/test-data/admin.password/reveal'),
    );
    expect(shown.body.value).toBe('Sup3r-secret!');
    expect(
      (await t.call<Data[]>(ada, 'GET', P('/test-data'))).body.find(
        (d) => d.name === 'admin.password',
      )?.revealedBy,
    ).toBe('Ada');
  });

  it('fills open values into the run’s steps and leaves sensitive ones as references', async () => {
    const plan = await t.call<{ cases: { steps: { action: string }[] }[] }>(
      ada,
      'GET',
      W('/test-runs/' + run + '/plan'),
    );
    expect(plan.body.cases[0]?.steps.map((s) => s.action)).toEqual([
      'Open https://staging.shop.test',
      'Sign in as {{data:admin.user}} with {{data:admin.password}}',
    ]);
  });

  it('masks personal data and test data in what results keep', async () => {
    const put = await t.call(ada, 'PUT', W('/test-runs/' + run + '/cases/' + tc), {
      status: 'failed',
      message:
        'Signed in as qa-admin; the mail went to ada.lovelace@example.org, call +49 151 2345678',
      steps: [
        { status: 'passed', note: '' },
        { status: 'failed', note: 'Card 4111 1111 1111 1111 refused for Sup3r-secret!' },
      ],
    });
    expect(put.status).toBe(200);
    const kept = await sys<{ message: string; step_results: { note: string }[] }>(
      'SELECT message, step_results FROM test_results WHERE run_id = $1',
      [run],
    );
    expect(kept[0]?.message).toBe(
      'Signed in as [test data: admin.user]; the mail went to [email], call [phone]',
    );
    expect(kept[0]?.step_results[1]?.note).toBe(
      'Card [card] refused for [test data: admin.password]',
    );
    // an imported report's messages too
    const report = JSON.parse(
      readFileSync(
        new URL('../fixtures/testreports/cypress-mochawesome.json', import.meta.url),
        'utf8',
      ),
    ) as { results: { suites: { tests: { err: { message?: string } }[] }[] }[] };
    const failing = report.results[0]?.suites[0]?.tests[1];
    if (failing) failing.err.message = 'Expected the receipt for bob@example.com';
    await t.call(ada, 'POST', P('/test-runs/import'), { format: 'cypress', report });
    const imported = await sys<{ message: string }>(
      "SELECT r.message FROM test_results r JOIN test_runs t ON t.id = r.run_id WHERE t.source = 'cypress' AND r.status = 'failed'",
    );
    expect(imported[0]?.message).toBe('Expected the receipt for [email]');
  });

  it('keeps results as written when the project switches masking off', async () => {
    expect(
      (
        await t.call(ada, 'PUT', W('/settings/tests.mask_personal_data'), {
          scope: 'project',
          scopeId: project,
          value: false,
        })
      ).status,
    ).toBe(200);
    await t.call(ada, 'PUT', W('/test-runs/' + run + '/cases/' + tc), {
      status: 'failed',
      message: 'Mail ada@example.org',
    });
    const kept = await sys<{ message: string }>(
      'SELECT message FROM test_results WHERE run_id = $1',
      [run],
    );
    expect(kept[0]?.message).toBe('Mail ada@example.org');
  });
});
