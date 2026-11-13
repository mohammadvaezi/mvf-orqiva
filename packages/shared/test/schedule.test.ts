// ── [PCODE-259 | S15 | v0.1.0] T27.1 Canvas engine: constraint types, split tasks, holidays, move with successors ──
// ── [PCODE-165 | S15 | v0.1.0] B2.1 Planning and Canvas on the server: plan fields, dependencies, schedule, baselines, scenarios, drafts, retro, workload ──
//    Why:  the engine behind the Gantt, the critical path and the workload, checked by hand-computed
//          plans: working days and holidays, all four dependency kinds with lag, float, summary tasks,
//          manual tasks that break a dependency, loops, and levelling that keeps the finish date.
import { describe, expect, it } from 'vitest';
import {
  levelResources,
  schedulePlan,
  splitsProblem,
  successorsOf,
  wbsCodes,
  WorkCalendar,
  workload,
  wouldCycle,
  type PlanDependency,
  type PlanTask,
} from '../src/schedule.js';

const cal = (): WorkCalendar => new WorkCalendar({ anchor: '2026-10-05' });
const task = (
  id: string,
  durationDays: number,
  rank: number,
  extra: Partial<PlanTask> = {},
): PlanTask => ({
  id,
  parentId: null,
  rank,
  startDate: null,
  dueDate: null,
  durationDays,
  mode: 'auto',
  percentDone: 0,
  ...extra,
});
const dep = (
  predecessorId: string,
  successorId: string,
  kind: PlanDependency['kind'] = 'FS',
  lagDays = 0,
): PlanDependency => ({
  predecessorId,
  successorId,
  kind,
  lagDays,
});

describe('working calendar', () => {
  it('counts working days, skips weekends and holidays, goes both ways', () => {
    const c = cal();
    expect(c.index('2026-10-10')).toBe(5); // Saturday counts as the Monday after
    expect(c.date(5)).toBe('2026-10-12');
    expect(c.date(-1)).toBe('2026-10-02');
    expect(c.span('2026-10-05', '2026-10-11')).toBe(5);
    expect(c.addWorkdays('2026-10-09', 1)).toBe('2026-10-12');
    const h = new WorkCalendar({ anchor: '2026-10-05', holidays: ['2026-10-06'] });
    expect(h.addWorkdays('2026-10-05', 1)).toBe('2026-10-07');
    const six = new WorkCalendar({
      anchor: '2026-10-05',
      workingDays: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'],
    });
    expect(six.addWorkdays('2026-10-09', 1)).toBe('2026-10-10');
  });
});

