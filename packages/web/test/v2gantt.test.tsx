// ── [PCODE-260 | S15 | v0.1.0] T27.2 Interactive Gantt: drag, resize, link, shift-drag, split, zoom, colour rules, outline levels ──
//    Why:  what a drag on the Gantt means is decided by plain rules: the working days a bar moves, the
//          duration a resize leaves, which rows an outline shows, the colour a rule gives, the axis at each
//          zoom and the pieces of a split bar. Here they are checked by hand, then drawn.
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  axisTicks,
  barColour,
  barPieces,
  colourLegend,
  dragOutcome,
  GanttV2,
  ganttSpan,
  visibleRows,
  workdayFrom,
  workdaysBetween,
} from '../src/v2/gantt.js';
import type { PlanData } from '../src/v2/canvas.js';

const WEEK = ['mon', 'tue', 'wed', 'thu', 'fri'];
const noop = (): void => undefined;

describe('drag rules', () => {
  it('counts working days both ways and lands on a working day', () => {
    expect(workdaysBetween('2030-01-07', '2030-01-14', WEEK)).toBe(5);
    expect(workdaysBetween('2030-01-14', '2030-01-07', WEEK)).toBe(-5);
    expect(workdaysBetween('2030-01-10', '2030-01-11', WEEK)).toBe(1);
    expect(workdayFrom('2030-01-12', WEEK)).toBe('2030-01-14');
  });

  it('turns a dragged bar into a new start, and a dragged end into a duration', () => {
    const bar = { start: '2030-01-07', finish: '2030-01-09', durationDays: 3, milestone: false };
    // three days right lands on Thursday: three working days
    expect(dragOutcome('move', bar, 3, WEEK)).toEqual({
      kind: 'move',
      startDate: '2030-01-10',
      days: 3,
    });
    // onto Saturday: the Monday after, five working days
    expect(dragOutcome('move', bar, 5, WEEK)).toEqual({
      kind: 'move',
      startDate: '2030-01-14',
      days: 5,
    });
    expect(dragOutcome('move', bar, 0, WEEK)).toEqual({ kind: 'none' });
    // the end over the weekend: Wednesday to Monday adds three working days
    expect(dragOutcome('resize', bar, 5, WEEK)).toEqual({ kind: 'resize', durationDays: 6 });
    // from Friday onto Sunday: the Monday after
    expect(
      dragOutcome('resize', { ...bar, finish: '2030-01-11', durationDays: 5 }, 2, WEEK),
    ).toEqual({ kind: 'resize', durationDays: 6 });
    // never below one day
    expect(dragOutcome('resize', bar, -10, WEEK)).toEqual({ kind: 'resize', durationDays: 1 });
    expect(dragOutcome('resize', { ...bar, milestone: true, durationDays: 0 }, 2, WEEK)).toEqual({
      kind: 'none',
    });
  });
});

