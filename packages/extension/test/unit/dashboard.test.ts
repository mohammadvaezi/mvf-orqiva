// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-65 | S13 | v0.1.0] Build the multi-project dashboard panel across the Plane workspace ──
//    Task: https://plan.broszio.com/prodsystem/projects/74f47636-71b0-4eb5-94b5-ea2fe840ec01/issues/
//    Why:  two things can go wrong here and neither shows up by looking at the panel. The counts can
//          disagree with the board (a state group read wrongly), and the workspace can be hammered - three
//          reads per project, as many projects as Plane has. Both are asserted: the arithmetic against
//          fixed issues, and the request count and ordering against a client that records every call.
import { describe, expect, it } from 'vitest';
import {
  ago,
  buildRow,
  countByGroup,
  currentCycle,
  lastActivity,
  sortRows,
  type ProjectRow,
} from '../../src/dashboard/aggregate';
import { CACHE_TTL_MS, Dashboard } from '../../src/dashboard/dashboardService';
import {
  FOLDERS_KEY,
  knownFolders,
  pruneFolders,
  readFolders,
  rememberFolder,
  type MementoLike,
} from '../../src/dashboard/folders';
import type { Cycle, Issue, Project, State } from '../../src/plane/types';

const STATES: State[] = [
  { id: 's-backlog', name: 'Backlog', group: 'backlog', color: '#111' },
  { id: 's-todo', name: 'Todo', group: 'unstarted', color: '#222' },
  { id: 's-prog', name: 'In Progress', group: 'started', color: '#333' },
  { id: 's-review', name: 'Review', group: 'started', color: '#444' },
  { id: 's-done', name: 'Done', group: 'completed', color: '#555' },
  { id: 's-cancel', name: 'Cancelled', group: 'cancelled', color: '#666' },
];

function issue(state: string, updated?: string): Issue {
  return {
    id: `i-${state}-${updated ?? '0'}`,
    sequence_id: 1,
    name: 'x',
    state,
    priority: 'medium',
    labels: [],
    ...(updated ? { updated_at: updated } : {}),
  };
}

describe('countByGroup', () => {
  it('collapses the five Plane groups into the columns, splitting Review out of started', () => {
    const issues = [
      issue('s-backlog'),
      issue('s-todo'),
      issue('s-todo'),
      issue('s-prog'),
      issue('s-review'),
      issue('s-done'),
      issue('s-done'),
      issue('s-done'),
      issue('s-cancel'),
    ];
    expect(countByGroup(issues, STATES)).toEqual({
      open: 3, // backlog + the two Todo
      inProgress: 1, // only the one genuinely being worked on
      review: 1, // Review is 'started' in Plane, but it is waiting for a person
      done: 3,
      cancelled: 1,
      total: 9,
    });
  });

  // ── [PCODE-65 | S13 | v0.1.0] found against the real workspace ──
  //    Orqiva had every finished item sitting in Review; counting the group reported "67 in progress",
  //    which is true of Plane's grouping and false of the project.
  it('does not report work awaiting sign-off as work in flight', () => {
    const waiting = Array.from({ length: 67 }, () => issue('s-review'));
    const counts = countByGroup([...waiting, issue('s-prog')], STATES);
    expect(counts.review).toBe(67);
    expect(counts.inProgress).toBe(1);
  });

  it('counts Test as waiting too, and an unnamed started state as in progress', () => {
    const states: State[] = [
      ...STATES,
      { id: 's-test', name: 'Test', group: 'started', color: '#777' },
      { id: 's-custom', name: 'Doing the thing', group: 'started', color: '#888' },
    ];
    const counts = countByGroup([issue('s-test'), issue('s-custom')], states);
    expect(counts.review).toBe(1);
    expect(counts.inProgress).toBe(1);
  });

  it('counts an issue in an unknown state in the total only, so the columns never exceed it', () => {
    const counts = countByGroup([issue('s-made-up'), issue('s-done')], STATES);
    expect(counts.total).toBe(2);
    expect(counts.open + counts.inProgress + counts.review + counts.done + counts.cancelled).toBe(
      1,
    );
  });

  it('is zero for a project with no issues', () => {
    expect(countByGroup([], STATES).total).toBe(0);
  });
});