describe('schedule', () => {
  const tasks = [
    task('P', 0, 1),
    task('A', 3, 1, { parentId: 'P' }),
    task('B', 2, 2, { parentId: 'P' }),
    task('C', 1, 2),
    task('D', 2, 3),
    task('M', 0, 4, { kind: 'milestone' }),
    task('E', 1, 5),
  ];
  const deps = [dep('A', 'B'), dep('A', 'C', 'SS', 1), dep('B', 'D', 'FF'), dep('D', 'M')];

  it('places every task as early as its dependencies allow, with float and the critical path', () => {
    const s = schedulePlan(tasks, deps, cal());
    const by = new Map(s.tasks.map((t) => [t.id, t]));
    expect(by.get('A')).toMatchObject({
      start: '2026-10-05',
      finish: '2026-10-07',
      totalFloat: 0,
      critical: true,
      wbs: '1.1',
    });
    expect(by.get('B')).toMatchObject({
      start: '2026-10-08',
      finish: '2026-10-09',
      critical: true,
    });
    expect(by.get('C')).toMatchObject({ start: '2026-10-06', totalFloat: 3, critical: false });
    expect(by.get('D')).toMatchObject({
      start: '2026-10-08',
      finish: '2026-10-09',
      critical: true,
    });
    expect(by.get('M')).toMatchObject({ milestone: true, start: '2026-10-12', durationDays: 0 });
    expect(by.get('E')).toMatchObject({ totalFloat: 4, critical: false });
    expect(by.get('P')).toMatchObject({
      summary: true,
      start: '2026-10-05',
      finish: '2026-10-09',
      durationDays: 5,
      wbs: '1',
    });
    expect(s.finish).toBe('2026-10-09');
    expect(s.tasks.map((t) => t.wbs)).toEqual(['1', '1.1', '1.2', '2', '3', '4', '5']);
  });

  it('keeps an auto task from starting before its own start date, and a manual task where it is', () => {
    const s = schedulePlan(
      [
        task('A', 3, 1),
        task('B', 1, 2, { startDate: '2026-10-14' }),
        task('X', 1, 3, { mode: 'manual', startDate: '2026-10-05' }),
      ],
      [dep('A', 'B'), dep('A', 'X')],
      cal(),
    );
    const by = new Map(s.tasks.map((t) => [t.id, t]));
    expect(by.get('B')?.start).toBe('2026-10-14');
    expect(by.get('X')).toMatchObject({ start: '2026-10-05', violations: ['A'] });
  });

  it('derives the duration from the dates, and rolls % done up by duration', () => {
    const s = schedulePlan(
      [
        task('P', 0, 1),
        task('A', 0, 1, {
          parentId: 'P',
          durationDays: null,
          startDate: '2026-10-05',
          dueDate: '2026-10-09',
          percentDone: 100,
        }),
        task('B', 5, 2, { parentId: 'P', startDate: '2026-10-12' }),
      ],
      [],
      cal(),
    );
    expect(s.tasks.find((t) => t.id === 'A')?.durationDays).toBe(5);
    expect(s.tasks.find((t) => t.id === 'P')?.percentDone).toBe(50);
  });

  it('reports a dependency loop and ignores links to summary tasks', () => {
    const s = schedulePlan(
      [task('P', 0, 1), task('A', 1, 1, { parentId: 'P' }), task('B', 1, 2), task('C', 1, 3)],
      [dep('B', 'C'), dep('C', 'B'), dep('P', 'B')],
      cal(),
    );
    expect(s.cycle.sort()).toEqual(['B', 'C']);
    expect(s.ignored).toHaveLength(1);
    expect(wouldCycle([dep('A', 'B'), dep('B', 'C')], 'C', 'A')).toBe(true);
    expect(wouldCycle([dep('A', 'B')], 'A', 'C')).toBe(false);
  });

  it('numbers the outline by rank', () => {
    const codes = wbsCodes([
      { id: 'x', parentId: null, rank: 2 },
      { id: 'y', parentId: null, rank: 1 },
      { id: 'z', parentId: 'x', rank: 1 },
    ]);
    expect([codes.get('y'), codes.get('x'), codes.get('z')]).toEqual(['1', '2', '2.1']);
  });
});

describe('workload and levelling', () => {
  const tasks = [
    task('A', 3, 1, { assigneeId: 'u1' }),
    task('B', 2, 2, { assigneeId: 'u2' }),
    task('C', 1, 3, { assigneeId: 'u1' }),
  ];
  const deps = [dep('A', 'B'), dep('A', 'C', 'SS', 1)];

  it('shows a person planned twice on one day', () => {
    const c = cal();
    const rows = workload(schedulePlan(tasks, deps, c), tasks, c, '2026-10-05', '2026-10-09');
    const u1 = rows.find((r) => r.assigneeId === 'u1');
    expect(u1?.days.map((d) => d.percent)).toEqual([100, 200, 100, 0, 0]);
    expect(u1).toMatchObject({ peak: 200, overDays: 1 });
  });

  it('levels by delaying the task with float and keeps the finish date', () => {
    const l = levelResources(tasks, deps, cal());
    expect(l.moves).toEqual([{ id: 'C', from: '2026-10-06', to: '2026-10-08' }]);
    expect(l.finishAfter).toBe(l.finishBefore);
  });
});

