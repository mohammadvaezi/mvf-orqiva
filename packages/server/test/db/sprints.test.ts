// ── [PCODE-99 | S15 | v0.1.0] Build sprints, backlog, board and list views ──
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ItemJson } from '../../src/api/items.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

interface Sprint {
  id: string;
  name: string;
  status: string;
  startDate: string | null;
  itemCount: number;
  doneCount: number;
  estimateTotal: number;
  estimateDone: number;
}

describe.skipIf(!hasDatabase)('sprints and planning (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let ws = '';
  let project = { id: '', states: [] as { id: string; name: string }[] };
  const W = (p: string): string => '/api/workspaces/' + ws + p;
  const state = (name: string): string => project.states.find((s) => s.name === name)?.id ?? '';
  const item = async (title: string, extra: Record<string, unknown> = {}): Promise<ItemJson> =>
    (
      await t.call<ItemJson>(ada, 'POST', W('/projects/' + project.id + '/items'), {
        title,
        ...extra,
      })
    ).body;

  beforeAll(async () => {
    t = await startTestApp();
    ada = await t.signup('Ada');
    ws = ada.workspaceId;
    project = (
      await t.call<typeof project>(ada, 'POST', W('/projects'), { key: 'APP', name: 'App' })
    ).body;
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  let s1: Sprint;
  let s2: Sprint;

  it('plans sprints, refusing an end before the start', async () => {
    s1 = (
      await t.call<Sprint>(ada, 'POST', W('/projects/' + project.id + '/sprints'), {
        name: 'Sprint 1',
        goal: 'Login works',
        startDate: '2026-11-02',
        endDate: '2026-11-13',
      })
    ).body;
    s2 = (
      await t.call<Sprint>(ada, 'POST', W('/projects/' + project.id + '/sprints'), {
        name: 'Sprint 2',
      })
    ).body;
    expect(s1).toMatchObject({ status: 'planned', startDate: '2026-11-02', itemCount: 0 });
    const bad = await t.call(ada, 'POST', W('/projects/' + project.id + '/sprints'), {
      name: 'Backwards',
      startDate: '2026-11-13',
      endDate: '2026-11-02',
    });
    expect(bad.status).toBe(400);
  });

  it('puts items into a sprint and keeps them in rank order', async () => {
    const a = await item('A', { sprintId: s1.id, estimate: 3 });
    const b = await item('B', { sprintId: s1.id, estimate: 5 });
    const c = await item('C');
    expect(a.rank).toBeLessThan(b.rank);
    expect(c.sprintId).toBeNull();
    // move C into the sprint, ahead of A
    const moved = await t.call<ItemJson>(ada, 'PATCH', W('/items/' + c.id), {
      sprintId: s1.id,
      rank: a.rank - 1,
    });
    expect(moved.body).toMatchObject({ sprintId: s1.id, rank: a.rank - 1 });
    const history = (
      await t.call<{ data: { changes?: Record<string, unknown> } }[]>(
        ada,
        'GET',
        W('/items/' + c.id + '/history'),
      )
    ).body;
    expect(history.at(-1)?.data.changes?.['sprint']).toEqual({ from: 'Backlog', to: 'Sprint 1' });
    const sp = (
      await t.call<Sprint[]>(ada, 'GET', W('/projects/' + project.id + '/sprints'))
    ).body.find((x) => x.id === s1.id);
    expect(sp).toMatchObject({ itemCount: 3, estimateTotal: 8 });
  });

  it('runs one sprint at a time', async () => {
    expect((await t.call<Sprint>(ada, 'POST', W('/sprints/' + s1.id + '/start'))).body.status).toBe(
      'active',
    );
    const second = await t.call<{ error: { message: string } }>(
      ada,
      'POST',
      W('/sprints/' + s2.id + '/start'),
    );
    expect(second.status).toBe(409);
    expect(second.body.error.message).toContain('Sprint 1 is still active');
    expect((await t.call(ada, 'DELETE', W('/sprints/' + s1.id))).status).toBe(409);
  });

  it('completes the sprint and carries unfinished items to the next one', async () => {
    const items = (await t.call<ItemJson[]>(ada, 'GET', W('/projects/' + project.id + '/items')))
      .body;
    const a = items.find((i) => i.title === 'A');
    if (!a) throw new Error('no A');
    await t.call(ada, 'PATCH', W('/items/' + a.id), { stateId: state('Done') });
    const done = await t.call<{ sprint: Sprint; moved: number }>(
      ada,
      'POST',
      W('/sprints/' + s1.id + '/complete'),
      { moveTo: s2.id },
    );
    expect(done.body.moved).toBe(2);
    expect(done.body.sprint).toMatchObject({
      status: 'completed',
      itemCount: 1,
      doneCount: 1,
      estimateDone: 3,
    });
    const after = (await t.call<ItemJson[]>(ada, 'GET', W('/projects/' + project.id + '/items')))
      .body;
    expect(
      after
        .filter((i) => i.sprintId === s2.id)
        .map((i) => i.title)
        .sort(),
    ).toEqual(['B', 'C']);
  });

  it('refuses to put items into a completed sprint, or to change it', async () => {
    const r = await t.call(ada, 'POST', W('/projects/' + project.id + '/items'), {
      title: 'Late',
      sprintId: s1.id,
    });
    expect(r.status).toBe(400);
    expect((await t.call(ada, 'PATCH', W('/sprints/' + s1.id), { name: 'Rewritten' })).status).toBe(
      409,
    );
  });

  it('returns the items of a deleted sprint to the backlog', async () => {
    expect((await t.call(ada, 'DELETE', W('/sprints/' + s2.id))).status).toBe(200);
    const after = (await t.call<ItemJson[]>(ada, 'GET', W('/projects/' + project.id + '/items')))
      .body;
    expect(
      after.filter((i) => ['B', 'C'].includes(i.title)).every((i) => i.sprintId === null),
    ).toBe(true);
  });
});
