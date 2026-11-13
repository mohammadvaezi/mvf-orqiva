// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-191 | S15 | v0.1.0] B7.6 Client status page with uptime probes, own portal domains with DNS verification and on-demand TLS ──
//    Why:  the status page and own domains against the real database: a portal domain counts only once its
//          DNS record matches (a fake DNS here), the TLS proxy may only get certificates for verified names,
//          probes are recorded (a fake fetch here), and the client sees its components' state, 30 days of
//          uptime, the incidents reported to it and postmortems shared with it, nothing more.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { probeAll } from '../../src/api/status.js';
import { inSystem } from '../../src/db/pool.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

describe.skipIf(!hasDatabase)('status page and own domains (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let ines: Person;
  let client = '';
  let project = '';
  let env = '';
  const txt: Record<string, string[][]> = {};
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  const sys = (sql: string, args: unknown[] = []) => inSystem(t.db.pool, (c) => c.query(sql, args));

  beforeAll(async () => {
    t = await startTestApp({
      dns: {
        resolveTxt: (name: string) =>
          txt[name] ? Promise.resolve(txt[name]) : Promise.reject(new Error('ENOTFOUND')),
      },
    });
    ada = await t.signup('Ada');
    client = (
      await t.call<{ id: string }>(ada, 'POST', W('/clients'), {
        name: 'Helio',
        portalDomain: 'projects.helio.example',
      })
    ).body.id;
    project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'HEL', name: 'Helio app' })
    ).body.id;
    await t.call(ada, 'PUT', W('/projects/' + project + '/client'), { clientId: client });
    env = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects/' + project + '/environments'), {
        key: 'production',
        name: 'Production',
        kind: 'compose',
        settings: { dir: '/srv' },
      })
    ).body.id;
    const inv = await t.call<{ invitation: { token: string } }>(
      ada,
      'POST',
      W('/clients/' + client + '/contacts'),
      { email: 'ines@helio.example', portalRole: 'approver' },
    );
    const res = await fetch(t.base + '/auth/invitations/' + inv.body.invitation.token + '/accept', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Ines', password: 'a client password 1' }),
    });
    ines = {
      id: '',
      email: 'ines@helio.example',
      name: 'Ines',
      cookie: (res.headers.get('set-cookie') ?? '').split(';')[0] ?? '',
      workspaceId: ada.workspaceId,
    };
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('verifies a portal domain by its DNS record; only verified names get certificates', async () => {
    const d = await t.call<{ verified: boolean; record: { name: string; value: string } }>(
      ada,
      'GET',
      W('/clients/' + client + '/domain'),
    );
    expect(d.body.record.name).toBe('_orqiva.projects.helio.example');
    expect(d.body.record.value).toMatch(/^orqiva-verify=[0-9a-f]{32}$/);
    const allow = async (name: string) =>
      (await fetch(t.base + '/internal/tls/allow?domain=' + name)).status;
    expect(await allow('projects.helio.example')).toBe(404);
    expect(
      (
        await t.call<{ verified: boolean }>(
          ada,
          'POST',
          W('/clients/' + client + '/domain/verify'),
          {},
        )
      ).body.verified,
    ).toBe(false);
    txt['_orqiva.projects.helio.example'] = [['orqiva-verify=wrong']];
    const wrong = await t.call<{ verified: boolean; message: string }>(
      ada,
      'POST',
      W('/clients/' + client + '/domain/verify'),
      {},
    );
    expect(wrong.body).toMatchObject({
      verified: false,
      message: 'The record is there but holds another value',
    });
    txt['_orqiva.projects.helio.example'] = [[d.body.record.value]];
    expect(
      (
        await t.call<{ verified: boolean }>(
          ada,
          'POST',
          W('/clients/' + client + '/domain/verify'),
          {},
        )
      ).body.verified,
    ).toBe(true);
    expect(await allow('projects.helio.example')).toBe(200);
    expect(await allow('evil.example')).toBe(404);
    // a new domain starts unverified again
    await t.call(ada, 'PATCH', W('/clients/' + client), { portalDomain: 'portal.helio.example' });
    expect(await allow('portal.helio.example')).toBe(404);
    expect(await allow('projects.helio.example')).toBe(404);
  });

  it('records probes and shows the client its components, incidents and postmortems', async () => {
    expect(
      (
        await t.call(ada, 'POST', W('/clients/' + client + '/status-components'), {
          name: 'Booking service',
          probeUrl: 'http://10.0.0.5/health',
        })
      ).status,
    ).toBe(400);
    const app = (
      await t.call<{ id: string }>(ada, 'POST', W('/clients/' + client + '/status-components'), {
        name: 'Production app',
        environmentId: env,
      })
    ).body.id;
    const api = (
      await sys(
        "INSERT INTO status_components (workspace_id, client_id, name, probe_url, position) VALUES ($1, $2, 'Booking API', 'https://api.helio.example/health', 2) RETURNING id",
        [ada.workspaceId, client],
      )
    ).rows[0] as { id: string };
    // yesterday the API was down for a third of its probes
    await sys(
      `INSERT INTO status_checks (workspace_id, component_id, at, ok, latency_ms)
       SELECT $1, $2, ((date_trunc('day', now() AT TIME ZONE 'Europe/Berlin') - interval '12 hours') AT TIME ZONE 'Europe/Berlin') + make_interval(mins => g), g % 3 <> 0, 120 FROM generate_series(1, 30) g`,
      [ada.workspaceId, api.id],
    );
    const probed = await probeAll(t.db.pool, {
      isPublic: () => Promise.resolve(true),
      fetch: () => Promise.resolve(new Response('ok', { status: 200 })),
    });
    expect(probed).toBe(1);
    type Status = {
      incidents: { title: string; update: string }[];
      components: { name: string; state: string; uptimePct: number; days: { state: string }[] }[];
      postmortems: { title: string }[];
    };
    let s = (await t.call<Status>(ines, 'GET', W('/portal/status'))).body;
    expect(s.components.map((c) => [c.name, c.state])).toEqual([
      ['Production app', 'unknown'],
      ['Booking API', 'working'],
    ]);
    const bookingApi = s.components[1];
    expect(bookingApi?.days.at(-2)?.state).toBe('down');
    expect(bookingApi?.days.at(-1)?.state).toBe('ok');
    expect(bookingApi?.uptimePct).toBeCloseTo(((20 + 1) / 31) * 100, 1);
    expect(s.incidents).toEqual([]);
    // an incident on production, reported to the client
    const inc = (
      await t.call<{ id: string }>(ada, 'POST', W('/incidents'), {
        title: 'Booking slow',
        severity: 'sev2',
        projectId: project,
        environmentId: env,
      })
    ).body.id;
    s = (await t.call<Status>(ines, 'GET', W('/portal/status'))).body;
    expect(s.incidents).toEqual([]);
    await t.call(ada, 'POST', W('/incidents/' + inc + '/updates'), {
      audience: 'client',
      body: 'Booking is slow; we are on it.',
      nextUpdateMinutes: 30,
    });
    s = (await t.call<Status>(ines, 'GET', W('/portal/status'))).body;
    expect(s.incidents).toEqual([
      expect.objectContaining({ title: 'Booking slow', update: 'Booking is slow; we are on it.' }),
    ]);
    expect(s.components[0]?.state).toBe('down');
    await t.call(ada, 'PATCH', W('/incidents/' + inc), { state: 'resolved' });
    await t.call(ada, 'PUT', W('/incidents/' + inc + '/postmortem'), {
      text: '### What happened\n\nSlow.',
      shared: true,
    });
    s = (await t.call<Status>(ines, 'GET', W('/portal/status'))).body;
    expect(s.incidents).toEqual([]);
    expect(s.postmortems.map((p) => p.title)).toEqual(['Booking slow']);
    expect(app).toBeTruthy();
    // the team's component list is not for the client
    expect((await t.call(ines, 'GET', W('/clients/' + client + '/status-components'))).status).toBe(
      403,
    );
  });
});
