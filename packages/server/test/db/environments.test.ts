// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-131 | S15 | v0.1.0] Add environments and the secrets vault ──
//    Why:  environments and the vault against the real database: who may do what, and that a secret's
//          value never leaves the server through the API.
import { settingsProblems } from '@orqiva/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { open } from '../../src/agents/secrets.js';
import { inSystem } from '../../src/db/pool.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

process.env['ORQIVA_SECRET_KEY'] = 'cd'.repeat(32);

describe('environment settings', () => {
  it('are checked per kind, and secrets are refused as settings', () => {
    expect(settingsProblems('ssh', { host: 'staging.example', dir: '/srv/app' })).toEqual([]);
    expect(settingsProblems('ssh', { host: 'x' })).toEqual(['Folder on the server is required']);
    expect(settingsProblems('compose', { dir: '/srv', password: 'x' })).toEqual([
      'password is not a setting of compose',
    ]);
    expect(
      settingsProblems('coolify', { url: 'https://c.example/api/v1/deploy?token=abc' }),
    ).toEqual(['url looks like it holds a secret; store it as a secret of the environment']);
    expect(settingsProblems('ftp', {})).toEqual([
      'kind is one of compose, ssh, kubernetes, coolify, opentofu',
    ]);
  });
});

describe.skipIf(!hasDatabase)('environments and secrets (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let mo: Person;
  let gus: Person;
  let project = '';
  let env = '';
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  type Env = {
    id: string;
    key: string;
    settings: Record<string, string>;
    secrets: { name: string; updatedBy: string | null }[];
  };

  beforeAll(async () => {
    t = await startTestApp();
    ada = await t.signup('Ada');
    mo = await t.signup('Mo');
    gus = await t.signup('Gus');
    await t.call(ada, 'POST', W('/members'), { email: mo.email, role: 'member' });
    await t.call(ada, 'POST', W('/members'), { email: gus.email, role: 'guest' });
    project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'APP', name: 'App' })
    ).body.id;
    await t.call(ada, 'POST', W('/projects/' + project + '/guests'), { userId: gus.id });
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('are set up by admins and seen by members', async () => {
    const body = {
      key: 'staging',
      name: 'Staging',
      kind: 'ssh',
      settings: { host: 'staging.example', dir: '/srv/app' },
      healthUrl: 'https://staging.example/health',
      deployOnGate: 'g1',
    };
    expect(
      (await t.call(mo, 'POST', W('/projects/' + project + '/environments'), body)).status,
    ).toBe(403);
    const r = await t.call<Env>(ada, 'POST', W('/projects/' + project + '/environments'), body);
    expect(r.status).toBe(201);
    env = r.body.id;
    expect(
      (await t.call(ada, 'POST', W('/projects/' + project + '/environments'), body)).status,
    ).toBe(409);
    const bad = await t.call(ada, 'POST', W('/projects/' + project + '/environments'), {
      ...body,
      key: 'prod',
      settings: { host: 'x' },
    });
    expect(bad.status).toBe(400);
    expect(
      (await t.call<Env[]>(mo, 'GET', W('/projects/' + project + '/environments'))).body.map(
        (e) => e.key,
      ),
    ).toEqual(['staging']);
    expect((await t.call(gus, 'GET', W('/projects/' + project + '/environments'))).status).toBe(
      403,
    );
  });

  it('keep secrets sealed and show only their names', async () => {
    expect(
      (await t.call(mo, 'PUT', W('/environments/' + env + '/secrets/DB_PASSWORD'), { value: 'x' }))
        .status,
    ).toBe(403);
    const r = await t.call<Env>(ada, 'PUT', W('/environments/' + env + '/secrets/DB_PASSWORD'), {
      value: 'hunter2-très-secret',
    });
    expect(r.body.secrets).toEqual([
      expect.objectContaining({ name: 'DB_PASSWORD', updatedBy: 'Ada' }),
    ]);
    expect(JSON.stringify(r.body)).not.toContain('hunter2');
    expect(
      JSON.stringify((await t.call(mo, 'GET', W('/projects/' + project + '/environments'))).body),
    ).not.toContain('hunter2');
    const stored = await inSystem(
      t.db.pool,
      async (c) =>
        (
          await c.query<{ k: string }>(
            "SELECT ciphertext AS k FROM environment_secrets WHERE name = 'DB_PASSWORD'",
          )
        ).rows[0]?.k ?? '',
    );
    expect(stored).not.toContain('hunter2');
    expect(open(stored)).toBe('hunter2-très-secret');
    expect(
      (await t.call(ada, 'PUT', W('/environments/' + env + '/secrets/db-password'), { value: 'x' }))
        .status,
    ).toBe(400);
    const gone = await t.call<Env>(
      ada,
      'DELETE',
      W('/environments/' + env + '/secrets/DB_PASSWORD'),
    );
    expect(gone.body.secrets).toEqual([]);
    // the change is in the feed, without the value
    const events = await inSystem(t.db.pool, async (c) =>
      (
        await c.query<{ e: string }>(
          "SELECT envelope::text AS e FROM activity_events WHERE type LIKE 'orqiva.environment.%'",
        )
      ).rows.map((r) => r.e),
    );
    expect(events.join()).toContain('DB_PASSWORD');
    expect(events.join()).not.toContain('hunter2');
  });

  it('change and go away with their secrets', async () => {
    const r = await t.call<Env>(ada, 'PATCH', W('/environments/' + env), {
      settings: { host: 'stage2.example', dir: '/srv' },
    });
    expect(r.body.settings).toEqual({ host: 'stage2.example', dir: '/srv' });
    await t.call(ada, 'PUT', W('/environments/' + env + '/secrets/TOKEN'), { value: 'x' });
    expect((await t.call(ada, 'DELETE', W('/environments/' + env))).status).toBe(200);
    const left = await inSystem(
      t.db.pool,
      async (c) => (await c.query('SELECT 1 FROM environment_secrets')).rowCount,
    );
    expect(left).toBe(0);
  });
});
