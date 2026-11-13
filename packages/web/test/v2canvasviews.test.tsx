// ── [PCODE-262 | S15 | v0.1.0] T27.4 Canvas views: timeline, mind map, portfolio; agents as resources and heat map; scenario diff; commits on bars ──
//    Why:  the other views of the plan, from the same data: the timeline's lanes and milestones, the mind
//          map's tree and folding, the portfolio's rows on one axis, the heat map's colours, what a scenario
//          changes, and the commits drawn on the bars.
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PlanData } from '../src/v2/canvas.js';
import {
  HeatMap,
  heatColour,
  mindTree,
  PortfolioV2,
  ScenarioDiff,
  timelineLanes,
  TimelineV2,
} from '../src/v2/canvasviews.js';
import { GanttV2 } from '../src/v2/gantt.js';

const WEEK = ['mon', 'tue', 'wed', 'thu', 'fri'];
const task = (id: string, extra: Partial<PlanData['tasks'][number]> = {}) => ({
  id,
  ref: 'APP-' + id,
  title: 'Task ' + id,
  kind: 'task',
  stateGroup: 'started',
  assigneeId: null,
  estimate: null,
  parentId: null,
  sprintId: null,
  startDate: null,
  dueDate: null,
  durationDays: 2,
  scheduleMode: 'auto',
  ...extra,
});
const sched = (id: string, wbs: string, extra: Partial<PlanData['schedule'][number]> = {}) => ({
  id,
  wbs,
  level: wbs.split('.').length - 1,
  summary: false,
  milestone: false,
  start: '2030-01-07',
  finish: '2030-01-08',
  durationDays: 2,
  percentDone: 0,
  totalFloat: 1,
  critical: false,
  violations: [],
  ...extra,
});
const plan: PlanData = {
  today: '2030-01-08',
  workingDays: WEEK,
  start: '2030-01-07',
  finish: '2030-01-21',
  tasks: [
    task('E', { kind: 'epic', title: 'Booking' }),
    task('A', { parentId: 'E', title: 'API' }),
    task('B', { parentId: 'E', title: 'Screen' }),
    task('L', { title: 'Loose' }),
    task('M', { kind: 'milestone', title: 'Go live' }),
  ],
  schedule: [
    sched('E', '1', { summary: true, finish: '2030-01-14', percentDone: 50 }),
    sched('A', '1.1', { percentDone: 100 }),
    sched('B', '1.2', { start: '2030-01-09', finish: '2030-01-14', critical: true }),
    sched('L', '2', { start: '2030-01-15', finish: '2030-01-16' }),
    sched('M', '3', {
      milestone: true,
      start: '2030-01-21',
      finish: '2030-01-21',
      durationDays: 0,
    }),
  ],
  dependencies: [],
  cycle: [],
  ignored: [],
  baseline: null,
  scenario: null,
  git: [
    {
      itemId: 'A',
      kind: 'commit',
      ref: 'abc1234',
      title: 'Add API',
      url: '',
      state: 'main',
      date: '2030-01-07',
    },
    {
      itemId: 'A',
      kind: 'pull_request',
      ref: '12',
      title: 'API',
      url: 'https://example.test/p/12',
      state: 'merged',
      date: '2030-01-08',
    },
  ],
};

describe('timeline', () => {
  it('puts each top-level part in a lane, loose tasks together, milestones apart', () => {
    const t = timelineLanes(plan);
    expect(t.lanes.map((l) => l.title)).toEqual(['Booking', 'Other tasks']);
    expect(t.lanes[0]).toMatchObject({ critical: true, percentDone: 50 });
    expect(t.lanes[0]?.parts.map((p) => p.done)).toEqual([true, false]);
    expect(t.milestones).toEqual([
      { id: 'M', title: 'Go live', date: '2030-01-21', critical: false },
    ]);
    const html = renderToString(<TimelineV2 plan={plan} onSelect={() => undefined} />);
    expect(html).toContain('Milestones');
    expect(html).toContain('pv-tl-bar pv-tl-bar--crit');
  });
});

