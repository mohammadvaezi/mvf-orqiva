// ── [PCODE-261 | S15 | v0.1.0] T27.3 Canvas grid: fill down, paste from Excel, formulas and roll-ups, indent and outdent, typed predecessors ──
//    Why:  the spreadsheet rules of the Canvas grid, by hand: values typed in common forms, formulas over
//          other rows, predecessors as MS Project writes them and what changes when they are retyped, a
//          block pasted from Excel, where indent and outdent put a task, and the sums of the summary rows.
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PlanData } from '../src/v2/canvas.js';
import { GridV2, rollups } from '../src/v2/grid.js';
import {
  addWorkdays,
  depChanges,
  depText,
  evalFormula,
  indentParent,
  outdentParent,
  parseDay,
  parseNumber,
  parsePredecessors,
  parseTsv,
  type RowValues,
} from '../src/v2/gridrules.js';

const WEEK = ['mon', 'tue', 'wed', 'thu', 'fri'];

describe('typed values', () => {
  it('reads days and numbers the ways people type them', () => {
    expect(parseDay('2030-01-07')).toBe('2030-01-07');
    expect(parseDay('7.1.2030')).toBe('2030-01-07');
    expect(parseDay('07/01/30')).toBe('2030-01-07');
    expect(parseDay('1/31/2030')).toBe('2030-01-31');
    expect(parseDay('31.02.2030')).toBeNull();
    expect(parseNumber('3')).toBe(3);
    expect(parseNumber('3 days')).toBe(3);
    expect(parseNumber('2,5d')).toBe(2.5);
    expect(parseNumber('40 %')).toBe(40);
    expect(parseNumber('soon')).toBeNull();
  });

  it('counts working days for dates', () => {
    expect(addWorkdays('2030-01-10', 2, WEEK)).toBe('2030-01-14');
    expect(addWorkdays('2030-01-14', -1, WEEK)).toBe('2030-01-11');
    expect(addWorkdays('2030-01-12', 0, WEEK)).toBe('2030-01-14');
  });
});

describe('formulas', () => {
  const rows: Record<string, RowValues> = {
    '1.1': { start: '2030-01-07', finish: '2030-01-09', duration: 3, done: 50, estimate: 5 },
    '1.2': { start: '2030-01-10', finish: '2030-01-11', duration: 2, done: 0, estimate: null },
  };
  const ctx = (field: 'start' | 'duration' | 'done') => ({
    row: (w: string) => rows[w],
    field,
    workingDays: WEEK,
  });

  it('reads other rows, counts working days and calls functions', () => {
    expect(evalFormula('=[1.2].finish + 2', ctx('start'))).toEqual({
      value: { date: '2030-01-15' },
    });
    expect(evalFormula('=SUM([1.1].duration, [1.2].duration) * 2', ctx('duration'))).toEqual({
      value: 10,
    });
    expect(evalFormula('=[1.1]', ctx('duration'))).toEqual({ value: 3 });
    expect(evalFormula('=ROUND([1.1].done / 3)', ctx('done'))).toEqual({ value: 17 });
    expect(evalFormula('=[1.2].start - [1.1].start', ctx('duration'))).toEqual({ value: 3 });
    expect(evalFormula('=WORKDAY(2030-01-10; 3)', ctx('start'))).toEqual({
      value: { date: '2030-01-15' },
    });
    expect(evalFormula('=MAX([1.1].finish, [1.2].finish)', ctx('start'))).toEqual({
      value: { date: '2030-01-11' },
    });
    expect(evalFormula('=-(2+3)*2', ctx('duration'))).toEqual({ value: -10 });
  });

  it('says what is wrong', () => {
    expect(evalFormula('=[9].finish', ctx('start'))).toEqual({ error: 'there is no row 9' });
    expect(evalFormula('=[1.2].estimate', ctx('duration'))).toEqual({
      error: 'row 1.2 has no estimate',
    });
    expect(evalFormula('=[1.1].start + [1.2].start', ctx('start'))).toMatchObject({
      error: 'two dates cannot be added',
    });
    expect(evalFormula('=1/0', ctx('duration'))).toMatchObject({ error: 'division by zero' });
    expect(evalFormula('=FOO(1)', ctx('duration'))).toMatchObject({
      error: 'there is no function FOO',
    });
    expect(evalFormula('=(1+2', ctx('duration'))).toMatchObject({
      error: 'a bracket is not closed',
    });
  });
});

