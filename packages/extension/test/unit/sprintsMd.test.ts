// ── [PCODE-18 | S03 | v0.1.0] Show the board offline from sprints.md when Plane is unreachable ──
//    Why:  the file-sourced board must have the same shape as the client-sourced one, for the fixture
//          and for a real sprints.md written by the engine (Letterman sample).
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { boardFromSprintsMd, buildBoardFromPlane, type Sprint } from '../../src/state/board';
import { parseSprintsMd } from '../../src/state/sprintsMd';

const FIXTURE = path.resolve(__dirname, '..', 'fixtures', 'workspace', '.plane', 'sprints.md');
const LETTERMAN = path.resolve(
  __dirname,
  '..',
  'fixtures',
  'engine-output',
  'sprints-letterman.md',
);

// ── [PCODE-18 | S03 | v0.1.0] the file board and the Plane board agree on names, dates, codes, states, done ──
describe('sprints.md offline board', () => {
  it('parses the Letterman sample the engine wrote', () => {
    const board = boardFromSprintsMd(
      parseSprintsMd(fs.readFileSync(LETTERMAN, 'utf8')),
      '2026-09-23',
    );
    expect(board.length).toBeGreaterThanOrEqual(2);
    const s1 = board.find((s) => s.code === 'S01');
    expect(s1).toMatchObject({
      name: 'Sprint 01 - Foundation',
      date: '2026-09-23',
      source: 'file',
    });
    expect(s1?.goal.length).toBeGreaterThan(10);
    expect(s1?.items.length).toBe(5);
    const review = s1?.items.find((i) => i.ref === 'LTR-2');
    expect(review).toMatchObject({
      state: { name: 'Review', group: 'started' },
      priority: 'urgent',
      done: false,
    });
    expect(s1?.items.every((i) => i.id === undefined && i.url === undefined)).toBe(true);
  });

  it('yields the same shape as buildBoardFromPlane for equivalent data', () => {
    const fromFile = boardFromSprintsMd(
      parseSprintsMd(fs.readFileSync(FIXTURE, 'utf8')),
      '2026-01-01',
    );
    const fromPlane = buildBoardFromPlane(
      {
        identifier: 'FIX',
        cycles: [
          {
            id: 'c1',
            name: 'Sprint 01 - Foundation',
            description: 'The fixture app starts and one test passes.',
            start_date: '2026-01-01',
            end_date: '2026-01-01',
          },
          {
            id: 'c2',
            name: 'Sprint 02 - Polish',
            description: 'Nice-to-haves for the fixture.',
            start_date: '2026-01-02',
            end_date: '2026-01-02',
          },
        ],
        cycleIssueIds: new Map([
          ['c1', ['i1', 'i2']],
          ['c2', ['i3', 'i4']],
        ]),
        issues: [
          {
            id: 'i1',
            sequence_id: 1,
            name: 'Create the sample module',
            state: 'done',
            priority: 'high',
            labels: [],
          },
          {
            id: 'i2',
            sequence_id: 2,
            name: 'Add the greeting function',
            state: 'wip',
            priority: 'medium',
            labels: [],
          },
          {
            id: 'i3',
            sequence_id: 3,
            name: 'Add a farewell function',
            state: 'todo',
            priority: 'low',
            labels: [],
          },
          {
            id: 'i4',
            sequence_id: 4,
            name: 'Write the fixture README',
            state: 'todo',
            priority: 'low',
            labels: [],
          },
        ],
        states: [
          { id: 'done', name: 'Done', group: 'completed', color: '' },
          { id: 'wip', name: 'In Progress', group: 'started', color: '' },
          { id: 'todo', name: 'Todo', group: 'unstarted', color: '' },
        ],
        labels: [],
        webUrl: (id) => `u/${id}`,
      },
      '2026-01-01',
    );
    const strip = (s: Sprint[]): unknown =>
      s.map((x) => ({
        name: x.name,
        code: x.code,
        date: x.date,
        goal: x.goal,
        isToday: x.isToday,
        items: x.items.map((i) => ({
          ref: i.ref,
          title: i.title,
          state: i.state,
          priority: i.priority,
          done: i.done,
        })),
      }));
    expect(strip(fromFile)).toEqual(strip(fromPlane));
  });
});