describe('currentCycle', () => {
  const cycles: Cycle[] = [
    {
      id: 'c1',
      name: 'Sprint 01',
      description: '',
      start_date: '2026-10-05',
      end_date: '2026-10-05',
    },
    {
      id: 'c2',
      name: 'Sprint 02',
      description: '',
      start_date: '2026-10-06',
      end_date: '2026-10-06',
    },
    { id: 'c3', name: 'Backlog cycle', description: '', start_date: null, end_date: null },
  ];

  it('finds the one-day cycle that covers today', () => {
    expect(currentCycle(cycles, new Date(2026, 9, 6, 11))?.name).toBe('Sprint 02');
    expect(currentCycle(cycles, new Date(2026, 9, 7, 11))).toBeNull();
  });

  it('prefers the latest start when two cycles overlap, and ignores a cycle without dates', () => {
    const long: Cycle = {
      id: 'c4',
      name: 'Quarter',
      description: '',
      start_date: '2026-10-01',
      end_date: '2026-12-31',
    };
    expect(currentCycle([long, ...cycles], new Date(2026, 9, 6, 11))?.name).toBe('Sprint 02');
    expect(currentCycle([cycles[2] as Cycle], new Date(2026, 9, 6))).toBeNull();
  });
});

describe('lastActivity and ago', () => {
  it('takes the newest update and words the distance', () => {
    const now = new Date('2026-10-08T12:00:00Z');
    const newest = lastActivity([
      issue('s-done', '2026-10-01T09:00:00Z'),
      issue('s-todo', '2026-10-07T09:00:00Z'),
      issue('s-todo'),
    ]);
    expect(newest).toBe('2026-10-07T09:00:00Z');
    expect(ago(newest, now)).toBe('yesterday');
    expect(ago('2026-10-08T08:00:00Z', now)).toBe('today');
    expect(ago('2026-10-01T09:00:00Z', now)).toBe('7 days ago');
    expect(ago('2026-08-01T09:00:00Z', now)).toBe('2 months ago');
    expect(ago('2025-08-01T09:00:00Z', now)).toBe('1 year ago');
    expect(ago(null, now)).toBe('');
    expect(ago('not a date', now)).toBe('');
    expect(lastActivity([])).toBeNull();
  });
});

describe('sortRows', () => {
  const row = (o: Partial<ProjectRow> & { identifier: string }): ProjectRow => ({
    id: o.identifier,
    name: o.identifier,
    counts: { open: 0, inProgress: 0, review: 0, done: 0, cancelled: 0, total: 0 },
    sprint: null,
    lastActivity: null,
    boardUrl: 'https://p/x',
    ...o,
  });

  it('puts a project with a sprint today first, then the busiest, then the most recent', () => {
    const rows = [
      row({ identifier: 'QUIET', lastActivity: '2026-01-01T00:00:00Z' }),
      row({
        identifier: 'BUSY',
        counts: { open: 1, inProgress: 4, review: 0, done: 0, cancelled: 0, total: 5 },
      }),
      row({ identifier: 'RECENT', lastActivity: '2026-10-07T00:00:00Z' }),
      row({ identifier: 'TODAY', sprint: 'Sprint 13' }),
    ];
    expect(sortRows(rows).map((r) => r.identifier)).toEqual(['TODAY', 'BUSY', 'RECENT', 'QUIET']);
    // the input is not mutated
    expect(rows[0]?.identifier).toBe('QUIET');
  });
});

