// ── [PCODE-223 | S15 | v0.1.0] T20.5 GA exit test (licence, team, backlog, first sprint without our help), launch checklist, licence decision memo ──
//    Why:  the GA exit test. A new customer follows docs/getting-started.md on a fresh server, with nothing
//          but what the guide says: installs the licence they bought, invites the team, picks the demo
//          model, imports the Jira backlog, plans the first sprint with the Planner agent, writes
//          acceptance criteria, works the sprint and completes it, and sees the velocity it measured.
//          Every step is an API call the web app or `orq` makes.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { installLicence } from './licencehelper.js';
import { hasDatabase } from './testdb.js';

interface Capacity {
  capacity: number;
  committed: number;
  velocity: number | null;
  velocitySprints: number;
}

describe.skipIf(!hasDatabase)('the first hour, as the guide describes it (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let bob: Person;
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;

  beforeAll(async () => {
    t = await startTestApp();
    ada = await t.signup('Ada');
    bob = await t.signup('Bob');
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('goes from an empty server to a completed first sprint', async () => {
    // 2. the first account owns the workspace; the licence bought online goes in
    await installLicence(t, ada, { plan: 'team', seats: 10 });
    const lic = await t.call<{ plan: string; seats: number; status: string }>(
      ada,
      'GET',
      W('/licence'),
    );
    expect(lic.body).toMatchObject({ plan: 'team', seats: 10, status: 'active' });

    // 3. the team, and the demo model to try the agents without a key
    const inv = await t.call<{ token: string }>(ada, 'POST', W('/invitations'), {
      email: bob.email,
      role: 'member',
    });
    expect(inv.status).toBe(201);
    expect(
      (await t.call(bob, 'POST', '/auth/invitations/' + inv.body.token + '/accept', {})).status,
    ).toBe(200);
    expect((await t.call(ada, 'PUT', W('/agents/provider'), { provider: 'demo' })).status).toBe(
      200,
    );

    // 4. the backlog from Jira, numbers kept (what `orq import jira` sends)
    const state = (name: string, group: string) => ({
      externalId: 'jira:APP:state:' + name,
      name,
      group,
    });
    const issue = (n: number, title: string, points: number | null) => ({
      externalId: 'jira:' + String(10_000 + n),
      sequence: n,
      title,
      description: '',
      stateExternalId: 'jira:APP:state:To Do',
      labelExternalIds: [],
      sprintExternalId: null,
      parentExternalId: null,
      estimate: points,
      assigneeEmails: [],
      createdAt: '2026-09-01T10:00:00.000Z',
      updatedAt: '2026-09-02T10:00:00.000Z',
    });
    const imported = await t.call<{ projectId: string }>(ada, 'POST', W('/import/plane'), {
      project: { externalId: 'jira:project:APP', key: 'APP', name: 'Patient app' },
      states: [state('To Do', 'unstarted'), state('Done', 'completed')],
      items: [
        issue(12, 'Sign-in with email', 3),
        issue(13, 'Appointment list', 5),
        issue(14, 'Reminder settings', 2),
        issue(15, 'Export as PDF', 8),
      ],
    });
    expect(imported.status).toBe(200);
    const project = imported.body.projectId;
    const items = async () =>
      (
        await t.call<{ id: string; ref: string; stateId: string }[]>(
          ada,
          'GET',
          W('/projects/' + project + '/items'),
        )
      ).body;
    expect((await items()).map((i) => i.ref)).toEqual(['APP-12', 'APP-13', 'APP-14', 'APP-15']);

    // 5. the first sprint: capacity, the Planner's suggestion, a person's choice
    const sprint = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects/' + project + '/sprints'), {
        name: 'Sprint 1',
      })
    ).body.id;
    await t.call(ada, 'PUT', W('/sprints/' + sprint + '/capacity'), {
      entries: [
        { userId: ada.id, points: 5 },
        { userId: bob.id, points: 5 },
      ],
    });
    const draft = await t.call<{ room: number; items: { id: string; ref: string }[] }>(
      ada,
      'POST',
      W('/sprints/' + sprint + '/plan/draft'),
    );
    expect(draft.status).toBe(200);
    expect(draft.body.room).toBe(10);
    expect(draft.body.items.map((i) => i.ref)).toEqual(['APP-12', 'APP-13', 'APP-14']);
    const applied = await t.call<Capacity>(ada, 'POST', W('/sprints/' + sprint + '/plan/apply'), {
      itemIds: draft.body.items.map((i) => i.id),
    });
    expect(applied.body.committed).toBe(10);

    // acceptance criteria on a task
    const signIn = (await items()).find((i) => i.ref === 'APP-12')?.id ?? '';
    const crit = await t.call(ada, 'POST', W('/items/' + signIn + '/criteria'), {
      text: 'A wrong password says so without naming which part was wrong',
    });
    expect(crit.status).toBeLessThan(300);

    // 6. start, work, complete
    expect((await t.call(ada, 'POST', W('/sprints/' + sprint + '/start'))).status).toBe(200);
    const done = (
      await t.call<{ states: { id: string; name: string }[] }>(
        ada,
        'GET',
        W('/projects/' + project),
      )
    ).body.states.find((s) => s.name === 'Done')?.id;
    for (const ref of ['APP-12', 'APP-13']) {
      const id = (await items()).find((i) => i.ref === ref)?.id ?? '';
      expect((await t.call(bob, 'PATCH', W('/items/' + id), { stateId: done })).status).toBe(200);
    }
    expect(
      (await t.call(ada, 'POST', W('/sprints/' + sprint + '/complete'), { moveTo: null })).status,
    ).toBe(200);

    // the next sprint knows the velocity the team showed: 8 of 10 points
    const next = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects/' + project + '/sprints'), {
        name: 'Sprint 2',
      })
    ).body.id;
    const cap = await t.call<Capacity>(ada, 'GET', W('/sprints/' + next + '/capacity'));
    expect(cap.body).toMatchObject({ velocity: 8, velocitySprints: 1 });
  });
});