// [PCODE-259 | S15 | v0.1.0] constraints, as late as possible, splits and the chain behind a task
describe('constraints and splits', () => {
  const at = (sched: ReturnType<typeof schedulePlan>, id: string) =>
    sched.tasks.find((t) => t.id === id);

  it('holds the floors and fixed days, and says when a constraint breaks', () => {
    const s = schedulePlan(
      [
        task('a', 3, 1),
        task('b', 2, 2, { constraintType: 'snet', constraintDate: '2026-10-12' }),
        task('c', 2, 3, { constraintType: 'fnet', constraintDate: '2026-10-09' }),
        task('d', 2, 4, { constraintType: 'mso', constraintDate: '2026-10-06' }),
        task('e', 2, 5, { constraintType: 'snlt', constraintDate: '2026-10-06' }),
        task('f', 2, 6, { constraintType: 'mfo', constraintDate: '2026-10-09' }),
        task('g', 1, 7, { constraintType: 'snet', constraintDate: null }),
      ],
      [dep('a', 'b'), dep('a', 'd'), dep('a', 'e')],
      cal(),
    );
    expect(at(s, 'b')).toMatchObject({ start: '2026-10-12', constraintBroken: false });
    expect(at(s, 'c')).toMatchObject({ start: '2026-10-08', finish: '2026-10-09' });
    // must start on wins over the dependency, and says it breaks it
    expect(at(s, 'd')).toMatchObject({ start: '2026-10-06', constraintBroken: true });
    // no later than: the dependency wins, the constraint is broken, and the chain turns critical
    expect(at(s, 'e')).toMatchObject({ start: '2026-10-08', constraintBroken: true });
    expect(at(s, 'e')?.totalFloat).toBeLessThan(0);
    expect(at(s, 'a')?.critical).toBe(true);
    expect(at(s, 'f')).toMatchObject({ start: '2026-10-08', finish: '2026-10-09' });
    // a dated kind without a date is as soon as possible
    expect(at(s, 'g')).toMatchObject({ start: '2026-10-05', constraintBroken: false });
  });

  it('puts an as-late-as-possible task against its successor or the plan end', () => {
    const s = schedulePlan(
      [
        task('long', 5, 1),
        task('late', 1, 2, { constraintType: 'alap' }),
        task('x', 2, 3, { constraintType: 'alap' }),
        task('y', 1, 4),
      ],
      [dep('x', 'y'), dep('long', 'y')],
      cal(),
    );
    expect(at(s, 'y')?.start).toBe('2026-10-12');
    expect(at(s, 'late')?.start).toBe('2026-10-12');
    expect(at(s, 'x')).toMatchObject({ start: '2026-10-08', finish: '2026-10-09' });
  });

  it('runs a split task in pieces, with the successor after the last one', () => {
    const c = cal();
    const tasks = [
      task('s', 4, 1, { splits: [{ after: 2, gap: 1 }], assigneeId: 'u' }),
      task('n', 1, 2),
    ];
    const s = schedulePlan(tasks, [dep('s', 'n')], c);
    expect(at(s, 's')).toMatchObject({
      start: '2026-10-05',
      finish: '2026-10-09',
      durationDays: 4,
      segments: [
        { start: '2026-10-05', finish: '2026-10-06' },
        { start: '2026-10-08', finish: '2026-10-09' },
      ],
    });
    expect(at(s, 'n')?.start).toBe('2026-10-12');
    const w = workload(s, tasks, c, '2026-10-05', '2026-10-10')[0];
    expect(w?.days.map((d) => d.percent)).toEqual([100, 100, 0, 100, 100]);
    // a split past the end of the work does nothing
    const one = schedulePlan([task('o', 2, 1, { splits: [{ after: 3, gap: 2 }] })], [], c);
    expect(at(one, 'o')).toMatchObject({ finish: '2026-10-06', segments: [] });
    expect(splitsProblem([{ after: 0, gap: 1 }])).toMatch(/after/);
    expect(
      splitsProblem([
        { after: 1, gap: 1 },
        { after: 1, gap: 2 },
      ]),
    ).toMatch(/same/);
    expect(splitsProblem([{ after: 2, gap: 3 }])).toBeNull();
  });

  it('follows the dependencies to every task behind one', () => {
    expect(
      successorsOf([dep('a', 'b'), dep('b', 'c'), dep('a', 'd'), dep('x', 'a')], 'a').sort(),
    ).toEqual(['b', 'c', 'd']);
  });
});
