// ── [PCODE-427 | S15 | v0.1.0] T37 low: The portal survey waits for a later visit and its field fits ──
// ── [PCODE-337 | S15 | v0.1.0] T34.1b Request votes and duplicate merge, NPS survey, embeddable feedback widget ──
//    Why:  against the real database: contacts vote on their client's requests (not another client's); the
//          team merges a duplicate, moving its votes and closing it; a contact is asked for a score once in
//          90 days and the team sees the client's NPS; and the widget takes feedback only from its allowed
//          site, as JSON sent as plain text, a few times a day per visitor, and serves its script to any site.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inSystem } from '../../src/db/pool.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

process.env['ORQIVA_SECRET_KEY'] = 'ab'.repeat(32);

describe.skipIf(!hasDatabase)('the client’s voice (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let ines: Person;
  let tom: Person;
  let otto: Person;
  let helio = '';
  let project = '';
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  type Req = {
    id: string;
    ref: string;
    votes: number;
    voterIds: string[];
    mergedInto: { ref: string } | null;
    state: string;
    source: string;
    pageUrl: string;
  };

  async function contact(client: string, email: string, role: string): Promise<Person> {
    const r = await t.call<{ invitation: { token: string } | null }>(
      ada,
      'POST',
      W('/clients/' + client + '/contacts'),
      {
        email,
        portalRole: role,
      },
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
    const aurum = (await t.call<{ id: string }>(ada, 'POST', W('/clients'), { name: 'Aurum' })).body
      .id;
    project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'HEL', name: 'Helio app' })
    ).body.id;
    await t.call(ada, 'PUT', W('/projects/' + project + '/client'), { clientId: helio });
    ines = await contact(helio, 'ines@helio.example', 'approver');
    tom = await contact(helio, 'tom@helio.example', 'requester');
    otto = await contact(aurum, 'otto@aurum.example', 'requester');
  }, 90_000);

  afterAll(async () => {
    await t.stop();
  });

  it('counts votes and merges a duplicate with its votes', async () => {
    const first = (
      await t.call<Req>(ines, 'POST', W('/client-requests'), {
        kind: 'feature',
        title: 'Export to PDF',
        projectId: project,
      })
    ).body;
    const dup = (
      await t.call<Req>(tom, 'POST', W('/client-requests'), {
        kind: 'feature',
        title: 'PDF export please',
      })
    ).body;
    expect(
      (await t.call<Req>(ines, 'POST', W('/client-requests/' + dup.id + '/vote'))).body.votes,
    ).toBe(1);
    expect((await t.call(otto, 'POST', W('/client-requests/' + dup.id + '/vote'))).status).toBe(
      404,
    );
    const back = await t.call<Req>(ines, 'DELETE', W('/client-requests/' + dup.id + '/vote'));
    expect(back.body.votes).toBe(0);
    await t.call(ines, 'POST', W('/client-requests/' + dup.id + '/vote'));
    expect(
      (await t.call(ines, 'POST', W('/client-requests/' + dup.id + '/merge'), { intoId: first.id }))
        .status,
    ).toBe(403);
    const merged = await t.call<Req>(ada, 'POST', W('/client-requests/' + dup.id + '/merge'), {
      intoId: first.id,
    });
    expect(merged.status).toBe(200);
    // Ines voted on the duplicate, Tom asked for it: both count for the original
    expect(merged.body.voterIds.sort()).toEqual([ines.id, tom.id].sort());
    const d = (
      await t.call<{ request: Req; messages: { body: string }[] }>(
        tom,
        'GET',
        W('/client-requests/' + dup.id),
      )
    ).body;
    expect(d.request).toMatchObject({ state: 'declined', mergedInto: { ref: first.ref } });
    expect(d.messages.at(-1)?.body).toMatch(/^Merged into /);
    expect((await t.call(ines, 'POST', W('/client-requests/' + dup.id + '/vote'))).status).toBe(
      409,
    );
    expect(
      (
        await t.call(ada, 'POST', W('/client-requests/' + first.id + '/merge'), {
          intoId: first.id,
        })
      ).status,
    ).toBe(400);
  });

  it('asks a contact for a score once in 90 days and gives the team the NPS', async () => {
    // [PCODE-427 | S15 | v0.1.0] not on the first visit: only after two weeks as a contact
    expect((await t.call<{ due: boolean }>(ines, 'GET', W('/portal/nps'))).body.due).toBe(false);
    await inSystem(t.db.pool, (c) =>
      c.query("UPDATE client_contacts SET created_at = now() - interval '15 days'"),
    );
    expect((await t.call<{ due: boolean }>(ines, 'GET', W('/portal/nps'))).body.due).toBe(true);
    for (const [who, score] of [
      [ines, 10],
      [tom, 4],
    ] as const)
      expect(
        (
          await t.call(who, 'POST', W('/portal/nps'), {
            score,
            comment: who === ines ? 'Fast and clear' : '',
          })
        ).status,
      ).toBe(201);
    expect((await t.call<{ due: boolean }>(ines, 'GET', W('/portal/nps'))).body.due).toBe(false);
    expect((await t.call(ines, 'POST', W('/portal/nps'), { score: 9 })).status).toBe(409);
    expect((await t.call(ada, 'POST', W('/portal/nps'), { score: 9 })).status).toBe(403);
    const nps = await t.call<
      { clientId: string; score: number; answers: number; comments: { comment: string }[] }[]
    >(ada, 'GET', W('/clients-nps'));
    expect(nps.body.find((x) => x.clientId === helio)).toMatchObject({
      score: 0,
      answers: 2,
      comments: [expect.objectContaining({ comment: 'Fast and clear' })],
    });
    expect((await t.call(ines, 'GET', W('/clients-nps'))).status).toBe(403);
  });

  it('takes feedback from the allowed site through the widget', async () => {
    const w = await t.call<{ key: string; snippet: string; origins: string[] }>(
      ada,
      'POST',
      W('/clients/' + helio + '/widgets'),
      {
        name: 'Patient app',
        origins: ['https://app.helio.example/anything'],
        projectId: project,
      },
    );
    expect(w.status).toBe(201);
    expect(w.body.origins).toEqual(['https://app.helio.example']);
    expect(w.body.snippet).toContain('data-key="' + w.body.key + '"');
    const send = (origin: string, body: unknown, type = 'text/plain') =>
      fetch(t.base + '/widget/' + w.body.key + '/feedback', {
        method: 'POST',
        headers: { 'content-type': type, ...(origin ? { origin } : {}) },
        body: JSON.stringify(body),
      });
    const note = {
      kind: 'bug',
      title: 'Reminder does not ring',
      text: 'Set it for 8:00',
      email: 'p@x.example',
      pageUrl: 'https://app.helio.example/reminders',
      userAgent: 'Test',
      viewport: '390x844',
    };
    expect((await send('https://evil.example', note)).status).toBe(403);
    const ok = await send('https://app.helio.example', note);
    expect(ok.status).toBe(201);
    expect(ok.headers.get('access-control-allow-origin')).toBe('https://app.helio.example');
    const ref = ((await ok.json()) as { ref: string }).ref;
    const list = (await t.call<Req[]>(ada, 'GET', W('/client-requests?clientId=' + helio))).body;
    const got = list.find((r) => r.ref === ref);
    expect(got).toMatchObject({ source: 'widget', pageUrl: 'https://app.helio.example/reminders' });
    const msg = (
      await t.call<{ messages: { body: string }[] }>(
        ada,
        'GET',
        W('/client-requests/' + (got?.id ?? '')),
      )
    ).body.messages[0]?.body;
    expect(msg).toContain('From the Patient app widget · p@x.example');
    // a visitor is held to ten a day
    for (let i = 0; i < 9; i++) await send('https://app.helio.example', note);
    expect((await send('https://app.helio.example', note)).status).toBe(429);
    // switched off, it takes nothing
    const id = (await t.call<{ id: string }[]>(ada, 'GET', W('/clients/' + helio + '/widgets')))
      .body[0]?.id;
    await t.call(ada, 'PATCH', W('/clients/' + helio + '/widgets/' + (id ?? '')), {
      enabled: false,
    });
    expect((await send('https://app.helio.example', note)).status).toBe(404);
    const js = await fetch(t.base + '/widget.js');
    expect(js.headers.get('content-type')).toContain('javascript');
    expect(js.headers.get('cross-origin-resource-policy')).toBe('cross-origin');
    expect(await js.text()).toContain("'content-type': 'text/plain'");
    const n = await inSystem(t.db.pool, async (c) =>
      Number(
        (
          await c.query<{ received: number }>(
            'SELECT received FROM feedback_widgets WHERE id = $1',
            [id],
          )
        ).rows[0]?.received,
      ),
    );
    expect(n).toBe(10);
  });
});
