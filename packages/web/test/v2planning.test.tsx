// ── [PCODE-166 | S15 | v0.1.0] B2.2 Planning live in the web app: sprint header, board, backlog, Planner draft, capacity, reports, retro ──
//    Why:  the Planning tab's rules: which sprint opens first, which epic a task belongs to, the burndown's
//          ideal line, the board's columns, marks and filters, the project tabs per role and portal.
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { appRoute } from '../src/core/nav.js';
import type { Item } from '../src/sync/items.js';
import {
  BoardV2,
  burndownSeries,
  defaultSprint,
  epicOf,
  type LiveSprint,
  type LiveState,
} from '../src/v2/planning.js';
import { ProjectTabsV2, tabOf } from '../src/v2/projecttabs.js';

const noop = (): void => undefined;
const text = (html: string): string => html.replace(/<!-- -->/g, '');
const P = '0b1f6a52-3c1e-4d7a-9a51-2f0f6c1d2e3a';

const item = (id: string, extra: Partial<Item> = {}): Item => ({
  id,
  ref: 'APP-' + id,
  projectId: 'p',
  sequence: 1,
  title: 'Task ' + id,
  description: '',
  stateId: 's-todo',
  assigneeId: null,
  estimate: null,
  parentId: null,
  labelIds: [],
  sprintId: 'sp',
  rank: 1,
  version: 1,
  commentCount: 0,
  createdAt: '',
  updatedAt: '',
  ...extra,
});
const sprint = (id: string, status: LiveSprint['status']): LiveSprint => ({
  id,
  name: id,
  goal: '',
  startDate: null,
  endDate: null,
  status,
  itemCount: 0,
  doneCount: 0,
  estimateTotal: 0,
  estimateDone: 0,
});
const states: LiveState[] = [
  { id: 's-back', name: 'Backlog', group: 'backlog', color: '' },
  { id: 's-todo', name: 'Todo', group: 'unstarted', color: '' },
  { id: 's-doing', name: 'In Progress', group: 'started', color: '' },
  { id: 's-block', name: 'Blocked', group: 'started', color: '' },
  { id: 's-done', name: 'Done', group: 'completed', color: '' },
  { id: 's-cxl', name: 'Cancelled', group: 'cancelled', color: '' },
];

describe('planning rules', () => {
  it('opens the active sprint, else the next planned, else the latest', () => {
    expect(
      defaultSprint([sprint('a', 'completed'), sprint('b', 'planned'), sprint('c', 'active')])?.id,
    ).toBe('c');
    expect(defaultSprint([sprint('a', 'completed'), sprint('b', 'planned')])?.id).toBe('b');
    expect(defaultSprint([sprint('a', 'completed'), sprint('z', 'completed')])?.id).toBe('z');
    expect(defaultSprint([])).toBeNull();
  });

  it('finds the nearest epic above a task', () => {
    const e = item('e', { kind: 'epic', parentId: null });
    const s = item('s', { kind: 'story', parentId: 'e' });
    const t = item('t', { parentId: 's' });
    const by = new Map([e, s, t].map((x) => [x.id, x]));
    expect(epicOf(t, by)?.id).toBe('e');
    expect(epicOf(e, by)).toBeNull();
  });

  it('draws the ideal burndown from the total to zero', () => {
    const b = burndownSeries({
      sprintId: 's',
      name: 'S',
      total: 20,
      days: [20, 18, 15, null, null].map((r, i) => ({ date: String(i), remaining: r })),
    });
    expect(b).toEqual({ actual: [20, 18, 15], ideal: [20, 15, 10, 5, 0], days: 4 });
  });

  it('resolves the Planning address and keeps board and backlog under List', () => {
    expect(appRoute('/projects/' + P + '/planning')).toEqual({
      kind: 'project',
      id: P,
      view: 'planning',
    });
    expect(tabOf('board')).toBe('list');
    expect(tabOf('planning')).toBe('planning');
  });
});

describe('board', () => {
  const items = [
    item('1', { estimate: 3, carriedCount: 2, kind: 'bug', priority: 'urgent', assigneeId: 'me' }),
    item('2', { stateId: 's-doing', estimate: 5, ready: false }),
    item('3', { stateId: 's-block' }),
  ];
  const board = (): string =>
    text(
      renderToString(
        <BoardV2
          items={items}
          states={states}
          byId={new Map(items.map((i) => [i.id, i]))}
          added={new Set(['2'])}
          pkey="APP"
          meId="me"
          name={() => 'Ada'}
          canEdit
          onOpen={noop}
          onMove={noop}
        />,
      ),
    );

  it('has a column per working state, with counts and points, and no backlog or cancelled column', () => {
    const html = board();
    for (const c of ['Todo', 'In Progress', 'Blocked', 'Done'])
      expect(html).toContain('<strong>' + c + '</strong>');
    expect(html).not.toContain('<strong>Backlog</strong>');
    expect(html).not.toContain('<strong>Cancelled</strong>');
    expect(html).toContain('3 pt');
  });

  it('marks added, carried, bugs, unready tasks, and offers quick filters', () => {
    const html = board();
    expect(html).toContain('>added<');
    expect(html).toContain('carried 2×');
    expect(html).toContain('>bug<');
    expect(html).toContain('not ready');
    for (const q of ['Mine', 'Blocked', 'Bugs', 'Not ready'])
      expect(html).toContain('>' + q + '</button>');
  });
  it('shows a sprint task still in a backlog state in that column', () => {
    const odd = [item('9', { stateId: 's-back' })];
    const html = text(
      renderToString(
        <BoardV2
          items={odd}
          states={states}
          byId={new Map(odd.map((i) => [i.id, i]))}
          added={new Set()}
          pkey="APP"
          meId="me"
          name={() => 'Ada'}
          canEdit={false}
          onOpen={noop}
          onMove={noop}
        />,
      ),
    );
    expect(html).toContain('<strong>Backlog</strong>');
    expect(html).toContain('Task 9');
  });
});

describe('project tabs', () => {
  const tabs = (role: string, portal = false): string =>
    text(
      renderToString(
        <ProjectTabsV2 projectId={P} view="board" portal={portal} role={role} go={noop} />,
      ),
    );

  it('show the team every section, admins the settings, and mark List for the board', () => {
    const admin = tabs('admin');
    for (const t of [
      'Overview',
      'Lifecycle',
      'Ideation',
      'Planning',
      'List',
      'Test',
      'Security',
      'Repositories',
      'Settings',
    ])
      expect(admin).toContain(t + '</a>');
    expect(tabs('member')).not.toContain('Settings</a>');
    expect(admin).toMatch(/aria-current="page"[^>]*>.*?List<\/a>/);
  });

  it('show a client contact only the portal’s tabs', () => {
    const html = tabs('guest', true);
    expect(html).toContain('Overview</a>');
    expect(html).toContain('List</a>');
    expect(html).not.toContain('Planning</a>');
    expect(html).not.toContain('Security</a>');
  });
});
