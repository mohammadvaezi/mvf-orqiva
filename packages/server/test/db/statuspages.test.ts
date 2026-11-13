// ── [PCODE-341 | S15 | v0.1.0] T34.2b Public status pages per client and environment; incident update templates ──
//    Why:  against the real database: a client's status page opens to everyone at its short name and
//          closes again, shows its components by environment (one environment when asked) with the
//          incidents reported to the client but no postmortems; and update templates come built in and
//          can be replaced and added by an admin.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fillUpdate } from '@orqiva/shared';
import { inSystem } from '../../src/db/pool.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

process.env['ORQIVA_SECRET_KEY'] = 'ab'.repeat(32);

describe.skipIf(!hasDatabase)('status pages and update templates (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let bob: Person;
  let helio = '';
  let project = '';
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  const sys = <T>(sql: string, args: unknown[] = []): Promise<T[]> =>
    inSystem(t.db.pool, async (c) => (await c.query(sql, args)).rows as T[]);
  const pub = (path: string) => fetch(t.base + path);

  beforeAll(async () => {
    t = await startTestApp();
    ada = await t.signup('Ada');
    bob = await t.signup('Bob');
    await t.call(ada, 'POST', W('/members'), { email: bob.email, role: 'member' });
    helio = (await t.call<{ id: string }>(ada, 'POST', W('/clients'), { name: 'Helio' })).body.id;
    project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'HEL', name: 'Helio app' })
    ).body.id;
    await t.call(ada, 'PUT', W('/projects/' + project + '/client'), { clientId: helio });
    const ws = ada.workspaceId;
    const env = async (key: string, name: string) =>
      (
        await sys<{ id: string }>(
          "INSERT INTO environments (workspace_id, project_id, key, name, kind) VALUES ($1, $2, $3, $4, 'compose') RETURNING id",
          [ws, project, key, name],
        )
      )[0]?.id ?? '';
    const prod = await env('prod', 'Production');
    const stage = await env('stage', 'Staging');
    for (const [name, e] of [
      ['Booking API', prod],
      ['Booking API (test)', stage],
    ] as const) {
      const id = (
        await sys<{ id: string }>(
          "INSERT INTO status_components (workspace_id, client_id, name, environment_id, probe_url) VALUES ($1, $2, $3, $4, 'https://x.example.test') RETURNING id",
          [ws, helio, name, e],
        )
      )[0]?.id;
      await sys(
        'INSERT INTO status_checks (workspace_id, component_id, at, ok, latency_ms, code) VALUES ($1, $2, now(), true, 120, 200)',
        [ws, id],
      );
    }
    const inc = (
      await sys<{ id: string }>(
        "INSERT INTO incidents (workspace_id, number, project_id, environment_id, severity, title, postmortem, postmortem_shared) VALUES ($1, 1, $2, $3, 'sev3', 'Slow bookings', 'internal notes', true) RETURNING id",
        [ws, project, prod],
      )
    )[0]?.id;
    await sys(
      "INSERT INTO incident_updates (workspace_id, incident_id, audience, body) VALUES ($1, $2, 'client', 'We are looking into slow bookings.')",
      [ws, inc],
    );
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('opens a client’s status page to everyone, one environment when asked', async () => {
    expect((await pub('/api/public/status/helio')).status).toBe(404);
    expect(
      (
        await t.call(bob, 'PUT', W('/clients/' + helio + '/status-page'), {
          public: true,
          slug: 'helio',
        })
      ).status,
    ).toBe(403);
    expect(
      (await t.call(ada, 'PUT', W('/clients/' + helio + '/status-page'), { public: true })).status,
    ).toBe(400);
    const open = await t.call<{ public: boolean; slug: string }>(
      ada,
      'PUT',
      W('/clients/' + helio + '/status-page'),
      {
        public: true,
        slug: 'helio',
      },
    );
    expect(open.body).toEqual({ public: true, slug: 'helio' });
    type Page = {
      name: string;
      components: { name: string; environment: string; state: string }[];
      incidents: { title: string; update: string }[];
      postmortems?: unknown;
    };
    const r = await pub('/api/public/status/helio');
    expect(r.status).toBe(200);
    const page = (await r.json()) as Page;
    expect(page.name).toBe('Helio');
    expect(page.components.map((c) => [c.name, c.environment, c.state])).toEqual([
      ['Booking API', 'Production', 'slow'],
      ['Booking API (test)', 'Staging', 'working'],
    ]);
    expect(page.incidents).toEqual([
      expect.objectContaining({
        title: 'Slow bookings',
        update: 'We are looking into slow bookings.',
      }),
    ]);
    expect(page.postmortems).toBeUndefined();
    const staging = (await (
      await pub('/api/public/status/helio?environment=stage')
    ).json()) as Page;
    expect(staging.components.map((c) => c.name)).toEqual(['Booking API (test)']);
    // another client cannot take the name; closed, the page is gone
    const other = (await t.call<{ id: string }>(ada, 'POST', W('/clients'), { name: 'Aurum' })).body
      .id;
    expect(
      (
        await t.call(ada, 'PUT', W('/clients/' + other + '/status-page'), {
          public: true,
          slug: 'helio',
        })
      ).status,
    ).toBe(409);
    await t.call(ada, 'PUT', W('/clients/' + helio + '/status-page'), { public: false });
    expect((await pub('/api/public/status/helio')).status).toBe(404);
  });

  it('offers the built-in update templates and the workspace’s own', async () => {
    type T = { id: string | null; name: string; body: string; builtIn: boolean };
    const first = (await t.call<T[]>(bob, 'GET', W('/incident-templates'))).body;
    expect(first.map((x) => x.name)).toEqual([
      'Investigating',
      'Identified',
      'Monitoring',
      'Resolved',
    ]);
    expect(
      (
        await t.call(bob, 'PUT', W('/incident-templates'), {
          name: 'x',
          audience: 'team',
          body: 'y',
        })
      ).status,
    ).toBe(403);
    await t.call(ada, 'PUT', W('/incident-templates'), {
      name: 'Resolved',
      audience: 'client',
      body: '{{product}} is back. Sorry.',
    });
    await t.call(ada, 'PUT', W('/incident-templates'), {
      name: 'Maintenance',
      audience: 'client',
      body: 'Planned work on {{product}}.',
    });
    const list = (await t.call<T[]>(bob, 'GET', W('/incident-templates'))).body;
    expect(list.map((x) => [x.name, x.builtIn])).toEqual([
      ['Investigating', true],
      ['Identified', true],
      ['Monitoring', true],
      ['Maintenance', false],
      ['Resolved', false],
    ]);
    const own = list.find((x) => x.name === 'Resolved');
    expect(
      fillUpdate(own?.body ?? '', {
        title: 't',
        severity: 's',
        state: 'resolved',
        next: '',
        product: 'Booking',
      }),
    ).toBe('Booking is back. Sorry.');
    await t.call(ada, 'DELETE', W('/incident-templates/' + (own?.id ?? '')));
    expect(
      (await t.call<T[]>(bob, 'GET', W('/incident-templates'))).body.find(
        (x) => x.name === 'Resolved',
      )?.builtIn,
    ).toBe(true);
  });
});
