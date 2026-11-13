// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-127 | S15 | v0.1.0] Show measured progress on every card from acceptance criteria and subtasks ──
//    Why:  criteria and progress against the real database: who may change them, how progress is counted,
//          and the event that moves the bars.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { combined } from '../../src/api/criteria.js';
import { inSystem } from '../../src/db/pool.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

describe('progress', () => {
  it('counts criteria and subtasks together', () => {
    expect(combined({ criteria: { done: 1, total: 3 }, subtasks: { done: 1, total: 1 } })).toEqual({
      done: 2,
      total: 4,
      unit: 'criteria',
    });
    expect(
      combined({ criteria: { done: 0, total: 0 }, subtasks: { done: 1, total: 2 } }).unit,
    ).toBe('subtasks');
  });
});

describe.skipIf(!hasDatabase)('acceptance criteria (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let gus: Person;
  let project = '';
  let item = '';
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  type Criterion = { id: string; text: string; done: boolean; doneBy: string | null };
  type Progress = {
    itemId: string;
    criteria: { done: number; total: number };
    subtasks: { done: number; total: number };
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
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('are a checklist members keep and guests read', async () => {
    await t.call(ada, 'POST', W('/items/' + item + '/criteria'), { text: 'CSV has a header row' });
    const two = await t.call<Criterion[]>(ada, 'POST', W('/items/' + item + '/criteria'), {
      text: 'Dates are ISO',
    });
    expect(two.status).toBe(201);
    expect(two.body.map((c) => c.text)).toEqual(['CSV has a header row', 'Dates are ISO']);
    expect(
      (await t.call(gus, 'POST', W('/items/' + item + '/criteria'), { text: 'x' })).status,
    ).toBe(403);
    expect(
      (await t.call<Criterion[]>(gus, 'GET', W('/items/' + item + '/criteria'))).body,
    ).toHaveLength(2);

    const ticked = await t.call<Criterion[]>(
      ada,
      'PATCH',
      W('/criteria/' + (two.body[0]?.id ?? '')),
      { done: true },
    );
    expect(ticked.body[0]).toMatchObject({ done: true, doneBy: 'Ada' });
    const reworded = await t.call<Criterion[]>(
      ada,
      'PATCH',
      W('/criteria/' + (two.body[1]?.id ?? '')),
      {
        text: 'Dates are ISO 8601',
      },
    );
    expect(reworded.body[1]).toMatchObject({ text: 'Dates are ISO 8601', done: false });
    expect(reworded.body[0]?.done).toBe(true);
  });

  it('give each task a measured progress, with its subtasks', async () => {
    const states = (
      await t.call<{ states: { id: string; name: string }[] }>(
        ada,
        'GET',
        W('/projects/' + project),
      )
    ).body.states;
    const done = states.find((s) => s.name === 'Done')?.id;
    await t.call(ada, 'POST', W('/projects/' + project + '/items'), {
      title: 'Sub 1',
      parentId: item,
      stateId: done,
    });
    await t.call(ada, 'POST', W('/projects/' + project + '/items'), {
      title: 'Sub 2',
      parentId: item,
    });
    const r = await t.call<Progress[]>(ada, 'GET', W('/projects/' + project + '/progress'));
    expect(r.body).toEqual([
      { itemId: item, criteria: { done: 1, total: 2 }, subtasks: { done: 1, total: 2 } },
    ]);
  });

  it('records each change as an item event carrying the progress', async () => {
    const list = await t.call<Criterion[]>(ada, 'GET', W('/items/' + item + '/criteria'));
    await t.call(ada, 'DELETE', W('/criteria/' + (list.body[1]?.id ?? '')));
    const last = await inSystem(
      t.db.pool,
      async (c) =>
        (
          await c.query<{
            envelope: { data: { verb: string; progress: unknown; changes: unknown } };
          }>(
            "SELECT envelope FROM activity_events WHERE type = 'orqiva.item.progressed' ORDER BY sequence DESC LIMIT 1",
          )
        ).rows[0]?.envelope.data,
    );
    expect(last).toMatchObject({
      verb: 'progressed',
      progress: { done: 2, total: 3, unit: 'criteria' },
      changes: { criteria: { from: 'present', to: 'removed' } },
    });
  });
});
