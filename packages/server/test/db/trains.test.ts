// ── [PCODE-203 | S15 | v0.1.0] T17.1 Release trains on the server: releases of several projects, freeze, go/no-go, ship with deploys, rollback ──
//    Why:  the exit of T17 against PostgreSQL and a runner speaking HTTP: two projects ship 2.0.0 in one
//          train; the train waits for open work, ships all releases at once with their deploys, notices
//          that one deploy failed, and its rollback redeploys 1.0.0 on both environments.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

describe.skipIf(!hasDatabase)('release trains (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let token = '';
  let train = '';
  const projects: Record<string, { id: string; env: string; release: string }> = {};
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  type Train = {
    state: string;
    releases: {
      projectKey: string;
      state: string;
      deploy: { status: string; ref: string } | null;
    }[];
  };
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
  /** The runner takes the next deploy and ends it; returns what it deployed. */
  const run = async (outcome: (project: string) => 'succeeded' | 'failed') => {
    const claim = (await runner('/api/runner/claim'))['run'] as {
      id: string;
      ref: string;
      project: string;
    } | null;
    if (!claim) return null;
    await runner('/api/runner/deploys/' + claim.id + '/finish', {
      status: outcome(claim.project),
      ...(outcome(claim.project) === 'failed' ? { error: 'health check failed' } : {}),
    });
    return claim.project + ' ' + claim.ref;
  };
  const get = async (): Promise<Train> =>
    (await t.call<Train>(ada, 'GET', W('/trains/' + train))).body;

  beforeAll(async () => {
    t = await startTestApp();
    ada = await t.signup('Ada');
    token = (await t.call<{ token: string }>(ada, 'POST', W('/runners'), { name: 'box' })).body
      .token;
    for (const key of ['APP', 'API']) {
      const id = (await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key, name: key }))
        .body.id;
      const env = (
        await t.call<{ id: string }>(ada, 'POST', W('/projects/' + id + '/environments'), {
          key: 'production',
          name: 'Production',
          kind: 'compose',
          settings: { dir: '/srv/' + key.toLowerCase() },
        })
      ).body.id;
      // 1.0.0 already runs there
      await t.call(ada, 'POST', W('/environments/' + env + '/deploys'), { ref: '1.0.0' });
      await run(() => 'succeeded');
      const release = (
        await t.call<{ id: string }>(ada, 'POST', W('/projects/' + id + '/releases'), {
          version: '2.0.0',
        })
      ).body.id;
      projects[key] = { id, env, release };
    }
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('carries releases of two projects, one per project, and freezes them together', async () => {
    const made = await t.call<{ id: string; state: string }>(ada, 'POST', W('/trains'), {
      name: 'October',
      targetDate: '2026-10-16',
    });
    expect(made.status).toBe(201);
    train = made.body.id;
    expect((await t.call(ada, 'POST', W('/trains'), { name: 'October' })).status).toBe(409);
    for (const key of ['APP', 'API']) {
      const p = projects[key];
      const r = await t.call(ada, 'POST', W('/trains/' + train + '/releases'), {
        releaseId: p?.release,
        environmentId: p?.env,
      });
      expect(r.status).toBe(200);
    }
    const second = (
      await t.call<{ id: string }>(
        ada,
        'POST',
        W('/projects/' + (projects['APP']?.id ?? '') + '/releases'),
        {
          version: '2.1.0',
        },
      )
    ).body.id;
    expect(
      (await t.call(ada, 'POST', W('/trains/' + train + '/releases'), { releaseId: second }))
        .status,
    ).toBe(409);
    // the environment must be the project's own
    expect(
      (
        await t.call(ada, 'POST', W('/trains/' + train + '/releases'), {
          releaseId: projects['APP']?.release,
          environmentId: projects['API']?.env,
        })
      ).status,
    ).toBe(400);
    await t.call(ada, 'POST', W('/trains/' + train + '/freeze'));
    const now = await get();
    expect(now.state).toBe('frozen');
    expect(now.releases.map((r) => [r.projectKey, r.state])).toEqual([
      ['API', 'frozen'],
      ['APP', 'frozen'],
    ]);
    // a release on a train ships only with it
    expect(
      (await t.call(ada, 'POST', W('/releases/' + (projects['APP']?.release ?? '') + '/release')))
        .status,
    ).toBe(409);
  });

  it('waits for open work, then ships both releases with their deploys', async () => {
    const api = projects['API'];
    const item = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects/' + (api?.id ?? '') + '/items'), {
        title: 'Rate limits',
        kind: 'bug',
      })
    ).body.id;
    await t.call(ada, 'POST', W('/releases/' + (api?.release ?? '') + '/items'), {
      itemIds: [item],
    });
    const check = await t.call<{
      ready: boolean;
      releases: { project: string; missing: string[] }[];
    }>(ada, 'GET', W('/trains/' + train + '/check'));
    expect(check.body.ready).toBe(false);
    expect(check.body.releases.find((r) => r.project === 'API')?.missing).toEqual([
      '1 task is not done',
    ]);
    const refused = await t.call<{ error: { message: string } }>(
      ada,
      'POST',
      W('/trains/' + train + '/ship'),
    );
    expect(refused.status).toBe(409);
    expect(refused.body.error.message).toBe('Not ready: API 2.0.0: 1 task is not done');
    await t.call(ada, 'DELETE', W('/releases/' + (api?.release ?? '') + '/items/' + item));

    const shipped = await t.call<Train>(ada, 'POST', W('/trains/' + train + '/ship'));
    expect(shipped.status).toBe(200);
    expect(shipped.body.state).toBe('shipping');
    expect(
      shipped.body.releases.map((r) => [r.projectKey, r.state, r.deploy?.status, r.deploy?.ref]),
    ).toEqual([
      ['API', 'released', 'queued', '2.0.0'],
      ['APP', 'released', 'queued', '2.0.0'],
    ]);
  });

  it('notices a failed deploy, and its rollback redeploys 1.0.0 everywhere', async () => {
    const done = [await run((p) => (p === 'API' ? 'failed' : 'succeeded'))];
    expect((await get()).state).toBe('shipping');
    done.push(await run((p) => (p === 'API' ? 'failed' : 'succeeded')));
    expect(done.sort()).toEqual(['API 2.0.0', 'APP 2.0.0']);
    expect((await get()).state).toBe('partial');

    expect(
      (await t.call(ada, 'POST', W('/trains/' + train + '/rollback'), { reason: '' })).status,
    ).toBe(400);
    const back = await t.call<Train>(ada, 'POST', W('/trains/' + train + '/rollback'), {
      reason: 'API health check failed',
    });
    expect(back.body.state).toBe('rolling_back');
    expect(
      back.body.releases.map((r) => [r.projectKey, r.state, r.deploy?.status, r.deploy?.ref]),
    ).toEqual([
      ['API', 'rolled_back', 'queued', '1.0.0'],
      ['APP', 'rolled_back', 'queued', '1.0.0'],
    ]);
    const again = [await run(() => 'succeeded'), await run(() => 'succeeded')];
    expect(again.sort()).toEqual(['API 1.0.0', 'APP 1.0.0']);
    expect(await run(() => 'succeeded')).toBeNull();
    const end = await get();
    expect(end.state).toBe('rolled_back');
    const list = await t.call<{ name: string; state: string }[]>(ada, 'GET', W('/trains'));
    expect(list.body.map((x) => [x.name, x.state])).toEqual([['October', 'rolled_back']]);
    const notes = await t.call<{ notesTeam: string }>(
      ada,
      'GET',
      W('/releases/' + (projects['APP']?.release ?? '')),
    );
    expect(JSON.stringify(notes.body)).toContain('Train October: API health check failed');
  });
});
