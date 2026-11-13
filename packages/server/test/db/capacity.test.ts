// ── [PCODE-253 | S15 | v0.1.0] T26.2 Capacity from profiles, absences, holidays and agents; Planner proposes assignees and new stories ──
//    Why:  capacity and the Planner against the real database with a scripted model: each person's room comes
//          from their profile, the sprint's working days, the workspace's holidays and their approved absences;
//          an agent with a day budget shows its share; the Planner's draft keeps a task after the task it waits
//          for, names who has room, proposes a missing story within the room, and accepting gives tasks their
//          assignees and makes the story a task of the sprint.
import { personCapacity } from '@orqiva/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { scriptedProvider, type ModelReply } from '../../src/agents/provider.js';
import { inSystem } from '../../src/db/pool.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

describe('capacity of one person', () => {
  it('counts working days, holidays, absences and focus', () => {
    const base = {
      from: '2026-10-19',
      to: '2026-10-30',
      workingDays: ['mon', 'tue', 'wed', 'thu', 'fri'],
      holidays: ['2026-10-26'],
      hoursPerWeek: 40,
      focusFactor: 0.75,
      absences: [],
      hoursPerPoint: 6,
      unit: 'points' as const,
    };
    expect(personCapacity(base)).toEqual({ days: 9, absentDays: 0, hours: 54, value: 9 });
    expect(
      personCapacity({
        ...base,
        hoursPerWeek: 20,
        focusFactor: 0.5,
        absences: [
          { startsOn: '2026-10-20', endsOn: '2026-10-21', halfDay: false },
          { startsOn: '2026-10-29', endsOn: '2026-10-29', halfDay: true },
        ],
      }),
    ).toEqual({ days: 9, absentDays: 2.5, hours: 13, value: 2 });
    expect(personCapacity({ ...base, unit: 'hours' }).value).toBe(54);
  });
});

