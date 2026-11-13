// ── [PCODE-342 | S15 | v0.1.0] T34.2c AI postmortems and runbooks matched to incidents ──
//    Why:  against the real database: admins keep runbooks; an alert that opens an incident puts the
//          runbooks its words match (its project's or general ones, not another project's) on the timeline
//          once; the incident lists them; and the DevOps agent (the demo model) drafts a postmortem in the
//          asked sections whose "Actions" become its actions, refused for an incident without a project.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { demoProvider } from '../../src/agents/provider.js';
import { inSystem } from '../../src/db/pool.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

describe.skipIf(!hasDatabase)('runbooks and AI postmortems (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let bob: Person;
  let incident = '';
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  type Detail = { timeline: { kind: string; text: string }[] };

  beforeAll(async () => {
    t = await startTestApp({ agents: { provider: () => Promise.resolve(demoProvider()) } });
    ada = await t.signup('Ada');
    bob = await t.signup('Bob');
    await t.call(ada, 'POST', W('/members'), { email: bob.email, role: 'member' });
    await t.call(ada, 'POST', W('/projects'), { key: 'RB', name: 'Runbook app' });
    const other = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'OT', name: 'Other app' })
    ).body.id;
    const rb = (body: Record<string, unknown>) => t.call(ada, 'POST', W('/runbooks'), body);
    expect(
      (await t.call(bob, 'POST', W('/runbooks'), { title: 'x', pattern: 'xx', body: 'y' })).status,
    ).toBe(403);
    expect(
      (
        await rb({
          title: 'Disk full',
          pattern: 'disk full, no space left',
          body: '1. Clear old logs\n2. Grow the volume',
        })
      ).status,
    ).toBe(201);
    await rb({ title: 'Other disk', pattern: 'space', body: 'Not for RB.', projectId: other });
    await rb({ title: 'Certificates', pattern: 'certificate expired', body: 'Renew it.' });
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('notes the matching runbooks on the timeline once, and lists them on the incident', async () => {
    const hot = await t.call<{ incidentId: string }>(ada, 'POST', W('/alerts'), {
      source: 'prometheus',
      key: 'db-disk',
      severity: 'sev2',
      title: 'No space left on device on db-1',
      projectKey: 'RB',
    });
    incident = hot.body.incidentId;
    expect(incident).toBeTruthy();
    // a second alert joins the same incident; the runbook is not noted again
    await t.call(ada, 'POST', W('/alerts'), {
      source: 'prometheus',
      key: 'db-disk-2',
      severity: 'sev2',
      title: 'Disk full on db-2',
      projectKey: 'RB',
    });
    const d = (await t.call<Detail>(ada, 'GET', W('/incidents/' + incident))).body;
    expect(d.timeline.filter((e) => e.text.startsWith('Runbook: ')).map((e) => e.text)).toEqual([
      'Runbook: Disk full',
    ]);
    const list = (
      await t.call<{ title: string }[]>(bob, 'GET', W('/incidents/' + incident + '/runbooks'))
    ).body;
    expect(list.map((x) => x.title)).toEqual(['Disk full']);
    expect((await t.call<unknown[]>(bob, 'GET', W('/runbooks'))).body).toHaveLength(3);
  });

  it('has the DevOps agent draft the postmortem with its actions', async () => {
    const r = await t.call<{ postmortem: string; postmortemActions: { text: string }[] }>(
      bob,
      'PUT',
      W('/incidents/' + incident + '/postmortem'),
      { ai: true },
    );
    expect(r.status).toBe(200);
    for (const h of [
      '### What happened',
      '### Timeline (UTC)',
      '### Why',
      '### Impact',
      '### Actions',
    ])
      expect(r.body.postmortem).toContain(h);
    expect(r.body.postmortem).toContain('Runbook: Disk full');
    expect(r.body.postmortemActions.map((a) => a.text)).toContain(
      'Write a runbook for this problem',
    );
    // without a project there is nothing for the agent to work in
    const loose = await inSystem(
      t.db.pool,
      async (c) =>
        (
          await c.query<{ id: string }>(
            "INSERT INTO incidents (workspace_id, number, severity, title) VALUES ($1, 99, 'sev3', 'Loose') RETURNING id",
            [ada.workspaceId],
          )
        ).rows[0]?.id,
    );
    expect(
      (await t.call(bob, 'PUT', W('/incidents/' + (loose ?? '') + '/postmortem'), { ai: true }))
        .status,
    ).toBe(409);
  });
});
