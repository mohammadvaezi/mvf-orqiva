// ── [PCODE-463 | S15 | v0.1.0] Finishing a task never dead-ends on missing fingerprints: Claude marks the code, or finish without marks ──
// ── [PCODE-462 | S15 | v0.1.0] Tasks run in plan order, finish by themselves, and show the same state in VS Code and the portal ──
//    Why:  against a fake server: publishing chains the plan's tasks and makes them To do and ready, a
//          second run adds nothing, a task someone linked by hand keeps its own order; the board says
//          what a task waits for until the task before is handed on; Build with Claude ends with orq done.
import { describe, expect, it } from 'vitest';
import { markPrompt, taskPrompt } from '../../src/commands/devCommands';
import { finishTask } from '../../src/commands/taskCommands';
import { ensurePlanOrder } from '../../src/plan/orqivaPlan';
import { boardFromServer } from '../../src/server/connection';
import type { PlanJson } from '../../src/state/types';

const T = { server: 'http://o.test', token: 't', workspaceId: 'w', projectId: 'p' };
const STATES = [
  { id: 'sb', name: 'Backlog', group: 'backlog' },
  { id: 'st', name: 'Todo', group: 'unstarted' },
  { id: 'sp', name: 'In Progress', group: 'started' },
  { id: 'sr', name: 'Review', group: 'started' },
  { id: 'sd', name: 'Done', group: 'completed' },
];
const item = (n: number, title: string, stateId = 'sb') => ({
  id: 'i' + String(n),
  ref: 'MARK-' + String(n),
  title,
  stateId,
  ready: false,
});
const plan = (titles: string[][]): PlanJson =>
  ({
    version: '0.1.0',
    sprints: titles.map((items, n) => ({
      name: 'Sprint 0' + String(n + 1),
      date: '2026-10-2' + String(n + 6),
      goal: 'g',
      items: items.map((title) => ({ title })),
    })),
  }) as unknown as PlanJson;