describe('predecessors', () => {
  const ids: Record<string, string> = { '1.1': 'A', '1.2': 'B', '2': 'C' };
  const idOf = (w: string) => ids[w];

  it('reads MS Project notation', () => {
    expect(parsePredecessors('1.1, 1.2SS+2, 2ff-1d', idOf)).toEqual({
      deps: [
        { predecessorId: 'A', kind: 'FS', lagDays: 0 },
        { predecessorId: 'B', kind: 'SS', lagDays: 2 },
        { predecessorId: 'C', kind: 'FF', lagDays: -1 },
      ],
    });
    expect(parsePredecessors('', idOf)).toEqual({ deps: [] });
    expect(parsePredecessors('7', idOf)).toEqual({ error: 'there is no row 7' });
    expect(parsePredecessors('1.1 after lunch', idOf)).toEqual({
      error: '"1.1 after lunch" is not like 1.2FS+2',
    });
    expect(parsePredecessors('1.1, 1.1SS', idOf)).toEqual({ error: '1.1 is named twice' });
    expect(depText('1.2', 'FS', 0)).toBe('1.2');
    expect(depText('1.2', 'SS', 2)).toBe('1.2SS+2d');
  });

  it('turns retyped predecessors into adds, changes and removals', () => {
    const now = [
      { id: 'd1', predecessorId: 'A', kind: 'FS', lagDays: 0 },
      { id: 'd2', predecessorId: 'B', kind: 'FS', lagDays: 0 },
    ];
    expect(
      depChanges(now, [
        { predecessorId: 'B', kind: 'SS', lagDays: 1 },
        { predecessorId: 'C', kind: 'FS', lagDays: 0 },
      ]),
    ).toEqual({
      add: [{ predecessorId: 'C', kind: 'FS', lagDays: 0 }],
      change: [{ id: 'd2', kind: 'SS', lagDays: 1 }],
      remove: ['d1'],
    });
  });
});

describe('paste and outline', () => {
  it('reads tabs, line ends and quoted cells from Excel', () => {
    expect(parseTsv('Design\t2030-01-07\t3\r\nBuild\t\t5\r\n')).toEqual([
      ['Design', '2030-01-07', '3'],
      ['Build', '', '5'],
    ]);
    expect(parseTsv('"Say ""hi""\nthere"\t2')).toEqual([['Say "hi"\nthere', '2']]);
  });

  it('indents under the row above on the level, outdents one level up', () => {
    const rows = [
      { id: 'P', level: 0, parentId: null },
      { id: 'A', level: 1, parentId: 'P' },
      { id: 'A1', level: 2, parentId: 'A' },
      { id: 'B', level: 1, parentId: 'P' },
      { id: 'Q', level: 0, parentId: null },
    ];
    expect(indentParent(rows, 'B')).toBe('A');
    expect(indentParent(rows, 'Q')).toBe('P');
    expect(indentParent(rows, 'A')).toBeNull();
    expect(indentParent(rows, 'P')).toBeNull();
    expect(outdentParent(rows, 'A1')).toBe('P');
    expect(outdentParent(rows, 'A')).toBeNull();
    expect(outdentParent(rows, 'P')).toBeUndefined();
  });
});

describe('the grid', () => {
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
    totalFloat: 0,
    critical: false,
    violations: [],
    ...extra,
  });
  const plan: PlanData = {
    today: '2030-01-07',
    workingDays: WEEK,
    start: '2030-01-07',
    finish: '2030-01-10',
    tasks: [
      task('P', { kind: 'epic' }),
      task('A', { parentId: 'P', estimate: 3 }),
      task('B', { parentId: 'P', estimate: 5 }),
    ],
    schedule: [
      sched('P', '1', { summary: true, durationDays: 4 }),
      sched('A', '1.1'),
      sched('B', '1.2', { start: '2030-01-09', finish: '2030-01-10' }),
    ],
    dependencies: [{ id: 'd', predecessorId: 'A', successorId: 'B', kind: 'SS', lagDays: 1 }],
    cycle: [],
    ignored: [],
    baseline: null,
    scenario: null,
  };

  it('adds up estimate and work on the summary rows', () => {
    expect(rollups(plan).get('P')).toEqual({ estimate: 8, work: 4 });
  });

  it('draws editable cells, the predecessors as typed, the roll-ups and the tools', () => {
    const html = renderToString(
      <GridV2 plan={plan} canEdit scenario={false} name={() => ''} onEdit={() => undefined} />,
    );
    expect(html).toContain('aria-label="Title of APP-P"');
    expect(html).not.toContain('aria-label="Start of APP-P"');
    expect(html).toContain('aria-label="Predecessors of APP-B"');
    expect(html).toContain('value="1.1SS+1d"');
    expect(html).toContain('Fill down');
    expect(html).toContain('Indent');
    expect(html).toContain('>8<');
  });

  it('keeps a scenario to dates and durations', () => {
    const html = renderToString(
      <GridV2 plan={plan} canEdit scenario name={() => ''} onEdit={() => undefined} />,
    );
    expect(html).toContain('aria-label="Start of APP-A"');
    expect(html).not.toContain('aria-label="Title of APP-A"');
    expect(html).not.toContain('Fill down');
  });
});
