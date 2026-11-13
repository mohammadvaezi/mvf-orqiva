// ── [PCODE-256 | S15 | v0.1.0] T26.5 Planning charts: burndown and burnup in points, cumulative flow, control chart, lead time ──
//    Why:  the charts rebuilt from the activity against the real database: a past sprint's burnup follows
//          its scope as tasks joined and left and its done points as they finished; cumulative flow counts
//          each group per day; the control chart gives each task's cycle and lead time and their statistics.
import { histogram, percentile, stats, valueOn } from '@orqiva/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inSystem } from '../../src/db/pool.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

describe('flow statistics', () => {
  it('reads a value on a day and sums up times', () => {
    const steps = [
      { at: '2026-10-05T09:00:00Z', value: 'unstarted' },
      { at: '2026-10-07T10:00:00Z', value: 'completed' },
    ];
    expect(valueOn(steps, '2026-10-04')).toBeNull();
    expect(valueOn(steps, '2026-10-06')).toBe('unstarted');
    expect(valueOn(steps, '2026-10-07')).toBe('completed');
    expect(stats([2, 4, 4, 4, 5, 5, 7, 9])).toEqual({ count: 8, mean: 5, sd: 2, p50: 4, p85: 7 });
    expect(stats([])).toMatchObject({ count: 0, mean: null });
    expect(percentile([1, 2, 3], 100)).toBe(3);
    expect(histogram([0.5, 1.2, 1.9, 3], 1)).toEqual([
      { from: 0, count: 1 },
      { from: 1, count: 2 },
      { from: 2, count: 0 },
      { from: 3, count: 1 },
    ]);
  });
});

describe.skipIf(!hasDatabase)('planning charts (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let project = '';
  let sprint = '';
  const st: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  const state = (n: string): string => st[n] ?? '';
  const id = (n: string): string => ids[n] ?? '';
  /** every event of the task with this change is dated to `at` */
  const dateEvents = (item: string, change: string, at: string) =>
    inSystem(t.db.pool, (c) =>
      c.query(
        `UPDATE activity_events SET time = $3 WHERE object_type = 'item' AND object_id = $1
           AND envelope->'data'->'changes' ? $2`,
        [item, change, at],
      ),
    );

  beforeAll(async () => {
    t = await startTestApp();
    ada = await t.signup('Ada');
    project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'HEL', name: 'Helio' })
    ).body.id;
    for (const x of (
      await t.call<{ states: { id: string; name: string }[] }>(
        ada,
        'GET',
        W('/projects/' + project),
      )
    ).body.states)
      st[x.name] = x.id;
    sprint = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects/' + project + '/sprints'), {
        name: 'Sprint 1',
        startDate: '2026-10-05',
        endDate: '2026-10-09',
      })
    ).body.id;
    for (const [title, estimate] of [
      ['A', 3],
      ['B', 5],
      ['C', 2],
      ['D', 1],
    ] as const)
      ids[title] = (
        await t.call<{ id: string }>(ada, 'POST', W('/projects/' + project + '/items'), {
          title,
          estimate,
          sprintId: sprint,
          stateId: state('Todo'),
        })
      ).body.id;
    await t.call(ada, 'PATCH', W('/items/' + id('A')), { stateId: state('Done') });
    await t.call(ada, 'PATCH', W('/items/' + id('B')), { stateId: state('In Progress') });
    await t.call(ada, 'PATCH', W('/items/' + id('B')), { stateId: state('Done') });
    await t.call(ada, 'PATCH', W('/items/' + id('D')), { sprintId: null });
    // the week as it happened
    await inSystem(t.db.pool, async (c) => {
      await c.query(
        "UPDATE items SET created_at = '2026-10-04T08:00:00Z' WHERE id = ANY($1::uuid[])",
        [[id('A'), id('B'), id('D')]],
      );
      await c.query("UPDATE items SET created_at = '2026-10-06T08:00:00Z' WHERE id = $1", [
        id('C'),
      ]);
    });
    await dateEvents(id('A'), 'state', '2026-10-07T10:00:00Z');
    await dateEvents(id('B'), 'state', '2026-10-08T10:00:00Z');
    await dateEvents(id('D'), 'sprint', '2026-10-07T09:00:00Z');
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('rebuilds a past sprint day by day: scope as it changed, points as they finished', async () => {
    const r = await t.call<{
      days: {
        day: string;
        scopePoints: number;
        donePoints: number;
        scopeTasks: number;
        doneTasks: number;
      }[];
    }>(ada, 'GET', W('/sprints/' + sprint + '/charts/burn'));
    expect(
      r.body.days.map((d) => [
        d.day.slice(5),
        d.scopePoints,
        d.donePoints,
        d.scopeTasks,
        d.doneTasks,
      ]),
    ).toEqual([
      ['10-05', 9, 0, 3, 0],
      ['10-06', 11, 0, 4, 0],
      ['10-07', 10, 3, 3, 1],
      ['10-08', 10, 8, 3, 2],
      ['10-09', 10, 8, 3, 2],
    ]);
  });

  it('counts each state group per day, and times each finished task', async () => {
    const f = await t.call<{ days: { day: string; unstarted: number; completed: number }[] }>(
      ada,
      'GET',
      W('/projects/' + project + '/charts/flow?days=7'),
    );
    expect(f.body.days).toHaveLength(7);
    expect(f.body.days.at(-1)).toMatchObject({ unstarted: 2, completed: 2 });
    await inSystem(t.db.pool, async (c) => {
      const now = Date.now();
      const at = (days: number) => new Date(now - days * 86_400_000).toISOString();
      await c.query(
        'UPDATE items SET created_at = $2, started_at = $3, completed_at = $4 WHERE id = $1',
        [id('A'), at(10), at(4), at(2)],
      );
      await c.query(
        'UPDATE items SET created_at = $2, started_at = $3, completed_at = $4 WHERE id = $1',
        [id('B'), at(6), at(5), at(1)],
      );
    });
    const r = await t.call<{
      tasks: { ref: string; cycleDays: number; leadDays: number }[];
      cycle: { count: number; mean: number };
      lead: { count: number; p85: number };
    }>(ada, 'GET', W('/projects/' + project + '/charts/cycle'));
    expect(r.body.tasks.map((x) => [x.ref, x.cycleDays, x.leadDays])).toEqual([
      ['HEL-1', 2, 8],
      ['HEL-2', 4, 5],
    ]);
    expect(r.body.cycle).toMatchObject({ count: 2, mean: 3 });
    expect(r.body.lead).toMatchObject({ count: 2, p85: 8 });
  });
});
