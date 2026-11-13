// ── [PCODE-340 | S15 | v0.1.0] T34.2a Automatic alerts from probes and failed deploys; Sentry and Alertmanager sources with signed webhooks ──
//    Why:  against the real database: a component down for three probes raises a SEV-2 alert and an
//          incident by itself and the first good probe clears the alert; a failed production deploy
//          alerts and the next good one clears it; Alertmanager needs its bearer token and Sentry its
//          signature, and their alerts open, group and clear like every alert.
import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deployAlert } from '../../src/api/monitoring.js';
import { probeAll } from '../../src/api/status.js';
import { inSystem, inWorkspace } from '../../src/db/pool.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

process.env['ORQIVA_SECRET_KEY'] = 'ab'.repeat(32);

describe.skipIf(!hasDatabase)('alerts that raise themselves (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let project = '';
  let env = '';
  let component = '';
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  const sys = <T>(sql: string, args: unknown[] = []): Promise<T[]> =>
    inSystem(t.db.pool, async (c) => (await c.query(sql, args)).rows as T[]);
  const alertsOf = (key: string) =>
    sys<{ status: string; severity: string; incident_id: string | null; count: number }>(
      'SELECT status, severity, incident_id, count FROM alerts WHERE dedupe_key = $1 ORDER BY first_at',
      [key],
    );

  beforeAll(async () => {
    t = await startTestApp();
    ada = await t.signup('Ada');
    project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'MON', name: 'Monitored' })
    ).body.id;
    const client = (await t.call<{ id: string }>(ada, 'POST', W('/clients'), { name: 'Helio' }))
      .body.id;
    env =
      (
        await sys<{ id: string }>(
          "INSERT INTO environments (workspace_id, project_id, key, name, kind) VALUES ($1, $2, 'prod', 'Production', 'compose') RETURNING id",
          [ada.workspaceId, project],
        )
      )[0]?.id ?? '';
    component =
      (
        await sys<{ id: string }>(
          "INSERT INTO status_components (workspace_id, client_id, name, environment_id, probe_url) VALUES ($1, $2, 'Booking API', $3, 'https://booking.example.test/health') RETURNING id",
          [ada.workspaceId, client, env],
        )
      )[0]?.id ?? '';
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('raises an alert after three failed probes and clears it at the first good one', async () => {
    let status = 503;
    const deps = {
      fetch: () => Promise.resolve(new Response('', { status })),
      isPublic: () => Promise.resolve(true),
    };
    await probeAll(t.db.pool, deps);
    await probeAll(t.db.pool, deps);
    expect(await alertsOf('probe:' + component)).toEqual([]);
    await probeAll(t.db.pool, deps);
    const [down] = await alertsOf('probe:' + component);
    expect(down).toMatchObject({ status: 'open', severity: 'sev2' });
    expect(down?.incident_id).not.toBeNull();
    const inc = (
      await sys<{ title: string; declared_by: string | null; project_id: string }>(
        'SELECT title, declared_by, project_id FROM incidents WHERE id = $1',
        [down?.incident_id],
      )
    )[0];
    expect(inc).toEqual({
      title: 'Booking API is not answering',
      declared_by: null,
      project_id: project,
    });
    await probeAll(t.db.pool, deps);
    expect((await alertsOf('probe:' + component))[0]?.count).toBe(2);
    status = 200;
    await probeAll(t.db.pool, deps);
    expect((await alertsOf('probe:' + component))[0]?.status).toBe('resolved');
  });

  it('alerts on a failed production deploy and clears it with the next good one', async () => {
    const d = {
      id: '00000000-0000-4000-8000-0000000000aa',
      project_id: project,
      environment_id: env,
      environment_name: 'Production',
      project_key: 'MON',
    };
    await inWorkspace(t.db.pool, ada.workspaceId, (c) =>
      deployAlert(c, ada.workspaceId, d, 'failed', 'health check timed out'),
    );
    expect((await alertsOf('deploy:' + env))[0]).toMatchObject({
      status: 'open',
      severity: 'sev2',
    });
    await inWorkspace(t.db.pool, ada.workspaceId, (c) =>
      deployAlert(c, ada.workspaceId, d, 'succeeded', ''),
    );
    expect((await alertsOf('deploy:' + env))[0]?.status).toBe('resolved');
  });

  it('takes Alertmanager’s alerts with its token and Sentry’s with its signature', async () => {
    const am = await t.call<{ source: { id: string; url: string }; secret: string }>(
      ada,
      'POST',
      W('/alert-sources'),
      {
        kind: 'alertmanager',
        name: 'Prometheus',
        projectId: project,
      },
    );
    expect(am.status).toBe(201);
    expect(am.body.source.url).toMatch(/\/hooks\/alerts\/[0-9a-f-]{36}$/);
    const hook = (id: string, body: unknown, headers: Record<string, string>) =>
      fetch(t.base + '/hooks/alerts/' + id, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: typeof body === 'string' ? body : JSON.stringify(body),
      });
    const firing = {
      alerts: [
        {
          status: 'firing',
          labels: { alertname: 'HighErrorRate', severity: 'critical' },
          annotations: { summary: 'Errors above 5 %' },
          fingerprint: 'fp1',
        },
      ],
    };
    expect((await hook(am.body.source.id, firing, {})).status).toBe(401);
    expect(
      (await hook(am.body.source.id, firing, { authorization: 'Bearer wrong-token-xxxxxxxx' }))
        .status,
    ).toBe(401);
    const ok = await hook(am.body.source.id, firing, { authorization: 'Bearer ' + am.body.secret });
    expect(ok.status).toBe(202);
    const [a] = await alertsOf('am:fp1');
    expect(a).toMatchObject({ status: 'open', severity: 'sev1' });
    expect(a?.incident_id).not.toBeNull();
    await hook(
      am.body.source.id,
      { alerts: [{ ...firing.alerts[0], status: 'resolved' }] },
      { authorization: 'Bearer ' + am.body.secret },
    );
    expect((await alertsOf('am:fp1'))[0]?.status).toBe('resolved');

    const secret = 'sentry-client-secret-0123456789';
    const sentry = await t.call<{ source: { id: string } }>(ada, 'POST', W('/alert-sources'), {
      kind: 'sentry',
      name: 'Sentry',
      secret,
    });
    const body = JSON.stringify({
      action: 'created',
      data: { issue: { id: '99', title: 'TypeError in checkout', level: 'error' } },
    });
    expect(
      (await hook(sentry.body.source.id, body, { 'sentry-hook-signature': 'f'.repeat(64) })).status,
    ).toBe(401);
    const signed = await hook(sentry.body.source.id, body, {
      'sentry-hook-signature': createHmac('sha256', secret).update(body).digest('hex'),
    });
    expect(signed.status).toBe(202);
    expect((await alertsOf('sentry:99'))[0]).toMatchObject({
      status: 'open',
      severity: 'sev3',
      incident_id: null,
    });
    const list = await t.call<{ name: string; received: number }[]>(
      ada,
      'GET',
      W('/alert-sources'),
    );
    expect(list.body.map((s) => [s.name, s.received])).toEqual([
      ['Prometheus', 2],
      ['Sentry', 1],
    ]);
    expect(JSON.stringify(list.body)).not.toContain(am.body.secret);
  });
});