describe('mind map', () => {
  it('lays the tree out with leaves in slots and folds a branch', () => {
    const open = mindTree(plan, new Set());
    expect(open.roots.map((r) => r.title)).toEqual(['Booking', 'Loose', 'Go live']);
    expect(open.slots).toBe(4);
    expect(open.roots[0]?.y).toBe(0.5);
    const folded = mindTree(plan, new Set(['E']));
    expect(folded.roots[0]?.children).toEqual([]);
    expect(folded.slots).toBe(3);
  });
});

describe('portfolio, diff, heat map', () => {
  it('draws every project on one axis with its slip and lateness', () => {
    const html = renderToString(
      <PortfolioV2
        workspaceId="w"
        go={() => undefined}
        data={{
          today: '2030-01-08',
          projects: [
            {
              id: 'p1',
              key: 'APP',
              name: 'App',
              tasks: 4,
              start: '2030-01-07',
              finish: '2030-03-01',
              percentDone: 40,
              critical: 2,
              late: 1,
              baseline: { name: 'v1', finish: '2030-02-20', slip: 6 },
              milestones: [{ id: 'm', title: 'Beta', date: '2030-02-01' }],
            },
            {
              id: 'p2',
              key: 'WEB',
              name: 'Web',
              tasks: 0,
              start: null,
              finish: null,
              percentDone: 0,
              critical: 0,
              late: 0,
              baseline: null,
              milestones: [],
            },
          ],
        }}
      />,
    );
    expect(html).toContain('+6 d');
    expect(html).toContain('40 %');
    expect(html).toContain('Beta · 1 Feb');
    expect(html.match(/class="pv-tl-bar"/g)).toHaveLength(1);
  });

  it('lists what a scenario changes and why', () => {
    const html = renderToString(
      <ScenarioDiff
        name={(id) => (id === 'u1' ? 'Ada' : '')}
        onSelect={() => undefined}
        diff={[
          {
            itemId: 'A',
            ref: 'APP-A',
            title: 'API',
            startFrom: '2030-01-07',
            startTo: '2030-01-07',
            finishFrom: '2030-01-08',
            finishTo: '2030-01-10',
            durationFrom: 2,
            durationTo: 4,
            assigneeFrom: null,
            assigneeTo: 'u1',
            direct: true,
          },
          {
            itemId: 'B',
            ref: 'APP-B',
            title: 'Screen',
            startFrom: '2030-01-09',
            startTo: '2030-01-11',
            finishFrom: '2030-01-14',
            finishTo: '2030-01-16',
            durationFrom: 4,
            durationTo: 4,
            assigneeFrom: null,
            assigneeTo: null,
            direct: false,
          },
        ]}
      />,
    );
    expect(html).toContain('2 tasks');
    expect(html).toContain('2 → 4 d');
    expect(html).toContain('nobody → Ada');
    expect(html).toContain('follows');
    expect(html).toContain('9 Jan → 11 Jan');
  });

  it('colours the load from calm to over, and marks agents', () => {
    expect(heatColour(0)).toBe('transparent');
    expect(heatColour(50)).toContain('var(--pe-primary) 41%');
    expect(heatColour(200)).toContain('var(--pv-bad)');
    const html = renderToString(
      <HeatMap
        people={[
          {
            userId: 'agent:x',
            name: 'Coder',
            kind: 'agent',
            tasksPerDay: 3,
            days: [
              { date: '2030-01-07', percent: 133, taskIds: ['a', 'b', 'c', 'd'] },
              { date: '2030-01-08', percent: 0, taskIds: [] },
            ],
          },
        ]}
      />,
    );
    expect(html).toContain('agent, 3 a day');
    expect(html).toContain('pv-heatmap-cell pv-heatmap-cell--over');
    expect(html).toContain('Coder, 7 Jan: 133 %, 4 tasks');
  });
});

describe('commits on the bars', () => {
  it('marks a commit and a pull request on their days, the pull request as a link', () => {
    const html = renderToString(
      <GanttV2
        plan={plan}
        zoom="day"
        critical
        selected={null}
        name={() => ''}
        onSelect={() => undefined}
      />,
    );
    expect(html).toContain('class="pv-commit"');
    expect(html).toContain('pv-commit pv-commit--pr');
    expect(html).toContain('href="https://example.test/p/12"');
    expect(html).toContain('Commit abc1234: Add API (main), 7 Jan');
  });
});
