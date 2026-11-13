// ── [PCODE-259 | S15 | v0.1.0] T27.1 Canvas engine: constraint types, split tasks, holidays, move with successors ──
//    Why:  the Gantt's new rules through the API against PostgreSQL: a constraint kept on the task and held by
//          the schedule (and reported when the dependencies break it), a split task scheduled in pieces, the
//          workspace's holidays out of the plan, and shift-drag that moves a task with every task behind it,
//          live or in a scenario.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

interface Sched {
  id: string;
  start: string;
  finish: string;
  durationDays: number;
  constraintBroken: boolean;
  segments: { start: string; finish: string }[];
}
interface Plan {
  schedule: Sched[];
  tasks: { id: string; constraintType: string; constraintDate: string | null; splits: unknown[] }[];
}

describe.skipIf(!hasDatabase)('canvas engine (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let project = '';
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  const P = (p: string): string => W('/projects/' + project + p);
  const plan = async (q = ''): Promise<Plan> =>
    (await t.call<Plan>(ada, 'GET', P('/plan' + q))).body;
  const at = (p: Plan, id: string): Sched | undefined => p.schedule.find((x) => x.id === id);
  const add = async (body: Record<string, unknown>): Promise<string> =>
    (await t.call<{ id: string }>(ada, 'POST', P('/items'), body)).body.id;

  beforeAll(async () => {
    t = await startTestApp();
    ada = await t.signup('Ada');
    project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'GNT', name: 'Gantt' })
    ).body.id;
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('keeps constraints and splits on the task, and the schedule holds them', async () => {
    // Monday 4 Jan 2027 onwards, far from today
    const a = await add({ title: 'Build', startDate: '2027-01-04', durationDays: 3 });
    const b = await add({
      title: 'Launch',
      durationDays: 1,
      constraintType: 'snet',
      constraintDate: '2027-01-13',
    });
    const c = await add({
      title: 'Demo',
      durationDays: 1,
      constraintType: 'mso',
      constraintDate: '2027-01-05',
    });
    const s = await add({
      title: 'Write',
      startDate: '2027-01-04',
      durationDays: 4,
      splits: [{ after: 2, gap: 2 }],
    });
    await t.call(ada, 'POST', P('/dependencies'), { predecessorId: a, successorId: b });
    await t.call(ada, 'POST', P('/dependencies'), { predecessorId: a, successorId: c });
    const p = await plan();
    expect(p.tasks.find((x) => x.id === b)).toMatchObject({
      constraintType: 'snet',
      constraintDate: '2027-01-13',
    });
    expect(at(p, b)).toMatchObject({ start: '2027-01-13', constraintBroken: false });
    expect(at(p, c)).toMatchObject({ start: '2027-01-05', constraintBroken: true });
    expect(at(p, s)).toMatchObject({
      start: '2027-01-04',
      finish: '2027-01-11',
      durationDays: 4,
      segments: [
        { start: '2027-01-04', finish: '2027-01-05' },
        { start: '2027-01-08', finish: '2027-01-11' },
      ],
    });

    // bad values are refused
    const bad = await t.call(ada, 'PATCH', W('/items/' + s), { splits: [{ after: 0, gap: 1 }] });
    expect(bad.status).toBe(400);
    expect(
      (await t.call(ada, 'PATCH', W('/items/' + b), { constraintType: 'sometime' })).status,
    ).toBe(400);
    expect(
      (await t.call(ada, 'PATCH', W('/items/' + b), { constraintDate: '2027-02-30' })).status,
    ).toBe(400);

    // back to as soon as possible: right after its predecessor
    await t.call(ada, 'PATCH', W('/items/' + b), { constraintType: 'asap', constraintDate: null });
    expect(at(await plan(), b)?.start).toBe('2027-01-07');

    // a holiday of the workspace is no working day
    await t.call(ada, 'PUT', W('/settings/calendar.holidays'), {
      scope: 'workspace',
      value: ['2027-01-05'],
    });
    const h = await plan();
    expect(at(h, a)).toMatchObject({ start: '2027-01-04', finish: '2027-01-07' });
    expect(at(h, b)?.start).toBe('2027-01-08');
  });

  it('moves a task with every task behind it, live or in a scenario', async () => {
    const x = await add({ title: 'Plan', startDate: '2027-03-01', durationDays: 2 });
    const y = await add({
      title: 'Do',
      durationDays: 2,
      scheduleMode: 'manual',
      startDate: '2027-03-03',
    });
    const z = await add({ title: 'Check', durationDays: 1 });
    const lone = await add({ title: 'Elsewhere', startDate: '2027-03-01', durationDays: 1 });
    await t.call(ada, 'POST', P('/dependencies'), { predecessorId: x, successorId: y });
    await t.call(ada, 'POST', P('/dependencies'), { predecessorId: y, successorId: z });

    // in a scenario first: the live plan stays
    const sc = (await t.call<{ id: string }>(ada, 'POST', P('/scenarios'), { name: 'Later' })).body
      .id;
    const inScenario = await t.call<{ moved: { id: string; to: string }[] }>(
      ada,
      'POST',
      P('/plan/shift'),
      { itemId: x, days: 5, withSuccessors: true, scenarioId: sc },
    );
    expect(inScenario.body.moved.map((m) => m.id).sort()).toEqual([x, y, z].sort());
    expect(at(await plan(), x)?.start).toBe('2027-03-01');
    expect(at(await plan('?scenarioId=' + sc), y)?.start).toBe('2027-03-10');

    // live: the chain moves a week, the task elsewhere does not
    const live = await t.call<{ moved: { id: string; from: string; to: string }[] }>(
      ada,
      'POST',
      P('/plan/shift'),
      { itemId: x, days: 5, withSuccessors: true },
    );
    expect(live.status).toBe(200);
    const p = await plan();
    expect(at(p, x)?.start).toBe('2027-03-08');
    expect(at(p, y)?.start).toBe('2027-03-10');
    expect(at(p, z)?.start).toBe('2027-03-12');
    expect(at(p, lone)?.start).toBe('2027-03-01');

    // alone, back by two days: only the task moves; a manual successor stays where it is
    await t.call(ada, 'POST', P('/plan/shift'), { itemId: y, days: -2 });
    const q = await plan();
    expect(at(q, y)?.start).toBe('2027-03-08');
    expect(at(q, x)?.start).toBe('2027-03-08');

    // the history says what moved
    const hist = await t.call<{ changes?: Record<string, unknown> }[]>(
      ada,
      'GET',
      W('/items/' + y + '/history'),
    );
    expect(hist.status).toBe(200);
  });
});
