// ── [PCODE-199 | S15 | v0.1.0] T16.3 Handover pack on the server: checks, team checklist, frozen packs, PDF, client acceptance in the portal ──
//    Why:  the handover through the API against PostgreSQL: the checks name what is missing and sending is
//          refused until it is there; a sent pack is frozen (a later edit of a page does not change it), it
//          comes as PDF, the client reads it and accepts it with a signed name (an approval over the
//          pack's hash) that finishes the handover stage; a viewer cannot decide, another client sees
//          nothing, and a new pack supersedes the one before.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inSystem } from '../../src/db/pool.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

describe.skipIf(!hasDatabase)('handover packs (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let ines: Person;
  let paul: Person;
  let otto: Person;
  let project = '';
  let readme = '';
  let finding = '';
  let packId = '';
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  const P = (p: string): string => W('/projects/' + project + p);
  const sys = (sql: string, args: unknown[] = []) => inSystem(t.db.pool, (c) => c.query(sql, args));
  type Check = { key: string; state: string; detail: string };
  type Status = {
    checks: Check[];
    ready: boolean;
    items: { id: string; label: string; done: boolean }[];
    suggested: string[];
    client: string | null;
    pages: { title: string }[];
    packs: { id: string; number: number; status: string }[];
  };
  const status = async (): Promise<Status> =>
    (await t.call<Status>(ada, 'GET', P('/handover'))).body;
  const missing = async (): Promise<string[]> =>
    (await status()).checks.filter((c) => c.state === 'missing').map((c) => c.key);

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
  const publish = async (title: string, body: string): Promise<string> => {
    const id = (await t.call<{ page: { id: string } }>(ada, 'POST', P('/docs'), { title, body }))
      .body.page.id;
    await t.call(ada, 'PATCH', W('/docs/' + id), { status: 'published' });
    return id;
  };

  beforeAll(async () => {
    t = await startTestApp();
    ada = await t.signup('Ada');
    const helio = (await t.call<{ id: string }>(ada, 'POST', W('/clients'), { name: 'Helio' })).body
      .id;
    const aurum = (await t.call<{ id: string }>(ada, 'POST', W('/clients'), { name: 'Aurum' })).body
      .id;
    project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'HEL', name: 'Helio app' })
    ).body.id;
    await t.call(ada, 'PUT', P('/client'), { clientId: helio });
    await t.call(ada, 'POST', P('/lifecycle'), {});
    ines = await contact(helio, 'ines@helio.example', 'approver');
    paul = await contact(helio, 'paul@helio.example', 'viewer');
    otto = await contact(aurum, 'otto@aurum.example', 'approver');
    const ws = ada.workspaceId;
    finding = (
      (
        await sys(
          "INSERT INTO findings (workspace_id, project_id, tool, rule, severity, title, fingerprint) VALUES ($1, $2, 'scan', 'r1', 'high', 'Open redirect', 'f1') RETURNING id",
          [ws, project],
        )
      ).rows[0] as { id: string }
    ).id;
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('names what is missing and refuses to send until it is there', async () => {
    const first = await status();
    expect(first.client).toBe('Helio');
    expect(first.ready).toBe(false);
    expect(await missing()).toEqual(['architecture', 'readme', 'runbooks', 'release', 'security']);
    const refused = await t.call<{ error: { message: string } }>(
      ada,
      'POST',
      P('/handover/packs'),
      {},
    );
    expect(refused.status).toBe(409);
    expect(refused.body.error.message).toBe(
      'Not ready to hand over: Architecture, Handover readme, Runbooks, Release, Security',
    );
    // the team checklist: the suggested items, one ticked, one own
    expect(first.suggested).toHaveLength(4);
    expect((await t.call(ada, 'POST', P('/handover/items'), { suggested: true })).body).toEqual({
      added: 4,
    });
    await t.call(ada, 'POST', P('/handover/items'), { label: 'Domain moved' });
    const items = (await status()).items;
    expect(items.map((i) => i.label).at(-1)).toBe('Domain moved');
    expect((await missing()).filter((k) => k.startsWith('item:'))).toHaveLength(5);
    for (const i of items) await t.call(ada, 'PATCH', W('/handover-items/' + i.id), { done: true });
    await t.call(ada, 'DELETE', W('/handover-items/' + (items[0]?.id ?? '')));
    expect((await status()).items).toHaveLength(4);
  });

  it('sends a frozen pack when everything required is there', async () => {
    readme = await publish('Handover readme', '# Readme\n\nRun `docker compose up`.');
    await publish('Architecture', '# Parts\n\n- web\n- server');
    await publish('Runbook: deploy', '## Steps\n\n1. Tag\n2. Deploy');
    await sys(
      "INSERT INTO releases (workspace_id, project_id, version, state, notes_client, released_at) VALUES ($1, $2, '1.0.0', 'released', 'All features', now())",
      [ada.workspaceId, project],
    );
    await sys("UPDATE findings SET status = 'fixed' WHERE id = $1", [finding]);
    const now = await status();
    expect(now.ready).toBe(true);
    expect(now.checks.find((c) => c.key === 'tests')).toMatchObject({ state: 'warn' });
    expect(now.pages.map((p) => p.title)).toEqual([
      'Handover readme',
      'Architecture',
      'Runbook: deploy',
    ]);
    const sent = await t.call<{
      pack: { id: string; number: number; status: string; hash: string };
      contents: { pages: { title: string; version: number }[]; release: { version: string } };
    }>(ada, 'POST', P('/handover/packs'), { note: 'Everything for the launch' });
    expect(sent.status).toBe(201);
    expect(sent.body.pack).toMatchObject({ number: 1, status: 'sent' });
    expect(sent.body.contents.release.version).toBe('1.0.0');
    packId = sent.body.pack.id;
    // a later edit does not change what was sent
    const page = await t.call<{ page: { version: number } }>(ada, 'GET', W('/docs/' + readme));
    await t.call(ada, 'PUT', W('/docs/' + readme), {
      body: '# Readme\n\nChanged after sending.',
      baseVersion: page.body.page.version,
    });
    const frozen = await t.call<{ body: string; version: number }>(
      ada,
      'GET',
      W('/handover-packs/' + packId + '/pages/' + readme),
    );
    expect(frozen.body.body).toContain('docker compose up');
    const pdf = await fetch(t.base + W('/handover-packs/' + packId + '/pdf'), {
      headers: { cookie: ada.cookie },
    });
    expect(pdf.headers.get('content-type')).toBe('application/pdf');
    const bytes = Buffer.from(await pdf.arrayBuffer()).toString('latin1');
    expect(bytes.startsWith('%PDF')).toBe(true);
    expect(bytes).toContain('(Handover pack 1)');
    expect(bytes).toContain('docker compose up');
  });

  it('lets the client read it and accept it with a signed name, which finishes the handover stage', async () => {
    const list = await t.call<{
      mayDecide: boolean;
      packs: { projectKey: string; latest: boolean; pack: { id: string } }[];
    }>(ines, 'GET', W('/portal/handover'));
    expect(list.body.mayDecide).toBe(true);
    expect(list.body.packs).toEqual([
      expect.objectContaining({
        projectKey: 'HEL',
        latest: true,
        pack: expect.objectContaining({ id: packId }) as unknown,
      }),
    ]);
    expect(
      (
        await t.call<{ body: string }>(
          ines,
          'GET',
          W('/portal/handover/' + packId + '/pages/' + readme),
        )
      ).body.body,
    ).toContain('docker compose up');
    expect((await t.call(otto, 'GET', W('/portal/handover/' + packId))).status).toBe(404);
    expect(
      (
        await t.call(paul, 'POST', W('/portal/handover/' + packId + '/decision'), {
          decision: 'accepted',
          signedName: 'Paul Viewer',
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await t.call(ines, 'POST', W('/portal/handover/' + packId + '/decision'), {
          decision: 'accepted',
          signedName: 'In',
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await t.call(ines, 'POST', W('/portal/handover/' + packId + '/decision'), {
          decision: 'changes_requested',
        })
      ).status,
    ).toBe(400);
    const ok = await t.call<{ status: string; signedName: string }>(
      ines,
      'POST',
      W('/portal/handover/' + packId + '/decision'),
      {
        decision: 'accepted',
        signedName: 'Ines Vogel',
      },
    );
    expect(ok.body).toMatchObject({ status: 'accepted', signedName: 'Ines Vogel' });
    const proof = await sys(
      "SELECT a.version_hash = k.hash AS same, a.decision FROM approvals a JOIN handover_packs k ON k.id::text = a.object_id WHERE a.object_type = 'handover'",
    );
    expect(proof.rows).toEqual([{ same: true, decision: 'approved' }]);
    const stage = await sys(
      "SELECT status FROM lifecycle_stages WHERE project_id = $1 AND stage_key = 'handover'",
      [project],
    );
    expect(stage.rows[0]).toEqual({ status: 'done' });
    expect(
      (
        await t.call(ines, 'POST', W('/portal/handover/' + packId + '/decision'), {
          decision: 'accepted',
          signedName: 'Ines Vogel',
        })
      ).status,
    ).toBe(409);
  });

  it('supersedes a sent pack with a new one', async () => {
    const two = await t.call<{ pack: { id: string; number: number } }>(
      ada,
      'POST',
      P('/handover/packs'),
      {},
    );
    const three = await t.call<{ pack: { id: string; number: number } }>(
      ada,
      'POST',
      P('/handover/packs'),
      {},
    );
    expect([two.body.pack.number, three.body.pack.number]).toEqual([2, 3]);
    const packs = (await status()).packs;
    expect(packs.map((p) => [p.number, p.status])).toEqual([
      [3, 'sent'],
      [2, 'superseded'],
      [1, 'accepted'],
    ]);
    expect(
      (
        await t.call(ines, 'POST', W('/portal/handover/' + two.body.pack.id + '/decision'), {
          decision: 'changes_requested',
          note: 'x',
        })
      ).status,
    ).toBe(409);
  });
});
