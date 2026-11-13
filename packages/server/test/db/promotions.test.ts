// ── [PCODE-204 | S15 | v0.1.0] T17.2 Promotions with approval, rollback per environment, backports, go/no-go meeting notes ──
//    Why:  against PostgreSQL and a runner speaking HTTP: the pipeline says what runs where and what
//          production lacks; a promotion into production waits for its approver (others may not decide),
//          deploys once approved and leaves an approval; production rolls back to what ran before; a fix
//          goes back to an older line as a hotfix; go/no-go notes are kept.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inSystem } from '../../src/db/pool.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

describe.skipIf(!hasDatabase)('promotions (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let bob: Person;
  let mo: Person;
  let token = '';
  let project = '';
  let staging = '';
  let production = '';
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  const P = (p: string): string => W('/projects/' + project + p);
  const sys = (sql: string, args: unknown[] = []) => inSystem(t.db.pool, (c) => c.query(sql, args));
  const runner = async (path: string, body?: unknown): Promise<Record<string, unknown>> => {
    const res = await fetch(t.base + path, {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + token,
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return (await res.json()) as Record<string, unknown>;
  };
  const runAll = async (): Promise<string[]> => {
    const done: string[] = [];
    for (;;) {
      const claim = (await runner('/api/runner/claim'))['run'] as {
        id: string;
        ref: string;
        environment: { key: string };
      } | null;
      if (!claim) return done;
      await runner('/api/runner/deploys/' + claim.id + '/finish', { status: 'succeeded' });
      done.push(claim.environment.key + ' ' + claim.ref);
    }
  };
  const release = async (version: string, kinds: string[], state = 'released'): Promise<string> => {
    const id = (await t.call<{ id: string }>(ada, 'POST', P('/releases'), { version })).body.id;
    const items: string[] = [];
    for (const [i, kind] of kinds.entries())
      items.push(
        (
          await t.call<{ id: string }>(ada, 'POST', P('/items'), {
            title: version + ' ' + String(i),
            kind,
          })
        ).body.id,
      );
    if (items.length)
      await t.call(ada, 'POST', W('/releases/' + id + '/items'), { itemIds: items });
    if (state !== 'planned')
      await sys('UPDATE releases SET state = $2, released_at = now() WHERE id = $1', [id, state]);
    return id;
  };
  type Env = {
    key: string;
    running: { ref: string } | null;
    approver: { name: string } | null;
    waiting: { id: string; status: string } | null;
    ahead: { versions: string[]; tasks: number; fixes: number };
  };

  beforeAll(async () => {
    t = await startTestApp();
    ada = await t.signup('Ada');
    bob = await t.signup('Bob');
    mo = await t.signup('Mo');
    await t.call(ada, 'POST', W('/members'), { email: bob.email, role: 'member' });
    await t.call(ada, 'POST', W('/members'), { email: mo.email, role: 'member' });
    token = (await t.call<{ token: string }>(ada, 'POST', W('/runners'), { name: 'box' })).body
      .token;
    project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'NWL', name: 'Nordwind' })
    ).body.id;
    const env = async (key: string, name: string): Promise<string> =>
      (
        await t.call<{ id: string }>(ada, 'POST', P('/environments'), {
          key,
          name,
          kind: 'compose',
          settings: { dir: '/srv/' + key },
        })
      ).body.id;
    staging = await env('staging', 'Staging');
    production = await env('production', 'Production');
    await sys('UPDATE environments SET position = 1 WHERE id = $1', [production]);
    await release('1.0.0', ['story']);
    await release('1.1.0', ['story', 'story', 'bug']);
    await t.call(ada, 'POST', W('/environments/' + production + '/deploys'), { ref: '1.0.0' });
    await t.call(ada, 'POST', W('/environments/' + staging + '/deploys'), { ref: '1.1.0' });
    await runAll();
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('shows what runs where and what production does not have yet', async () => {
    expect(
      (await t.call(mo, 'PUT', W('/environments/' + production + '/approver'), { userId: bob.id }))
        .status,
    ).toBe(403);
    expect(
      (
        await t.call<{ approver: string }>(
          ada,
          'PUT',
          W('/environments/' + production + '/approver'),
          { userId: bob.id },
        )
      ).body,
    ).toEqual({
      approver: 'Bob',
    });
    const envs = (await t.call<Env[]>(ada, 'GET', P('/pipeline'))).body;
    expect(envs.map((e) => [e.key, e.running?.ref, e.approver?.name ?? null])).toEqual([
      ['staging', '1.1.0', null],
      ['production', '1.0.0', 'Bob'],
    ]);
    expect(envs[0]?.ahead).toEqual({ versions: ['1.1.0'], tasks: 2, fixes: 1 });
  });

  it('waits for the approver, deploys once approved and keeps the approval', async () => {
    const asked = await t.call<{ id: string; status: string; ref: string; approver: string }>(
      ada,
      'POST',
      W('/environments/' + production + '/promote'),
    );
    expect(asked.status).toBe(201);
    expect(asked.body).toMatchObject({ status: 'requested', ref: '1.1.0', approver: 'Bob' });
    expect((await t.call(ada, 'POST', W('/environments/' + production + '/promote'))).status).toBe(
      409,
    );
    expect(await runAll()).toEqual([]);
    const D = W('/promotions/' + asked.body.id + '/decision');
    expect((await t.call(mo, 'POST', D, { approve: true })).status).toBe(403);
    expect((await t.call(bob, 'POST', D, { approve: false })).status).toBe(400);
    const ok = await t.call<{ status: string; decidedBy: string; deployId: string }>(
      bob,
      'POST',
      D,
      { approve: true },
    );
    expect(ok.body).toMatchObject({ status: 'approved', decidedBy: 'Bob' });
    expect(await runAll()).toEqual(['production 1.1.0']);
    const proof = await sys(
      "SELECT decision FROM approvals WHERE object_type = 'release' AND object_id = $1",
      [asked.body.id],
    );
    expect(proof.rows).toEqual([{ decision: 'approved' }]);
    // staging has no approver: a promotion there deploys at once
    const direct = await t.call<{ status: string }>(
      ada,
      'POST',
      W('/environments/' + staging + '/promote'),
      { ref: '1.0.0' },
    );
    expect(direct.body.status).toBe('approved');
    expect(await runAll()).toEqual(['staging 1.0.0']);
  });

  it('rolls production back to what ran there before', async () => {
    expect(
      (await t.call(ada, 'POST', W('/environments/' + production + '/rollback'), { reason: '' }))
        .status,
    ).toBe(400);
    const back = await t.call<{ ref: string; from: string }>(
      ada,
      'POST',
      W('/environments/' + production + '/rollback'),
      {
        reason: 'Login broken',
      },
    );
    expect(back.body).toMatchObject({ ref: '1.0.0', from: '1.1.0' });
    expect(await runAll()).toEqual(['production 1.0.0']);
    const rel = await sys(
      "SELECT state FROM releases WHERE project_id = $1 AND version = '1.1.0'",
      [project],
    );
    expect(rel.rows).toEqual([{ state: 'rolled_back' }]);
  });

  it('backports a fix to an older line as a hotfix', async () => {
    await release('1.3.8', ['story']);
    const newer = await release('1.4.0', ['bug', 'story'], 'planned');
    const items = (
      await t.call<{ items: { id: string; kind: string }[] }>(ada, 'GET', W('/releases/' + newer))
    ).body.items;
    const fix = items.find((i) => i.kind === 'bug')?.id ?? '';
    const B = W('/releases/' + newer + '/backport');
    expect((await t.call(ada, 'POST', B, { line: '1.4', itemIds: [fix] })).status).toBe(409);
    expect((await t.call(ada, 'POST', B, { line: '0.9', itemIds: [fix] })).status).toBe(409);
    const first = await t.call<{ version: string; created: boolean }>(ada, 'POST', B, {
      line: '1.3',
      itemIds: [fix],
    });
    expect(first.body).toMatchObject({ version: '1.3.9', created: true });
    const again = await t.call<{ version: string; created: boolean }>(ada, 'POST', B, {
      line: '1.3',
      itemIds: [fix],
    });
    expect(again.body).toMatchObject({ version: '1.3.9', created: false });
    const hot = await sys(
      "SELECT r.hotfix_of IS NOT NULL AS hotfix, (SELECT count(*)::int FROM release_items x WHERE x.release_id = r.id) AS n FROM releases r WHERE r.project_id = $1 AND r.version = '1.3.9'",
      [project],
    );
    expect(hot.rows).toEqual([{ hotfix: true, n: 1 }]);
  });

  it('keeps the go/no-go notes', async () => {
    const id = (
      await t.call<{ releases: { id: string; version: string }[] }>(ada, 'GET', P('/releases'))
    ).body.releases.find((r) => r.version === '1.4.0')?.id;
    const put = await t.call<{ decision: string; by: string }>(
      ada,
      'PUT',
      W('/releases/' + (id ?? '') + '/go-no-go'),
      {
        decision: 'no_go',
        notes: 'Wait for the payment fix',
        attendees: ['Ada', 'Bob'],
      },
    );
    expect(put.body).toMatchObject({ decision: 'no_go', by: 'Ada' });
    const get = await t.call<{ meeting: { notes: string; attendees: string[] } }>(
      ada,
      'GET',
      W('/releases/' + (id ?? '') + '/go-no-go'),
    );
    expect(get.body.meeting).toMatchObject({
      notes: 'Wait for the payment fix',
      attendees: ['Ada', 'Bob'],
    });
  });
});
