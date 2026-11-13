// ── [PCODE-466 | S15 | v0.1.0] Every task shows its work record: AI, model, tokens, price, time and version, in VS Code and the portal ──
// ── [PCODE-459 | S15 | v0.1.0] Planning in VS Code locks the project in the portal: banner on every tab, conflicting AI planning refused both ways ──
// ── [PCODE-456 | S15 | v0.1.0] Planning in VS Code shows live in the portal: local AI runs, hook steps, plan documents synced ──
//    Why:  a run from a developer's machine counts as running, collects its steps live, ends with a result,
//          is written only by the person who opened it, and is never touched by the server's worker.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

process.env['ORQIVA_SECRET_KEY'] = 'ab'.repeat(32);

describe.skipIf(!hasDatabase)('runs on a developer machine (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let cy: Person;
  let project = '';
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  type Run = {
    id: string;
    status: string;
    source: string;
    client: string;
    agentName: string;
    summary: string;
    error: string;
  };
  type Step = { seq: number; kind: string; content: Record<string, unknown> };

  const open = (who: Person, client = 'pc1:C:/repo') =>
    t.call<Run>(who, 'POST', W('/projects/' + project + '/local-runs'), {
      agent: 'planner',
      instruction: 'Plan the project in VS Code',
      client,
    });

  beforeAll(async () => {
    // the worker runs, with no model: it must not pick up a run from a developer's machine
    t = await startTestApp({
      agents: { provider: () => Promise.reject(new Error('no model in this test')) },
    });
    ada = await t.signup('Ada');
    cy = await t.signup('Cy');
    await t.call(ada, 'POST', W('/members'), { email: cy.email, role: 'member' });
    project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), {
        key: 'MARK',
        name: 'Marketspider',
      })
    ).body.id;
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('runs, counts as running, takes steps live and ends with its result', async () => {
    const r = await open(ada);
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({
      status: 'running',
      source: 'local',
      client: 'pc1:C:/repo',
      agentName: 'Planner agent',
    });
    const shell = await t.call<{ agents: { running: number } }>(ada, 'GET', W('/shell'));
    expect(shell.body.agents.running).toBe(1);
    const active = await t.call<Run[]>(ada, 'GET', W('/agent-runs?active=1'));
    expect(active.body.map((x) => x.id)).toContain(r.body.id);

    const s1 = await t.call<{ seq: number }>(
      ada,
      'POST',
      W('/agent-runs/' + r.body.id + '/steps'),
      {
        kind: 'tool_result',
        text: 'Read .orqiva/description/description.md',
        tool: 'Read',
        path: '.orqiva/description/description.md',
      },
    );
    expect(s1.body.seq).toBe(1);
    await t.call(ada, 'POST', W('/agent-runs/' + r.body.id + '/steps'), {
      kind: 'note',
      text: 'Wrote .orqiva/plan.json with the key ghp_' + 'A'.repeat(36),
    });
    const detail = await t.call<{ run: Run; steps: Step[] }>(
      ada,
      'GET',
      W('/agent-runs/' + r.body.id),
    );
    expect(detail.body.steps.map((s) => s.content['text'])).toEqual([
      'Read .orqiva/description/description.md',
      expect.not.stringContaining('ghp_AAAA'),
    ]);
    expect(detail.body.steps[0]).toMatchObject({ kind: 'note', content: { tool: 'Read' } });

    const done = await t.call<Run>(ada, 'POST', W('/agent-runs/' + r.body.id + '/finish'), {
      status: 'succeeded',
      summary: '27 sprints, 113 tasks',
    });
    expect(done.body).toMatchObject({ status: 'succeeded', summary: '27 sprints, 113 tasks' });
    const after = await t.call<{ agents: { running: number } }>(ada, 'GET', W('/shell'));
    expect(after.body.agents.running).toBe(0);
    const late = await t.call(ada, 'POST', W('/agent-runs/' + r.body.id + '/steps'), {
      kind: 'note',
      text: 'too late',
    });
    expect(late.status).toBe(409);
  });

  it('is written only by the person who opened it', async () => {
    const r = await open(ada, 'pc1:C:/other');
    const step = await t.call(cy, 'POST', W('/agent-runs/' + r.body.id + '/steps'), {
      kind: 'note',
      text: 'not mine',
    });
    expect(step.status).toBe(403);
    const end = await t.call(cy, 'POST', W('/agent-runs/' + r.body.id + '/finish'), {
      status: 'failed',
    });
    expect(end.status).toBe(403);
    await t.call(ada, 'POST', W('/agent-runs/' + r.body.id + '/finish'), { status: 'cancelled' });
  });

  it('ends a run the same machine left open when it opens a new one', async () => {
    const first = await open(ada, 'pc2:C:/repo');
    const second = await open(ada, 'pc2:C:/repo');
    const old = await t.call<{ run: Run }>(ada, 'GET', W('/agent-runs/' + first.body.id));
    expect(old.body.run).toMatchObject({ status: 'failed', summary: 'Ended without a result' });
    const now = await t.call<{ run: Run }>(ada, 'GET', W('/agent-runs/' + second.body.id));
    expect(now.body.run.status).toBe('running');
    await t.call(ada, 'POST', W('/agent-runs/' + second.body.id + '/finish'), {
      status: 'failed',
      error: 'The terminal was closed before a plan was written',
    });
  });

  it("does not let a server run's routes act on it, and the worker leaves it alone", async () => {
    const r = await open(ada, 'pc3:C:/repo');
    const decide = await t.call(ada, 'POST', W('/agent-runs/' + r.body.id + '/decision'), {
      approve: true,
    });
    expect(decide.status).toBe(409);
    await new Promise((res) => setTimeout(res, 300));
    const still = await t.call<{ run: Run; steps: Step[] }>(
      ada,
      'GET',
      W('/agent-runs/' + r.body.id),
    );
    expect(still.body.run.status).toBe('running');
    expect(still.body.steps).toEqual([]);
    await t.call(ada, 'POST', W('/agent-runs/' + r.body.id + '/finish'), { status: 'cancelled' });
  });

  // ── [PCODE-459 | S15 | v0.1.0] one planning session per project: the lock, its banner text, the 409s ──
  it('locks the project for planning while VS Code plans it, and lets go when it ends', async () => {
    type Lock = {
      lock: null | {
        runId: string;
        source: string;
        computer: string;
        by: string;
        message: string;
        lastStep: string | null;
      };
    };
    const r = await open(ada, 'PC-ZARVANDEH:C:\Development phase\MarketSpider');
    await t.call(ada, 'POST', W('/agent-runs/' + r.body.id + '/steps'), {
      kind: 'tool_result',
      text: 'Wrote .orqiva/architecture.md',
    });
    const seen = await t.call<Lock>(cy, 'GET', W('/projects/' + project + '/planning-lock'));
    expect(seen.body.lock).toMatchObject({
      runId: r.body.id,
      source: 'local',
      computer: 'PC-ZARVANDEH',
      by: 'Ada',
      lastStep: 'Wrote .orqiva/architecture.md',
    });
    expect(seen.body.lock?.message).toContain(
      'Claude is planning this project in VS Code on PC-ZARVANDEH (Ada, since',
    );
    // a second session: another person, or the same person in another folder
    const other = await open(cy, 'pc9:C:/repo');
    expect(other.status).toBe(409);
    expect((other.body as unknown as { error: { message: string } }).error.message).toContain(
      'PC-ZARVANDEH',
    );
    expect((await open(ada, 'pc9:C:/repo')).status).toBe(409);
    // the planning agents in the portal wait; the others do not
    const agents = (await t.call<{ id: string; key: string }[]>(ada, 'GET', W('/agents'))).body;
    const run = (key: string) =>
      t.call(cy, 'POST', W('/projects/' + project + '/agent-runs'), {
        agentId: agents.find((x) => x.key === key)?.id,
        instruction: 'Write the architecture',
      });
    expect((await run('documenter')).status).toBe(409);
    expect((await run('planner')).status).toBe(409);
    await t.call(ada, 'POST', W('/agent-runs/' + r.body.id + '/finish'), { status: 'succeeded' });
    const free = await t.call<Lock>(cy, 'GET', W('/projects/' + project + '/planning-lock'));
    expect(free.body.lock).toBeNull();
    const next = await open(cy, 'pc9:C:/repo');
    expect(next.status).toBe(201);
    await t.call(cy, 'POST', W('/agent-runs/' + next.body.id + '/finish'), { status: 'cancelled' });
  });

  // ── [PCODE-466 | S15 | v0.1.0] the planning conversation reports what it used, with Claude Code's own price ──
  it('keeps the tokens and the price a run reports when it ends', async () => {
    const r = await open(ada, 'pc7:C:/repo');
    await t.call(ada, 'POST', W('/agent-runs/' + r.body.id + '/finish'), {
      status: 'succeeded',
      usage: {
        model: 'claude-opus-5-5',
        tokensIn: 12,
        tokensOut: 14046,
        cacheRead: 214046,
        cacheWrite: 31650,
        costUsd: 0.51,
      },
    });
    const d = await t.call<{
      run: { model: string; tokensIn: number; tokensOut: number; costMicros: number };
    }>(ada, 'GET', W('/agent-runs/' + r.body.id));
    expect(d.body.run).toMatchObject({
      model: 'claude-opus-5-5',
      tokensIn: 12,
      tokensOut: 14046,
      costMicros: 510000,
    });
  });
});