// ── [PCODE-65 | S13 | v0.1.0] the client recorder: every call, in order ──
function fakeClient(projects: Project[], opts: { failFor?: string } = {}) {
  const calls: string[] = [];
  return {
    calls,
    getProjects: () => {
      calls.push('projects');
      return Promise.resolve(projects);
    },
    getIssues: (id: string) => {
      calls.push(`issues:${id}`);
      if (opts.failFor === id) return Promise.reject(new Error('Plane GET failed (500).'));
      return Promise.resolve([issue('s-prog', '2026-10-07T09:00:00Z'), issue('s-done')]);
    },
    getStates: (id: string) => {
      calls.push(`states:${id}`);
      return Promise.resolve(STATES);
    },
    getCycles: (id: string) => {
      calls.push(`cycles:${id}`);
      return Promise.resolve([
        {
          id: 'c',
          name: 'Sprint 13',
          description: '',
          start_date: '2026-10-09',
          end_date: '2026-10-09',
        },
      ]);
    },
    webUrl: (id: string) => `https://plan.example.test/ws/projects/${id}/issues/`,
  };
}

const tenProjects: Project[] = Array.from({ length: 10 }, (_, i) => ({
  id: `p${String(i)}`,
  identifier: `P${String(i)}`,
  name: `Project ${String(i)}`,
}));

describe('Dashboard', () => {
  it('reads three endpoints per project and nothing more, one project after another', async () => {
    const client = fakeClient(tenProjects);
    const d = new Dashboard({ client, now: () => Date.parse('2026-10-09T10:00:00Z') });
    const rows = await d.rows();

    expect(rows).toHaveLength(10);
    // 1 projects call + 3 per project: the whole workspace costs 31 requests, never more
    expect(client.calls).toHaveLength(31);
    expect(client.calls[0]).toBe('projects');
    // a project is finished before the next one starts, so the throttle sees a queue, not a burst
    expect(client.calls.slice(1, 7)).toEqual([
      'issues:p0',
      'states:p0',
      'cycles:p0',
      'issues:p1',
      'states:p1',
      'cycles:p1',
    ]);
  });

  it('fills the row from the project, its issues and its cycle', async () => {
    const client = fakeClient(tenProjects.slice(0, 1));
    const d = new Dashboard({ client, now: () => Date.parse('2026-10-09T10:00:00Z') });
    const row = (await d.rows())[0];
    expect(row?.identifier).toBe('P0');
    expect(row?.counts).toEqual({
      open: 0,
      inProgress: 1,
      review: 0,
      done: 1,
      cancelled: 0,
      total: 2,
    });
    expect(row?.sprint).toBe('Sprint 13');
    expect(row?.lastActivity).toBe('2026-10-07T09:00:00Z');
    expect(row?.boardUrl).toBe('https://plan.example.test/ws/projects/p0/issues/');
    expect(row?.error).toBeUndefined();
  });

  // ── [PCODE-65 | S13 | v0.1.0] cache expiry ──
  it('serves a cached row for five minutes and reads again after', async () => {
    const client = fakeClient(tenProjects.slice(0, 2));
    let clock = 1_000_000;
    const d = new Dashboard({ client, now: () => clock });
    await d.rows();
    expect(client.calls).toHaveLength(7); // 1 + 2 * 3
    expect(d.cachedCount).toBe(2);

    clock += CACHE_TTL_MS - 1;
    await d.rows();
    expect(client.calls).toHaveLength(8); // only the projects list was read again

    clock += 2;
    await d.rows();
    expect(client.calls).toHaveLength(15); // 8 + projects + 2 * 3

    // force ignores the cache even inside the window
    await d.rows(true);
    expect(client.calls).toHaveLength(22);
    d.clear();
    expect(d.cachedCount).toBe(0);
  });

  it('keeps the other rows when one project cannot be read', async () => {
    const client = fakeClient(tenProjects.slice(0, 3), { failFor: 'p1' });
    const seen: string[] = [];
    const d = new Dashboard({
      client,
      now: () => Date.parse('2026-10-09T10:00:00Z'),
      onRow: (r) => seen.push(r.identifier),
      log: () => undefined,
    });
    const rows = await d.rows();
    expect(rows).toHaveLength(3);
    expect(seen).toEqual(['P0', 'P1', 'P2']);
    const bad = rows.find((r) => r.identifier === 'P1');
    expect(bad?.error).toContain('Plane GET failed');
    expect(bad?.counts.total).toBe(0);
    expect(rows.find((r) => r.identifier === 'P2')?.counts.total).toBe(2);
  });

  it('attaches a known folder to the row it belongs to', async () => {
    const client = fakeClient(tenProjects.slice(0, 2));
    const d = new Dashboard({
      client,
      folders: { P1: 'C:\\Broszio Apps\\letterman' },
      now: () => Date.parse('2026-10-09T10:00:00Z'),
    });
    const rows = await d.rows();
    expect(rows.find((r) => r.identifier === 'P0')?.folder).toBeUndefined();
    expect(rows.find((r) => r.identifier === 'P1')?.folder).toBe('C:\\Broszio Apps\\letterman');
  });
});

