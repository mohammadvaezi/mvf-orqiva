// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-93 | S15 | v0.1.0] Add items, states, labels and comments with full history ──
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ItemJson } from '../../src/api/items.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

interface Project {
  id: string;
  states: { id: string; name: string }[];
}

describe.skipIf(!hasDatabase)('items, labels and comments (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let bob: Person;
  let gus: Person;
  let ws = '';
  let app: Project;
  let other: Project;
  const W = (path: string): string => '/api/workspaces/' + ws + path;
  const state = (p: Project, name: string): string =>
    p.states.find((st) => st.name === name)?.id ?? '';

  beforeAll(async () => {
    t = await startTestApp();
    ada = await t.signup('Ada');
    bob = await t.signup('Bob');
    gus = await t.signup('Gus');
    ws = ada.workspaceId;
    await t.call(ada, 'POST', W('/members'), { email: bob.email, role: 'member' });
    await t.call(ada, 'POST', W('/members'), { email: gus.email, role: 'guest' });
    app = (await t.call<Project>(ada, 'POST', W('/projects'), { key: 'APP', name: 'App' })).body;
    other = (await t.call<Project>(ada, 'POST', W('/projects'), { key: 'OPS', name: 'Ops' })).body;
    await t.call(ada, 'POST', W('/projects/' + app.id + '/guests'), { userId: gus.id });
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  let first: ItemJson;

  it('creates an item in Backlog with the next number of its project', async () => {
    const r = await t.call<ItemJson>(bob, 'POST', W('/projects/' + app.id + '/items'), {
      title: 'Write the router',
    });
    expect(r.status).toBe(201);
    first = r.body;
    expect(first).toMatchObject({
      ref: 'APP-1',
      sequence: 1,
      stateId: state(app, 'Backlog'),
      version: 1,
      labelIds: [],
      assigneeId: null,
    });
  });

  it('numbers concurrent creates 2, 3, 4 … without gaps or twins', async () => {
    const made = await Promise.all(
      Array.from({ length: 12 }, (_v, i) =>
        t.call<ItemJson>(bob, 'POST', W('/projects/' + app.id + '/items'), {
          title: 'Load ' + String(i),
        }),
      ),
    );
    expect(made.map((m) => m.status).every((s) => s === 201)).toBe(true);
    expect(made.map((m) => m.body.sequence).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 12 }, (_v, i) => i + 2),
    );
  });

  it('changes only the fields sent, raises the version and names every change in the history', async () => {
    const label = (
      await t.call<{ id: string }>(bob, 'POST', W('/projects/' + app.id + '/labels'), {
        name: 'backend',
        color: '#3f76ff',
      })
    ).body;
    const r = await t.call<ItemJson>(bob, 'PATCH', W('/items/' + first.id), {
      title: 'Write the router on node:http',
      assigneeId: ada.id,
      estimate: 3,
      labelIds: [label.id],
    });
    expect(r.body).toMatchObject({
      title: 'Write the router on node:http',
      assigneeId: ada.id,
      estimate: 3,
      labelIds: [label.id],
      version: 2,
      stateId: state(app, 'Backlog'),
    });
    const moved = await t.call<ItemJson>(bob, 'PATCH', W('/items/' + first.id), {
      stateId: state(app, 'In Progress'),
    });
    expect(moved.body.version).toBe(3);
    const history = (
      await t.call<
        { type: string; data: { changes?: Record<string, { from: unknown; to: unknown }> } }[]
      >(ada, 'GET', W('/items/' + first.id + '/history'))
    ).body;
    expect(history.map((e) => e.type)).toEqual([
      'orqiva.item.created',
      'orqiva.item.updated',
      'orqiva.item.moved',
    ]);
    expect(history[1]?.data.changes?.['title']).toEqual({
      from: 'Write the router',
      to: 'Write the router on node:http',
    });
    expect(Object.keys(history[1]?.data.changes ?? {}).sort()).toEqual([
      'assigneeId',
      'estimate',
      'labelIds',
      'title',
    ]);
    expect(history[2]?.data.changes?.['state']).toEqual({ from: 'Backlog', to: 'In Progress' });
  });

  it('records nothing when nothing changes', async () => {
    const r = await t.call<ItemJson>(bob, 'PATCH', W('/items/' + first.id), { estimate: 3 });
    expect(r.body.version).toBe(3);
  });

  it('refuses a state, label or parent of another project, a loop, and an assignee who cannot see it', async () => {
    const otherItem = (
      await t.call<ItemJson>(ada, 'POST', W('/projects/' + other.id + '/items'), {
        title: 'Ops work',
      })
    ).body;
    const otherLabel = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects/' + other.id + '/labels'), {
        name: 'ops',
        color: '#ef4444',
      })
    ).body;
    const bad = async (body: Record<string, unknown>): Promise<string> => {
      const r = await t.call<{ error: { details: { path: string }[] } }>(
        bob,
        'PATCH',
        W('/items/' + first.id),
        body,
      );
      expect(r.status).toBe(400);
      return r.body.error.details[0]?.path ?? '';
    };
    expect(await bad({ stateId: state(other, 'Done') })).toBe('body.stateId');
    expect(await bad({ labelIds: [otherLabel.id] })).toBe('body.labelIds');
    expect(await bad({ parentId: otherItem.id })).toBe('body.parentId');
    const child = (
      await t.call<ItemJson>(bob, 'POST', W('/projects/' + app.id + '/items'), {
        title: 'Child',
        parentId: first.id,
      })
    ).body;
    expect(await bad({ parentId: child.id })).toBe('body.parentId');
    // the guest sees APP, so may be assigned there; not in OPS, which they cannot see
    expect(
      (await t.call(bob, 'PATCH', W('/items/' + first.id), { assigneeId: gus.id })).status,
    ).toBe(200);
    const r = await t.call(ada, 'PATCH', W('/items/' + otherItem.id), { assigneeId: gus.id });
    expect(r.status).toBe(400);
  });

  it('lets a guest read and comment on an invited project, but not edit or see other projects', async () => {
    expect(
      (await t.call<ItemJson[]>(gus, 'GET', W('/projects/' + app.id + '/items'))).body.length,
    ).toBeGreaterThan(10);
    expect((await t.call(gus, 'PATCH', W('/items/' + first.id), { title: 'nope' })).status).toBe(
      403,
    );
    expect((await t.call(gus, 'GET', W('/projects/' + other.id + '/items'))).status).toBe(404);
    const c = await t.call<{ id: string; authorName: string }>(
      gus,
      'POST',
      W('/items/' + first.id + '/comments'),
      { body: 'Looks good from the client side.' },
    );
    expect(c).toMatchObject({ status: 201, body: { authorName: 'Gus' } });
  });

  it('keeps comments with their item: edit by the author only, delete by author or admin, all in the history', async () => {
    const list = (
      await t.call<{ id: string; body: string }[]>(
        bob,
        'GET',
        W('/items/' + first.id + '/comments'),
      )
    ).body;
    const comment = list[0];
    if (!comment) throw new Error('no comment');
    expect(
      (await t.call(bob, 'PATCH', W('/comments/' + comment.id), { body: 'edited by someone else' }))
        .status,
    ).toBe(403);
    expect(
      (await t.call(gus, 'PATCH', W('/comments/' + comment.id), { body: 'Looks good, ship it.' }))
        .status,
    ).toBe(200);
    expect((await t.call<ItemJson>(bob, 'GET', W('/items/' + first.id))).body.commentCount).toBe(1);
    expect((await t.call(ada, 'DELETE', W('/comments/' + comment.id))).status).toBe(200);
    const history = (
      await t.call<{ type: string }[]>(ada, 'GET', W('/items/' + first.id + '/history'))
    ).body.map((e) => e.type);
    expect(history).toEqual(
      expect.arrayContaining([
        'orqiva.comment.commented',
        'orqiva.comment.updated',
        'orqiva.comment.deleted',
      ]),
    );
  });

  it('filters the list by state and assignee', async () => {
    const inProgress = await t.call<ItemJson[]>(
      ada,
      'GET',
      W('/projects/' + app.id + '/items?stateId=' + state(app, 'In Progress')),
    );
    expect(inProgress.body.map((i) => i.ref)).toEqual(['APP-1']);
  });

  it('deletes an item but keeps its history', async () => {
    expect((await t.call(bob, 'DELETE', W('/items/' + first.id))).status).toBe(200);
    expect((await t.call(bob, 'GET', W('/items/' + first.id))).status).toBe(404);
  });

  it('refuses new items in an archived project', async () => {
    await t.call(ada, 'PATCH', W('/projects/' + other.id), { archived: true });
    expect(
      (await t.call(ada, 'POST', W('/projects/' + other.id + '/items'), { title: 'Late' })).status,
    ).toBe(409);
  });
});
