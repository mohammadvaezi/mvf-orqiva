// ── [PCODE-265 | S15 | v0.1.0] T27.7 T27 exit check, docs and sprint close ──
//    Why:  the T27 exit as one planner's week, end to end against the real server: a plan comes in from MS
//          Project, a task gets a constraint and a split, a chain is shifted, a scenario is compared task by
//          task, an agent carries work, the plan goes out as CSV and a calendar, and a read-only link shows it
//          to someone without an account.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inSystem } from '../../src/db/pool.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

const MSP = `<?xml version="1.0"?><Project xmlns="http://schemas.microsoft.com/project"><Tasks>
<Task><UID>1</UID><Name>Release 2</Name><OutlineLevel>1</OutlineLevel><Summary>1</Summary></Task>
<Task><UID>2</UID><Name>Design</Name><OutlineLevel>2</OutlineLevel><Start>2027-09-06T08:00:00</Start><Duration>PT24H0M0S</Duration></Task>
<Task><UID>3</UID><Name>Build</Name><OutlineLevel>2</OutlineLevel><Duration>PT32H0M0S</Duration>
  <PredecessorLink><PredecessorUID>2</PredecessorUID><Type>1</Type></PredecessorLink></Task>
<Task><UID>4</UID><Name>Release</Name><OutlineLevel>1</OutlineLevel><Milestone>1</Milestone><Duration>PT0H0M0S</Duration>
  <PredecessorLink><PredecessorUID>3</PredecessorUID><Type>1</Type></PredecessorLink></Task>
</Tasks></Project>`;

interface Plan {
  tasks: { id: string; title: string }[];
  schedule: {
    id: string;
    start: string;
    finish: string;
    segments: { start: string }[];
    constraintBroken: boolean;
  }[];
  scenario: { diff: { itemId: string; direct: boolean }[] } | null;
}

describe.skipIf(!hasDatabase)('T27 exit: the Canvas complete (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let project = '';
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  const P = (p: string): string => W('/projects/' + project + p);
  const plan = async (q = ''): Promise<Plan> =>
    (await t.call<Plan>(ada, 'GET', P('/plan' + q))).body;

  beforeAll(async () => {
    t = await startTestApp();
    ada = await t.signup('Ada');
    project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'REL', name: 'Release 2' })
    ).body.id;
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('runs a plan from MS Project to a shared link', async () => {
    // in from MS Project
    const imp = await t.call<{ created: number; linked: number }>(ada, 'POST', P('/plan/import'), {
      format: 'msproject',
      text: MSP,
      apply: true,
    });
    expect(imp.body).toMatchObject({ created: 4, linked: 2 });
    let p = await plan();
    const id = (title: string): string => p.tasks.find((x) => x.title === title)?.id ?? '';
    const at = (title: string) => p.schedule.find((x) => x.id === id(title));
    expect(at('Design')?.start).toBe('2027-09-06');
    expect(at('Build')?.start).toBe('2027-09-09');
    expect(at('Release')?.start).toBe('2027-09-15');

    // a split and a constraint
    await t.call(ada, 'PATCH', W('/items/' + id('Build')), { splits: [{ after: 2, gap: 1 }] });
    await t.call(ada, 'PATCH', W('/items/' + id('Release')), {
      constraintType: 'fnlt',
      constraintDate: '2027-09-15',
    });
    p = await plan();
    expect(at('Build')?.segments).toHaveLength(2);
    expect(at('Release')).toMatchObject({ start: '2027-09-16', constraintBroken: true });

    // shift-drag: the design and everything behind it a week later
    await t.call(ada, 'POST', P('/plan/shift'), {
      itemId: id('Design'),
      days: 5,
      withSuccessors: true,
    });
    p = await plan();
    expect(at('Design')?.start).toBe('2027-09-13');
    expect(at('Release')?.start).toBe('2027-09-23');

    // a scenario, compared task by task
    const sc = (
      await t.call<{ id: string }>(ada, 'POST', P('/scenarios'), { name: 'Longer build' })
    ).body.id;
    await t.call(ada, 'PATCH', W('/scenarios/' + sc), {
      changes: { [id('Build')]: { durationDays: 6 } },
    });
    const sp = await plan('?scenarioId=' + sc);
    expect(sp.scenario?.diff.find((d) => d.itemId === id('Build'))?.direct).toBe(true);
    expect(sp.scenario?.diff.find((d) => d.itemId === id('Release'))?.direct).toBe(false);

    // an agent carries a task
    const agent = await inSystem(
      t.db.pool,
      async (c) =>
        (
          await c.query<{ id: string }>(
            "INSERT INTO agents (workspace_id, key, name, model) VALUES ($1, 'builder', 'Builder', 'demo') RETURNING id",
            [ada.workspaceId],
          )
        ).rows[0]?.id,
    );
    await t.call(ada, 'PATCH', W('/items/' + id('Design')), { agentId: agent });
    const load = await t.call<{ people: { kind: string; name: string }[] }>(
      ada,
      'GET',
      P('/workload?from=2027-09-13&to=2027-09-24'),
    );
    expect(load.body.people).toEqual([expect.objectContaining({ kind: 'agent', name: 'Builder' })]);

    // out as CSV and a calendar
    const csv = await (
      await fetch(t.base + P('/plan/export?format=csv'), { headers: { cookie: ada.cookie } })
    ).text();
    expect(csv).toContain('Finish no later than');
    const ics = await (
      await fetch(t.base + P('/plan/export?format=ics'), { headers: { cookie: ada.cookie } })
    ).text();
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(3);

    // and read-only for the steering board
    const share = await t.call<{ token: string }>(ada, 'POST', P('/plan/shares'), {
      label: 'Steering board',
    });
    const seen = await t.call<{ tasks: { title: string }[] }>(
      null,
      'GET',
      '/api/share/plan/' + share.body.token,
    );
    expect(seen.body.tasks.map((x) => x.title)).toEqual([
      'Release 2',
      'Design',
      'Build',
      'Release',
    ]);
  });
});
