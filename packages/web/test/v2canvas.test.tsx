// ── [PCODE-261 | S15 | v0.1.0] T27.3 Canvas grid: fill down, paste from Excel, formulas and roll-ups, indent and outdent, typed predecessors ──
// ── [PCODE-167 | S15 | v0.1.0] B2.3 Canvas live in the web app: Gantt with critical path and dependencies, baselines, scenarios, grid, workload and levelling, calendar ──
//    Why:  the Canvas draws the server's schedule: the span around the plan and today, bars, milestones,
//          summary bars, dependency arrows, the critical path and the baseline; the grid edits the leaves;
//          the workload folds days into weeks.
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  addDays,
  daysBetween,
  ganttRange,
  GanttV2,
  GridV2,
  weekly,
  type PlanData,
} from '../src/v2/canvas.js';
import { ProjectTabsV2 } from '../src/v2/projecttabs.js';

const noop = (): void => undefined;

const plan: PlanData = {
  today: '2030-01-08',
  workingDays: ['mon', 'tue', 'wed', 'thu', 'fri'],
  start: '2030-01-07',
  finish: '2030-01-14',
  tasks: [
    {
      id: 'P',
      ref: 'APP-1',
      title: 'Pilot phase',
      kind: 'epic',
      stateGroup: 'started',
      assigneeId: null,
      estimate: null,
      parentId: null,
      sprintId: null,
      startDate: null,
      dueDate: null,
      durationDays: null,
      scheduleMode: 'auto',
    },
    {
      id: 'A',
      ref: 'APP-2',
      title: 'Design',
      kind: 'story',
      stateGroup: 'started',
      assigneeId: 'u1',
      estimate: 5,
      parentId: 'P',
      sprintId: null,
      startDate: '2030-01-07',
      dueDate: null,
      durationDays: 3,
      scheduleMode: 'auto',
    },
    {
      id: 'B',
      ref: 'APP-3',
      title: 'Build',
      kind: 'story',
      stateGroup: 'unstarted',
      assigneeId: null,
      estimate: 3,
      parentId: 'P',
      sprintId: null,
      startDate: null,
      dueDate: null,
      durationDays: 2,
      scheduleMode: 'auto',
    },
    {
      id: 'M',
      ref: 'APP-4',
      title: 'Go live',
      kind: 'milestone',
      stateGroup: 'unstarted',
      assigneeId: null,
      estimate: null,
      parentId: null,
      sprintId: null,
      startDate: null,
      dueDate: null,
      durationDays: 0,
      scheduleMode: 'auto',
    },
  ],
  schedule: [
    {
      id: 'P',
      wbs: '1',
      level: 0,
      summary: true,
      milestone: false,
      start: '2030-01-07',
      finish: '2030-01-11',
      durationDays: 5,
      percentDone: 30,
      totalFloat: 0,
      critical: false,
      violations: [],
    },
    {
      id: 'A',
      wbs: '1.1',
      level: 1,
      summary: false,
      milestone: false,
      start: '2030-01-07',
      finish: '2030-01-09',
      durationDays: 3,
      percentDone: 50,
      totalFloat: 0,
      critical: true,
      violations: [],
    },
    {
      id: 'B',
      wbs: '1.2',
      level: 1,
      summary: false,
      milestone: false,
      start: '2030-01-10',
      finish: '2030-01-11',
      durationDays: 2,
      percentDone: 0,
      totalFloat: 0,
      critical: true,
      violations: [],
    },
    {
      id: 'M',
      wbs: '2',
      level: 0,
      summary: false,
      milestone: true,
      start: '2030-01-14',
      finish: '2030-01-14',
      durationDays: 0,
      percentDone: 0,
      totalFloat: 0,
      critical: true,
      violations: [],
    },
  ],
  dependencies: [
    { id: 'd1', predecessorId: 'A', successorId: 'B', kind: 'FS', lagDays: 0 },
    { id: 'd2', predecessorId: 'B', successorId: 'M', kind: 'FS', lagDays: 0 },
  ],
  cycle: [],
  ignored: [],
  baseline: {
    id: 'b',
    name: 'v1',
    finish: '2030-01-11',
    variance: [
      { itemId: 'B', start: '2030-01-09', finish: '2030-01-10', startSlip: 1, finishSlip: 1 },
    ],
  },
  scenario: null,
};

describe('canvas rules', () => {
  it('counts days and draws from the Monday a week before the plan', () => {
    expect(daysBetween('2030-01-07', '2030-01-14')).toBe(7);
    expect(addDays('2030-01-31', 1)).toBe('2030-02-01');
    const r = ganttRange(plan);
    expect(r.from).toBe('2029-12-31');
    expect(r.days).toBeGreaterThanOrEqual(42);
  });

  it('folds daily load into weeks', () => {
    expect(
      weekly([
        { date: '2030-01-07', percent: 100 },
        { date: '2030-01-08', percent: 200 },
        { date: '2030-01-14', percent: 0 },
      ]),
    ).toEqual([
      { week: '2030-01-07', percent: 150 },
      { week: '2030-01-14', percent: 0 },
    ]);
  });
});

describe('gantt', () => {
  const html = renderToString(
    <GanttV2 plan={plan} zoom="day" critical selected="A" name={() => 'Ada'} onSelect={noop} />,
  );

  it('draws bars, the summary, the milestone, arrows and the baseline', () => {
    expect(html.match(/class="pv-task-bar/g)).toHaveLength(2);
    expect(html).toContain('pv-summary');
    expect(html).toContain('pv-milestone pv-milestone--crit');
    expect(html.match(/class="pv-dep pv-dep--crit"/g)).toHaveLength(2);
    expect(html).toContain('class="pv-baseline"');
    expect(html).toContain('+1 d');
    expect(html).toContain('pv-gantt-row--sel');
    expect(html).toContain('>today<');
  });

  it('can hide the critical path', () => {
    const plain = renderToString(
      <GanttV2
        plan={plan}
        zoom="week"
        critical={false}
        selected={null}
        name={() => ''}
        onSelect={noop}
      />,
    );
    expect(plain).not.toContain('pv-task-bar--crit');
  });
});

describe('grid', () => {
  it('edits start, duration and % done of the leaves; summary and milestone stay read only', () => {
    const html = renderToString(
      <GridV2 plan={plan} canEdit scenario={false} name={() => 'Ada'} onEdit={noop} />,
    );
    expect(html).toContain('aria-label="Duration of APP-2"');
    expect(html).toContain('aria-label="Percent done of APP-3"');
    expect(html).not.toContain('aria-label="Duration of APP-1"');
    expect(html).not.toContain('aria-label="Duration of APP-4"');
    expect(html).toContain('value="1.1"'); // [PCODE-261 | S15 | v0.1.0] predecessors as MS Project writes them
  });

  it('keeps % done out of a scenario', () => {
    const html = renderToString(
      <GridV2 plan={plan} canEdit scenario name={() => ''} onEdit={noop} />,
    );
    expect(html).toContain('Edits go into the scenario');
    expect(html).not.toContain('Percent done of');
  });

  it('has its own project tab', () => {
    expect(
      renderToString(
        <ProjectTabsV2
          projectId="0b1f6a52-3c1e-4d7a-9a51-2f0f6c1d2e3a"
          view="canvas"
          portal={false}
          role="member"
          go={noop}
        />,
      ),
    ).toMatch(/aria-current="page"[^>]*>.*?Canvas<\/a>/);
  });
});
