// ── [PCODE-258 | S15 | v0.1.0] T26.7 T26 exit check, docs and sprint close ──
//    Why:  the T26 exit as one team's sprint planning, end to end against the real server with a scripted
//          Planner: an initiative with its own fields and types, estimates from poker and from similar work,
//          capacity from profiles and holidays, a Planner draft that names people and proposes a story, flow
//          warnings and a WIP limit, a bulk change undone, a branch that moves its task, and the charts that
//          read it all back.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { scriptedProvider, type ModelReply } from '../../src/agents/provider.js';
import { inSystem } from '../../src/db/pool.js';
import { sign } from '../../src/git/webhook.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

describe.skipIf(!hasDatabase)('T26 exit: planning complete (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let bo: Person;
  let project = '';
  let reply: ModelReply | null = null;
  const st: Record<string, string> = {};
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  const P = (p: string): string => W('/projects/' + project + p);
  const state = (n: string): string => st[n] ?? '';
  const add = async (who: Person, body: Record<string, unknown>) =>
    (await t.call<{ id: string; ref: string }>(who, 'POST', P('/items'), body)).body;

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
    for (const x of (await t.call<{ states: { id: string; name: string }[] }>(ada, 'GET', P('')))
      .body.states)
      st[x.name] = x.id;
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('plans and runs a sprint with every planning feature', async () => {
    // the shape of the work: an initiative, an epic, a type and a field
    const init = await add(ada, { title: 'Self-service booking', kind: 'initiative' });
    const epic = await add(ada, { title: 'Booking', kind: 'epic', parentId: init.id });
    const incident = (
      await t.call<{ id: string }[]>(ada, 'POST', P('/item-types'), {
        name: 'Incident',
        baseKind: 'bug',
      })
    ).body[0]?.id;
    await t.call(ada, 'POST', P('/custom-fields'), {
      key: 'customer',
      label: 'Customer',
      type: 'text',
    });

    // what was done before teaches the estimates
    const old = await add(ada, { title: 'Export bookings to CSV', estimate: 3 });
    await inSystem(t.db.pool, async (c) => {
      await c.query("UPDATE items SET completed_at = now() - interval '20 days' WHERE id = $1", [
        old.id,
      ]);
      for (const d of [1, 2])
        await c.query(
          "INSERT INTO time_entries (workspace_id, user_id, item_id, project_id, day, minutes, source) VALUES ($1, $2, $3, $4, current_date - $5::int, 540, 'manual')",
          [ada.workspaceId, ada.id, old.id, project, d],
        );
    });
    const api = await add(ada, {
      title: 'Export appointments to CSV',
      parentId: epic.id,
      assigneeId: ada.id,
    });
    const suggestion = await t.call<{ value: number; basis: string }>(
      ada,
      'GET',
      W('/items/' + api.id + '/estimate-suggestion'),
    );
    expect(suggestion.body).toMatchObject({ value: 3, basis: 'estimate' });
    const round = (await t.call<{ id: string }>(ada, 'POST', W('/items/' + api.id + '/poker'))).body
      .id;
    await t.call(ada, 'POST', W('/poker/' + round + '/vote'), { card: '3' });
    await t.call(bo, 'POST', W('/poker/' + round + '/vote'), { card: '5' });
    await t.call(bo, 'POST', W('/poker/' + round + '/reveal'));
    await t.call(ada, 'POST', W('/poker/' + round + '/accept'), { card: '5' });
    const screen = await add(ada, {
      title: 'Booking screen',
      parentId: epic.id,
      estimate: 3,
      custom: { customer: 'Northwind' },
    });
    await t.call(ada, 'POST', W('/items/' + api.id + '/links'), { to: screen.ref, kind: 'blocks' });
    const bug = await add(ada, {
      title: 'Checkout down',
      typeId: incident,
      priority: 'high',
      estimate: 1,
    });

    // capacity from profiles, a holiday and the project's people
    await t.call(ada, 'PUT', W('/projects/' + project + '/members/' + bo.id), { role: 'member' });
    await t.call(ada, 'PUT', W('/settings/calendar.holidays'), {
      scope: 'workspace',
      value: ['2026-10-26'],
    });
    const sprint = (
      await t.call<{ id: string }>(ada, 'POST', P('/sprints'), {
        name: 'Sprint 7',
        startDate: '2026-10-19',
        endDate: '2026-10-30',
      })
    ).body.id;
    const cap = await t.call<{ capacity: number; window: { days: number } }>(
      ada,
      'GET',
      W('/sprints/' + sprint + '/capacity'),
    );
    expect(cap.body.window.days).toBe(9);
    expect(cap.body.capacity).toBe(18);

    // the Planner names people and proposes what is missing
    reply = {
      content: [
        {
          type: 'text',
          text:
            '```json\n' +
            JSON.stringify({
              items: [
                { ref: api.ref, why: 'first', confidence: 0.9, assignee: 'Ada' },
                { ref: screen.ref, why: 'then', confidence: 0.8, assignee: 'Bo' },
                { ref: bug.ref, why: 'urgent', confidence: 0.9, assignee: 'Bo' },
              ],
              newItems: [
                { title: 'Booking reminder mail', estimate: 2, why: 'clients ask', assignee: 'Bo' },
              ],
              reasons: 'API, screen, the bug.',
              considered: [],
            }) +
            '\n```',
        },
      ],
      stopReason: 'end_turn',
      usage: { input: 10, output: 10 },
    };
    const draft = await t.call<{
      draftId: string;
      lines: { id: string }[];
      newItems: { id: string }[];
    }>(ada, 'POST', W('/sprints/' + sprint + '/plan/draft'));
    expect(draft.body.lines.length).toBe(3);
    await t.call(ada, 'POST', W('/plan-drafts/' + draft.body.draftId + '/decide'), {
      accept: draft.body.lines.map((l) => l.id),
      acceptNew: draft.body.newItems.map((n) => n.id),
    });
    await t.call(ada, 'POST', W('/sprints/' + sprint + '/start'));

    // the flow: a WIP limit and the warnings of the sprint
    await t.call(ada, 'PUT', P('/states/' + state('In Progress') + '/wip'), { limit: 1 });
    const bulk = await t.call<{
      updated: number;
      before: { id: string; fields: Record<string, unknown> }[];
    }>(ada, 'POST', P('/items/bulk'), {
      itemIds: [screen.id, bug.id],
      set: { stateId: state('In Progress') },
    });
    expect(bulk.body.updated).toBe(2);
    const warnings = await t.call<{ kind: string }[]>(
      ada,
      'GET',
      P('/warnings?sprintId=' + sprint),
    );
    expect(warnings.body.map((w) => w.kind).sort()).toEqual(['blocked', 'over_wip']);
    // undone: the earlier states back
    for (const b of bulk.body.before) await t.call(ada, 'PATCH', W('/items/' + b.id), b.fields);
    // the column is back within its limit; the screen still waits for the API
    expect(
      (await t.call<{ kind: string }[]>(ada, 'GET', P('/warnings?sprintId=' + sprint))).body.map(
        (w) => w.kind,
      ),
    ).toEqual(['blocked']);

    // a branch named for the task moves it
    await t.call(ada, 'PUT', W('/settings/git.moves'), {
      scope: 'project',
      scopeId: project,
      value: { branch: 'In Progress', opened: '', merged: 'Done' },
    });
    const conn = (
      await t.call<{ connection: { webhookPath: string }; secret: string }>(
        ada,
        'POST',
        P('/git'),
        {
          provider: 'github',
          repo: 'acme/helio',
        },
      )
    ).body;
    const body = Buffer.from(
      JSON.stringify({
        repository: { full_name: 'acme/helio' },
        ref_type: 'branch',
        ref: api.ref.toLowerCase() + '-export',
      }),
    );
    await fetch(t.base + conn.connection.webhookPath, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-github-event': 'create',
        'x-hub-signature-256': 'sha256=' + sign(conn.secret, body),
      },
      body,
    });
    expect(
      (await t.call<{ stateId: string }>(ada, 'GET', W('/items/' + api.id))).body.stateId,
    ).toBe(state('In Progress'));
    await t.call(ada, 'PATCH', W('/items/' + api.id), { stateId: state('Done') });

    // what it all reads back as
    const burn = await t.call<{ days: unknown[] }>(
      ada,
      'GET',
      W('/sprints/' + sprint + '/charts/burn'),
    );
    expect(Array.isArray(burn.body.days)).toBe(true);
    const cycle = await t.call<{ tasks: { ref: string }[] }>(ada, 'GET', P('/charts/cycle'));
    expect(cycle.body.tasks.map((x) => x.ref)).toContain(api.ref);
    const inits = await t.call<{ done: number; total: number }[]>(ada, 'GET', P('/initiatives'));
    expect(inits.body[0]).toMatchObject({ done: 1, total: 2 });
    const versus = await t.call<{ tasks: { ref: string; estimate: number }[] }>(
      ada,
      'GET',
      P('/estimate-vs-actual?sprintId=' + sprint),
    );
    expect(versus.body.tasks.find((x) => x.ref === api.ref)?.estimate).toBe(5);
    const northwind = await t.call<{ ref: string }[]>(
      ada,
      'GET',
      P('/items?field=customer:Northwind'),
    );
    expect(northwind.body.map((x) => x.ref)).toEqual([screen.ref]);
  });
});
