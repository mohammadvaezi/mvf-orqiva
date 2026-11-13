// ── [PCODE-307 | S15 | v0.1.0] T31.7 Environment config diff: variables, secrets, settings, flags and versions side by side ──
//    Why:  staging and production compared key by key: variables with their values, secrets only as "set"
//          and whether they are equal (the value never comes back), settings, flags and the deployed
//          version; keys marked as meant to differ are not counted as drift; only admins change variables.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inSystem } from '../../src/db/pool.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

process.env['ORQIVA_SECRET_KEY'] = 'ab'.repeat(32);

interface Row {
  key: string;
  area: string;
  name: string;
  a: string | null;
  b: string | null;
  state: string;
  expected: boolean;
}
interface Diff {
  a: { name: string };
  b: { name: string };
  rows: Row[];
  drift: string;
}

describe.skipIf(!hasDatabase)('environment config diff (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let bob: Person;
  let project = '';
  const env: Record<string, string> = {};
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  const sys = <T>(sql: string, args: unknown[] = []): Promise<T[]> =>
    inSystem(t.db.pool, async (c) => (await c.query(sql, args)).rows as T[]);
  const diff = async (): Promise<Diff> =>
    (
      await t.call<Diff>(
        ada,
        'GET',
        W(
          '/projects/' +
            project +
            '/env-diff?a=' +
            (env['staging'] ?? '') +
            '&b=' +
            (env['production'] ?? ''),
        ),
      )
    ).body;
  const setVar = (e: string, name: string, value: string, who: Person = ada) =>
    t.call(who, 'PUT', W('/environments/' + (env[e] ?? '') + '/vars/' + name), { value });
  const setSecret = (e: string, name: string, value: string) =>
    t.call(ada, 'PUT', W('/environments/' + (env[e] ?? '') + '/secrets/' + name), { value });

  beforeAll(async () => {
    t = await startTestApp();
    ada = await t.signup('Ada');
    bob = await t.signup('Bob');
    await t.call(ada, 'POST', W('/members'), { email: bob.email, role: 'member' });
    project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'SHOP', name: 'Shop' })
    ).body.id;
    for (const [key, name, dir] of [
      ['staging', 'Staging', '/srv/staging'],
      ['production', 'Production', '/srv/shop'],
    ] as const)
      env[key] = (
        await t.call<{ id: string }>(ada, 'POST', W('/projects/' + project + '/environments'), {
          key,
          name,
          kind: 'compose',
          settings: { dir, file: 'compose.yaml' },
        })
      ).body.id;
    await setVar('staging', 'LOG_LEVEL', 'debug');
    await setVar('production', 'LOG_LEVEL', 'info');
    await setVar('staging', 'CART_TTL_DAYS', '30');
    await setVar('production', 'CART_TTL_DAYS', '30');
    await setVar('staging', 'NEW_CHECKOUT_URL', 'https://pay.example.test');
    await setSecret('staging', 'STRIPE_KEY', 'sk_test_same');
    await setSecret('production', 'STRIPE_KEY', 'sk_test_same');
    await setSecret('staging', 'DATABASE_URL', 'postgres://staging');
    await setSecret('production', 'DATABASE_URL', 'postgres://production');
    await setSecret('staging', 'SENTRY_DSN', 'https://sentry.example.test/1');
    await t.call(ada, 'POST', W('/projects/' + project + '/flags'), {
      key: 'new-checkout',
      enabled: { staging: true, production: false },
    });
    await t.call(ada, 'POST', W('/projects/' + project + '/flags'), {
      key: 'dark-mode',
      enabled: { staging: true, production: true },
    });
    for (const [e, ref] of [
      ['staging', 'v1.3.0'],
      ['production', 'v1.2.0'],
    ] as const)
      await sys(
        `INSERT INTO deploy_runs (workspace_id, project_id, environment_id, status, ref, finished_at)
         VALUES ($1, $2, $3, 'succeeded', $4, now())`,
        [ada.workspaceId, project, env[e], ref],
      );
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('lets only admins set variables, and lists them', async () => {
    expect((await setVar('staging', 'LOG_LEVEL', 'trace', bob)).status).toBe(403);
    expect((await setVar('staging', 'bad-name', 'x')).status).toBe(400);
    const list = await t.call<{ key: string; vars: { name: string; value: string }[] }[]>(
      bob,
      'GET',
      W('/projects/' + project + '/env-config'),
    );
    expect(list.body.map((e) => [e.key, e.vars.map((v) => v.name + '=' + v.value)])).toEqual([
      [
        'staging',
        ['CART_TTL_DAYS=30', 'LOG_LEVEL=debug', 'NEW_CHECKOUT_URL=https://pay.example.test'],
      ],
      ['production', ['CART_TTL_DAYS=30', 'LOG_LEVEL=info']],
    ]);
  });

  it('compares two environments key by key, secrets without their values', async () => {
    const d = await diff();
    expect(d.rows.map((r) => [r.area, r.name, r.a, r.b, r.state])).toEqual([
      ['version', 'deployed', 'v1.3.0', 'v1.2.0', 'different'],
      ['variable', 'CART_TTL_DAYS', '30', '30', 'same'],
      ['variable', 'LOG_LEVEL', 'debug', 'info', 'different'],
      ['variable', 'NEW_CHECKOUT_URL', 'https://pay.example.test', null, 'only_a'],
      ['secret', 'DATABASE_URL', 'set', 'set', 'different'],
      ['secret', 'SENTRY_DSN', 'set', null, 'only_a'],
      ['secret', 'STRIPE_KEY', 'set', 'set', 'same'],
      ['setting', 'dir', '"/srv/staging"', '"/srv/shop"', 'different'],
      ['setting', 'file', '"compose.yaml"', '"compose.yaml"', 'same'],
      ['flag', 'dark-mode', 'on', 'on', 'same'],
      ['flag', 'new-checkout', 'on', 'off', 'different'],
    ]);
    expect(JSON.stringify(d)).not.toContain('sk_test_same');
    expect(JSON.stringify(d)).not.toContain('postgres://');
    expect(d.drift).toBe('2 only in Staging, 5 different.');
  });

  it('leaves out what is meant to differ', async () => {
    const mark = (area: string, name: string, who: Person = ada) =>
      t.call<{ expected: string[] }>(who, 'PUT', W('/projects/' + project + '/expected-diffs'), {
        area,
        name,
        expected: true,
      });
    expect((await mark('secret', 'DATABASE_URL', bob)).status).toBe(403);
    await mark('secret', 'DATABASE_URL');
    await mark('setting', 'dir');
    const last = await mark('variable', 'LOG_LEVEL');
    expect(last.body.expected).toEqual([
      'secret:DATABASE_URL',
      'setting:dir',
      'variable:LOG_LEVEL',
    ]);
    const d = await diff();
    expect(d.rows.filter((r) => r.expected).map((r) => r.key)).toEqual([
      'variable:LOG_LEVEL',
      'secret:DATABASE_URL',
      'setting:dir',
    ]);
    expect(d.drift).toBe('2 only in Staging, 2 different.');
  });

  it('keeps environments of other projects and workspaces out', async () => {
    const other = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'OPS', name: 'Ops' })
    ).body.id;
    const r = await t.call(
      ada,
      'GET',
      W(
        '/projects/' +
          other +
          '/env-diff?a=' +
          (env['staging'] ?? '') +
          '&b=' +
          (env['production'] ?? ''),
      ),
    );
    expect(r.status).toBe(404);
  });
});