// ── [PCODE-65 | S13 | v0.1.0] the folder map: learned locally, offered only while it exists ──
function memento(initial?: unknown): MementoLike & { store: Record<string, unknown> } {
  const store: Record<string, unknown> = initial === undefined ? {} : { [FOLDERS_KEY]: initial };
  return {
    store,
    get: (k: string) => store[k],
    update: (k: string, v: unknown) => {
      store[k] = v;
      return Promise.resolve();
    },
  };
}

describe('project folders', () => {
  it('remembers a folder, overwrites a moved one and writes only on a change', async () => {
    const m = memento();
    await rememberFolder(m, 'PCODE', 'C:\\Broszio Apps\\orqiva');
    expect(readFolders(m)).toEqual({ PCODE: 'C:\\Broszio Apps\\orqiva' });
    const before = m.store[FOLDERS_KEY];
    await rememberFolder(m, 'PCODE', 'C:\\Broszio Apps\\orqiva');
    expect(m.store[FOLDERS_KEY]).toBe(before); // unchanged -> not written again
    await rememberFolder(m, 'PCODE', 'D:\\moved');
    expect(readFolders(m)['PCODE']).toBe('D:\\moved');
    await rememberFolder(m, '', 'D:\\nothing');
    expect(Object.keys(readFolders(m))).toEqual(['PCODE']);
  });

  it('survives a corrupt or foreign value in globalState', () => {
    expect(readFolders(memento('nonsense'))).toEqual({});
    expect(readFolders(memento(['a', 'b']))).toEqual({});
    expect(readFolders(memento({ OK: 'C:\\x', BAD: 42 }))).toEqual({ OK: 'C:\\x' });
  });

  it('offers only folders that still exist, and prunes the rest', async () => {
    const m = memento({ HERE: 'C:\\here', GONE: 'C:\\gone' });
    const exists = (p: string): boolean => p === 'C:\\here';
    expect(knownFolders(m, exists)).toEqual({ HERE: 'C:\\here' });
    await pruneFolders(m, exists);
    expect(readFolders(m)).toEqual({ HERE: 'C:\\here' });
  });
});

describe('buildRow', () => {
  it('produces the row the panel renders', () => {
    const row = buildRow({
      project: { id: 'p', identifier: 'LTR', name: 'Letterman' },
      issues: [issue('s-todo', '2026-10-08T07:00:00Z')],
      states: STATES,
      cycles: [],
      boardUrl: 'https://plan.example.test/ws/projects/p/issues/',
      now: new Date('2026-10-09T10:00:00Z'),
      folder: 'C:\\Broszio Apps\\letterman',
    });
    expect(row).toEqual({
      id: 'p',
      identifier: 'LTR',
      name: 'Letterman',
      counts: { open: 1, inProgress: 0, review: 0, done: 0, cancelled: 0, total: 1 },
      sprint: null,
      lastActivity: '2026-10-08T07:00:00Z',
      boardUrl: 'https://plan.example.test/ws/projects/p/issues/',
      folder: 'C:\\Broszio Apps\\letterman',
    });
  });
});