describe.skipIf(!hasDatabase)('derived capacity and the Planner (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let bo: Person;
  let project = '';
  let sprint = '';
  let reply: ModelReply | null = null;
  const ids: Record<string, string> = {};
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;

  beforeAll(async () => {
    t = await startTestApp({
      agents: { provider: () => Promise.resolve(scriptedProvider(reply ? [reply] : [])) },
    });
    ada = await t.signup('Ada');
    bo = await t.signup('Bo');
    await t.call(ada, 'POST', W('/members'), { email: bo.email, role: 'member' });
    project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'HEL', name: 'Helio' })
    ).body.id;
    sprint = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects/' + project + '/sprints'), {
        name: 'Sprint 7',
        startDate: '2026-10-19',
        endDate: '2026-10-30',
      })
    ).body.id;
    const add = async (title: string, estimate: number, extra: Record<string, unknown> = {}) =>
      (ids[title] = (
        await t.call<{ id: string }>(ada, 'POST', W('/projects/' + project + '/items'), {
          title,
          estimate,
          ...extra,
        })
      ).body.id);
    await add('Booking API', 3, { assigneeId: ada.id });
    await add('Booking screen', 2);
    await add('Export', 5);
    await t.call(ada, 'POST', W('/projects/' + project + '/dependencies'), {
      predecessorId: ids['Booking API'],
      successorId: ids['Booking screen'],
    });
    await t.call(ada, 'PUT', W('/projects/' + project + '/members/' + bo.id), { role: 'member' });
    await t.call(ada, 'PUT', W('/members/' + bo.id + '/profile'), {
      capacityHoursWeek: 20,
      focusFactor: 0.5,
    });
    await t.call(ada, 'PUT', W('/settings/calendar.holidays'), {
      scope: 'workspace',
      value: ['2026-10-26'],
    });
    await inSystem(t.db.pool, (c) =>
      c.query(
        "INSERT INTO absences (workspace_id, user_id, starts_on, ends_on, kind, state) VALUES ($1, $2, '2026-10-20', '2026-10-21', 'holiday', 'approved')",
        [ada.workspaceId, bo.id],
      ),
    );
    const dev = (await t.call<{ id: string; key: string }[]>(ada, 'GET', W('/agents'))).body.find(
      (a) => a.key === 'developer',
    );
    await t.call(ada, 'PATCH', W('/agents/' + String(dev?.id)), { dayBudgetCents: 500 });
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('derives each person’s room from profile, days, holidays and absences', async () => {
    const r = await t.call<{
      capacity: number;
      window: { days: number };
      members: {
        name: string;
        points: number;
        hours: number;
        absentDays: number;
        manual: boolean;
      }[];
      agents: { name: string; sprintBudgetCents: number }[];
    }>(ada, 'GET', W('/sprints/' + sprint + '/capacity'));
    expect(r.body.window.days).toBe(9);
    expect(r.body.members.map((m) => [m.name, m.points, m.hours, m.absentDays, m.manual])).toEqual([
      ['Ada', 9, 54, 0, false],
      ['Bo', 2, 14, 2, false],
    ]);
    expect(r.body.capacity).toBe(11);
    expect(r.body.agents).toEqual([
      expect.objectContaining({ name: 'Developer agent', sprintBudgetCents: 4500 }),
    ]);
  });

  it('keeps a task after the one it waits for, names who takes it, proposes a story', async () => {
    reply = {
      content: [
        {
          type: 'text',
          text:
            '```json\n' +
            JSON.stringify({
              items: [
                { ref: 'HEL-2', why: 'the screen', confidence: 0.7, assignee: 'Bo' },
                { ref: 'HEL-1', why: 'the API first', confidence: 0.9, assignee: 'Ada' },
                { ref: 'HEL-3', why: 'the export', confidence: 0.6, assignee: 'bo' },
              ],
              newItems: [
                {
                  title: 'Write the release note',
                  estimate: 1,
                  why: 'clients ask',
                  assignee: 'Bo',
                },
                { title: 'Rewrite everything', estimate: 50, why: 'why not' },
              ],
              reasons: 'API before the screen.',
              considered: ['Bo is away two days'],
            }) +
            '\n```',
        },
      ],
      stopReason: 'end_turn',
      usage: { input: 100, output: 50 },
    };
    const d = await t.call<{
      draftId: string;
      room: number;
      lines: { ref: string; assigneeName: string | null }[];
      newItems: { id: string; title: string; assigneeName: string | null }[];
      dropped: { ref: string; why: string }[];
    }>(ada, 'POST', W('/sprints/' + sprint + '/plan/draft'));
    expect(d.status).toBe(200);
    expect(d.body.room).toBe(11);
    expect(d.body.lines.map((l) => [l.ref, l.assigneeName])).toEqual([
      ['HEL-1', 'Ada'],
      ['HEL-3', 'Bo'],
    ]);
    expect(d.body.dropped).toEqual([
      { ref: 'HEL-2', why: 'waits for HEL-1' },
      { ref: 'Rewrite everything', why: 'a new story that does not fit the room left' },
    ]);
    expect(d.body.newItems.map((n) => [n.title, n.assigneeName])).toEqual([
      ['Write the release note', 'Bo'],
    ]);

    const decided = await t.call<{ draft: { status: string } }>(
      ada,
      'POST',
      W('/plan-drafts/' + d.body.draftId + '/decide'),
      {
        accept: [ids['Booking API'], ids['Export']],
        acceptNew: [d.body.newItems[0]?.id],
      },
    );
    expect(decided.body.draft.status).toBe('decided');
    const items = (
      await t.call<
        {
          ref: string;
          title: string;
          sprintId: string;
          assigneeId: string;
          estimate: number;
          kind: string;
        }[]
      >(ada, 'GET', W('/projects/' + project + '/items'))
    ).body.filter((i) => i.sprintId === sprint);
    expect(
      items.map((i) => [i.ref, i.title, i.assigneeId === bo.id ? 'Bo' : 'Ada', i.estimate, i.kind]),
    ).toEqual([
      ['HEL-1', 'Booking API', 'Ada', 3, 'task'],
      ['HEL-3', 'Export', 'Bo', 5, 'task'],
      ['HEL-4', 'Write the release note', 'Bo', 1, 'story'],
    ]);
  });
});
