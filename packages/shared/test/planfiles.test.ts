// ── [PCODE-263 | S15 | v0.1.0] T27.5 Plan files: MS Project XML and CSV export and import, iCal of the plan ──
//    Why:  a plan that goes out to MS Project or Excel comes back the same: tasks, levels, durations,
//          constraints, people and links survive both round trips; files written by MS Project itself (and in
//          German) are read; and the calendar file follows RFC 5545.
import { describe, expect, it } from 'vitest';
import {
  mspDays,
  parseMsProjectXml,
  parsePlanCsv,
  planIcs,
  readCsv,
  readDay,
  readDuration,
  toMsProjectXml,
  toPlanCsv,
  type ExportDep,
  type ExportTask,
} from '../src/planfiles.js';

const t = (id: string, extra: Partial<ExportTask>): ExportTask => ({
  id,
  ref: 'APP-' + id,
  title: 'Task ' + id,
  wbs: '1',
  level: 1,
  kind: 'task',
  start: '2030-01-07',
  finish: '2030-01-09',
  durationDays: 3,
  percentDone: 0,
  summary: false,
  milestone: false,
  manual: false,
  constraintType: 'asap',
  constraintDate: null,
  resource: null,
  ...extra,
});
const tasks: ExportTask[] = [
  t('E', {
    title: 'Booking & payments',
    wbs: '1',
    summary: true,
    kind: 'epic',
    finish: '2030-01-14',
    durationDays: 6,
  }),
  t('A', { title: 'API "v2"', wbs: '1.1', level: 2, percentDone: 40, resource: 'Ada Lovelace' }),
  t('B', {
    title: 'Screen; mobile',
    wbs: '1.2',
    level: 2,
    start: '2030-01-10',
    finish: '2030-01-14',
    constraintType: 'snet',
    constraintDate: '2030-01-10',
    manual: true,
  }),
  t('M', {
    title: 'Go live',
    wbs: '2',
    milestone: true,
    start: '2030-01-15',
    finish: '2030-01-15',
    durationDays: 0,
    kind: 'milestone',
  }),
];
const deps: ExportDep[] = [
  { predecessorId: 'A', successorId: 'B', kind: 'SS', lagDays: 2 },
  { predecessorId: 'B', successorId: 'M', kind: 'FS', lagDays: 0 },
];

describe('MS Project XML', () => {
  it('goes out and comes back the same', () => {
    const xml = toMsProjectXml({ name: 'App', start: '2030-01-07', tasks, deps });
    expect(xml).toContain('<Name>API &quot;v2&quot;</Name>');
    expect(xml).toContain('<Duration>PT24H0M0S</Duration>');
    expect(xml).toContain('<LinkLag>9600</LinkLag>');
    const back = parseMsProjectXml(xml);
    expect(back.problems).toEqual([]);
    expect(back.tasks.map((x) => [x.title, x.level, x.durationDays, x.summary])).toEqual([
      ['Booking & payments', 1, 6, true],
      ['API "v2"', 2, 3, false],
      ['Screen; mobile', 2, 3, false],
      ['Go live', 1, 0, false],
    ]);
    expect(back.tasks[1]).toMatchObject({
      percentDone: 40,
      resource: 'Ada Lovelace',
      start: '2030-01-07',
    });
    expect(back.tasks[2]).toMatchObject({
      manual: true,
      constraintType: 'snet',
      constraintDate: '2030-01-10',
      preds: [{ key: '2', kind: 'SS', lagDays: 2 }],
    });
    expect(back.tasks[3]).toMatchObject({
      milestone: true,
      preds: [{ key: '3', kind: 'FS', lagDays: 0 }],
    });
  });

  it('reads a file MS Project wrote: the project task skipped, its own minutes per day, extra blocks ignored', () => {
    const xml = `<?xml version="1.0"?><Project xmlns="http://schemas.microsoft.com/project"><MinutesPerDay>420</MinutesPerDay>
      <Tasks>
        <Task><UID>0</UID><ID>0</ID><Name>Plan</Name><OutlineLevel>0</OutlineLevel><Summary>1</Summary></Task>
        <Task><UID>7</UID><ID>1</ID><Name>Konzept</Name><OutlineLevel>1</OutlineLevel><Start>2030-02-04T08:00:00</Start>
          <Duration>PT14H0M0S</Duration><ExtendedAttribute><FieldID>1</FieldID><Name>ignored</Name></ExtendedAttribute>
          <Baseline><Number>0</Number><Duration>PT99H0M0S</Duration></Baseline></Task>
        <Task><UID>9</UID><ID>2</ID><Name>Bau</Name><OutlineLevel>1</OutlineLevel><Duration>P1DT7H</Duration>
          <ConstraintType>7</ConstraintType><ConstraintDate>2030-03-01T17:00:00</ConstraintDate>
          <PredecessorLink><PredecessorUID>7</PredecessorUID><Type>0</Type><LinkLag>-4200</LinkLag></PredecessorLink></Task>
      </Tasks></Project>`;
    const p = parseMsProjectXml(xml);
    expect(p.tasks.map((x) => [x.key, x.title, x.durationDays])).toEqual([
      ['7', 'Konzept', 2],
      ['9', 'Bau', 2],
    ]);
    expect(p.tasks[1]).toMatchObject({
      constraintType: 'fnlt',
      constraintDate: '2030-03-01',
      preds: [{ key: '7', kind: 'FF', lagDays: -1 }],
    });
    expect(parseMsProjectXml('<html></html>').problems).toEqual(['this is not MS Project XML']);
    expect(mspDays('PT4H0M0S')).toBe(0.5);
    expect(mspDays('soon')).toBeNull();
  });
});

