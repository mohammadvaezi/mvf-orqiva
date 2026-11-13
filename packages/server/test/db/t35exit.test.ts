// ── [PCODE-364 | S15 | v0.1.0] T35.8 T35 exit check, docs and sprint close ──
//    Why:  the T35 exit as one workspace's path against the real server. A member starts a project from
//          the template library and runs it as its lead; Cmd-K finds people and settings; a policy, tried
//          in a dry run, keeps vague tasks out of sprints; ideas arrive by mail, CI runs by API, and each
//          person's dates by a calendar link; a home fits its person; a Team licence holds the workspace to
//          the Team plan, and an Enterprise one publishes the SAML encryption certificate.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inSystem } from '../../src/db/pool.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { installLicence } from './licencehelper.js';
import { hasDatabase } from './testdb.js';

process.env['ORQIVA_SECRET_KEY'] = 'ef'.repeat(32);

describe.skipIf(!hasDatabase)('T35 exit: cross-cutting (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let bob: Person;
  let gus: Person;
  let project = '';
  let sprint = '';
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  const sys = (sql: string, args: unknown[] = []) => inSystem(t.db.pool, (c) => c.query(sql, args));

  beforeAll(async () => {
    t = await startTestApp();
    ada = await t.signup('Ada');
    bob = await t.signup('Bob');
    gus = await t.signup('Gus');
    await t.call(ada, 'POST', W('/members'), { email: bob.email, role: 'member' });
    await t.call(ada, 'POST', W('/members'), { email: gus.email, role: 'guest' });
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('starts a project from the library, run by its lead', async () => {
    const made = await t.call<{ projectId?: string }>(
      bob,
      'POST',
      W('/template-library/builtin:client-project/use'),
      { key: 'CLI', name: 'Client portal' },
    );
    expect(made.status).toBe(201);
    project = made.body.projectId ?? '';
    await sys(
      "INSERT INTO project_members (workspace_id, project_id, user_id, role) VALUES ($1, $2, $3, 'lead') ON CONFLICT (project_id, user_id) DO UPDATE SET role = 'lead'",
      [ada.workspaceId, project, bob.id],
    );
    expect(
      (await t.call(bob, 'POST', W('/projects/' + project + '/guests'), { userId: gus.id })).status,
    ).toBeLessThan(300);
    const setting = (scope: string, scopeId: string) =>
      t.call(bob, 'PUT', W('/settings/planning.sprint_weeks'), { scope, scopeId, value: 3 });
    expect((await setting('project', project)).status).toBe(200);
    expect((await setting('workspace', ada.workspaceId)).status).toBe(403);
  });

  it('finds people and settings with Cmd-K, for the team only', async () => {
    const found = await t.call<{ people: { name: string }[]; settings: { key: string }[] }>(
      ada,
      'GET',
      W('/search?q=sprint'),
    );
    expect(found.body.settings.map((s) => s.key)).toContain('planning.sprint_weeks');
    expect(
      (
        await t.call<{ people: { name: string }[] }>(ada, 'GET', W('/search?q=bob'))
      ).body.people.map((p) => p.name),
    ).toEqual(['Bob']);
    expect(
      (await t.call<{ settings: unknown[] }>(gus, 'GET', W('/search?q=sprint'))).body.settings,
    ).toEqual([]);
  });

  it('keeps vague tasks out of sprints once the policy is on, after a dry run', async () => {
    sprint = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects/' + project + '/sprints'), {
        name: 'Sprint 1',
        startDate: '2026-11-02',
        endDate: '2026-11-13',
      })
    ).body.id;
    await t.call(bob, 'POST', W('/projects/' + project + '/items'), {
      title: 'Vague task',
      sprintId: sprint,
    });
    const dry = await t.call<{ count: number }>(ada, 'POST', W('/workspace-policies/dry-run'), {
      rule: 'sprint_requires_criteria',
    });
    expect(dry.body.count).toBe(1);
    expect(
      (
        await t.call(ada, 'POST', W('/workspace-policies'), {
          rule: 'sprint_requires_criteria',
          state: 'on',
        })
      ).status,
    ).toBe(201);
    const refused = await t.call<{ error: { message: string } }>(
      bob,
      'POST',
      W('/projects/' + project + '/items'),
      { title: 'Still vague', sprintId: sprint },
    );
    expect(refused.status).toBe(409);
    expect(refused.body.error.message).toContain('acceptance criteria');
  });

  it('takes ideas by mail and CI runs by API, and gives each person their dates', async () => {
    const setup = await t.call<{ webhook: string }>(ada, 'PUT', W('/email-in'), {
      domain: 'in.example.test',
    });
    const address = (
      await t.call<{ address: string }>(ada, 'POST', W('/projects/' + project + '/email-ideas'))
    ).body.address;
    const hook = setup.body.webhook.startsWith('/')
      ? t.base + setup.body.webhook
      : setup.body.webhook;
    const mailed = await fetch(hook, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        from: 'Bob <' + bob.email + '>',
        to: address,
        subject: 'Status page for the client',
        text: 'They keep asking.',
      }),
    });
    expect(((await mailed.json()) as { outcome: string }).outcome).toBe('idea');

    const due = (
      await t.call<{ sequence: number }>(bob, 'POST', W('/projects/' + project + '/items'), {
        title: 'Ship the login',
        assigneeId: bob.id,
        dueDate: '2026-12-01',
      })
    ).body;
    const ci = await t.call<{ itemRefs: string[] }>(
      ada,
      'POST',
      W('/projects/' + project + '/ci-runs'),
      {
        externalId: 'gh-1',
        pipeline: 'build',
        status: 'failed',
        branch: 'feature/CLI-' + String(due.sequence) + '-login',
        sha: 'abcdef1',
        url: 'https://ci.example.test/1',
      },
    );
    expect(ci.body.itemRefs).toEqual(['CLI-' + String(due.sequence)]);
    expect(
      (
        await sys(
          "SELECT 1 FROM activity_events WHERE workspace_id = $1 AND object_type = 'ci_run'",
          [ada.workspaceId],
        )
      ).rowCount,
    ).toBe(1);

    const { url } = (await t.call<{ url: string }>(bob, 'POST', W('/calendar-feed'))).body;
    const ics = await (await fetch(t.base + new URL(url, 'http://x').pathname)).text();
    expect(ics).toContain('Ship the login');
  });

  it('gives a lead their home', async () => {
    const home = (await t.call<{ persona: string; widgets: string[] }>(ada, 'GET', W('/home')))
      .body;
    expect(home.persona).toBe('lead');
    expect(home.widgets.length).toBeGreaterThan(0);
  });

  it('holds a Team workspace to its plan, and publishes the SAML key on Enterprise', async () => {
    await installLicence(t, ada, { plan: 'team' });
    const refused = await t.call<{ error: { message: string } }>(ada, 'GET', W('/command-center'));
    expect(refused.status).toBe(403);
    expect(refused.body.error.message).toContain('Business plan');
    expect(
      (await t.call(ada, 'POST', W('/projects/' + project + '/test-cases'), { title: 'Login' }))
        .status,
    ).toBe(403);
    await installLicence(t, ada);
    expect((await t.call(ada, 'GET', W('/command-center'))).status).toBe(200);
    const meta = await (await fetch(t.base + '/auth/saml/' + ada.workspaceId + '/metadata')).text();
    expect(meta).toContain('<md:KeyDescriptor use="encryption">');
  });
});
