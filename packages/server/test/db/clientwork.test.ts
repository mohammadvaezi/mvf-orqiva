// ── [PCODE-338 | S15 | v0.1.0] T34.1c Meeting notes and actions into tasks; the team's client overview with health, revenue, activity and people ──
//    Why:  against the real database: notes on a client meeting bring their action items along once, an
//          action becomes a task in the client's project with its person and date, the client reads only
//          shared notes and sees the task's state; and the team's overview of a client shows health,
//          revenue for the billing roles only, activity and the people who booked time.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inSystem } from '../../src/db/pool.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

process.env['ORQIVA_SECRET_KEY'] = 'ab'.repeat(32);

describe.skipIf(!hasDatabase)('meeting notes and the client overview (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let bob: Person;
  let ines: Person;
  let helio = '';
  let project = '';
  let other = '';
  let meeting = '';
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  const sys = (sql: string, args: unknown[] = []) => inSystem(t.db.pool, (c) => c.query(sql, args));
  type Meeting = {
    id: string;
    notes: string;
    notesShared: boolean;
    actions: {
      id: string;
      text: string;
      item: { ref: string; state: string; done: boolean } | null;
    }[];
  };

  beforeAll(async () => {
    t = await startTestApp();
    ada = await t.signup('Ada');
    bob = await t.signup('Bob');
    await t.call(ada, 'POST', W('/members'), { email: bob.email, role: 'member' });
    helio = (await t.call<{ id: string }>(ada, 'POST', W('/clients'), { name: 'Helio' })).body.id;
    project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'HEL', name: 'Helio app' })
    ).body.id;
    other = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'OTH', name: 'Other' })
    ).body.id;
    await t.call(ada, 'PUT', W('/projects/' + project + '/client'), { clientId: helio });
    const r = await t.call<{ invitation: { token: string } | null }>(
      ada,
      'POST',
      W('/clients/' + helio + '/contacts'),
      {
        email: 'ines@helio.example',
        portalRole: 'approver',
      },
    );
    const res = await fetch(
      t.base + '/auth/invitations/' + (r.body.invitation?.token ?? '') + '/accept',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Ines', password: 'a client password 1' }),
      },
    );
    ines = {
      id: '',
      email: 'ines@helio.example',
      name: 'Ines',
      cookie: (res.headers.get('set-cookie') ?? '').split(';')[0] ?? '',
      workspaceId: ada.workspaceId,
    };
    const ws = ada.workspaceId;
    meeting = (
      (
        await sys(
          "INSERT INTO meetings (workspace_id, client_id, title, starts_at) VALUES ($1, $2, 'Sprint review', now() - interval '2 days') RETURNING id",
          [ws, helio],
        )
      ).rows[0] as { id: string }
    ).id;
    await sys(
      `INSERT INTO client_invoices (workspace_id, client_id, number, gross_cents, state, paid_on, due_on)
       VALUES ($1, $2, 'R-1', 119000, 'paid', current_date - 40, current_date - 50),
              ($1, $2, 'R-2', 59500, 'sent', NULL, current_date - 3),
              ($1, $2, 'R-3', 11900, 'sent', NULL, current_date + 10)`,
      [ws, helio],
    );
    await sys(
      "INSERT INTO time_entries (workspace_id, user_id, project_id, day, minutes, source) VALUES ($1, $2, $3, current_date - 1, 150, 'manual')",
      [ws, bob.id, project],
    );
  }, 90_000);

  afterAll(async () => {
    await t.stop();
  });

  it('takes action items from the notes and makes one a task', async () => {
    const M = W('/meetings/' + meeting);
    const notes =
      '# Review\nThe export works.\n- [ ] Add a header row\n- [x] Fix the date\nAction: Send the PDF sample\n';
    const saved = await t.call<Meeting>(ada, 'PUT', M + '/notes', { notes, shared: true });
    expect(saved.status).toBe(200);
    expect(saved.body.actions.map((x) => x.text)).toEqual([
      'Add a header row',
      'Send the PDF sample',
    ]);
    // saved again, nothing doubles
    expect((await t.call<Meeting>(ada, 'PUT', M + '/notes', { notes })).body.actions).toHaveLength(
      2,
    );
    await t.call(ada, 'POST', M + '/actions', {
      text: 'Book the next review',
      assigneeId: bob.id,
      dueOn: '2026-12-01',
    });
    const list = (await t.call<Meeting[]>(ada, 'GET', W('/clients/' + helio + '/meetings'))).body;
    const act = list[0]?.actions.find((x) => x.text === 'Book the next review');
    expect(
      (await t.call(ada, 'POST', M + '/actions/' + (act?.id ?? '') + '/task', { projectId: other }))
        .status,
    ).toBe(400);
    const task = await t.call<{ item: { ref: string } }>(
      ada,
      'POST',
      M + '/actions/' + (act?.id ?? '') + '/task',
      { projectId: project },
    );
    expect(task.status).toBe(200);
    expect(task.body.item.ref).toMatch(/^HEL-\d+$/);
    const item = (
      await sys(
        "SELECT assignee_id, due_date::text AS due, description FROM items WHERE project_id = $1 AND title = 'Book the next review'",
        [project],
      )
    ).rows[0] as { assignee_id: string; due: string; description: string };
    expect(item).toMatchObject({ assignee_id: bob.id, due: '2026-12-01' });
    expect(item.description).toContain('Sprint review');
    expect(
      (
        await t.call(ada, 'POST', M + '/actions/' + (act?.id ?? '') + '/task', {
          projectId: project,
        })
      ).status,
    ).toBe(409);
    expect((await t.call(ines, 'PUT', M + '/notes', { notes: 'x' })).status).toBe(403);
  });

  it('shows the client only shared notes, with the tasks’ state', async () => {
    const seen = (await t.call<Meeting[]>(ines, 'GET', W('/portal/meeting-notes'))).body;
    expect(seen).toHaveLength(1);
    expect(seen[0]?.actions.find((x) => x.item)?.item?.state).toBeTruthy();
    await t.call(ada, 'PUT', W('/meetings/' + meeting + '/notes'), {
      notes: 'Internal only',
      shared: false,
    });
    expect((await t.call<Meeting[]>(ines, 'GET', W('/portal/meeting-notes'))).body).toHaveLength(0);
  });

  it('gives the team the client at a glance, money for the billing roles only', async () => {
    type O = {
      health: string;
      revenue: { paid12mCents: number; openCents: number; overdueCents: number } | null;
      activity: { text: string }[];
      people: { name: string; hours: number }[];
    };
    const o = (await t.call<O>(ada, 'GET', W('/clients/' + helio + '/overview'))).body;
    expect(o.health).toBe('on-track');
    expect(o.revenue).toEqual({ paid12mCents: 119000, openCents: 71400, overdueCents: 59500 });
    expect(o.people.map((p) => [p.name, p.hours])).toEqual([['Bob', 2.5]]);
    expect(o.activity.length).toBeGreaterThan(0);
    expect(
      (await t.call<O>(bob, 'GET', W('/clients/' + helio + '/overview'))).body.revenue,
    ).toBeNull();
    expect((await t.call(ines, 'GET', W('/clients/' + helio + '/overview'))).status).toBe(403);
    const all = (
      await t.call<{ clientId: string; paid12mCents: number | null }[]>(
        ada,
        'GET',
        W('/clients-overview'),
      )
    ).body;
    expect(all.find((x) => x.clientId === helio)?.paid12mCents).toBe(119000);
  });
});
