// ── [PCODE-165 | S15 | v0.1.0] B2.1 Planning and Canvas on the server: plan fields, dependencies, schedule, baselines, scenarios, drafts, retro, workload ──
//    Why:  Planning and the Canvas through the API against PostgreSQL: tasks with plan fields, dependencies
//          without loops, the schedule with its critical path, a baseline that shows the slip, a scenario
//          compared and merged, workload with levelling, the sprint's scope snapshot, carry-over and
//          goal, the review report, the retro board, and the Planner's draft decided line by line.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  scriptedProvider,
  type ModelProvider,
  type ModelReply,
} from '../../src/agents/provider.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

const say = (text: string): ModelReply => ({
  content: [{ type: 'text', text }],
  stopReason: 'end_turn',
  usage: { input: 50, output: 20 },
});

interface Sched {
  id: string;
  start: string;
  finish: string;
  critical: boolean;
  totalFloat: number;
  milestone: boolean;
}
interface Plan {
  schedule: Sched[];
  finish: string;
  dependencies: { id: string }[];
  baseline: {
    variance: { itemId: string; startSlip: number | null; finishSlip: number | null }[];
  } | null;
  scenario: { liveFinish: string; changed: number } | null;
}

describe.skipIf(!hasDatabase)('planning and the canvas (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let current: ModelProvider | null = null;
  let project = '';
  const id: Record<string, string> = {};
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  const P = (p: string): string => W('/projects/' + project + p);
  const plan = async (q = ''): Promise<Plan> =>
    (await t.call<Plan>(ada, 'GET', P('/plan' + q))).body;
  const at = (p: Plan, key: string): Sched | undefined => p.schedule.find((x) => x.id === id[key]);

  beforeAll(async () => {
    t = await startTestApp({
      agents: {
        provider: () => {
          if (!current) throw new Error('no script');
          return Promise.resolve(current);
        },
      },
    });
    ada = await t.signup('Ada');
    project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'PLN', name: 'Plan' })
    ).body.id;
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('creates tasks with plan fields and refuses dates that cannot be', async () => {
    const a = await t.call<{
      id: string;
      kind: string;
      priority: string;
      startDate: string;
      durationDays: number;
      ready: boolean;
      scheduleMode: string;
    }>(ada, 'POST', P('/items'), {
      title: 'Design',
      kind: 'story',
      priority: 'high',
      startDate: '2030-01-07',
      durationDays: 3,
      assigneeId: ada.id,
      estimate: 5,
    });
    expect(a.status).toBe(201);
    expect(a.body).toMatchObject({
      kind: 'story',
      priority: 'high',
      startDate: '2030-01-07',
      durationDays: 3,
      ready: false,
      scheduleMode: 'auto',
    });
    id['A'] = a.body.id;
    id['B'] = (
      await t.call<{ id: string }>(ada, 'POST', P('/items'), {
        title: 'Build',
        durationDays: 2,
        estimate: 3,
      })
    ).body.id;
    id['C'] = (
      await t.call<{ id: string }>(ada, 'POST', P('/items'), {
        title: 'Docs',
        startDate: '2030-01-08',
        durationDays: 1,
        assigneeId: ada.id,
      })
    ).body.id;
    const m = await t.call<{ id: string; durationDays: number }>(ada, 'POST', P('/items'), {
      title: 'Pilot',
      kind: 'milestone',
      durationDays: 4,
    });
    expect(m.body.durationDays).toBe(0);
    id['M'] = m.body.id;
    expect(
      (
        await t.call(ada, 'POST', P('/items'), {
          title: 'x',
          startDate: '2030-01-09',
          dueDate: '2030-01-08',
        })
      ).status,
    ).toBe(400);
    expect(
      (await t.call(ada, 'POST', P('/items'), { title: 'x', startDate: '2030-02-30' })).status,
    ).toBe(400);
    const ready = await t.call<{ ready: boolean; priority: string }>(
      ada,
      'PATCH',
      W('/items/' + (id['B'] ?? '')),
      { ready: true, priority: 'urgent' },
    );
    expect(ready.body).toMatchObject({ ready: true, priority: 'urgent' });
  });

  it('links tasks and refuses loops, twins and links to itself', async () => {
    const ab = await t.call<{ id: string; kind: string }>(ada, 'POST', P('/dependencies'), {
      predecessorId: id['A'],
      successorId: id['B'],
    });
    expect(ab.status).toBe(201);
    expect(ab.body.kind).toBe('FS');
    expect(
      (
        await t.call(ada, 'POST', P('/dependencies'), {
          predecessorId: id['B'],
          successorId: id['M'],
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await t.call(ada, 'POST', P('/dependencies'), {
          predecessorId: id['M'],
          successorId: id['A'],
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await t.call(ada, 'POST', P('/dependencies'), {
          predecessorId: id['A'],
          successorId: id['B'],
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await t.call(ada, 'POST', P('/dependencies'), {
          predecessorId: id['A'],
          successorId: id['A'],
        })
      ).status,
    ).toBe(400);
    const lag = await t.call<{ lagDays: number }>(ada, 'PATCH', W('/dependencies/' + ab.body.id), {
      lagDays: 0,
      kind: 'FS',
    });
    expect(lag.status).toBe(200);
  });

  it('schedules the plan over working days with its critical path', async () => {
    const p = await plan();
    expect(at(p, 'A')).toMatchObject({ start: '2030-01-07', finish: '2030-01-09', critical: true });
    expect(at(p, 'B')).toMatchObject({ start: '2030-01-10', finish: '2030-01-11', critical: true });
    expect(at(p, 'M')).toMatchObject({ milestone: true, start: '2030-01-14', critical: true });
    expect(at(p, 'C')).toMatchObject({ critical: false });
    expect(at(p, 'C')?.totalFloat).toBeGreaterThan(0);
    expect(p.dependencies).toHaveLength(2);
  });

  it('saves a baseline and shows what slipped since', async () => {
    const b = await t.call<{ id: string; tasks: number }>(ada, 'POST', P('/baselines'), {
      name: 'Plan v1',
    });
    expect(b.status).toBe(201);
    expect(b.body.tasks).toBe(4);
    expect((await t.call(ada, 'POST', P('/baselines'), { name: 'Plan v1' })).status).toBe(409);
    await t.call(ada, 'PATCH', W('/items/' + (id['A'] ?? '')), { durationDays: 5 });
    const p = await plan('?baselineId=' + b.body.id);
    expect(at(p, 'B')).toMatchObject({ start: '2030-01-14', finish: '2030-01-15' });
    expect(p.baseline?.variance.find((v) => v.itemId === id['B'])).toMatchObject({
      startSlip: 2,
      finishSlip: 2,
    });
    expect(p.baseline?.variance.find((v) => v.itemId === id['C'])).toMatchObject({ startSlip: 0 });
  });

  it('branches a scenario, compares it with the live plan and merges it', async () => {
    const sc = await t.call<{ id: string; changed: number }>(ada, 'POST', P('/scenarios'), {
      name: 'Faster build',
      changes: { [id['B'] ?? '']: { durationDays: 1 } },
    });
    expect(sc.status).toBe(201);
    expect(sc.body.changed).toBe(1);
    expect(
      (
        await t.call(ada, 'POST', P('/scenarios'), {
          name: 'x',
          changes: { [project]: { durationDays: 1 } },
        })
      ).status,
    ).toBe(400);
    const p = await plan('?scenarioId=' + sc.body.id);
    expect(at(p, 'B')?.finish).toBe('2030-01-14');
    expect(p.scenario).toMatchObject({ liveFinish: '2030-01-15', changed: 1 });
    expect((await plan()).finish).toBe('2030-01-15');
    const merged = await t.call<{ changedTasks: number; scenario: { status: string } }>(
      ada,
      'POST',
      W('/scenarios/' + sc.body.id + '/merge'),
    );
    expect(merged.body).toMatchObject({ changedTasks: 1, scenario: { status: 'merged' } });
    const b = await t.call<{ durationDays: number }>(ada, 'GET', W('/items/' + (id['B'] ?? '')));
    expect(b.body.durationDays).toBe(1);
    expect((await t.call(ada, 'POST', W('/scenarios/' + sc.body.id + '/merge'))).status).toBe(409);
    const other = await t.call<{ id: string }>(ada, 'POST', P('/scenarios'), { name: 'Throwaway' });
    expect(
      (await t.call<{ status: string }>(ada, 'DELETE', W('/scenarios/' + other.body.id))).body
        .status,
    ).toBe('discarded');
  });

  it('shows the workload per day and levels it within the float', async () => {
    const w = await t.call<{
      people: { name: string; overDays: number; days: { date: string; percent: number }[] }[];
      levelling: {
        moves: { ref: string; to: string }[];
        finishBefore: string;
        finishAfter: string;
      };
    }>(ada, 'GET', P('/workload?from=2030-01-07&to=2030-01-18'));
    expect(w.status).toBe(200);
    const mine = w.body.people.find((x) => x.name === ada.name);
    expect(mine?.overDays).toBe(1);
    expect(mine?.days.find((d) => d.date === '2030-01-08')?.percent).toBe(200);
    expect(w.body.levelling.moves).toEqual([
      { id: id['C'], ref: 'PLN-3', from: '2030-01-08', to: '2030-01-14' },
    ]);
    expect(w.body.levelling.finishAfter).toBe(w.body.levelling.finishBefore);
    const done = await t.call<{ moved: number }>(ada, 'POST', P('/plan/level'));
    expect(done.body.moved).toBe(1);
    expect(
      (await t.call<{ startDate: string }>(ada, 'GET', W('/items/' + (id['C'] ?? '')))).body
        .startDate,
    ).toBe('2030-01-14');
  });

  it('keeps the sprint scope at the start, flags additions, counts carry-over and the goal', async () => {
    const sp = (
      await t.call<{ id: string }>(ada, 'POST', P('/sprints'), {
        name: 'Sprint 1',
        goal: 'Pilot ready',
      })
    ).body.id;
    await t.call(ada, 'PATCH', W('/items/' + (id['A'] ?? '')), { sprintId: sp });
    await t.call(ada, 'POST', W('/sprints/' + sp + '/start'));
    await t.call(ada, 'PATCH', W('/items/' + (id['B'] ?? '')), { sprintId: sp });
    const list = await t.call<{ id: string; addedCount: number }[]>(ada, 'GET', P('/sprints'));
    expect(list.body.find((x) => x.id === sp)?.addedCount).toBe(1);
    const rep = await t.call<{
      committed: { items: number; points: number };
      added: { ref: string }[];
      notDone: unknown[];
    }>(ada, 'GET', W('/sprints/' + sp + '/report'));
    expect(rep.body).toMatchObject({
      committed: { items: 1, points: 5 },
      added: [{ ref: 'PLN-2' }],
    });
    expect(rep.body.notDone).toHaveLength(2);
    const done = await t.call<{ sprint: { goalMet: boolean }; moved: number }>(
      ada,
      'POST',
      W('/sprints/' + sp + '/complete'),
      { moveTo: null, goalMet: false },
    );
    expect(done.body).toMatchObject({ sprint: { goalMet: false }, moved: 2 });
    expect(
      (await t.call<{ carriedCount: number }>(ada, 'GET', W('/items/' + (id['A'] ?? '')))).body
        .carriedCount,
    ).toBe(1);
    id['S1'] = sp;
  });

  it('runs the retro: notes, one vote each, and an action that becomes a task', async () => {
    const sp = id['S1'] ?? '';
    const next = (await t.call<{ id: string }>(ada, 'POST', P('/sprints'), { name: 'Sprint 2' }))
      .body.id;
    const well = await t.call<{ id: string }>(ada, 'POST', W('/sprints/' + sp + '/retro'), {
      kind: 'well',
      body: 'Pairing on the design',
    });
    expect(well.status).toBe(201);
    const act = await t.call<{ id: string }>(ada, 'POST', W('/sprints/' + sp + '/retro'), {
      kind: 'action',
      body: 'Estimate spikes before planning',
    });
    expect(
      (
        await t.call<{ votes: number; votedByMe: boolean }>(
          ada,
          'POST',
          W('/retro-notes/' + act.body.id + '/vote'),
        )
      ).body,
    ).toMatchObject({ votes: 1, votedByMe: true });
    expect(
      (await t.call<{ votes: number }>(ada, 'POST', W('/retro-notes/' + act.body.id + '/vote')))
        .body.votes,
    ).toBe(0);
    expect((await t.call(ada, 'POST', W('/retro-notes/' + well.body.id + '/task'))).status).toBe(
      409,
    );
    const task = await t.call<{ itemId: string; itemRef: string }>(
      ada,
      'POST',
      W('/retro-notes/' + act.body.id + '/task'),
    );
    expect(task.body.itemRef).toMatch(/^PLN-\d+$/);
    expect(
      (await t.call<{ sprintId: string }>(ada, 'GET', W('/items/' + task.body.itemId))).body
        .sprintId,
    ).toBe(next);
    expect((await t.call(ada, 'POST', W('/retro-notes/' + act.body.id + '/task'))).status).toBe(
      409,
    );
    const board = await t.call<{ kind: string }[]>(ada, 'GET', W('/sprints/' + sp + '/retro'));
    expect(board.body.map((n) => n.kind).sort()).toEqual(['action', 'well']);
    id['S2'] = next;
  });

  it('keeps the Planner’s draft and decides it line by line', async () => {
    const sp = id['S2'] ?? '';
    await t.call(ada, 'PUT', W('/sprints/' + sp + '/capacity'), {
      entries: [{ userId: ada.id, points: 20 }],
    });
    current = scriptedProvider([
      say(
        '```json\n{"items": [{"ref": "PLN-1", "why": "Carried over", "confidence": 0.9}, {"ref": "PLN-2", "why": "Unblocks the pilot", "confidence": 65}], "reasons": "Finish the build.", "considered": ["Velocity unknown", "Pilot on 14 Jan"]}\n```',
      ),
    ]);
    const d = await t.call<{
      draftId: string;
      lines: { ref: string; why: string; confidence: number }[];
      considered: string[];
    }>(ada, 'POST', W('/sprints/' + sp + '/plan/draft'));
    expect(d.status).toBe(200);
    expect(d.body.lines).toMatchObject([
      { ref: 'PLN-1', why: 'Carried over', confidence: 0.9 },
      { ref: 'PLN-2', why: 'Unblocks the pilot', confidence: 0.65 },
    ]);
    expect(d.body.considered).toEqual(['Velocity unknown', 'Pilot on 14 Jan']);
    const decided = await t.call<{
      draft: { status: string; lines: { decision: string | null; reason: string }[] };
      capacity: { committed: number };
    }>(ada, 'POST', W('/plan-drafts/' + d.body.draftId + '/decide'), {
      accept: [id['A']],
      decline: [{ itemId: id['B'], reason: 'Waits for the design review' }],
    });
    expect(decided.body.draft.status).toBe('decided');
    expect(decided.body.draft.lines.map((l) => l.decision)).toEqual(['accepted', 'declined']);
    expect(decided.body.draft.lines[1]?.reason).toBe('Waits for the design review');
    expect(decided.body.capacity.committed).toBe(5);
    expect(
      (
        await t.call(ada, 'POST', W('/plan-drafts/' + d.body.draftId + '/decide'), {
          accept: [id['B']],
        })
      ).status,
    ).toBe(409);
    const latest = await t.call<{ id: string; status: string } | null>(
      ada,
      'GET',
      W('/sprints/' + sp + '/plan/draft'),
    );
    expect(latest.body).toMatchObject({ id: d.body.draftId, status: 'decided' });
  });

  it('removes a dependency and the plan follows', async () => {
    const p = await plan();
    const dep = p.dependencies[0]?.id ?? '';
    expect((await t.call(ada, 'DELETE', W('/dependencies/' + dep))).status).toBe(200);
    expect((await plan()).dependencies).toHaveLength(1);
  });
});
