// ── [PCODE-263 | S15 | v0.1.0] T27.5 Plan files: MS Project XML and CSV export and import, iCal of the plan ──
//    Why:  the plan files through the API against PostgreSQL: a project exported to MS Project XML is read back
//          into a second project with the same tasks, parents, durations, constraints, people and links;
//          a CSV from Excel is previewed (nothing made) and then made; a loop in the file is left out and
//          said; the calendar file carries every task.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

interface Plan {
  tasks: {
    id: string;
    title: string;
    parentId: string | null;
    kind: string;
    constraintType: string;
    assigneeId: string | null;
  }[];
  schedule: { id: string; start: string; durationDays: number; summary: boolean }[];
  dependencies: { predecessorId: string; successorId: string; kind: string; lagDays: number }[];
}

describe.skipIf(!hasDatabase)('plan files (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let first = '';
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  const P = (id: string, p: string): string => W('/projects/' + id + p);
  const download = async (
    id: string,
    format: string,
  ): Promise<{ type: string; text: string; name: string }> => {
    const r = await fetch(t.base + P(id, '/plan/export?format=' + format), {
      headers: { cookie: ada.cookie },
    });
    return {
      type: r.headers.get('content-type') ?? '',
      name: r.headers.get('content-disposition') ?? '',
      text: await r.text(),
    };
  };
  const newProject = async (key: string): Promise<string> =>
    (await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key, name: key + ' plan' })).body
      .id;

  beforeAll(async () => {
    t = await startTestApp();
    ada = await t.signup('Ada Lovelace');
    first = await newProject('ONE');
    const add = async (b: Record<string, unknown>): Promise<string> =>
      (await t.call<{ id: string }>(ada, 'POST', P(first, '/items'), b)).body.id;
    const epic = await add({ title: 'Booking & payments', kind: 'epic' });
    const a = await add({
      title: 'API',
      parentId: epic,
      startDate: '2027-05-03',
      durationDays: 3,
      assigneeId: ada.id,
    });
    const b = await add({
      title: 'Screen',
      parentId: epic,
      durationDays: 2,
      constraintType: 'snet',
      constraintDate: '2027-05-10',
    });
    const m = await add({ title: 'Go live', kind: 'milestone' });
    await t.call(ada, 'POST', P(first, '/dependencies'), {
      predecessorId: a,
      successorId: b,
      kind: 'SS',
      lagDays: 1,
    });
    await t.call(ada, 'POST', P(first, '/dependencies'), { predecessorId: b, successorId: m });
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('exports MS Project XML that imports into another project the same', async () => {
    const xml = await download(first, 'msproject');
    expect(xml.type).toContain('application/xml');
    expect(xml.name).toContain('one-plan.xml');
    expect(xml.text).toContain('<Name>Booking &amp; payments</Name>');

    const second = await newProject('TWO');
    const preview = await t.call<{
      tasks: { title: string; parent: string | null; kind: string; person: string | null }[];
      created: number;
    }>(ada, 'POST', P(second, '/plan/import'), { format: 'msproject', text: xml.text });
    expect(preview.body.created).toBe(0);
    expect(preview.body.tasks.map((x) => [x.title, x.parent, x.kind])).toEqual([
      ['Booking & payments', null, 'epic'],
      ['API', 'Booking & payments', 'task'],
      ['Screen', 'Booking & payments', 'task'],
      ['Go live', null, 'milestone'],
    ]);
    expect(preview.body.tasks[1]?.person).toBe('Ada Lovelace');
    expect((await t.call<Plan>(ada, 'GET', P(second, '/plan'))).body.tasks).toEqual([]);

    const done = await t.call<{ created: number; linked: number; problems: string[] }>(
      ada,
      'POST',
      P(second, '/plan/import'),
      {
        format: 'msproject',
        text: xml.text,
        apply: true,
      },
    );
    expect(done.body).toMatchObject({ created: 4, linked: 2, problems: [] });
    const [p1, p2] = [
      (await t.call<Plan>(ada, 'GET', P(first, '/plan'))).body,
      (await t.call<Plan>(ada, 'GET', P(second, '/plan'))).body,
    ];
    const shape = (p: Plan) => {
      const title = new Map(p.tasks.map((x) => [x.id, x.title]));
      return {
        tasks: p.tasks.map((x) => [
          x.title,
          x.parentId ? title.get(x.parentId) : null,
          x.constraintType,
          !!x.assigneeId,
        ]),
        schedule: p.schedule.map((x) => [title.get(x.id), x.start, x.durationDays]),
        links: p.dependencies.map((d) => [
          title.get(d.predecessorId),
          title.get(d.successorId),
          d.kind,
          d.lagDays,
        ]),
      };
    };
    expect(shape(p2)).toEqual(shape(p1));
  });

  it('previews and makes a plan from an Excel CSV, leaving a loop out', async () => {
    const third = await newProject('TRI');
    const csv =
      'ID;Name;Outline level;Duration;Start;Predecessors;Resource\n' +
      '1;Phase 1;1;;;;\n' +
      '2;Design;2;3 days;03.05.2027;3;Ada\n' +
      '3;Build;2;5d;;2;Nobody Known\n';
    const r = await t.call<{ created: number; linked: number; problems: string[] }>(
      ada,
      'POST',
      P(third, '/plan/import'),
      {
        format: 'csv',
        text: csv,
        apply: true,
      },
    );
    expect(r.body.created).toBe(3);
    expect(r.body.linked).toBe(1);
    expect(r.body.problems).toEqual([
      'Build: nobody called Nobody Known, left unassigned',
      'Build: the link to 2 would close a loop, left out',
    ]);
    const bad = await t.call(ada, 'POST', P(third, '/plan/import'), {
      format: 'csv',
      text: 'Foo\n1',
    });
    expect(bad.status).toBe(200);
    expect((bad.body as { problems: string[] }).problems).toEqual([
      'the first row needs a Name column',
    ]);
  });

  it('gives the plan as CSV and as a calendar', async () => {
    const csv = await download(first, 'csv');
    expect(csv.type).toContain('text/csv');
    expect(csv.text.split('\r\n')[1]).toContain('Booking & payments');
    const ics = await download(first, 'ics');
    expect(ics.type).toContain('text/calendar');
    expect(ics.text.match(/BEGIN:VEVENT/g)).toHaveLength(3);
    expect(ics.text).toContain('DTSTART;VALUE=DATE:20270503');
  });
});
