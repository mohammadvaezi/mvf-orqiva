// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-13 | S03 | v0.1.0] Add the Orqiva activity bar container and the Sprints tree view ──
//    Why:  the tree's ordering, icons and empty state as specified in design-system.md.
import { describe, expect, it } from 'vitest';
import * as vscode from 'vscode';
import {
  boardFromSprintsMd,
  buildBoardFromPlane,
  orderSprints,
  type Sprint,
} from '../../src/state/board';
import { parseSprintsMd } from '../../src/state/sprintsMd';
import { Store } from '../../src/state/store';
import {
  EMPTY_COPY,
  SprintsTreeProvider,
  type ItemNode,
  type SprintNode,
} from '../../src/views/sprintsTree';

const TODAY = '2026-01-01';

function sprint(over: Partial<Sprint>): Sprint {
  return {
    name: 'Sprint 01 - X',
    code: 'S01',
    date: TODAY,
    endDate: TODAY,
    goal: 'g',
    isToday: false,
    items: [],
    source: 'file',
    ...over,
  };
}

describe('board ordering', () => {
  it('puts today first, then upcoming ascending, then past descending', () => {
    const s = orderSprints(
      [
        sprint({ name: 'old', date: '2025-12-01' }),
        sprint({ name: 'past2', date: '2025-12-30' }),
        sprint({ name: 'next2', date: '2026-01-05' }),
        sprint({ name: 'today', date: TODAY, isToday: true }),
        sprint({ name: 'next1', date: '2026-01-02' }),
        sprint({ name: 'past1', date: '2025-12-31' }),
      ],
      TODAY,
    );
    expect(s.map((x) => x.name)).toEqual(['today', 'next1', 'next2', 'past1', 'past2', 'old']);
  });

  it('builds the board from Plane objects like plane_task does', () => {
    const board = buildBoardFromPlane(
      {
        identifier: 'FIX',
        cycles: [
          {
            id: 'c1',
            name: 'Sprint 01 - Foundation',
            description: 'goal',
            start_date: '2026-01-01T00:00:00Z',
            end_date: '2026-01-01T23:59:00Z',
          },
          { id: 'c0', name: 'Backlog cycle', description: '', start_date: null, end_date: null },
        ],
        cycleIssueIds: new Map([['c1', ['i2', 'i1']]]),
        issues: [
          { id: 'i1', sequence_id: 1, name: 'A', state: 's-done', priority: 'low', labels: ['l1'] },
          { id: 'i2', sequence_id: 2, name: 'B', state: 's-todo', priority: null, labels: [] },
        ],
        states: [
          { id: 's-done', name: 'Done', group: 'completed', color: '#0f0' },
          { id: 's-todo', name: 'Todo', group: 'unstarted', color: '#00f' },
        ],
        labels: [{ id: 'l1', name: 'feature', color: '#fff' }],
        webUrl: (id) => `https://x/${id}/`,
      },
      TODAY,
    );
    expect(board).toHaveLength(1);
    expect(board[0]).toMatchObject({ code: 'S01', isToday: true, goal: 'goal', source: 'plane' });
    // priority order: low (A) before none (B)
    expect(board[0]?.items.map((i) => i.ref)).toEqual(['FIX-1', 'FIX-2']);
    expect(board[0]?.items[0]).toMatchObject({
      done: true,
      labels: ['feature'],
      url: 'https://x/i1/',
      state: { name: 'Done', group: 'completed' },
    });
    expect(board[0]?.items[1]?.priority).toBe('none');
  });
});

describe('SprintsTreeProvider', () => {
  function providerWith(sprints: Sprint[]): SprintsTreeProvider {
    const store = new Store();
    store.state.sprints = sprints;
    return new SprintsTreeProvider(store);
  }

  // ── [PCODE-13 | S03 | v0.1.0] today first and expanded; done items $(pass-filled); no icon for medium ──
  it("shows today's sprint first and expanded with state and priority icons", () => {
    const md = parseSprintsMd(
      '## Sprint 02 - Later (2026-01-02) — 0/1 done\n- [ ] FIX-3 C — Todo (medium)\n\n## Sprint 01 - Now (2026-01-01) — 1/2 done ← today\n_goal_\n- [x] FIX-1 A — Done (high)\n- [ ] FIX-2 B — In Progress (urgent)\n',
    );
    const p = providerWith(boardFromSprintsMd(md, TODAY));
    const roots = p.getChildren() as SprintNode[];
    expect(roots[0]?.sprint.name).toBe('Sprint 01 - Now');
    const first = p.getTreeItem(roots[0] as SprintNode);
    expect(first.collapsibleState).toBe(vscode.TreeItemCollapsibleState.Expanded);
    expect(first.description).toBe('2026-01-01 · 1/2 done');
    expect(first.tooltip).toBe('goal');
    expect(p.getTreeItem(roots[1] as SprintNode).collapsibleState).toBe(
      vscode.TreeItemCollapsibleState.Collapsed,
    );

    const items = p.getChildren(roots[0]) as ItemNode[];
    const done = p.getTreeItem(items.find((i) => i.item.ref === 'FIX-1') as ItemNode);
    expect((done.iconPath as vscode.ThemeIcon).id).toBe('pass-filled');
    expect(done.description).toBe('high');
    const wip = p.getTreeItem(items.find((i) => i.item.ref === 'FIX-2') as ItemNode);
    expect((wip.iconPath as vscode.ThemeIcon).id).toBe('play-circle');
    expect(wip.description).toBe('urgent');
    expect(wip.contextValue).toBe('item-started');
    const later = p.getChildren(roots[1]) as ItemNode[];
    expect(p.getTreeItem(later[0] as ItemNode).description).toBe('');
  });

  it('shows the empty-state copy when there are no sprints', () => {
    const p = providerWith([]);
    const roots = p.getChildren();
    expect(roots).toHaveLength(1);
    expect(roots[0]?.kind).toBe('empty');
    expect(p.getTreeItem(roots[0] as never).label).toBe(EMPTY_COPY);
  });
});
