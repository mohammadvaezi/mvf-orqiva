// ── [PCODE-186 | S15 | v0.1.0] B7.2 Client portal live: roadmap, acceptance tests, approvals, releases with ratings, shared documents ──
//    Why:  the portal against the real database: a contact sees the roadmap and what moved against the
//          baseline, tests a shared acceptance round (a problem files a bug request) and accepts it with a
//          signature, approves a shared design, rates a release and reads a shared page; nothing unshared
//          shows, a viewer only reads, the team can look as the client but not act, another client sees
//          nothing, and the older tables now hide the team's work from a contact's own transaction.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inSystem } from '../../src/db/pool.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

describe.skipIf(!hasDatabase)('client portal (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let ines: Person;
  let tom: Person;
  let paul: Person;
  let otto: Person;
  let helio = '';
  let project = '';
  let other = '';
  let run = '';
  const cases: string[] = [];
  let mockup = '';
  let page = '';
  let release = '';
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  const sys = (sql: string, args: unknown[] = []) => inSystem(t.db.pool, (c) => c.query(sql, args));
  const one = async <T>(sql: string, args: unknown[] = []): Promise<T> =>
    (await sys(sql, args)).rows[0] as T;

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
    const aurum = (await t.call<{ id: string }>(ada, 'POST', W('/clients'), { name: 'Aurum' })).body
      .id;
    project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'HEL', name: 'Helio app' })
    ).body.id;
    other = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'AUR', name: 'Aurum app' })
    ).body.id;
    await t.call(ada, 'PUT', W('/projects/' + project + '/client'), { clientId: helio });
    await t.call(ada, 'PUT', W('/projects/' + other + '/client'), { clientId: aurum });
    ines = await contact(helio, 'ines@helio.example', 'approver');
    tom = await contact(helio, 'tom@helio.example', 'tester');
    paul = await contact(helio, 'paul@helio.example', 'viewer');
    otto = await contact(aurum, 'otto@aurum.example', 'requester');
    const ws = ada.workspaceId;
    // a test run with two cases, a page, a mockup with an image, a release with client notes
    for (const title of ['Book an appointment', 'Cancel and re-book'])
      cases.push(
        (
          await one<{ id: string }>(
            'INSERT INTO test_cases (workspace_id, project_id, title, expected) VALUES ($1, $2, $3, $4) RETURNING id',
            [ws, project, title, 'It works'],
          )
        ).id,
      );
    run = (
      await one<{ id: string }>(
        "INSERT INTO test_runs (workspace_id, project_id, name, planned_case_ids) VALUES ($1, $2, 'Round 2', $3) RETURNING id",
        [ws, project, cases],
      )
    ).id;
    page = (
      await one<{ id: string }>(
        "INSERT INTO doc_pages (workspace_id, project_id, title, status, body, version) VALUES ($1, $2, 'Statement of work', 'published', '# SOW', 3) RETURNING id",
        [ws, project],
      )
    ).id;
    await sys(
      "INSERT INTO doc_pages (workspace_id, project_id, title, status, body, client_visible) VALUES ($1, $2, 'Internal draft', 'draft', 'secret', true)",
      [ws, project],
    );
    const file = await one<{ id: string }>(
      "INSERT INTO files (workspace_id, project_id, name, mime, size_bytes, sha256, storage_key) VALUES ($1, $2, 'reminders.png', 'image/png', 10, $3, 'k') RETURNING id",
      [ws, project, 'a'.repeat(64)],
    );
    mockup = (
      await one<{ id: string }>(
        "INSERT INTO mockups (workspace_id, project_id, title, version) VALUES ($1, $2, 'Reminder settings', 1) RETURNING id",
        [ws, project],
      )
    ).id;
    await sys(
      'INSERT INTO mockup_versions (workspace_id, mockup_id, version, file_id) VALUES ($1, $2, 1, $3)',
      [ws, mockup, file.id],
    );
    release = (
      await one<{ id: string }>(
        "INSERT INTO releases (workspace_id, project_id, version, state, notes_client) VALUES ($1, $2, '2.0.0-rc.3', 'frozen', '## New for patients') RETURNING id",
        [ws, project],
      )
    ).id;
    await sys(
      "INSERT INTO releases (workspace_id, project_id, version, state, notes_client) VALUES ($1, $2, '9.9.9', 'frozen', 'other client')",
      [ws, other],
    );
  }, 90_000);

  afterAll(async () => {
    await t.stop();
  });

  it('shows the roadmap and what moved against the baseline', async () => {
    const states = (
      await t.call<{ states: { id: string; group: string }[] }>(
        ada,
        'GET',
        W('/projects/' + project),
      )
    ).body.states;
    const epic = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects/' + project + '/items'), {
        title: 'Reminders',
        kind: 'epic',
        startDate: '2026-10-01',
        dueDate: '2026-10-15',
        stateId: states.find((s) => s.group === 'started')?.id,
      })
    ).body.id;
    const base = await one<{ id: string }>(
      "INSERT INTO baselines (workspace_id, project_id, name, created_at) VALUES ($1, $2, 'Plan v1', now() - interval '2 days') RETURNING id",
      [ada.workspaceId, project],
    );
    await sys(
      "INSERT INTO baseline_items (workspace_id, baseline_id, item_id, finish_date) VALUES ($1, $2, $3, '2026-10-13')",
      [ada.workspaceId, base.id, epic],
    );
    const r = await t.call<{
      items: { title: string; status: string }[];
      moved: { title: string; days: number; baseline: string }[];
    }>(ines, 'GET', W('/portal/roadmap'));
    expect(r.status).toBe(200);
    expect(r.body.items).toEqual([expect.objectContaining({ title: 'Reminders', status: 'now' })]);
    expect(r.body.moved).toEqual([
      expect.objectContaining({ title: 'Reminders', days: 2, baseline: 'Plan v1' }),
    ]);
    // the client switches the roadmap off
    await t.call(ada, 'PATCH', W('/clients/' + helio), {
      shares: { roadmap: false, acceptance_tests: true, release_notes: true },
    });
    expect((await t.call(ines, 'GET', W('/portal/roadmap'))).status).toBe(403);
    await t.call(ada, 'PATCH', W('/clients/' + helio), {
      shares: { roadmap: true, acceptance_tests: true, release_notes: true },
    });
  });

  it('runs an acceptance round: a problem files a bug, the approver accepts with a signature', async () => {
    expect(
      (await t.call<{ rounds: unknown[] }>(ines, 'GET', W('/portal/acceptance'))).body.rounds,
    ).toEqual([]);
    expect(
      (
        await t.call(ada, 'PUT', W('/test-runs/' + run + '/client-round'), {
          shared: true,
          dueOn: '2026-10-08',
        })
      ).status,
    ).toBe(200);
    const R = W('/portal/acceptance/' + run);
    expect(
      (await t.call(paul, 'POST', R + '/results', { caseId: cases[0], result: 'works' })).status,
    ).toBe(403);
    await t.call(tom, 'POST', R + '/results', { caseId: cases[0], result: 'works' });
    const bad = await t.call<{
      cases: { result: string | null; note: string }[];
      problems: number;
    }>(tom, 'POST', R + '/results', {
      caseId: cases[1],
      result: 'problem',
      note: 'The new slot is not offered',
    });
    expect(bad.body.problems).toBe(1);
    expect(bad.body.cases[1]?.note).toBe('The new slot is not offered (BUG-1)');
    const reqs = await t.call<{ ref: string; title: string }[]>(ines, 'GET', W('/client-requests'));
    expect(reqs.body.map((r) => [r.ref, r.title])).toEqual([
      ['BUG-1', 'Acceptance: Cancel and re-book'],
    ]);
    expect((await t.call(tom, 'POST', R + '/accept', { signedName: 'Tom' })).status).toBe(403);
    const ok = await t.call<{ open: boolean; accepted: { by: string; note: string } }>(
      ines,
      'POST',
      R + '/accept',
      { signedName: 'Ines Vogel' },
    );
    expect(ok.body).toMatchObject({
      open: false,
      accepted: { by: 'Ines Vogel', note: 'Accepted with 1 known issue' },
    });
    expect(
      (await t.call<{ rounds: unknown[] }>(otto, 'GET', W('/portal/acceptance'))).body.rounds,
    ).toEqual([]);
  });

  it('approves a shared design with a signature; the team can look but not act', async () => {
    expect(
      (await t.call<{ items: unknown[] }>(ines, 'GET', W('/portal/approvals'))).body.items,
    ).toEqual([]);
    await t.call(ada, 'PUT', W('/mockups/' + mockup + '/client'), { shared: true });
    const list = await t.call<{ items: { kind: string; waiting: boolean; fileId: string }[] }>(
      ines,
      'GET',
      W('/portal/approvals'),
    );
    expect(list.body.items).toEqual([expect.objectContaining({ kind: 'design', waiting: true })]);
    // the image is now the client's to open
    const img = await fetch(t.base + W('/files/' + (list.body.items[0]?.fileId ?? '')), {
      headers: { cookie: ines.cookie },
    });
    expect(img.status).toBe(200);
    expect((await t.call(ada, 'GET', W('/portal/approvals?clientId=' + helio))).status).toBe(200);
    expect(
      (
        await t.call(ada, 'POST', W('/portal/designs/' + mockup + '/decision'), {
          decision: 'approved',
          signedName: 'Ada',
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await t.call(ines, 'POST', W('/portal/designs/' + mockup + '/decision'), {
          decision: 'declined',
        })
      ).status,
    ).toBe(400);
    const ok = await t.call<{ status: string }>(
      ines,
      'POST',
      W('/portal/designs/' + mockup + '/decision'),
      { decision: 'approved', signedName: 'Ines Vogel' },
    );
    expect(ok.body.status).toBe('approved');
    const ap = await one<{ signed_name: string }>(
      "SELECT signed_name FROM approvals WHERE object_type = 'design' AND object_id = $1",
      [mockup],
    );
    expect(ap.signed_name).toBe('Ines Vogel');
  });

  it('shows release notes of the client’s projects only, and takes a rating', async () => {
    const r = await t.call<{ releases: { id: string; version: string; state: string }[] }>(
      ines,
      'GET',
      W('/portal/releases'),
    );
    expect(r.body.releases.map((x) => [x.version, x.state])).toEqual([['2.0.0-rc.3', 'candidate']]);
    const rated = await t.call<{ myRating: number }>(
      paul,
      'POST',
      W('/portal/releases/' + release + '/rating'),
      { rating: 5 },
    );
    expect(rated.body.myRating).toBe(5);
    const list = await t.call<{ clients: unknown } & { name: string; satisfaction: number }[]>(
      ada,
      'GET',
      W('/clients'),
    );
    expect(list.body.find((c) => c.name === 'Helio')?.satisfaction).toBe(5);
  });

  it('lists only shared, published pages, new until read', async () => {
    expect(
      (await t.call<{ documents: unknown[] }>(ines, 'GET', W('/portal/documents'))).body.documents,
    ).toEqual([]);
    expect(
      (await t.call(ada, 'PUT', W('/docs/' + page + '/client'), { shared: true })).status,
    ).toBe(200);
    const list = async () =>
      (
        await t.call<{ documents: { id: string; isNew: boolean }[] }>(
          ines,
          'GET',
          W('/portal/documents'),
        )
      ).body.documents;
    expect(await list()).toEqual([expect.objectContaining({ id: page, isNew: true })]);
    const read = await t.call<{ body: string }>(ines, 'GET', W('/portal/documents/' + page));
    expect(read.body.body).toBe('# SOW');
    expect(await list()).toEqual([expect.objectContaining({ id: page, isNew: false })]);
    expect((await t.call(otto, 'GET', W('/portal/documents/' + page))).status).toBe(404);
  });

  it('keeps the team’s own work out of a contact’s transaction', async () => {
    await sys(
      "INSERT INTO ideas (workspace_id, project_id, number, title) VALUES ($1, $2, 1, 'Secret idea')",
      [ada.workspaceId, project],
    );
    const seen = await t.db.pool.connect();
    try {
      await seen.query('BEGIN');
      await seen.query("SELECT set_config('app.workspace_id', $1, true)", [ada.workspaceId]);
      await seen.query("SELECT set_config('app.client_id', $1, true)", [helio]);
      const n = async (table: string) =>
        Number(
          ((await seen.query(`SELECT count(*) AS n FROM ${table}`)).rows[0] as { n: string }).n,
        );
      expect(await n('ideas')).toBe(0);
      expect(await n('agents')).toBe(0);
      expect(await n('test_runs')).toBe(1);
      expect(await n('project_states')).toBeGreaterThan(0);
      await seen.query("SELECT set_config('app.client_id', '', true)");
      expect(await n('project_states')).toBeGreaterThan(await n('test_runs'));
      await seen.query('ROLLBACK');
    } finally {
      seen.release();
    }
  });
});
