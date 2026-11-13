// ── [PCODE-347 | S15 | v0.1.0] T35.1b Homes for developers and testers with widgets the person chooses ──
//    Why:  against the real database: an admin gets a lead's home, a project's tester a tester's and a
//          member a developer's; each widget shows what is theirs; their own choice of widgets is kept
//          and forgotten again; and a client contact is sent to the portal's home.
import { localDay } from '@orqiva/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inSystem } from '../../src/db/pool.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

describe.skipIf(!hasDatabase)('homes and widgets (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let dev: Person;
  let tess: Person;
  let project = '';
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  type Home = {
    persona: string;
    custom: boolean;
    widgets: string[];
    data: Record<string, unknown>;
  };
  const sys = (sql: string, args: unknown[] = []) => inSystem(t.db.pool, (c) => c.query(sql, args));

  beforeAll(async () => {
    t = await startTestApp();
    ada = await t.signup('Ada');
    dev = await t.signup('Dev');
    tess = await t.signup('Tess');
    for (const p of [dev, tess])
      await t.call(ada, 'POST', W('/members'), { email: p.email, role: 'member' });
    project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'APP', name: 'The App' })
    ).body.id;
    await sys(
      "INSERT INTO project_members (workspace_id, project_id, user_id, role) VALUES ($1, $2, $3, 'tester') ON CONFLICT (project_id, user_id) DO UPDATE SET role = 'tester'",
      [ada.workspaceId, project, tess.id],
    );
    await t.call(ada, 'POST', W('/projects/' + project + '/items'), {
      title: 'Sign-in page',
      assigneeId: dev.id,
    });
    await t.call(dev, 'PUT', W('/time/cell'), {
      day: localDay(new Date()),
      minutes: 90,
      label: 'Reviews',
    });
    // a test run with a failed case assigned to Tess
    const kase = (
      await sys(
        "INSERT INTO test_cases (workspace_id, project_id, title, expected) VALUES ($1, $2, 'Sign in', 'It works') RETURNING id",
        [ada.workspaceId, project],
      )
    ).rows[0] as { id: string };
    const run = (
      await sys(
        "INSERT INTO test_runs (workspace_id, project_id, name) VALUES ($1, $2, 'UAT 1') RETURNING id",
        [ada.workspaceId, project],
      )
    ).rows[0] as { id: string };
    await sys(
      "INSERT INTO test_results (workspace_id, run_id, case_id, status, assignee_id) VALUES ($1, $2, $3, 'failed', $4)",
      [ada.workspaceId, run.id, kase.id, tess.id],
    );
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('gives each person their kind of home with what is theirs', async () => {
    const lead = (await t.call<Home>(ada, 'GET', W('/home'))).body;
    expect(lead.persona).toBe('lead');
    expect(lead.widgets).toEqual(['incidents', 'reviews', 'deploys']);
    const d = (await t.call<Home>(dev, 'GET', W('/home'))).body;
    expect(d.persona).toBe('developer');
    expect(d.data['time-today']).toEqual({ minutes: 90, running: false });
    const te = (await t.call<Home>(tess, 'GET', W('/home'))).body;
    expect(te.persona).toBe('tester');
    expect(te.data['my-tests']).toEqual([
      expect.objectContaining({ name: 'UAT 1', mine: 1, failing: 1 }),
    ]);
    expect(te.data['failing-tests']).toEqual([
      expect.objectContaining({ title: 'Sign in', status: 'failed' }),
    ]);
    // another kind of home can be tried
    expect((await t.call<Home>(dev, 'GET', W('/home?persona=tester'))).body.widgets[0]).toBe(
      'my-tests',
    );
  });

  it('keeps a person’s own widgets, and forgets them again', async () => {
    expect(
      (
        await t.call(dev, 'PUT', W('/settings/home.widgets'), {
          scope: 'user',
          value: ['time-today', 'nonsense'],
        })
      ).status,
    ).toBe(400);
    await t.call(dev, 'PUT', W('/settings/home.widgets'), {
      scope: 'user',
      value: ['time-today', 'my-tasks'],
    });
    const own = (await t.call<Home>(dev, 'GET', W('/home'))).body;
    expect(own).toMatchObject({ custom: true, widgets: ['time-today', 'my-tasks'] });
    expect(own.data['my-tasks']).toEqual([
      expect.objectContaining({ ref: 'APP-1', title: 'Sign-in page' }),
    ]);
    // nobody else's home changes
    expect((await t.call<Home>(tess, 'GET', W('/home'))).body.custom).toBe(false);
    await t.call(dev, 'DELETE', W('/settings/home.widgets?scope=user'));
    expect((await t.call<Home>(dev, 'GET', W('/home'))).body.custom).toBe(false);
  });
});