function fake(
  items: ReturnType<typeof item>[],
  deps: { predecessorId: string; successorId: string }[],
) {
  const calls: { method: string; path: string; body: Record<string, unknown> }[] = [];
  const fetchImpl = ((url: string, init: RequestInit) => {
    const method = init.method ?? 'GET';
    const p = url.slice(T.server.length);
    const body = init.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : {};
    calls.push({ method, path: p, body });
    const json = (v: unknown, status = 200) =>
      Promise.resolve(new Response(JSON.stringify(v), { status }));
    if (p === '/api/workspaces/w/projects/p') return json({ states: STATES });
    if (p === '/api/workspaces/w/projects/p/items') return json(items);
    if (p === '/api/workspaces/w/projects/p/plan') return json({ dependencies: deps });
    if (p === '/api/workspaces/w/projects/p/dependencies') {
      deps.push(body as never);
      return json({ id: 'd' }, 201);
    }
    const patched = /\/items\/(i\d+)$/.exec(p)?.[1];
    const it = items.find((x) => x.id === patched);
    if (it && method === 'PATCH') {
      Object.assign(it, body);
      return json(it);
    }
    return json({ error: { message: 'no route' } }, 404);
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

describe('the plan order on the server', () => {
  it('chains the tasks across sprints, makes them To do and ready, and adds nothing the second time', async () => {
    const items = [item(1, 'Repo'), item(2, 'API'), item(3, 'Web'), item(4, 'Database', 'sp')];
    const deps: { predecessorId: string; successorId: string }[] = [];
    const s = fake(items, deps);
    const p = plan([['Repo', 'API', 'Web'], ['Database']]);
    expect(await ensurePlanOrder(T, p, s.fetchImpl)).toEqual({ links: 3, ready: 4 });
    expect(deps).toEqual([
      { predecessorId: 'i1', successorId: 'i2' },
      { predecessorId: 'i2', successorId: 'i3' },
      { predecessorId: 'i3', successorId: 'i4' },
    ]);
    expect(items.map((i) => [i.stateId, i.ready])).toEqual([
      ['st', true],
      ['st', true],
      ['st', true],
      ['sp', true], // started: it stays where it is
    ]);
    expect(await ensurePlanOrder(T, p, s.fetchImpl)).toEqual({ links: 0, ready: 0 });
  });

  it('keeps an order someone set by hand', async () => {
    const items = [item(1, 'Repo'), item(2, 'API'), item(3, 'Web')];
    const deps = [{ predecessorId: 'i1', successorId: 'i3' }];
    const s = fake(items, deps);
    await ensurePlanOrder(T, plan([['Repo', 'API', 'Web']]), s.fetchImpl);
    expect(deps).toEqual([
      { predecessorId: 'i1', successorId: 'i3' },
      { predecessorId: 'i1', successorId: 'i2' },
    ]);
  });
});

describe('the board in VS Code', () => {
  it('says what a task waits for until the task before is handed on', () => {
    const sprints = [
      {
        id: 's1',
        name: 'Sprint 01',
        number: 1,
        status: 'active',
        goal: '',
        startDate: null,
        endDate: null,
      },
    ];
    const items = [
      { ...item(1, 'Repo', 'sp'), sprintId: 's1', labelIds: [], rank: 1, sequence: 1 },
      { ...item(2, 'API', 'st'), sprintId: 's1', labelIds: [], rank: 2, sequence: 2 },
    ];
    const deps = [{ predecessorId: 'i1', successorId: 'i2' }];
    const board = (st: string) =>
      boardFromServer(
        'http://o.test',
        STATES,
        sprints,
        items.map((i) => (i.id === 'i1' ? { ...i, stateId: st } : i)),
        [],
        '2026-10-26',
        deps,
      )[0]?.items.find((i) => i.ref === 'MARK-2')?.waitsFor;
    expect(board('sp')).toEqual(['MARK-1']);
    expect(board('sr')).toBeUndefined();
    expect(board('sd')).toBeUndefined();
  });

  it('asks Claude to hand the task on with orq done when it is finished', () => {
    const p = taskPrompt('MARK-1', 'Initialise the repo', 'node "C:/Orqiva/bin/orq.mjs"');
    expect(p).toContain('node "C:/Orqiva/bin/orq.mjs" show MARK-1');
    expect(p).toContain('node "C:/Orqiva/bin/orq.mjs" done MARK-1');
    expect(p).not.toContain('plane');
  });
});

// ── [PCODE-463 | S15 | v0.1.0] Finished without fingerprints: a way on, never a dead end ──
describe('finishing a task whose code has no fingerprint', () => {
  const done = { ref: 'MARK-1', state: 'Review', files: 0, commit: null };
  const services = (calls: unknown[]) =>
    ({
      engine: {
        done: (ref: string, opts?: { force?: boolean }) => {
          calls.push(opts ?? {});
          return opts?.force
            ? Promise.resolve(done)
            : Promise.reject(
                new Error(
                  'No fingerprint of ' +
                    ref +
                    ' in the code. Mark the code you wrote for it, or for a task without code: orq done ' +
                    ref +
                    ' --force',
                ),
              );
        },
      },
      store: { state: { active: null } },
      root: () => null,
    }) as never;
  const run = <T>(_t: string, fn: () => Promise<T>): Promise<T> => fn();

  it('finishes without marks when asked to, and moves it on', async () => {
    const calls: unknown[] = [];
    const r = await finishTask(services(calls), 'MARK-1', run, (_m, _d, ...items) =>
      Promise.resolve(items[1]),
    );
    expect(r).toEqual(done);
    expect(calls).toEqual([{}, { force: true }]);
  });

  it('does nothing more when the dialog is closed, and passes other errors on', async () => {
    const calls: unknown[] = [];
    expect(
      await finishTask(services(calls), 'MARK-1', run, () => Promise.resolve(undefined)),
    ).toBeNull();
    expect(calls).toEqual([{}]);
    const broken = { engine: { done: () => Promise.reject(new Error('Server away')) } } as never;
    await expect(
      finishTask(broken, 'MARK-1', run, () => Promise.resolve(undefined)),
    ).rejects.toThrow('Server away');
  });

  it('asks Claude to mark the code with the exact fingerprint and to finish with orq done', () => {
    const p = markPrompt(
      'MARK-1',
      'Initialise the repo',
      'orq',
      '[MARK-1 | S01 | v0.1.0] Initialise the repo',
    );
    expect(p).toContain('"[MARK-1 | S01 | v0.1.0] Initialise the repo"');
    expect(p).toContain('orq done MARK-1');
    expect(taskPrompt('MARK-2', 'API', 'orq', '[MARK-2 | S01 | v0.1.0] API')).toContain(
      'fingerprint comment "[MARK-2 | S01 | v0.1.0] API"',
    );
  });
});
