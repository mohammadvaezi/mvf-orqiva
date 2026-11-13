// ── [PCODE-245 | S15 | v0.1.0] Incident page not delivered when the on-call person's own token raised the alert ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-188 | S15 | v0.1.0] B7.4 Incidents and on-call live: alerts, incidents with timeline and roles, suspect deploys and rollback, status updates, rotations and escalation, postmortems, SLOs ──
//    Why:  incidents against the real database: alerts group by key and a SEV-2 opens an incident that
//          pages whoever is on call; nobody acknowledging pages the backup; the timeline, roles, updates,
//          suspect deploys and a rollback work; the postmortem is drafted and its actions become tasks;
//          rotations honour swaps and leave; reliability counts it all; a client contact sees none of it.
import { onCallAt } from '@orqiva/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { escalateDue } from '../../src/api/incidents.js';
import { inSystem } from '../../src/db/pool.js';
import { pumpWorkspace, vapidKeys } from '../../src/push/dispatch.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

process.env['ORQIVA_SECRET_KEY'] ??= '7d'.repeat(32);

describe.skipIf(!hasDatabase)('incidents and on-call (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let mo: Person;
  let lu: Person;
  let project = '';
  let env = '';
  let goodDeploy = '';
  let badDeploy = '';
  let incident = '';
  let schedule = '';
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  const sys = (sql: string, args: unknown[] = []) => inSystem(t.db.pool, (c) => c.query(sql, args));
  const today = new Date().toISOString().slice(0, 10);
  const startsOn = new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10);
  const rotation = () => ({
    memberIds: [mo.id, lu.id],
    rotationDays: 1,
    handoffTime: '09:00',
    timezone: 'Europe/Berlin',
    startsOn,
  });
  const inbox = async (p: Person): Promise<string[]> =>
    (
      await sys('SELECT title FROM inbox_items WHERE user_id = $1 ORDER BY created_at', [p.id])
    ).rows.map((r) => (r as { title: string }).title);
  const pump = () =>
    pumpWorkspace(t.db.pool, ada.workspaceId, {
      subject: 'mailto:ops@example.test',
      keys: () => vapidKeys(t.db.pool),
    });
  type Detail = {
    incident: {
      ref: string;
      state: string;
      severity: string;
      acknowledgedAt: string | null;
      commander: { name: string } | null;
    };
    timeline: { kind: string; text: string }[];
    suspects: { id: string; ref: string; likelihood: string }[];
    updates: { audience: string; body: string }[];
  };

  beforeAll(async () => {
    t = await startTestApp();
    ada = await t.signup('Ada');
    mo = await t.signup('Mo');
    lu = await t.signup('Lu');
    for (const p of [mo, lu])
      await t.call(ada, 'POST', W('/members'), { email: p.email, role: 'member' });
    project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'HEL', name: 'Helio app' })
    ).body.id;
    env = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects/' + project + '/environments'), {
        key: 'staging',
        name: 'Staging',
        kind: 'compose',
        settings: { dir: '/srv' },
      })
    ).body.id;
    goodDeploy = (
      (
        await sys(
          "INSERT INTO deploy_runs (workspace_id, project_id, environment_id, status, ref, created_at) VALUES ($1, $2, $3, 'succeeded', '2.0.0-rc.2', now() - interval '2 days') RETURNING id",
          [ada.workspaceId, project, env],
        )
      ).rows[0] as { id: string }
    ).id;
    badDeploy = (
      (
        await sys(
          "INSERT INTO deploy_runs (workspace_id, project_id, environment_id, status, ref, created_at) VALUES ($1, $2, $3, 'succeeded', '2.0.0-rc.3', now() - interval '28 minutes') RETURNING id",
          [ada.workspaceId, project, env],
        )
      ).rows[0] as { id: string }
    ).id;
    schedule = (
      await t.call<{ id: string }>(ada, 'POST', W('/oncall'), {
        name: 'Product engineering',
        memberIds: [mo.id, lu.id],
        rotationDays: 1,
        startsOn,
        escalation: [
          { afterMinutes: 10, target: 'backup' },
          { afterMinutes: 20, target: 'admins' },
        ],
      })
    ).body.id;
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('groups alerts by key; a SEV-2 opens an incident and pages whoever is on call', async () => {
    const low = await t.call<{ incidentId: string | null; count: number }>(
      mo,
      'POST',
      W('/alerts'),
      {
        source: 'prometheus',
        key: 'disk-80',
        severity: 'sev3',
        title: 'Disk 80 % full',
        projectKey: 'HEL',
      },
    );
    expect(low.body).toMatchObject({ incidentId: null, count: 1 });
    const again = await t.call<{ count: number }>(mo, 'POST', W('/alerts'), {
      source: 'prometheus',
      key: 'disk-80',
      severity: 'sev3',
      title: 'Disk 80 % full',
    });
    expect(again.body.count).toBe(2);
    // [PCODE-245 | S15 | v0.1.0] the person on call raises it with their own token, and is paged all the same
    const onCall = onCallAt(rotation(), new Date()).primary === mo.id ? mo : lu;
    const hot = await t.call<{ incidentId: string }>(onCall, 'POST', W('/alerts'), {
      source: 'prometheus',
      key: 'booking-p95',
      severity: 'sev2',
      title: 'Booking API p95 above 3 s',
      projectKey: 'HEL',
      environment: 'staging',
    });
    incident = hot.body.incidentId;
    expect(incident).toBeTruthy();
    const d = (await t.call<Detail>(ada, 'GET', W('/incidents/' + incident))).body;
    expect(d.incident).toMatchObject({
      ref: 'INC-1',
      severity: 'sev2',
      state: 'investigating',
      commander: null,
    });
    expect(d.timeline.map((e) => e.kind)).toEqual(['declared', 'escalated', 'alert']);
    expect(d.suspects[0]).toMatchObject({ id: badDeploy, likelihood: 'likely' });
    expect(d.suspects[1]).toBeUndefined();
    await pump();
    const primary = onCallAt(rotation(), new Date()).primary === mo.id ? mo : lu;
    expect(await inbox(primary)).toEqual(['You are paged: INC-1 SEV-2 Booking API p95 above 3 s']);
  });

  it('pages the backup when nobody acknowledges, and stops after the acknowledgement', async () => {
    await sys("UPDATE incidents SET declared_at = now() - interval '11 minutes' WHERE id = $1", [
      incident,
    ]);
    expect(await escalateDue(t.db.pool)).toBe(1);
    expect(await escalateDue(t.db.pool)).toBe(0);
    await pump();
    const backup = onCallAt(rotation(), new Date()).backup === mo.id ? mo : lu;
    expect(await inbox(backup)).toContain('You are paged: INC-1 SEV-2 Booking API p95 above 3 s');
    const acked = await t.call<{ acknowledgedAt: string; commander: { name: string } }>(
      lu,
      'POST',
      W('/incidents/' + incident + '/ack'),
      {},
    );
    expect(acked.body.commander.name).toBe('Lu');
    expect((await t.call(mo, 'POST', W('/incidents/' + incident + '/ack'), {})).status).toBe(409);
    await sys("UPDATE incidents SET declared_at = now() - interval '25 minutes' WHERE id = $1", [
      incident,
    ]);
    expect(await escalateDue(t.db.pool)).toBe(0);
  });

  it('keeps roles, notes, updates for the team and the client, and rolls back', async () => {
    await t.call(lu, 'PATCH', W('/incidents/' + incident), {
      commsId: ada.id,
      state: 'identified',
    });
    await t.call(lu, 'POST', W('/incidents/' + incident + '/notes'), {
      text: 'Database waits on slot_lock; migration 0041 added no index',
    });
    expect(
      (
        await t.call(ada, 'POST', W('/incidents/' + incident + '/updates'), {
          audience: 'client',
          body: 'Booking is slow on the test environment.',
        })
      ).status,
    ).toBe(409);
    const client = (await t.call<{ id: string }>(ada, 'POST', W('/clients'), { name: 'Helio' }))
      .body.id;
    await t.call(ada, 'PUT', W('/projects/' + project + '/client'), { clientId: client });
    expect(
      (
        await t.call(ada, 'POST', W('/incidents/' + incident + '/updates'), {
          audience: 'client',
          body: 'Booking is slow on the test environment.',
          nextUpdateMinutes: 30,
        })
      ).status,
    ).toBe(201);
    const rb = await t.call<{ deployId: string; ref: string }>(
      lu,
      'POST',
      W('/incidents/' + incident + '/rollback'),
      { deployId: badDeploy },
    );
    expect(rb.status).toBe(201);
    expect(rb.body.ref).toBe('2.0.0-rc.2');
    const queued = (
      await sys('SELECT ref, trigger FROM deploy_runs WHERE id = $1', [rb.body.deployId])
    ).rows[0] as { ref: string; trigger: string };
    expect(queued).toEqual({ ref: '2.0.0-rc.2', trigger: 'rollback' });
    const d = (await t.call<Detail>(ada, 'GET', W('/incidents/' + incident))).body;
    expect(d.timeline.map((e) => e.kind)).toEqual(
      expect.arrayContaining(['ack', 'role', 'state', 'note', 'update', 'rollback']),
    );
    expect(d.suspects[0]?.likelihood).toBe('cause');
    expect(d.updates[0]).toMatchObject({ audience: 'client' });
    expect(goodDeploy).toBeTruthy();
  });

  it('resolves, drafts the postmortem and turns its actions into tasks', async () => {
    await t.call(lu, 'PATCH', W('/incidents/' + incident), { state: 'resolved' });
    expect(
      (
        await sys(
          "SELECT count(*)::int AS n FROM alerts WHERE incident_id = $1 AND status = 'open'",
          [incident],
        )
      ).rows[0],
    ).toEqual({ n: 0 });
    const drafted = await t.call<{ postmortem: string }>(
      lu,
      'PUT',
      W('/incidents/' + incident + '/postmortem'),
      { draft: true, actions: ['Index on slot_lock', 'Alert on lock waits'] },
    );
    expect(drafted.body.postmortem).toContain('### Timeline (UTC)');
    expect(drafted.body.postmortem).toContain('Rolling back to 2.0.0-rc.2');
    const made = await t.call<{
      created: number;
      incident: { postmortemActions: { itemRef: string }[] };
    }>(lu, 'POST', W('/incidents/' + incident + '/postmortem/tasks'), {});
    expect(made.body.created).toBe(2);
    expect(made.body.incident.postmortemActions.map((x) => x.itemRef)).toEqual(['HEL-1', 'HEL-2']);
    expect(
      (
        await t.call<{ created: number }>(
          lu,
          'POST',
          W('/incidents/' + incident + '/postmortem/tasks'),
          {},
        )
      ).body.created,
    ).toBe(0);
  });

  it('honours swaps and leave in the rotation', async () => {
    const now = onCallAt(rotation(), new Date());
    const other = now.primary === mo.id ? lu : mo;
    await t.call(other, 'POST', W('/oncall/' + schedule + '/shifts'), {
      userId: other.id,
      startsAt: new Date(Date.now() - 3_600_000).toISOString(),
      endsAt: new Date(Date.now() + 3_600_000).toISOString(),
      reason: 'swap with a dentist appointment',
    });
    type Sch = {
      schedules: { now: { primary: { id: string } }; days: { primary: { id: string } }[] }[];
    };
    expect((await t.call<Sch>(ada, 'GET', W('/oncall'))).body.schedules[0]?.now.primary.id).toBe(
      other.id,
    );
    expect(
      (
        await t.call(mo, 'POST', W('/oncall/' + schedule + '/shifts'), {
          userId: lu.id,
          startsAt: new Date().toISOString(),
          endsAt: new Date(Date.now() + 3_600_000).toISOString(),
        })
      ).status,
    ).toBe(403);
    // the person on call tomorrow takes the day off: the other one covers
    const tomorrow = new Date(Date.now() + 86_400_000);
    const day = tomorrow.toISOString().slice(0, 10);
    const planned = onCallAt(rotation(), new Date(day + 'T12:00:00Z')).primary;
    await sys(
      "INSERT INTO absences (workspace_id, user_id, starts_on, ends_on, kind, state) VALUES ($1, $2, $3, $3, 'holiday', 'approved')",
      [ada.workspaceId, planned, day],
    );
    const sch = (await t.call<Sch>(ada, 'GET', W('/oncall'))).body.schedules[0];
    expect(sch?.days[1]?.primary.id).not.toBe(planned);
    expect(today).toBeTruthy();
  });

  it('measures reliability and the error budget; clients see none of it', async () => {
    await t.call(ada, 'POST', W('/slos'), {
      projectId: project,
      name: 'HEL booking available',
      indicator: 'availability',
      objectivePct: 99.5,
    });
    const r = await t.call<{
      total: number;
      causedByDeploy: number;
      ackMinutes: number;
      bySeverity: { severity: string; count: number }[];
      slos: { name: string; budgetLeft: number }[];
    }>(ada, 'GET', W('/reliability'));
    expect(r.body).toMatchObject({ total: 1, causedByDeploy: 1 });
    expect(r.body.ackMinutes).toBeGreaterThan(10);
    expect(r.body.bySeverity.find((x) => x.severity === 'sev2')?.count).toBe(1);
    // 25 minutes down of 30 days at 99.5 % (216 minutes allowed): 88 % of the budget is left
    expect(r.body.slos[0]?.budgetLeft).toBeGreaterThan(87);
    expect(r.body.slos[0]?.budgetLeft).toBeLessThan(90);
    const helio = (await t.call<{ id: string }[]>(ada, 'GET', W('/clients'))).body[0]?.id ?? '';
    const inv = await t.call<{ invitation: { token: string } }>(
      ada,
      'POST',
      W('/clients/' + helio + '/contacts'),
      {
        email: 'ines@helio.example',
        portalRole: 'approver',
      },
    );
    const res = await fetch(t.base + '/auth/invitations/' + inv.body.invitation.token + '/accept', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Ines', password: 'a client password 1' }),
    });
    const ines: Person = {
      id: '',
      email: 'ines@helio.example',
      name: 'Ines',
      cookie: (res.headers.get('set-cookie') ?? '').split(';')[0] ?? '',
      workspaceId: ada.workspaceId,
    };
    expect((await t.call(ines, 'GET', W('/incidents'))).status).toBe(403);
    expect((await t.call(ines, 'GET', W('/incidents/' + incident))).status).toBe(403);
  });
});
