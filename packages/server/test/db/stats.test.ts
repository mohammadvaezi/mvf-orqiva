// ── [PCODE-114 | S15 | v0.1.0] Add the Home dashboard and project overview with our own charts ──
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WEEKS } from '../../src/api/stats.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

interface ProjectStats {
  byState: { name: string; group: string; count: number }[];
  byAssignee: { userId: string | null; name: string; open: number }[];
  weekly: { week: string; created: number; completed: number }[];
  burndown: {
    name: string;
    total: number;
    days: { date: string; remaining: number | null }[];
  } | null;
}

/** Monday of the week of a date, as the server's date_trunc('week') gives it. */
function monday(d: Date): string {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
  return x.toISOString().slice(0, 10);
}

describe.skipIf(!hasDatabase)('statistics (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let project = '';
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  const today = new Date().toISOString().slice(0, 10);
  const shift = (days: number): string =>
    new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
  const fiveWeeksAgo = new Date(Date.now() - 35 * 86_400_000);

  beforeAll(async () => {
    t = await startTestApp();
    ada = await t.signup('Ada');
    project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'APP', name: 'App' })
    ).body.id;
    const states = (
      await t.call<{ states: { id: string; name: string }[] }>(
        ada,
        'GET',
        W('/projects/' + project),
      )
    ).body.states;
    const st = (name: string): string => states.find((s) => s.name === name)?.id ?? '';
    const sprint = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects/' + project + '/sprints'), {
        name: 'Sprint one',
        startDate: shift(-2),
        endDate: shift(3),
      })
    ).body.id;
    await t.call(ada, 'POST', W('/sprints/' + sprint + '/start'));
    const ids: string[] = [];
    for (const n of [1, 2, 3, 4]) {
      const r = await t.call<{ id: string }>(ada, 'POST', W('/projects/' + project + '/items'), {
        title: 'Task ' + String(n),
        sprintId: sprint,
        ...(n <= 2 ? { assigneeId: ada.id } : {}),
      });
      ids.push(r.body.id);
    }
    // two of the four are finished today: one by a move, one created straight into Done counts by its change
    await t.call(ada, 'PATCH', W('/items/' + String(ids[0])), {
      stateId: st('Done'),
    });
    await t.call(ada, 'PATCH', W('/items/' + String(ids[1])), {
      stateId: st('In Progress'),
    });
    await t.call(ada, 'POST', W('/projects/' + project + '/items'), {
      title: 'Born done',
      stateId: st('Done'),
    });

    // an item imported from Plane, finished five weeks ago according to its history
    await t.call(ada, 'POST', W('/import/plane'), {
      project: { externalId: 'pp', key: 'APP', name: 'App' },
      intoProjectId: project,
      states: [{ externalId: 'p-done', name: 'Done', group: 'completed' }],
      items: [
        {
          externalId: 'old-1',
          sequence: 50,
          title: 'Old work',
          description: '',
          stateExternalId: 'p-done',
          labelExternalIds: [],
          sprintExternalId: null,
          parentExternalId: null,
          assigneeEmails: [],
          createdAt: new Date(fiveWeeksAgo.getTime() - 86_400_000).toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
      history: [
        {
          externalId: 'h-1',
          itemExternalId: 'old-1',
          at: fiveWeeksAgo.toISOString(),
          actor: 'farivarz',
          verb: 'updated',
          field: 'state',
          oldValue: 'Review',
          newValue: 'Done',
        },
      ],
    });
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('counts work by state and open work by person', async () => {
    const r = await t.call<ProjectStats>(ada, 'GET', W('/projects/' + project + '/stats'));
    expect(r.status).toBe(200);
    const by = Object.fromEntries(r.body.byState.map((s) => [s.name, s.count]));
    expect(by).toMatchObject({ Backlog: 2, 'In Progress': 1, Done: 3, Todo: 0 });
    expect(r.body.byAssignee).toEqual([
      { userId: null, name: 'Unassigned', open: 2 },
      { userId: ada.id, name: 'Ada', open: 1 },
    ]);
  });

  it('counts created and finished per week, the imported past included', async () => {
    const r = await t.call<ProjectStats>(ada, 'GET', W('/projects/' + project + '/stats'));
    expect(r.body.weekly).toHaveLength(WEEKS);
    const week = (d: Date) => r.body.weekly.find((w) => w.week === monday(d));
    expect(week(new Date())).toMatchObject({ created: 5, completed: 2 });
    expect(week(fiveWeeksAgo)?.completed).toBe(1);
  });

  it('draws the burndown of the running sprint up to today', async () => {
    const r = await t.call<ProjectStats>(ada, 'GET', W('/projects/' + project + '/stats'));
    const b = r.body.burndown;
    expect(b?.name).toBe('Sprint one');
    expect(b?.total).toBe(4);
    expect(b?.days.map((d) => d.date)).toEqual([-2, -1, 0, 1, 2, 3].map(shift));
    expect(b?.days.find((d) => d.date === today)?.remaining).toBe(3);
    expect(b?.days.find((d) => d.date === shift(-1))?.remaining).toBe(4);
    expect(b?.days.find((d) => d.date === shift(1))?.remaining).toBeNull();
  });

  it('sums each project for the workspace', async () => {
    await t.call(ada, 'POST', W('/projects'), { key: 'OPS', name: 'Ops' });
    const r = await t.call<{
      projects: { key: string; backlog: number; started: number; completed: number }[];
      weekly: { completed: number }[];
    }>(ada, 'GET', W('/stats'));
    expect(r.body.projects.map((p) => [p.key, p.backlog, p.started, p.completed])).toEqual([
      ['APP', 2, 1, 3],
      ['OPS', 0, 0, 0],
    ]);
    expect(r.body.weekly.reduce((n, w) => n + w.completed, 0)).toBe(3);
  });
});
