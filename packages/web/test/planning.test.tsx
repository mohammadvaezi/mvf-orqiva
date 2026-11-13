// ── [PCODE-99 | S15 | v0.1.0] Build sprints, backlog, board and list views ──
// ── [PCODE-113 | S15 | v0.1.0] Rebuild the web app shell: sidebar, top bar, page layout, design refresh ──
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { appRoute } from '../src/core/nav.js';
import { BacklogView, BoardView, rankBetween, type Sprint } from '../src/planning.js';
import type { Item } from '../src/sync/items.js';
import type { State } from '../src/views.js';

const noop = (): void => undefined;
const none = (): Promise<null> => Promise.resolve(null);
const states: State[] = [
  { id: 'todo', name: 'Todo', group: 'unstarted', color: '#3f76ff' },
  { id: 'done', name: 'Done', group: 'completed', color: '#16a34a' },
];
const item = (id: string, stateId: string, rank: number, sprintId: string | null = null): Item => ({
  id,
  ref: 'APP-' + id,
  projectId: 'p',
  sequence: Number(id),
  title: 'Item ' + id,
  description: '',
  stateId,
  assigneeId: null,
  estimate: 2,
  parentId: null,
  labelIds: [],
  sprintId,
  rank,
  version: 1,
  commentCount: 0,
  createdAt: '',
  updatedAt: '',
});
const sprint = (id: string, status: Sprint['status']): Sprint => ({
  id,
  name: 'Sprint ' + id,
  goal: '',
  startDate: '2026-11-02',
  endDate: '2026-11-13',
  status,
  itemCount: 1,
  doneCount: 0,
  estimateTotal: 2,
  estimateDone: 0,
});

describe('ranks', () => {
  it('places between neighbours, before the first and after the last', () => {
    expect(rankBetween(1, 2)).toBe(1.5);
    expect(rankBetween(undefined, 1)).toBe(0);
    expect(rankBetween(5, undefined)).toBe(6);
    expect(rankBetween(undefined, undefined)).toBe(0);
  });

  it('reads the view from the path', () => {
    const id = '0b6f2f43-7d6e-4f6c-9a39-2f1e3c4d5e6f';
    expect(appRoute('/projects/' + id + '/board')).toEqual({ kind: 'project', id, view: 'board' });
    expect(appRoute('/projects/' + id + '/list')).toEqual({ kind: 'project', id, view: 'list' });
    expect(appRoute('/projects/' + id)).toEqual({ kind: 'project', id, view: 'overview' });
  });
});

describe('board', () => {
  it('shows a column per state, cards in rank order, and a keyboard way to move each card', () => {
    const html = renderToString(
      <BoardView
        states={states}
        items={[item('2', 'todo', 2), item('1', 'todo', 1), item('3', 'done', 1)]}
        canEdit
        isPending={() => false}
        onMove={noop}
        go={noop}
      />,
    );
    expect(html.indexOf('APP-1')).toBeLessThan(html.indexOf('APP-2'));
    expect(html).toContain('aria-label="Todo"');
    expect(html).toContain('aria-label="State of APP-1"');
    expect(html).toContain('draggable="true"');
    expect(html).not.toContain('style=');
  });

  it('is read-only for guests', () => {
    const html = renderToString(
      <BoardView
        states={states}
        items={[item('1', 'todo', 1)]}
        canEdit={false}
        isPending={() => false}
        onMove={noop}
        go={noop}
      />,
    );
    expect(html).not.toContain('draggable="true"');
    expect(html).not.toContain('State of APP-1');
  });
});

describe('backlog', () => {
  it('lists open sprints and the backlog, offers start only while no sprint runs', () => {
    const html = renderToString(
      <BacklogView
        sprints={[sprint('a', 'active'), sprint('b', 'planned')]}
        states={states}
        items={[item('1', 'todo', 1, 'a'), item('2', 'todo', 1)]}
        canEdit
        isPending={() => false}
        onMove={noop}
        onCreateSprint={none}
        onStart={none}
        onComplete={none}
        onDelete={none}
        go={noop}
      />,
    );
    expect(html).toContain('Sprint a');
    expect(html).toContain('>Complete sprint</button>');
    expect(html).toMatch(
      /<button[^>]*disabled=""[^>]*title="Complete the active sprint first"[^>]*>Start sprint<\/button>/,
    );
    expect(html).toContain('aria-label="Sprint of APP-1"');
    expect(html).toContain('>Plan sprint</button>');
  });
});
