// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-132 | S15 | v0.1.0] Run deploys through our own runner and stream each step ──
//    Why:  the runner protocol against the real database: claiming, one runner per run, secrets for the
//          claiming runner only, steps written as they come, finishing and cancelling.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inSystem } from '../../src/db/pool.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

process.env['ORQIVA_SECRET_KEY'] = 'ef'.repeat(32);

describe.skipIf(!hasDatabase)('deploys and runners (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let mo: Person;
  let env = '';
  let project = '';
  let one = '';
  let two = '';
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  const runner = async (token: string, path: string, body?: unknown) => {
    const res = await fetch(t.base + path, {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + token,
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };
  type Deploy = {
    id: string;
    status: string;
    runner: string | null;
    error: string;
    trigger: string;
  };

  beforeAll(async () => {
    t = await startTestApp();
    ada = await t.signup('Ada');
    mo = await t.signup('Mo');
    await t.call(ada, 'POST', W('/members'), { email: mo.email, role: 'member' });
    project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'APP', name: 'App' })
    ).body.id;
    env = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects/' + project + '/environments'), {
        key: 'staging',
        name: 'Staging',
        kind: 'compose',
        settings: { dir: '/srv/app' },
        healthUrl: 'https://staging.example/health',
      })
    ).body.id;
    await t.call(ada, 'PUT', W('/environments/' + env + '/secrets/DB_PASSWORD'), {
      value: 'p4ss-word',
    });
    expect((await t.call(mo, 'POST', W('/runners'), { name: 'x' })).status).toBe(403);
    one = (await t.call<{ token: string }>(ada, 'POST', W('/runners'), { name: 'build-box' })).body
      .token;
    two = (await t.call<{ token: string }>(ada, 'POST', W('/runners'), { name: 'spare' })).body
      .token;
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('gives a queued deploy to one runner, with the secrets, and takes its steps as they come', async () => {
    expect(one).toMatch(/^orq_runner_[\w-]{43}$/);
    expect((await runner(one, '/api/runner/claim')).body).toEqual({ run: null });
    const d = await t.call<Deploy>(mo, 'POST', W('/environments/' + env + '/deploys'), {
      ref: 'v1.2.0',
    });
    expect(d.status).toBe(201);
    expect(d.body).toMatchObject({ status: 'queued', trigger: 'manual' });
    expect((await t.call(mo, 'POST', W('/environments/' + env + '/deploys'), {})).status).toBe(409);

    const claim = await runner(one, '/api/runner/claim');
    expect(claim.body['run']).toMatchObject({
      id: d.body.id,
      ref: 'v1.2.0',
      project: 'APP',
      environment: { key: 'staging', kind: 'compose', settings: { dir: '/srv/app' } },
      secrets: { DB_PASSWORD: 'p4ss-word' },
    });
    expect((await runner(two, '/api/runner/claim')).body).toEqual({ run: null });

    const steps = '/api/runner/deploys/' + d.body.id + '/steps';
    await runner(one, steps, {
      seq: 1,
      name: 'Pull images',
      command: 'docker compose pull',
      status: 'running',
    });
    await runner(one, steps, {
      seq: 1,
      name: 'Pull images',
      status: 'running',
      output: 'pulling…',
    });
    await runner(one, steps, {
      seq: 1,
      name: 'Pull images',
      status: 'ok',
      output: 'pulled',
      exitCode: 0,
    });
    // another runner cannot write into this run
    expect((await runner(two, steps, { seq: 2, name: 'x', status: 'ok' })).status).toBe(404);
    const mid = await t.call<{
      deploy: Deploy;
      steps: { seq: number; status: string; output: string; command: string }[];
    }>(ada, 'GET', W('/deploys/' + d.body.id));
    expect(mid.body.deploy).toMatchObject({ status: 'running', runner: 'build-box' });
    expect(mid.body.steps).toEqual([
      expect.objectContaining({
        seq: 1,
        status: 'ok',
        output: 'pulled',
        command: 'docker compose pull',
      }),
    ]);

    const done = await runner(one, '/api/runner/deploys/' + d.body.id + '/finish', {
      status: 'succeeded',
    });
    expect(done.body).toMatchObject({ status: 'succeeded' });
    const events = await inSystem(t.db.pool, async (c) =>
      (
        await c.query<{ type: string }>(
          "SELECT type FROM activity_events WHERE type LIKE 'orqiva.deploy.%' ORDER BY sequence",
        )
      ).rows.map((r) => r.type),
    );
    expect(events).toEqual([
      'orqiva.deploy.created',
      'orqiva.deploy.started',
      'orqiva.deploy.progressed',
      'orqiva.deploy.progressed',
      'orqiva.deploy.progressed',
      'orqiva.deploy.completed',
    ]);
    expect(JSON.stringify(events)).not.toContain('p4ss');
  });

  it('tells the runner when a person cancelled, and refuses revoked tokens', async () => {
    const d = await t.call<Deploy>(mo, 'POST', W('/environments/' + env + '/deploys'), {});
    await runner(two, '/api/runner/claim');
    expect(
      (await t.call<Deploy>(mo, 'POST', W('/deploys/' + d.body.id + '/cancel'))).body.status,
    ).toBe('cancelled');
    const r = await runner(two, '/api/runner/deploys/' + d.body.id + '/steps', {
      seq: 1,
      name: 'Pull',
      status: 'running',
    });
    expect(r.body).toEqual({ cancelled: true });
    const runners = await t.call<{ id: string; name: string }[]>(ada, 'GET', W('/runners'));
    const spare = runners.body.find((x) => x.name === 'spare')?.id ?? '';
    await t.call(ada, 'DELETE', W('/runners/' + spare));
    expect((await runner(two, '/api/runner/claim')).status).toBe(401);
    expect((await runner('nonsense', '/api/runner/claim')).status).toBe(401);
  });
});
