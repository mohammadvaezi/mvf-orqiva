// ── [PCODE-336 | S15 | v0.1.0] T34.1a Portal home with health, milestone, release and budget; release deliverables and demos; client sign-off per release; files on acceptance results ──
//    Why:  against the real database: a client contact's home shows each project's health from delivery,
//          quality and operations only, its next milestone and latest release, and the budget only while it
//          is shared; the team adds links and a demo to a release, which the contact sees with the release
//          notes and signs off (a viewer may not); and a problem in an acceptance round carries a screenshot.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inSystem } from '../../src/db/pool.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

process.env['ORQIVA_SECRET_KEY'] = 'ab'.repeat(32);

describe.skipIf(!hasDatabase)('portal home and release deliverables (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let ines: Person;
  let paul: Person;
  let helio = '';
  let project = '';
  let release = '';
  let run = '';
  let kase = '';
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  const sys = (sql: string, args: unknown[] = []) => inSystem(t.db.pool, (c) => c.query(sql, args));
  const one = async <T>(sql: string, args: unknown[] = []): Promise<T> =>
    (await sys(sql, args)).rows[0] as T;

  async function contact(email: string, role: string): Promise<Person> {
    const r = await t.call<{ invitation: { token: string } | null }>(
      ada,
      'POST',
      W('/clients/' + helio + '/contacts'),
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
    project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'HEL', name: 'Helio app' })
    ).body.id;
    await t.call(ada, 'PUT', W('/projects/' + project + '/client'), { clientId: helio });
    ines = await contact('ines@helio.example', 'approver');
    paul = await contact('paul@helio.example', 'viewer');
    const ws = ada.workspaceId;
    // an overdue task, a milestone ahead, a released and a newer candidate release, a budget
    const state = await one<{ id: string }>(
      "SELECT id FROM project_states WHERE project_id = $1 AND grp = 'unstarted' LIMIT 1",
      [project],
    );
    await sys(
      `INSERT INTO items (workspace_id, project_id, sequence, title, state_id, kind, due_date)
       VALUES ($1, $2, 101, 'Late work', $3, 'task', current_date - 3),
              ($1, $2, 102, 'Beta for patients', $3, 'milestone', current_date + 20),
              ($1, $2, 103, 'Go live', $3, 'milestone', current_date + 60)`,
      [ws, project, state.id],
    );
    await sys(
      "INSERT INTO releases (workspace_id, project_id, version, state, notes_client, released_at) VALUES ($1, $2, '1.0.0', 'released', 'First', now() - interval '20 days')",
      [ws, project],
    );
    release = (
      await one<{ id: string }>(
        "INSERT INTO releases (workspace_id, project_id, version, state, notes_client, freeze_at) VALUES ($1, $2, '1.1.0-rc.1', 'frozen', '## Reminders', now()) RETURNING id",
        [ws, project],
      )
    ).id;
    await sys(
      "INSERT INTO budgets (workspace_id, scope_type, scope_id, measure, period, amount_cents) VALUES ($1, 'client', $2, 'total', 'total', 1000000)",
      [ws, helio],
    );
    kase = (
      await one<{ id: string }>(
        "INSERT INTO test_cases (workspace_id, project_id, title, expected) VALUES ($1, $2, 'Set a reminder', 'It rings') RETURNING id",
        [ws, project],
      )
    ).id;
    run = (
      await one<{ id: string }>(
        "INSERT INTO test_runs (workspace_id, project_id, name, planned_case_ids, client_round) VALUES ($1, $2, 'UAT 1', $3, true) RETURNING id",
        [ws, project, [kase]],
      )
    ).id;
  }, 90_000);

  afterAll(async () => {
    await t.stop();
  });

  it('shows each project’s health, next milestone, latest release and the budget', async () => {
    type Home = {
      projects: {
        key: string;
        health: string;
        reasons: string[];
        nextMilestone: { title: string } | null;
        latestRelease: { version: string; state: string } | null;
      }[];
      budget: { budgetCents: number | null; usedCents: number } | null;
    };
    const h = await t.call<Home>(ines, 'GET', W('/portal/home'));
    expect(h.status).toBe(200);
    expect(h.body.projects).toEqual([
      expect.objectContaining({
        key: 'HEL',
        health: 'at-risk',
        reasons: ['1 task overdue'],
      }),
    ]);
    expect(h.body.projects[0]?.nextMilestone?.title).toBe('Beta for patients');
    expect(h.body.projects[0]?.latestRelease).toMatchObject({
      version: '1.1.0-rc.1',
      state: 'candidate',
    });
    expect(h.body.budget).toEqual(expect.objectContaining({ budgetCents: 1000000, usedCents: 0 }));
    // the team decides what it shares
    await t.call(ada, 'PATCH', W('/clients/' + helio), { shares: { budget: false } });
    expect((await t.call<Home>(ines, 'GET', W('/portal/home'))).body.budget).toBeNull();
    // a team member sees the home as the client does
    expect(
      (await t.call<Home>(ada, 'GET', W('/portal/home?clientId=' + helio))).body.projects,
    ).toHaveLength(1);
  });

  it('adds links and a demo to a release, which the client sees and signs off', async () => {
    const D = W('/releases/' + release + '/deliverables');
    expect(
      (await t.call(ada, 'POST', D, { kind: 'link', title: 'Test build', url: 'ftp://x' })).status,
    ).toBe(400);
    expect(
      (await t.call(ines, 'POST', D, { kind: 'link', title: 'x', url: 'https://x.test' })).status,
    ).toBe(403);
    await t.call(ada, 'POST', D, {
      kind: 'link',
      title: 'Test build',
      url: 'https://test.helio.example',
    });
    const video = await one<{ id: string }>(
      "INSERT INTO files (workspace_id, project_id, name, mime, size_bytes, sha256, storage_key) VALUES ($1, $2, 'demo.mp4', 'video/mp4', 10, $3, 'k') RETURNING id",
      [ada.workspaceId, project, 'b'.repeat(64)],
    );
    const demo = await t.call<{ kind: string; fileName: string }>(ada, 'POST', D, {
      kind: 'demo',
      title: 'Reminders walkthrough',
      fileId: video.id,
    });
    expect(demo.body).toMatchObject({ kind: 'demo', fileName: 'demo.mp4' });
    type Rel = {
      releases: {
        id: string;
        deliverables: { title: string; kind: string }[];
        signOff: { decision: string } | null;
      }[];
      maySignOff: boolean;
    };
    const seen = await t.call<Rel>(ines, 'GET', W('/portal/releases'));
    const mine = seen.body.releases.find((r) => r.id === release);
    expect(mine?.deliverables.map((d) => d.title)).toEqual(['Test build', 'Reminders walkthrough']);
    expect(seen.body.maySignOff).toBe(true);
    expect((await t.call<Rel>(paul, 'GET', W('/portal/releases'))).body.maySignOff).toBe(false);
    const S = W('/portal/releases/' + release + '/sign-off');
    expect(
      (await t.call(paul, 'POST', S, { decision: 'approved', signedName: 'Paul P' })).status,
    ).toBe(403);
    expect(
      (await t.call(ines, 'POST', S, { decision: 'declined', signedName: 'Ines Vogel' })).status,
    ).toBe(400);
    const ok = await t.call<{ signOff: { decision: string; signedName: string } }>(
      ines,
      'POST',
      S,
      {
        decision: 'approved',
        signedName: 'Ines Vogel',
      },
    );
    expect(ok.body.signOff).toMatchObject({ decision: 'approved', signedName: 'Ines Vogel' });
    const team = await t.call<{ signOff: { decision: string } | null }>(ada, 'GET', D);
    expect(team.body.signOff?.decision).toBe('approved');
  });

  it('keeps a screenshot with a problem in an acceptance round', async () => {
    const shot = await one<{ id: string }>(
      "INSERT INTO files (workspace_id, project_id, name, mime, size_bytes, sha256, storage_key, uploaded_by) VALUES ($1, $2, 'bell.png', 'image/png', 10, $3, 'k', $4) RETURNING id",
      [ada.workspaceId, project, 'c'.repeat(64), ines.id],
    );
    const other = await one<{ id: string }>(
      "INSERT INTO files (workspace_id, project_id, name, mime, size_bytes, sha256, storage_key, uploaded_by) VALUES ($1, $2, 'x.png', 'image/png', 10, $3, 'k', $4) RETURNING id",
      [ada.workspaceId, project, 'd'.repeat(64), ada.id],
    );
    const R = W('/portal/acceptance/' + run + '/results');
    expect(
      (
        await t.call(ines, 'POST', R, {
          caseId: kase,
          result: 'problem',
          note: 'No sound',
          fileIds: [other.id],
        })
      ).status,
    ).toBe(400);
    const r = await t.call<{ cases: { files: { name: string; kind: string }[] }[] }>(
      ines,
      'POST',
      R,
      {
        caseId: kase,
        result: 'problem',
        note: 'No sound',
        fileIds: [shot.id],
      },
    );
    expect(r.status).toBe(200);
    expect(r.body.cases[0]?.files).toEqual([
      expect.objectContaining({ name: 'bell.png', kind: 'screenshot' }),
    ]);
  });
});
