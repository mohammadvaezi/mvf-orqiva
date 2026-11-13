// ── [PCODE-246 | S15 | v0.1.0] T25.1 Agent triggers act: assignment, label, mention, CI failure, schedule, webhook ──
//    Why:  each kind of trigger against the real database and worker: a task assigned to the Developer, a
//          label and a mention start it; a failed test run starts the Tester; the Planner's schedule starts at
//          its minute once; the Release agent's webhook takes signed calls and refuses others; a cause starts
//          an agent once, an agent never starts itself, and a switched-off agent starts nothing.
import { createHmac } from 'node:crypto';
import type { ActivityEvent } from '@orqiva/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { scriptedProvider } from '../../src/agents/provider.js';
import { scheduleRuns, startsFor } from '../../src/agents/triggers.js';
import { inSystem } from '../../src/db/pool.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

process.env['ORQIVA_SECRET_KEY'] = 'c4'.repeat(32);

interface Run {
  id: string;
  agentName: string;
  itemRef: string | null;
  instruction: string;
  trigger: { kind: string; note: string } | null;
}

describe.skipIf(!hasDatabase)('agent triggers (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let project = '';
  let item = '';
  const agents: Record<string, string> = {};
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  const runs = async (): Promise<Run[]> =>
    (await t.call<Run[]>(ada, 'GET', W('/agent-runs'))).body.filter((r) => r.trigger);
  /** waits until the worker has started `n` triggered runs */
  const triggered = async (n: number): Promise<Run[]> => {
    const end = Date.now() + 10_000;
    for (;;) {
      const r = await runs();
      if (r.length >= n) return r;
      if (Date.now() > end) throw new Error('only ' + String(r.length) + ' triggered runs');
      await new Promise((res) => setTimeout(res, 50));
    }
  };
  const set = (key: string, body: Record<string, unknown>) =>
    t.call(ada, 'PATCH', W('/agents/' + String(agents[key])), body);

  beforeAll(async () => {
    t = await startTestApp({
      agents: { provider: () => Promise.resolve(scriptedProvider([])) },
    });
    ada = await t.signup('Ada');
    project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'HEL', name: 'Helio' })
    ).body.id;
    item = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects/' + project + '/items'), {
        title: 'Export cancelled appointments',
      })
    ).body.id;
    for (const a of (await t.call<{ id: string; key: string }[]>(ada, 'GET', W('/agents'))).body)
      agents[a.key] = a.id;
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('keeps only triggers that can act', async () => {
    expect(
      (await set('planner', { triggers: [{ kind: 'schedule', value: '7 * *' }] })).status,
    ).toBe(400);
    const noProject = await set('planner', {
      triggers: [{ kind: 'schedule', value: '0 7 * * 1-5' }],
    });
    expect(noProject.status).toBe(400);
    expect(
      (
        await set('planner', {
          triggers: [{ kind: 'schedule', value: '0 7 * * 1-5', project: 'NOPE' }],
        })
      ).status,
    ).toBe(400);
    expect((await set('developer', { triggers: [{ kind: 'label', value: '' }] })).status).toBe(400);
  });

  it('starts the Developer on assignment, label and mention, once each', async () => {
    expect(
      (
        await set('developer', {
          triggers: [
            { kind: 'assigned' },
            { kind: 'label', value: 'Agent' },
            { kind: 'mention', value: '/dev', instruction: 'Answer in the task.' },
          ],
        })
      ).status,
    ).toBe(200);
    // the matcher starts from now: the task made before the triggers starts nothing
    const assigned = await t.call<{ agentId: string }>(ada, 'PATCH', W('/items/' + item), {
      agentId: agents['developer'],
    });
    expect(assigned.body.agentId).toBe(agents['developer']);
    let r = await triggered(1);
    expect(r[0]).toMatchObject({
      agentName: 'Developer agent',
      itemRef: 'HEL-1',
      trigger: { kind: 'assigned', note: 'assigned HEL-1' },
    });
    expect(r[0]?.instruction).toContain(
      'Ada assigned HEL-1 "Export cancelled appointments" to you',
    );

    const label = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects/' + project + '/labels'), {
        name: 'agent',
        color: '#3f76ff',
      })
    ).body.id;
    await t.call(ada, 'PATCH', W('/items/' + item), { labelIds: [label] });
    r = await triggered(2);
    expect(r.map((x) => x.trigger?.note)).toContain('label Agent on HEL-1');

    // a comment without the mention starts nothing; with it, the agent gets the comment and the ask
    await t.call(ada, 'POST', W('/items/' + item + '/comments'), { body: 'Looks good to me' });
    await t.call(ada, 'POST', W('/items/' + item + '/comments'), {
      body: 'Can you check the time zone? /dev',
    });
    r = await triggered(3);
    const mention = r.find((x) => x.trigger?.kind === 'mention');
    expect(mention?.instruction).toContain('Can you check the time zone? /dev');
    expect(mention?.instruction).toContain('Answer in the task.');
    // nothing more: each cause once
    await new Promise((res) => setTimeout(res, 600));
    expect((await runs()).length).toBe(3);
  });

  it('starts the Tester when a test run fails', async () => {
    await set('tester', { triggers: [{ kind: 'ci_failure' }] });
    const run = await t.call<{ id: string }>(
      ada,
      'POST',
      W('/projects/' + project + '/test-runs'),
      {
        name: 'Nightly',
        source: 'stream',
      },
    );
    const R = W('/test-runs/' + run.body.id);
    await t.call(ada, 'POST', R + '/results', {
      results: [{ key: 'export > dates', status: 'failed', message: 'expected ISO' }],
    });
    expect((await t.call(ada, 'POST', R + '/finish')).status).toBe(200);
    const r = await triggered(4);
    expect(r.find((x) => x.trigger?.kind === 'ci_failure')).toMatchObject({
      agentName: 'Tester agent',
      trigger: { note: 'tests failed: HEL Nightly' },
    });
  });

  it('never lets an agent start itself, and a switched-off agent starts nothing', async () => {
    const event = {
      id: 'e1',
      projectid: project,
      data: {
        actor: { kind: 'agent', id: agents['developer'] },
        verb: 'updated',
        object: { type: 'item', id: item },
        changes: { agentId: { from: null, to: agents['developer'] } },
      },
    } as unknown as ActivityEvent;
    const dev = {
      id: String(agents['developer']),
      key: 'developer',
      name: 'Developer agent',
      model: 'm',
      triggers: [{ kind: 'assigned' as const, value: '' }],
    };
    expect(await inSystem(t.db.pool, (c) => startsFor(c, event, [dev]))).toEqual([]);

    await set('developer', { enabled: false });
    await t.call(ada, 'PATCH', W('/items/' + item), { agentId: null });
    await t.call(ada, 'POST', W('/items/' + item + '/comments'), { body: 'Still there? /dev' });
    await new Promise((res) => setTimeout(res, 600));
    expect((await runs()).filter((x) => x.trigger?.kind === 'mention').length).toBe(1);
    // a switched-off agent cannot take a task either
    expect(
      (await t.call(ada, 'PATCH', W('/items/' + item), { agentId: agents['developer'] })).status,
    ).toBe(400);
    await set('developer', { enabled: true });
  });

  it('starts the Planner at the minutes of its schedule, in the workspace time zone, once', async () => {
    expect(
      (
        await set('planner', {
          triggers: [{ kind: 'schedule', value: '0 7 * * 1-5', project: 'hel' }],
        })
      ).status,
    ).toBe(200);
    // Monday 12 Oct 2026, 07:01 in Berlin (05:01 UTC); the minute 07:00 is still looked at
    const monday = new Date('2026-10-12T05:01:30Z');
    expect(await scheduleRuns(t.db.pool, ada.workspaceId, monday)).toBe(1);
    expect(await scheduleRuns(t.db.pool, ada.workspaceId, monday)).toBe(0);
    // Saturday at the same time: not a weekday
    expect(await scheduleRuns(t.db.pool, ada.workspaceId, new Date('2026-10-17T05:00:10Z'))).toBe(
      0,
    );
    const r = (await runs()).find((x) => x.trigger?.kind === 'schedule');
    expect(r).toMatchObject({
      agentName: 'Planner agent',
      trigger: { note: 'schedule 0 7 * * 1-5' },
    });
    const agent = (
      await t.call<{ id: string; triggersFired: Record<string, string> }[]>(
        ada,
        'GET',
        W('/agents'),
      )
    ).body.find((a) => a.id === agents['planner']);
    expect(Object.keys(agent?.triggersFired ?? {})).toEqual(['schedule']);
  });

  it('starts the Release agent from its webhook, signed or with the secret, once per delivery', async () => {
    await set('release', {
      triggers: [{ kind: 'webhook', instruction: 'Write the notes for the build.' }],
    });
    const hook = (
      await t.call<{ path: string; secret: string; hint: string }>(
        ada,
        'POST',
        W('/agents/' + String(agents['release']) + '/webhook'),
      )
    ).body;
    expect(hook.path).toMatch(/^\/hooks\/agents\/[A-Za-z0-9_-]{20,}$/);
    expect(hook.secret.endsWith(hook.hint)).toBe(true);
    const body = JSON.stringify({ project: 'HEL', build: '1.4.0' });
    const post = (headers: Record<string, string>) =>
      fetch(t.base + hook.path, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body,
      });
    const sig = 'sha256=' + createHmac('sha256', hook.secret).update(body).digest('hex');
    expect((await post({ 'x-orqiva-signature': 'sha256=00' })).status).toBe(401);
    expect((await post({})).status).toBe(401);
    const first = await post({ 'x-orqiva-signature': sig, 'x-orqiva-delivery': 'd-1' });
    expect(first.status).toBe(202);
    expect((await post({ 'x-orqiva-signature': sig, 'x-orqiva-delivery': 'd-1' })).status).toBe(
      200,
    );
    expect((await post({ authorization: 'Bearer ' + hook.secret })).status).toBe(202);
    const hooks = (await runs()).filter((x) => x.trigger?.kind === 'webhook');
    expect(hooks.length).toBe(2);
    expect(hooks[0]?.instruction).toContain('Write the notes for the build.');
    expect(hooks[0]?.instruction).toContain('"build":"1.4.0"');
    // a new secret ends the old one
    await t.call(ada, 'POST', W('/agents/' + String(agents['release']) + '/webhook'));
    expect((await post({ authorization: 'Bearer ' + hook.secret })).status).toBe(404);
  });
});
