// ── [PCODE-251 | S15 | v0.1.0] T25.6 T25 exit check, docs and sprint close ──
//    Why:  the T25 exit as one workspace's day, where every setting that was only kept now acts: the
//          Developer starts when a task is assigned to it and keeps to its scope, the Planner starts at its
//          minute, the Release agent from a signed webhook; a contractor's role holds only in its hours and a
//          viewer changes nothing; a budget warns, a watched page tells its watcher, a stale flag reminds; a
//          profile keeps its cost rate private; an edit on an old version is refused; and a person who left
//          gets their data and is erased.
import { createHmac } from 'node:crypto';
import { wallClock } from '@orqiva/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { scriptedProvider } from '../../src/agents/provider.js';
import { scheduleRuns } from '../../src/agents/triggers.js';
import { inSystem } from '../../src/db/pool.js';
import { unzip } from '../../src/export/zip.js';
import { alertRound, WATCH_QUIET_MS } from '../../src/push/alerts.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

process.env['ORQIVA_SECRET_KEY'] = 'e6'.repeat(32);

describe.skipIf(!hasDatabase)('T25 exit: stored settings act (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let mo: Person;
  let cy: Person;
  let project = '';
  const agents: Record<string, string> = {};
  const deps = { subject: 'mailto:ops@example.test' };
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  const runs = async () =>
    (
      await t.call<{ agentName: string; trigger: { kind: string; note: string } | null }[]>(
        ada,
        'GET',
        W('/agent-runs'),
      )
    ).body.filter((r) => r.trigger);
  const until = async (n: number) => {
    const end = Date.now() + 10_000;
    while ((await runs()).length < n) {
      if (Date.now() > end) throw new Error('no triggered run');
      await new Promise((r) => setTimeout(r, 50));
    }
  };
  const inbox = async (who: Person, kind: string) =>
    (await t.call<{ items: { kind: string; title: string }[] }>(who, 'GET', W('/inbox'))).body.items
      .filter((i) => i.kind === kind)
      .map((i) => i.title);

  beforeAll(async () => {
    t = await startTestApp({
      agents: { provider: () => Promise.resolve(scriptedProvider([])) },
    });
    ada = await t.signup('Ada');
    mo = await t.signup('Mo');
    cy = await t.signup('Cy');
    for (const p of [mo, cy])
      await t.call(ada, 'POST', W('/members'), { email: p.email, role: 'member' });
    project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'HEL', name: 'Helio' })
    ).body.id;
    for (const a of (await t.call<{ id: string; key: string }[]>(ada, 'GET', W('/agents'))).body)
      agents[a.key] = a.id;
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('runs a day in which every stored setting acts', async () => {
    // 08:00 the agents are set up: triggers, scope, a schedule and a webhook
    await t.call(ada, 'PATCH', W('/agents/' + String(agents['developer'])), {
      triggers: [{ kind: 'assigned' }, { kind: 'mention', value: '/dev' }],
      scope: { files: ['src/**'], branches: ['agent/*'], network: ['docs.example.com'] },
    });
    await t.call(ada, 'PATCH', W('/agents/' + String(agents['planner'])), {
      triggers: [{ kind: 'schedule', value: '0 7 * * 1-5', project: 'HEL' }],
    });
    await t.call(ada, 'PATCH', W('/agents/' + String(agents['release'])), {
      triggers: [{ kind: 'webhook', project: 'HEL' }],
    });
    const hook = (
      await t.call<{ path: string; secret: string }>(
        ada,
        'POST',
        W('/agents/' + String(agents['release']) + '/webhook'),
      )
    ).body;

    // 08:30 a task for the Developer: it starts, and orq gets its scope
    const item = (
      await t.call<{ id: string; version: number }>(
        ada,
        'POST',
        W('/projects/' + project + '/items'),
        {
          title: 'Export cancelled appointments',
          description: 'The export leaves out cancelled appointments; add them with their reason.',
          agentId: agents['developer'],
        },
      )
    ).body;
    await until(1);
    const loop = await t.call<{ rules: { agent?: { name: string; files: string[] } } }>(
      ada,
      'POST',
      W('/loop/start'),
      { ref: 'HEL-1', client: 'laptop:repo' },
    );
    expect(loop.body.rules.agent).toMatchObject({ name: 'Developer agent', files: ['src/**'] });
    const scope = await t.call<{ network: { allowed: boolean } }>(
      ada,
      'GET',
      W('/agents/' + String(agents['developer']) + '/scope-check?host=evil.example.org'),
    );
    expect(scope.body.network.allowed).toBe(false);

    // 07:00 Berlin on a Monday: the Planner's minute; and the build server calls the Release agent
    expect(await scheduleRuns(t.db.pool, ada.workspaceId, new Date('2026-10-12T05:00:30Z'))).toBe(
      1,
    );
    const body = JSON.stringify({ build: '1.4.0' });
    const signed = await fetch(t.base + hook.path, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-orqiva-signature':
          'sha256=' + createHmac('sha256', hook.secret).update(body).digest('hex'),
      },
      body,
    });
    expect(signed.status).toBe(202);
    expect((await runs()).map((r) => r.trigger?.kind).sort()).toEqual([
      'assigned',
      'schedule',
      'webhook',
    ]);

    // 09:00 Mo works as a contractor whose writing hours are over; Cy is a viewer of HEL
    const contractor = (
      await t.call<{ id: string; name: string }[]>(ada, 'POST', W('/roles'), {
        name: 'Contractor',
        baseRole: 'member',
        permissions: ['read', 'write'],
      })
    ).body.find((r) => r.name === 'Contractor')?.id;
    const h = wallClock(new Date(), 'Europe/Berlin').hour;
    await t.call(ada, 'PATCH', W('/roles/' + String(contractor)), {
      conditions: { write: { hours: h < 23 ? [h + 1, 24] : [0, 23] } },
    });
    await t.call(ada, 'PUT', W('/members/' + mo.id + '/custom-role'), { roleId: contractor });
    const late = await t.call(mo, 'PATCH', W('/items/' + item.id), { title: 'Mo was here' });
    expect(late.status).toBe(403);
    await t.call(ada, 'PUT', W('/projects/' + project + '/members/' + cy.id), { role: 'viewer' });
    expect((await t.call(cy, 'PATCH', W('/items/' + item.id), { title: 'Cy' })).status).toBe(403);
    expect((await t.call(cy, 'GET', W('/items/' + item.id))).status).toBe(200);

    // 10:00 an edit on what Ada saw at 08:30 meets a newer version
    await t.call(ada, 'PATCH', W('/items/' + item.id), { description: 'With the reason.' });
    expect(
      (
        await t.call(ada, 'PATCH', W('/items/' + item.id), {
          description: 'Overwrite',
          version: item.version,
        })
      ).status,
    ).toBe(409);

    // 11:00 a budget warns; Cy watches the runbook Ada edits; a flag has been forgotten
    await t.call(ada, 'POST', W('/budgets'), {
      scopeType: 'workspace',
      measure: 'ai',
      period: 'day',
      amountCents: 1000,
      warnPct: 80,
    });
    await inSystem(t.db.pool, (c) =>
      c.query(
        "INSERT INTO agent_runs (workspace_id, project_id, agent_id, instruction, status, model, cost_micros) SELECT $1, $2, id, 'work', 'succeeded', 'm', 9300000 FROM agents WHERE workspace_id = $1 AND key = 'analyst'",
        [ada.workspaceId, project],
      ),
    );
    const page = (
      await t.call<{ page: { id: string } }>(ada, 'POST', W('/projects/' + project + '/docs'), {
        title: 'Runbook',
      })
    ).body.page.id;
    await t.call(cy, 'POST', W('/docs/' + page + '/watch'));
    await t.call(ada, 'PUT', W('/docs/' + page), { body: 'Restart the API', baseVersion: 1 });
    await t.call(ada, 'POST', W('/projects/' + project + '/flags'), { key: 'new-export' });
    await inSystem(t.db.pool, (c) =>
      c.query("UPDATE feature_flags SET updated_at = now() - interval '31 days'"),
    );
    const counts = await alertRound(t.db.pool, deps, new Date(Date.now() + WATCH_QUIET_MS + 1000));
    expect(counts).toMatchObject({ budgets: 1, watch: 1, reminders: 1 });
    expect(await inbox(ada, 'budget')).toContain('Budget at 85 %: the workspace, today');
    expect(await inbox(cy, 'watch')).toEqual(['Runbook changed']);
    expect(await inbox(ada, 'reminder')).toEqual(['Flag new-export in HEL unchanged for 30 days']);

    // 14:00 profiles: the rate stays between the admin and the person
    await t.call(ada, 'PUT', W('/members/' + mo.id + '/profile'), {
      title: 'Contractor, backend',
      costRateCents: 9500,
    });
    const seen = await t.call(cy, 'GET', W('/members/' + mo.id + '/profile'));
    expect(seen.body['title']).toBe('Contractor, backend');
    expect('costRateCents' in seen.body).toBe(false);

    // 17:00 Mo's contract ends: their data goes to them, then they are erased here
    const zip = await fetch(t.base + W('/members/' + mo.id + '/export'), {
      headers: { cookie: ada.cookie },
    });
    const names = unzip(Buffer.from(await zip.arrayBuffer())).map((f) => f.name);
    expect(names).toEqual(
      expect.arrayContaining(['README.txt', 'account.json', 'member_profiles.json']),
    );
    await t.call(ada, 'POST', W('/members/' + mo.id + '/offboard'), {
      handoverTo: ada.id,
      revokeTokens: true,
    });
    const erased = await t.call<{ accountErased: boolean }>(
      ada,
      'POST',
      W('/members/' + mo.id + '/erase'),
      { confirm: 'Mo' },
    );
    expect(erased.body.accountErased).toBe(false);
  });
});
