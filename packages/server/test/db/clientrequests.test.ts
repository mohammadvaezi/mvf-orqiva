// ── [PCODE-428 | S15 | v0.1.0] T37 low: Request references count per kind ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-185 | S15 | v0.1.0] B7.1 Client requests live: portal requests, threads with internal notes, response times, change requests with impact and signature, ratings ──
//    Why:  requests against the real database: a contact files one with a file, the team answers and
//          keeps an internal note the contact never sees, a change is quoted and signed, the task it
//          becomes moves the request to done, the contact rates it, the clients list counts it all, and
//          the owner and approvers get their notices. A viewer reads only; another client sees nothing.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inSystem } from '../../src/db/pool.js';
import { pumpWorkspace, vapidKeys } from '../../src/push/dispatch.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

process.env['ORQIVA_SECRET_KEY'] ??= '7d'.repeat(32);

describe.skipIf(!hasDatabase)('client requests (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let ines: Person;
  let paul: Person;
  let otto: Person;
  let helio = '';
  let other = '';
  let project = '';
  let bug = '';
  let change = '';
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  type Req = {
    id: string;
    ref: string;
    state: string;
    step: number;
    late: boolean;
    responseText: string;
    firstResponseAt: string | null;
    itemId: string | null;
    approval: { decision: string; signedName: string } | null;
    rating: number | null;
    lastNote: string | null;
    projectId: string | null;
  };

  async function contact(client: string, email: string, role: string): Promise<Person> {
    const r = await t.call<{ invitation: { token: string } | null }>(
      ada,
      'POST',
      W('/clients/' + client + '/contacts'),
      { email, portalRole: role },
    );
    const res = await fetch(
      t.base + '/auth/invitations/' + (r.body.invitation?.token ?? '') + '/accept',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: email.split('@')[0], password: 'a client password 1' }),
      },
    );
    const p: Person = {
      id: '',
      email,
      name: email.split('@')[0] ?? '',
      cookie: (res.headers.get('set-cookie') ?? '').split(';')[0] ?? '',
      workspaceId: ada.workspaceId,
    };
    p.id = (await t.call<{ user: { id: string } }>(p, 'GET', '/auth/me')).body.user.id;
    return p;
  }

  beforeAll(async () => {
    t = await startTestApp();
    ada = await t.signup('Ada');
    helio = (await t.call<{ id: string }>(ada, 'POST', W('/clients'), { name: 'Helio' })).body.id;
    other = (await t.call<{ id: string }>(ada, 'POST', W('/clients'), { name: 'Aurum' })).body.id;
    project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'HEL', name: 'Helio app' })
    ).body.id;
    await t.call(ada, 'PUT', W('/projects/' + project + '/client'), { clientId: helio });
    ines = await contact(helio, 'ines@helio.example', 'approver');
    paul = await contact(helio, 'paul@helio.example', 'viewer');
    otto = await contact(other, 'otto@aurum.example', 'requester');
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('lets a contact file a request with a file, and shows when the first answer is due', async () => {
    const up = await fetch(t.base + W('/files') + '?name=calendar.png&projectId=' + project, {
      method: 'POST',
      headers: { cookie: ines.cookie, 'content-type': 'image/png' },
      body: Buffer.from('png bytes'),
    });
    expect(up.status).toBe(201);
    const file = ((await up.json()) as { id: string }).id;
    const r = await t.call<Req>(ines, 'POST', W('/client-requests'), {
      kind: 'bug',
      title: 'Calendar shows UTC',
      body: 'All times are two hours early.',
      fileIds: [file],
    });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({
      ref: 'BUG-1',
      state: 'new',
      step: 0,
      late: false,
      projectId: project,
    });
    expect(r.body.responseText).toMatch(/^first answer within [34] h$/);
    bug = r.body.id;
    // a viewer reads but does not file; another client's contact sees nothing of it
    expect(
      (await t.call(paul, 'POST', W('/client-requests'), { kind: 'question', title: 'Hi' })).status,
    ).toBe(403);
    expect((await t.call<Req[]>(paul, 'GET', W('/client-requests'))).body).toHaveLength(1);
    expect((await t.call<Req[]>(otto, 'GET', W('/client-requests'))).body).toHaveLength(0);
    expect((await t.call(otto, 'GET', W('/client-requests/' + bug))).status).toBe(404);
  });

  it('keeps internal notes from the client; the first answer to the client counts', async () => {
    await t.call(ada, 'POST', W('/client-requests/' + bug + '/messages'), {
      body: 'Probably the date library, check before answering.',
      internal: true,
    });
    let r = (await t.call<Req>(ada, 'GET', W('/client-requests/' + bug))).body as unknown as {
      request: Req;
      messages: { internal: boolean }[];
    };
    expect(r.request.firstResponseAt).toBeNull();
    expect(r.request.lastNote).toMatch(/date library/);
    await t.call(ada, 'POST', W('/client-requests/' + bug + '/messages'), {
      body: 'Reproduced, fixing it now.',
    });
    r = (await t.call(ada, 'GET', W('/client-requests/' + bug))).body as typeof r;
    expect(r.messages).toHaveLength(3);
    expect(r.request).toMatchObject({ state: 'understood', late: false });
    expect(r.request.firstResponseAt).not.toBeNull();
    const seen = (await t.call(ines, 'GET', W('/client-requests/' + bug))).body as typeof r;
    expect(seen.messages.map((m) => m.internal)).toEqual([false, false]);
    expect(seen.request.lastNote).toBeNull();
    expect(
      (
        await t.call(ines, 'POST', W('/client-requests/' + bug + '/messages'), {
          body: 'sneaky',
          internal: true,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await t.call(ines, 'POST', W('/client-requests/' + bug + '/messages'), {
          body: 'Thanks!',
        })
      ).status,
    ).toBe(201);
  });

  it('quotes a change, the approver signs it, and the task moves the request to done', async () => {
    change = (
      await t.call<Req>(ines, 'POST', W('/client-requests'), {
        kind: 'change',
        title: 'SMS reminders',
      })
    ).body.id;
    const impact = { points: 8, priceCents: 340000, days: 2 };
    const q = await t.call<Req>(ada, 'PATCH', W('/client-requests/' + change), { impact });
    // [PCODE-428 | S15 | v0.1.0] the first change request is CR-1: each kind counts on its own
    expect(q.body).toMatchObject({ ref: 'CR-1', state: 'quoted' });
    expect((await t.call(ada, 'POST', W('/client-requests/' + change + '/task'), {})).status).toBe(
      409,
    );
    expect(
      (
        await t.call(paul, 'POST', W('/client-requests/' + change + '/decision'), {
          decision: 'approved',
          signedName: 'Paul',
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await t.call(ines, 'POST', W('/client-requests/' + change + '/decision'), {
          decision: 'approved',
        })
      ).status,
    ).toBe(400);
    const ok = await t.call<Req>(ines, 'POST', W('/client-requests/' + change + '/decision'), {
      decision: 'approved',
      signedName: 'Ines Vogel',
    });
    expect(ok.body).toMatchObject({
      state: 'planned',
      approval: { decision: 'approved', signedName: 'Ines Vogel' },
    });
    const made = await t.call<Req>(ada, 'POST', W('/client-requests/' + change + '/task'), {});
    expect(made.status).toBe(201);
    const item = made.body.itemId ?? '';
    const states = (
      await t.call<{ states: { id: string; group: string }[] }>(
        ada,
        'GET',
        W('/projects/' + project),
      )
    ).body.states;
    const est = await inSystem(
      t.db.pool,
      async (c) =>
        (await c.query<{ estimate: number }>('SELECT estimate FROM items WHERE id = $1', [item]))
          .rows[0],
    );
    expect(est?.estimate).toBe(8);
    await t.call(ada, 'PATCH', W('/items/' + item), {
      stateId: states.find((s) => s.group === 'started')?.id,
    });
    expect(
      (await t.call<Req[]>(ines, 'GET', W('/client-requests'))).body.find((x) => x.id === change),
    ).toMatchObject({ state: 'in_progress', step: 3 });
    await t.call(ada, 'PATCH', W('/items/' + item), {
      stateId: states.find((s) => s.group === 'completed')?.id,
    });
    const rated = await t.call<Req>(ines, 'POST', W('/client-requests/' + change + '/rating'), {
      rating: 4,
    });
    expect(rated.body).toMatchObject({ state: 'done', step: 4, rating: 4 });
    expect(
      (await t.call(ines, 'POST', W('/client-requests/' + bug + '/rating'), { rating: 5 })).status,
    ).toBe(409);
  });

  it('counts open and late requests and satisfaction per client', async () => {
    const late = (
      await t.call<Req>(ines, 'POST', W('/client-requests'), {
        kind: 'question',
        title: 'Late one',
      })
    ).body.id;
    await inSystem(t.db.pool, (c) =>
      c.query(
        "UPDATE client_requests SET response_due_at = now() - interval '1 hour' WHERE id = $1",
        [late],
      ),
    );
    const list = await t.call<
      {
        name: string;
        openRequests: number;
        lateRequests: number;
        satisfaction: number | null;
        lastPortalVisit: string | null;
      }[]
    >(ada, 'GET', W('/clients'));
    expect(list.body.find((c) => c.name === 'Helio')).toMatchObject({
      openRequests: 2,
      lateRequests: 1,
      satisfaction: 4,
    });
    expect(list.body.find((c) => c.name === 'Helio')?.lastPortalVisit).not.toBeNull();
  });

  it('tells the account owner about new requests and the approvers about quotes', async () => {
    await pumpWorkspace(t.db.pool, ada.workspaceId, {
      subject: 'mailto:ops@example.test',
      keys: () => vapidKeys(t.db.pool),
    });
    const inbox = async (p: Person) =>
      inSystem(t.db.pool, async (c) =>
        (
          await c.query<{ title: string }>(
            'SELECT title FROM inbox_items WHERE user_id = $1 ORDER BY created_at',
            [p.id],
          )
        ).rows.map((r) => r.title),
      );
    const mine = await inbox(ada);
    expect(mine).toEqual(
      expect.arrayContaining([
        'New request from Helio: BUG-1 Calendar shows UTC',
        'Reply from Helio: BUG-1 Calendar shows UTC',
      ]),
    );
    expect(await inbox(ines)).toContain('A quote waits for your approval: CR-1 SMS reminders');
    expect(await inbox(paul)).toEqual([]);
  });
});
