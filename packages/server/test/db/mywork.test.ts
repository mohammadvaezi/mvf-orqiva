// ── [PCODE-113 | S15 | v0.1.0] Rebuild the web app shell: sidebar, top bar, page layout, design refresh ──
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

describe.skipIf(!hasDatabase)('my work (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let gus: Person;
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  type Mine = { ref: string; projectKey: string; state: string; stateGroup: string }[];

  beforeAll(async () => {
    t = await startTestApp();
    ada = await t.signup('Ada');
    gus = await t.signup('Gus');
    await t.call(ada, 'POST', W('/members'), { email: gus.email, role: 'guest' });
    const app = (
      await t.call<{ id: string; states: { id: string; name: string }[] }>(
        ada,
        'POST',
        W('/projects'),
        { key: 'APP', name: 'App' },
      )
    ).body.id;
    const ops = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'OPS', name: 'Ops' })
    ).body.id;
    await t.call(ada, 'POST', W('/projects/' + app + '/guests'), { userId: gus.id });
    const states = (
      await t.call<{ states: { id: string; name: string }[] }>(ada, 'GET', W('/projects/' + app))
    ).body.states;
    const opsStates = (
      await t.call<{ states: { id: string; name: string }[] }>(ada, 'GET', W('/projects/' + ops))
    ).body.states;
    const st = (list: { id: string; name: string }[], name: string): string =>
      list.find((s) => s.name === name)?.id ?? '';
    await t.call(ada, 'POST', W('/projects/' + app + '/items'), {
      title: 'Todo for Ada',
      assigneeId: ada.id,
      stateId: st(states, 'Todo'),
    });
    await t.call(ada, 'POST', W('/projects/' + ops + '/items'), {
      title: 'Running for Ada',
      assigneeId: ada.id,
      stateId: st(opsStates, 'In Progress'),
    });
    await t.call(ada, 'POST', W('/projects/' + app + '/items'), {
      title: 'Done for Ada',
      assigneeId: ada.id,
      stateId: st(states, 'Done'),
    });
    await t.call(ada, 'POST', W('/projects/' + app + '/items'), {
      title: 'Nobody',
      stateId: st(states, 'Todo'),
    });
    await t.call(ada, 'POST', W('/projects/' + ops + '/items'), {
      title: 'Gus in Ops',
      assigneeId: gus.id,
    });
    await t.call(ada, 'POST', W('/projects/' + app + '/items'), {
      title: 'Gus in App',
      assigneeId: gus.id,
    });
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('lists my open work across projects, in progress first, without done or others’ work', async () => {
    const r = await t.call<Mine>(ada, 'GET', W('/my-work'));
    expect(r.body.map((i) => [i.ref, i.state])).toEqual([
      ['OPS-1', 'In Progress'],
      ['APP-1', 'Todo'],
    ]);
  });

  it('shows a guest only the projects they are invited to', async () => {
    const r = await t.call<Mine>(gus, 'GET', W('/my-work'));
    expect(r.body.map((i) => i.ref)).toEqual(['APP-4']);
  });
});
