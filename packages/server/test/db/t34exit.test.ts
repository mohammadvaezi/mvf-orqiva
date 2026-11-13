// ── [PCODE-345 | S15 | v0.1.0] T34.4 T34 exit check, docs and sprint close ──
//    Why:  the T34 exit as one client's path against the real server, with the demo model. The client's
//          approver sees the portal home and votes on a request; an alert opens an incident that brings its
//          runbook; an update from a template reaches the client's public status page; the DevOps agent
//          drafts the postmortem whose actions become tasks; booked time warns and then stops the hour
//          budget; the breakdown and the DATEV file carry the hours; and an approved week is corrected
//          with a reason and goes back for approval.
import { fillUpdate, localDay, weekOf } from '@orqiva/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { demoProvider } from '../../src/agents/provider.js';
import { inSystem } from '../../src/db/pool.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

describe.skipIf(!hasDatabase)('T34 exit: clients, incidents, time (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let mo: Person;
  let ines: Person;
  let helio = '';
  let project = '';
  let incident = '';
  const today = localDay(new Date());
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  const sys = (sql: string, args: unknown[] = []) => inSystem(t.db.pool, (c) => c.query(sql, args));
  type Entry = { kind: string; title: string; detail: string };
  const inbox = async (who: Person, kind: string): Promise<Entry[]> =>
    (await t.call<{ items: Entry[] }>(who, 'GET', W('/inbox'))).body.items.filter(
      (i) => i.kind === kind,
    );

  beforeAll(async () => {
    t = await startTestApp({ agents: { provider: () => Promise.resolve(demoProvider()) } });
    ada = await t.signup('Ada');
    mo = await t.signup('Mo');
    await t.call(ada, 'POST', W('/members'), { email: mo.email, role: 'member' });
    helio = (await t.call<{ id: string }>(ada, 'POST', W('/clients'), { name: 'Helio' })).body.id;
    project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'HEL', name: 'Helio app' })
    ).body.id;
    await t.call(ada, 'PUT', W('/projects/' + project + '/client'), { clientId: helio });
    await sys(
      'INSERT INTO member_profiles (workspace_id, user_id, manager_id) VALUES ($1, $2, $3)',
      [ada.workspaceId, mo.id, ada.id],
    );
    // the client's approver accepts the invitation
    const inv = await t.call<{ invitation: { token: string } | null }>(
      ada,
      'POST',
      W('/clients/' + helio + '/contacts'),
      { email: 'ines@helio.example', portalRole: 'approver' },
    );
    const res = await fetch(
      t.base + '/auth/invitations/' + (inv.body.invitation?.token ?? '') + '/accept',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Ines', password: 'a client password 1' }),
      },
    );
    ines = {
      id: '',
      email: 'ines@helio.example',
      name: 'Ines',
      cookie: (res.headers.get('set-cookie') ?? '').split(';')[0] ?? '',
      workspaceId: ada.workspaceId,
    };
    ines.id = (await t.call<{ user: { id: string } }>(ines, 'GET', '/auth/me')).body.user.id;
    // a production component on the client's status page
    const env = (
      await sys(
        "INSERT INTO environments (workspace_id, project_id, key, name, kind) VALUES ($1, $2, 'prod', 'Production', 'compose') RETURNING id",
        [ada.workspaceId, project],
      )
    ).rows[0] as { id: string };
    const comp = (
      await sys(
        "INSERT INTO status_components (workspace_id, client_id, name, environment_id, probe_url) VALUES ($1, $2, 'Booking API', $3, 'https://x.example.test') RETURNING id",
        [ada.workspaceId, helio, env.id],
      )
    ).rows[0] as { id: string };
    await sys(
      'INSERT INTO status_checks (workspace_id, component_id, at, ok, latency_ms, code) VALUES ($1, $2, now(), false, 0, 503)',
      [ada.workspaceId, comp.id],
    );
  }, 90_000);

  afterAll(async () => {
    await t.stop();
  });

  it('shows the client its portal home and takes its vote', async () => {
    const home = await t.call<{ projects: { key: string }[] }>(ines, 'GET', W('/portal/home'));
    expect(home.status).toBe(200);
    expect(home.body.projects.map((p) => p.key)).toEqual(['HEL']);
    const req = await t.call<{ id: string }>(ines, 'POST', W('/client-requests'), {
      kind: 'feature',
      title: 'Booking reminders by text message',
      projectId: project,
    });
    const voted = await t.call<{ votes: number }>(
      ines,
      'POST',
      W('/client-requests/' + req.body.id + '/vote'),
    );
    expect(voted.body.votes).toBe(1);
  });

  it('opens an incident from an alert, with its runbook, and tells the public status page', async () => {
    await t.call(ada, 'POST', W('/runbooks'), {
      title: 'Booking API down',
      pattern: 'booking api',
      body: '1. Check the database\n2. Roll back the last deploy',
    });
    const hot = await t.call<{ incidentId: string }>(ada, 'POST', W('/alerts'), {
      source: 'alertmanager',
      key: 'booking-down',
      severity: 'sev1',
      title: 'Booking API returns 503',
      projectKey: 'HEL',
      environment: 'prod',
    });
    incident = hot.body.incidentId;
    const d = (
      await t.call<{ timeline: { text: string }[] }>(ada, 'GET', W('/incidents/' + incident))
    ).body;
    expect(d.timeline.map((x) => x.text)).toContain('Runbook: Booking API down');
    // the update starts from the built-in template
    const templates = (
      await t.call<{ name: string; body: string }[]>(mo, 'GET', W('/incident-templates'))
    ).body;
    const words = fillUpdate(templates.find((x) => x.name === 'Investigating')?.body ?? '', {
      title: 'Booking API returns 503',
      severity: 'SEV-1',
      state: 'investigating',
      next: '14:30',
      product: 'HEL Production',
    });
    expect(words).toContain('HEL Production');
    expect(
      (
        await t.call(mo, 'POST', W('/incidents/' + incident + '/updates'), {
          body: words,
          audience: 'client',
          nextUpdateMinutes: 30,
        })
      ).status,
    ).toBeLessThan(300);
    await t.call(ada, 'PUT', W('/clients/' + helio + '/status-page'), {
      public: true,
      slug: 'helio',
    });
    const page = (await (await fetch(t.base + '/api/public/status/helio')).json()) as {
      components: { name: string; state: string }[];
      incidents: { update: string }[];
      postmortems?: unknown;
    };
    expect(page.components).toEqual([
      expect.objectContaining({ name: 'Booking API', state: 'down' }),
    ]);
    expect(page.incidents[0]?.update).toBe(words);
    expect(page.postmortems).toBeUndefined();
  });

  it('has the DevOps agent draft the postmortem, whose actions become tasks', async () => {
    await t.call(ada, 'PATCH', W('/incidents/' + incident), { state: 'resolved' });
    const pm = await t.call<{ postmortem: string; postmortemActions: { text: string }[] }>(
      mo,
      'PUT',
      W('/incidents/' + incident + '/postmortem'),
      { ai: true },
    );
    expect(pm.body.postmortem).toContain('### Why');
    expect(pm.body.postmortemActions.length).toBeGreaterThanOrEqual(3);
    const made = await t.call<{ created: number }>(
      mo,
      'POST',
      W('/incidents/' + incident + '/postmortem/tasks'),
      {},
    );
    expect(made.body.created).toBe(pm.body.postmortemActions.length);
  });

  it('warns and stops the hour budget, and bills the hours to DATEV', async () => {
    await t.call(ada, 'POST', W('/time/rates'), {
      scopeType: 'client',
      scopeKey: helio,
      kind: 'billable',
      centsPerHour: 12000,
      validFrom: '2026-01-01',
    });
    await t.call(ada, 'PUT', W('/time/hour-budgets'), {
      scopeType: 'client',
      scopeId: helio,
      period: 'month',
      hours: 4,
    });
    const book = (minutes: number, extra: Record<string, unknown> = {}) =>
      t.call(mo, 'PUT', W('/time/cell'), {
        day: today,
        minutes,
        projectId: project,
        label: 'Incident follow-up',
        billable: true,
        ...extra,
      });
    await book(210);
    expect((await inbox(ada, 'budget')).map((x) => x.title)).toEqual([
      'Helio: 88 % of the hour budget',
    ]);
    await book(270);
    expect((await inbox(ada, 'budget')).map((x) => x.title)).toContain(
      'Helio: hour budget used up',
    );
    const by = (
      await t.call<{ rows: { label: string; minutes: number; cents: number }[] }>(
        ada,
        'GET',
        W('/time/breakdown?from=' + today + '&to=' + today + '&by=client'),
      )
    ).body.rows;
    expect(by).toEqual([expect.objectContaining({ label: 'Helio', minutes: 270, cents: 54000 })]);
    await t.call(ada, 'PUT', W('/clients/' + helio + '/datev-account'), { account: '10007' });
    const datev = await fetch(
      t.base +
        W(
          '/time/datev.csv?from=' +
            today +
            '&to=' +
            today +
            '&revenueAccount=8400&consultant=1001&client=1',
        ),
      { headers: { cookie: ada.cookie } },
    );
    expect((await datev.text()).split('\r\n')[2]).toMatch(/^540,00;"S";"EUR";;;;10007;8400;/);
  });

  it('corrects the approved week with a reason and sends it back for approval', async () => {
    const week = weekOf(today);
    await t.call(mo, 'POST', W('/time/week/submit'), { week });
    await t.call(ada, 'POST', W('/time/approvals/decision'), {
      userId: mo.id,
      week,
      decision: 'approved',
    });
    expect(
      (
        await t.call(mo, 'PUT', W('/time/cell'), {
          day: today,
          minutes: 240,
          projectId: project,
          label: 'Incident follow-up',
          reason: 'Half an hour was internal',
        })
      ).status,
    ).toBe(200);
    const w = (
      await t.call<{ state: string; corrections: { before: number; after: number }[] }>(
        mo,
        'GET',
        W('/time/week?week=' + week),
      )
    ).body;
    expect(w.state).toBe('submitted');
    expect(w.corrections).toEqual([expect.objectContaining({ before: 270, after: 240 })]);
    expect((await inbox(ada, 'approval')).map((x) => x.title)).toContain(
      'A locked week was corrected',
    );
  });
});
