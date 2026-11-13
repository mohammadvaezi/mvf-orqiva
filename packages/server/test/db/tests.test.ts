// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-135 | S15 | v0.1.0] Add test cases from acceptance criteria and test runs ──
//    Why:  cases and runs against the real database: from criteria once, results by case or by name,
//          totals, events and who may write.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inSystem } from '../../src/db/pool.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

describe.skipIf(!hasDatabase)('test cases and runs (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let gus: Person;
  let project = '';
  let item = '';
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  type Case = {
    id: string;
    title: string;
    itemRef: string | null;
    criterionId: string | null;
    source: string;
    key: string;
    lastStatus: string | null;
  };
  type Run = {
    id: string;
    status: string;
    passed: number;
    failed: number;
    skipped: number;
    blocked: number;
  };

  beforeAll(async () => {
    t = await startTestApp();
    ada = await t.signup('Ada');
    gus = await t.signup('Gus');
    await t.call(ada, 'POST', W('/members'), { email: gus.email, role: 'guest' });
    project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'APP', name: 'App' })
    ).body.id;
    await t.call(ada, 'POST', W('/projects/' + project + '/guests'), { userId: gus.id });
    item = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects/' + project + '/items'), {
        title: 'Export',
      })
    ).body.id;
    await t.call(ada, 'POST', W('/items/' + item + '/criteria'), {
      text: 'CSV has one header row',
    });
    await t.call(ada, 'POST', W('/items/' + item + '/criteria'), { text: 'Dates are ISO 8601' });
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('makes one case per acceptance criterion, once', async () => {
    const r = await t.call<Case[]>(ada, 'POST', W('/items/' + item + '/test-cases/from-criteria'));
    expect(r.status).toBe(201);
    expect(r.body.map((c) => [c.title, c.itemRef, c.source])).toEqual([
      ['CSV has one header row', 'APP-1', 'criteria'],
      ['Dates are ISO 8601', 'APP-1', 'criteria'],
    ]);
    expect(r.body.every((c) => c.criterionId)).toBe(true);
    expect(
      (await t.call<Case[]>(ada, 'POST', W('/items/' + item + '/test-cases/from-criteria'))).body,
    ).toHaveLength(2);
    expect(
      (await t.call(gus, 'POST', W('/items/' + item + '/test-cases/from-criteria'))).status,
    ).toBe(403);
    expect(
      (await t.call<Case[]>(gus, 'GET', W('/projects/' + project + '/test-cases'))).body,
    ).toHaveLength(2);
  });

  it('collects results by case and by automated name, with totals and events', async () => {
    const cases = (await t.call<Case[]>(ada, 'GET', W('/projects/' + project + '/test-cases')))
      .body;
    const run = await t.call<Run>(ada, 'POST', W('/projects/' + project + '/test-runs'), {
      name: 'Nightly',
      source: 'stream',
    });
    expect(run.status).toBe(201);
    const R = W('/test-runs/' + run.body.id);
    let r = await t.call<Run>(ada, 'POST', R + '/results', {
      results: [{ caseId: cases[0]?.id, status: 'passed', durationMs: 12 }],
    });
    expect(r.body).toMatchObject({ passed: 1, failed: 0 });
    r = await t.call<Run>(ada, 'POST', R + '/results', {
      results: [
        { key: 'export > writes dates as ISO', status: 'failed', message: 'expected 2026-10-04' },
        { key: 'export > skips empty rows', status: 'skipped' },
        { caseId: cases[1]?.id, status: 'blocked', message: 'no data' },
      ],
    });
    expect(r.body).toMatchObject({ passed: 1, failed: 1, skipped: 1, blocked: 1 });
    // a later result for the same case replaces the earlier one in this run
    r = await t.call<Run>(ada, 'POST', R + '/results', {
      results: [{ key: 'export > writes dates as ISO', status: 'passed' }],
    });
    expect(r.body).toMatchObject({ passed: 2, failed: 0 });
    const named = (
      await t.call<Case[]>(ada, 'GET', W('/projects/' + project + '/test-cases'))
    ).body.filter((c) => c.key);
    expect(named.map((c) => [c.title, c.source, c.lastStatus])).toEqual([
      ['skips empty rows', 'import', 'skipped'],
      ['writes dates as ISO', 'import', 'passed'],
    ]);
    const detail = await t.call<{ results: { title: string; status: string; message: string }[] }>(
      ada,
      'GET',
      R,
    );
    expect(detail.body.results).toHaveLength(4);
    expect(
      (await t.call(ada, 'POST', R + '/results', { results: [{ status: 'passed' }] })).status,
    ).toBe(400);

    const done = await t.call<Run>(ada, 'POST', R + '/finish');
    expect(done.body.status).toBe('done');
    expect(
      (
        await t.call(ada, 'POST', R + '/results', {
          results: [{ caseId: cases[0]?.id, status: 'passed' }],
        })
      ).status,
    ).toBe(409);
    const events = await inSystem(t.db.pool, async (c) =>
      (
        await c.query<{ type: string; p: { done: number; total: number } | null }>(
          "SELECT type, envelope->'data'->'progress' AS p FROM activity_events WHERE type LIKE 'orqiva.test_run.%' ORDER BY sequence",
        )
      ).rows.map(
        (x) =>
          x.type.replace('orqiva.test_run.', '') +
          ':' +
          String(x.p?.done) +
          '/' +
          String(x.p?.total),
      ),
    );
    expect(events).toEqual([
      'created:0/0',
      'progressed:1/1',
      'progressed:1/4',
      'progressed:2/4',
      'completed:2/4',
    ]);
  });
});