describe('CSV', () => {
  it('goes out and comes back the same', () => {
    const csv = toPlanCsv(tasks, deps);
    expect(csv.split('\r\n')[0]).toBe(
      'ID,WBS,Name,Kind,Start,Finish,Duration,Predecessors,Resource,% Complete,Constraint,Constraint date,Ref',
    );
    expect(csv).toContain('"API ""v2"""');
    expect(csv).toContain('2SS+2d');
    const back = parsePlanCsv(csv);
    expect(back.problems).toEqual([]);
    expect(
      back.tasks.map((x) => [x.key, x.title, x.level, x.durationDays, x.summary, x.milestone]),
    ).toEqual([
      ['1', 'Booking & payments', 1, 6, true, false],
      ['2', 'API "v2"', 2, 3, false, false],
      ['3', 'Screen; mobile', 2, 3, false, false],
      ['4', 'Go live', 1, 0, false, true],
    ]);
    expect(back.tasks[2]).toMatchObject({
      constraintType: 'snet',
      constraintDate: '2030-01-10',
      preds: [{ key: '2', kind: 'SS', lagDays: 2 }],
    });
    expect(back.tasks[1]).toMatchObject({ percentDone: 40, resource: 'Ada Lovelace' });
  });

  it('reads a German sheet with semicolons, levels and its own words', () => {
    const csv =
      'Nr.;Gliederungsebene;Vorgangsname;Dauer;Anfang;Vorgänger;Ressourcennamen\n' +
      '1;1;Phase 1;10 Tage;Mo 01.07.30;;\n' +
      '2;2;Entwurf;1 Woche;Mo 01.07.30;;Ada[50%]\n' +
      '3;2;"Prüfung; intern";16h;;2EA+1 Tag;\n';
    const p = parsePlanCsv(csv);
    expect(p.problems).toEqual([]);
    expect(p.tasks.map((x) => [x.title, x.level, x.durationDays, x.summary, x.start])).toEqual([
      ['Phase 1', 1, 10, true, '2030-07-01'],
      ['Entwurf', 2, 5, false, '2030-07-01'],
      ['Prüfung; intern', 2, 2, false, null],
    ]);
    expect(p.tasks[1]?.resource).toBe('Ada');
    expect(p.tasks[2]?.preds).toEqual([{ key: '2', kind: 'FS', lagDays: 1 }]);
  });

  it('says what it cannot read', () => {
    expect(parsePlanCsv('Foo,Bar\n1,2').problems).toEqual(['the first row needs a Name column']);
    expect(parsePlanCsv('Name,Duration,Start\nX,a while,someday').problems).toEqual([
      'row 2: cannot read the duration "a while"',
      'row 2: cannot read the start "someday"',
    ]);
    expect(readCsv('a\tb\n1\t2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
    expect(readDay('10/12/2030 08:00')).toBe('2030-10-12');
    expect(readDay('13/12/2030')).toBe('2030-12-13');
    expect(readDuration('3 days?')).toBe(3);
    expect(readDuration('2 mons')).toBe(40);
  });
});

describe('iCal', () => {
  it('writes all-day events, ends the day after, escapes and folds', () => {
    const ics = planIcs({
      name: 'App, the plan',
      stamp: '20300101T000000Z',
      tasks: [
        {
          id: 'A',
          ref: 'APP-1',
          title: 'API; first',
          start: '2030-01-07',
          finish: '2030-01-09',
          milestone: false,
          percentDone: 40,
        },
        {
          id: 'M',
          ref: 'APP-2',
          title: 'Go live ' + 'x'.repeat(80),
          start: '2030-01-15',
          finish: '2030-01-15',
          milestone: true,
          percentDone: 0,
        },
      ],
    });
    expect(ics).toContain('X-WR-CALNAME:App\\, the plan');
    expect(ics).toContain('DTSTART;VALUE=DATE:20300107\r\nDTEND;VALUE=DATE:20300110');
    expect(ics).toContain('SUMMARY:APP-1 API\\; first');
    expect(ics).toContain('DTEND;VALUE=DATE:20300116');
    expect(ics.split('\r\n').every((l) => new TextEncoder().encode(l).length <= 75)).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
  });
});
