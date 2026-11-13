// ── [PCODE-129 | S15 | v0.1.0] Import from Jira and Linear CSV exports ──
//    Why:  imports from Jira and Linear carry story points; a second run updates them, never duplicates.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

describe.skipIf(!hasDatabase)('imports with estimates (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  const bundle = (estimate: number | null, title = 'Login page') => ({
    project: { externalId: 'linear:project:ENG', key: 'ENG', name: 'Engineering' },
    states: [{ externalId: 'linear:ENG:state:Todo', name: 'Todo', group: 'unstarted' }],
    items: [
      {
        externalId: 'linear:ENG-12',
        sequence: 12,
        title,
        description: '',
        stateExternalId: 'linear:ENG:state:Todo',
        labelExternalIds: [],
        sprintExternalId: null,
        parentExternalId: null,
        estimate,
        assigneeEmails: [],
        createdAt: '2026-09-01T10:00:00.000Z',
        updatedAt: '2026-09-02T10:00:00.000Z',
      },
    ],
  });

  beforeAll(async () => {
    t = await startTestApp();
    ada = await t.signup('Ada');
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('keeps the number and the points, and updates on a second run', async () => {
    const first = await t.call<{ projectId: string }>(ada, 'POST', W('/import/plane'), bundle(3));
    expect(first.status).toBe(200);
    const list = async () =>
      (
        await t.call<{ ref: string; title: string; estimate: number | null }[]>(
          ada,
          'GET',
          W('/projects/' + first.body.projectId + '/items'),
        )
      ).body.map((i) => [i.ref, i.title, i.estimate]);
    expect(await list()).toEqual([['ENG-12', 'Login page', 3]]);
    await t.call(ada, 'POST', W('/import/plane'), bundle(5, 'Login page v2'));
    expect(await list()).toEqual([['ENG-12', 'Login page v2', 5]]);
    // a run without points keeps the ones there
    await t.call(ada, 'POST', W('/import/plane'), bundle(null));
    expect(await list()).toEqual([['ENG-12', 'Login page', 5]]);
  });
});