describe('outline, colours, axis, pieces', () => {
  const rows = [
    { id: 'P', level: 0 },
    { id: 'A', level: 1 },
    { id: 'A1', level: 2 },
    { id: 'M', level: 0 },
  ];
  const parents = new Map<string, string | null>([
    ['P', null],
    ['A', 'P'],
    ['A1', 'A'],
    ['M', null],
  ]);

  it('folds below a closed summary and below the level shown', () => {
    expect(visibleRows(rows, parents, new Set(), null).map((r) => r.id)).toEqual([
      'P',
      'A',
      'A1',
      'M',
    ]);
    expect(visibleRows(rows, parents, new Set(['P']), null).map((r) => r.id)).toEqual(['P', 'M']);
    expect(visibleRows(rows, parents, new Set(), 2).map((r) => r.id)).toEqual(['P', 'A', 'M']);
    expect(visibleRows(rows, parents, new Set(['A']), null).map((r) => r.id)).toEqual([
      'P',
      'A',
      'M',
    ]);
  });

  it('colours by the rule, with one legend entry per colour', () => {
    const ctx = {
      types: new Map([['ty', { name: 'Incident', color: '#aa3300' }]]),
      people: ['u1', 'u2'],
      name: (id: string | null) => (id === 'u2' ? 'Bo' : 'Ada'),
    };
    const t = { kind: 'bug', stateGroup: 'started', assigneeId: 'u2', typeId: 'ty' };
    expect(barColour('critical', t, ctx)).toBeNull();
    expect(barColour('state', t, ctx)?.key).toBe('In progress');
    expect(barColour('kind', t, ctx)?.key).toBe('Bug');
    expect(barColour('type', t, ctx)).toEqual({ colour: '#aa3300', key: 'Incident' });
    expect(barColour('person', t, ctx)?.key).toBe('Bo');
    expect(barColour('person', { ...t, assigneeId: null }, ctx)?.key).toBe('Nobody');
    expect(
      colourLegend(
        'kind',
        {
          tasks: [
            { ...t, id: 'a' },
            { ...t, id: 'b', kind: 'story' },
            { ...t, id: 'c', kind: 'epic' },
          ] as PlanData['tasks'],
          schedule: [
            { id: 'a', summary: false, milestone: false },
            { id: 'b', summary: false, milestone: false },
            { id: 'c', summary: true, milestone: false },
          ] as PlanData['schedule'],
        },
        ctx,
      ).map((c) => c.key),
    ).toEqual(['Bug', 'Story']);
  });

  it('writes the axis to suit the zoom', () => {
    const day = axisTicks('day', '2030-01-06', 14);
    expect(day.lines).toEqual([1, 8]);
    expect(day.bottom.find((b) => b.i === 1)?.label).toBe('7 Jan');
    const month = axisTicks('month', '2029-12-01', 62);
    expect(month.top.map((x) => x.label)).toEqual(['2029', '2030']);
    expect(month.bottom.map((x) => x.label)).toEqual(['Dec', 'Jan']);
    const year = axisTicks('year', '2030-01-01', 365);
    expect(year.bottom.map((x) => x.label)).toEqual(['Q1', 'Q2', 'Q3', 'Q4']);
    expect(year.lines).toEqual([0]);
    expect(
      ganttSpan({ start: '2030-05-10', finish: '2030-06-01', today: '2030-05-12' }, 'quarter'),
    ).toMatchObject({ from: '2030-01-01' });
    expect(
      ganttSpan({ start: '2030-05-10', finish: '2036-06-01', today: '2030-05-12' }, 'year').days,
    ).toBe(1827);
  });

  it('fills the pieces of a split bar in order', () => {
    const p = barPieces({
      start: '2030-01-07',
      finish: '2030-01-11',
      durationDays: 4,
      percentDone: 50,
      segments: [
        { start: '2030-01-07', finish: '2030-01-08' },
        { start: '2030-01-10', finish: '2030-01-11' },
      ],
    });
    expect(p.map((x) => x.done)).toEqual([1, 0]);
    expect(
      barPieces({ start: '2030-01-07', finish: '2030-01-08', durationDays: 2, percentDone: 50 }),
    ).toHaveLength(1);
  });
});

describe('drawing', () => {
  const plan: PlanData = {
    today: '2030-01-08',
    workingDays: WEEK,
    start: '2030-01-07',
    finish: '2030-01-14',
    tasks: [
      {
        id: 'P',
        ref: 'APP-1',
        title: 'Pilot',
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
        title: 'Write',
        kind: 'task',
        stateGroup: 'started',
        assigneeId: 'u1',
        estimate: null,
        parentId: 'P',
        sprintId: null,
        startDate: '2030-01-07',
        dueDate: null,
        durationDays: 4,
        scheduleMode: 'auto',
        splits: [{ after: 2, gap: 1 }],
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
        percentDone: 0,
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
        finish: '2030-01-11',
        durationDays: 4,
        percentDone: 0,
        totalFloat: 0,
        critical: true,
        violations: [],
        constraintBroken: true,
        segments: [
          { start: '2030-01-07', finish: '2030-01-08' },
          { start: '2030-01-10', finish: '2030-01-11' },
        ],
      },
    ],
    dependencies: [],
    cycle: [],
    ignored: [],
    baseline: null,
    scenario: null,
  };

  it('draws a split bar in pieces, grips and link dots for editors, and the fold', () => {
    const html = renderToString(
      <GanttV2
        plan={plan}
        zoom="day"
        critical
        selected={null}
        name={() => 'Ada'}
        onSelect={noop}
        canEdit
        onToggle={noop}
      />,
    );
    expect(html.match(/class="pv-task-bar/g)).toHaveLength(2);
    expect(html).toContain('pv-split-gap');
    expect(html).toContain('pv-bar-grip');
    expect(html).toContain('pv-link-dot');
    expect(html).toContain('constraint broken');
    expect(html).toContain('aria-label="Collapse APP-1"');
  });

  it('hides what is folded, and keeps readers to looking', () => {
    const html = renderToString(
      <GanttV2
        plan={plan}
        zoom="year"
        critical
        selected={null}
        name={() => ''}
        onSelect={noop}
        collapsed={new Set(['P'])}
        onToggle={noop}
      />,
    );
    expect(html).not.toContain('APP-2 Write');
    expect(html).not.toContain('pv-link-dot');
    expect(html).toContain('aria-label="Expand APP-1"');
  });
});
