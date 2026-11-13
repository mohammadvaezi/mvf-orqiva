// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-180 | S15 | v0.1.0] B5.1 Agents live: settings, versioned prompts, action rules, autonomy, pause all, budgets in euro, traces, costs, quality ──
//    Why:  the control of agents against the real database and worker, with a scripted model: settings
//          and versioned instructions with rollback, rules and autonomy deciding what a tool call does,
//          "pause all" holding the queue, euro budgets stopping a run, the fallback model, and the fleet,
//          costs and leaderboard reading the runs back in euro.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ProviderError,
  scriptedProvider,
  type ModelProvider,
  type ModelReply,
} from '../../src/agents/provider.js';
import { inSystem } from '../../src/db/pool.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

process.env['ORQIVA_SECRET_KEY'] = 'ab'.repeat(32);

const use = (
  name: string,
  input: Record<string, unknown>,
  id = name + '-1',
): ModelReply['content'][number] => ({
  type: 'tool_use',
  id,
  name,
  input,
});
const turn = (content: ModelReply['content'], usage = { input: 1000, output: 0 }): ModelReply => ({
  content,
  stopReason: content.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn',
  usage,
});
const say = (text: string): ModelReply => turn([{ type: 'text', text }], { input: 10, output: 10 });

describe.skipIf(!hasDatabase)('agent control (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let cy: Person;
  let project = '';
  let item = '';
  let analyst = '';
  let current: ModelProvider | null = null;
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  type Run = { id: string; status: string; error: string; summary: string; promptVersion: number };
  type Step = { kind: string; content: Record<string, unknown> };
  const until = async (id: string, statuses: string[]): Promise<{ run: Run; steps: Step[] }> => {
    const end = Date.now() + 10_000;
    for (;;) {
      const r = await t.call<{ run: Run; steps: Step[] }>(ada, 'GET', W('/agent-runs/' + id));
      if (statuses.includes(r.body.run.status)) return r.body;
      if (Date.now() > end) throw new Error('run stayed ' + r.body.run.status);
      await new Promise((res) => setTimeout(res, 50));
    }
  };
  const start = async (
    replies: ModelReply[] | ModelProvider,
    agentId = analyst,
  ): Promise<string> => {
    current = Array.isArray(replies) ? scriptedProvider(replies) : replies;
    const r = await t.call<Run>(ada, 'POST', W('/projects/' + project + '/agent-runs'), {
      agentId,
      instruction: 'Work on it',
      itemId: item,
    });
    expect(r.status).toBe(201);
    return r.body.id;
  };

  beforeAll(async () => {
    t = await startTestApp({
      agents: {
        provider: () => {
          if (!current) throw new Error('no script');
          return Promise.resolve(current);
        },
      },
    });
    ada = await t.signup('Ada');
    cy = await t.signup('Cy');
    await t.call(ada, 'POST', W('/members'), { email: cy.email, role: 'member' });
    project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'AGT', name: 'Agents' })
    ).body.id;
    item = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects/' + project + '/items'), {
        title: 'Write the export',
      })
    ).body.id;
    analyst =
      (await t.call<{ id: string; key: string }[]>(ada, 'GET', W('/agents'))).body.find(
        (a) => a.key === 'analyst',
      )?.id ?? '';
    // 1 USD = 0.5 EUR makes the euro figures easy to read
    await inSystem(t.db.pool, (c) =>
      c.query(
        "INSERT INTO fx_rates (day, usd_eur, source) VALUES (current_date, 0.5, 'test') ON CONFLICT (day) DO UPDATE SET usd_eur = 0.5",
      ),
    );
    await t.call(ada, 'PUT', W('/agents/provider'), {
      provider: 'demo',
      inputPricePerMillion: 2000,
      outputPricePerMillion: 0,
    });
  }, 60_000);

  afterAll(async () => {
    await inSystem(t.db.pool, (c) => c.query("DELETE FROM fx_rates WHERE source = 'test'"));
    await t.stop();
  });

  it('keeps settings, versions a changed prompt and rolls back', async () => {
    const P = W('/agents/' + analyst);
    expect((await t.call(cy, 'PATCH', P, { autonomy: 'autonomous' })).status).toBe(403);
    expect((await t.call(ada, 'PATCH', P, { scope: { secrets: ['x'] } })).status).toBe(400);
    const r = await t.call<{
      autonomy: string;
      ownerName: string;
      scope: unknown;
      promptVersion: number;
      dayBudgetCents: number;
    }>(ada, 'PATCH', P, {
      autonomy: 'scoped',
      ownerId: cy.id,
      fallbackModel: 'backup-model',
      temperature: 0.3,
      scope: { files: ['src/**'], branches: ['agent/*'] },
      triggers: [{ kind: 'label', value: 'agent' }],
      dayBudgetCents: 500,
      systemPrompt: 'Be brief.',
      promptNote: 'shorter',
    });
    expect(r.body).toMatchObject({
      autonomy: 'scoped',
      ownerName: 'Cy',
      scope: { files: ['src/**'], branches: ['agent/*'] },
      promptVersion: 2,
      dayBudgetCents: 500,
    });
    await t.call(ada, 'PATCH', P, { systemPrompt: 'Be very brief.' });
    const versions = await t.call<{ version: number; live: boolean; note: string }[]>(
      ada,
      'GET',
      P + '/prompts',
    );
    expect(versions.body.map((v) => [v.version, v.live])).toEqual([
      [3, true],
      [2, false],
      [1, false],
    ]);
    expect(
      (await t.call<{ version: number }>(ada, 'POST', P + '/prompts/2/rollback')).body.version,
    ).toBe(4);
    const after = await t.call<{ systemPrompt: string }[]>(ada, 'GET', W('/agents'));
    expect(
      after.body.find((a) => (a as unknown as { id: string }).id === analyst)?.systemPrompt,
    ).toBe('Be brief.');
  });

  it('lets rules and autonomy decide whether a tool runs, asks or is refused', async () => {
    const R = W('/agents/' + analyst + '/rules');
    const rules = await t.call<{ actionClass: string; rule: string; isDefault: boolean }[]>(
      ada,
      'GET',
      R,
    );
    expect(rules.body.find((x) => x.actionClass === 'comment')).toMatchObject({
      rule: 'allowed',
      isDefault: true,
    });
    expect((await t.call(ada, 'PUT', R, { rules: { comment: 'maybe' } })).status).toBe(400);
    await t.call(ada, 'PUT', R, { rules: { comment: 'never' } });
    const refused = await until(
      await start([
        turn([use('add_comment', { itemId: item, body: 'hi' })], { input: 10, output: 10 }),
        say('I could not comment.'),
      ]),
      ['succeeded'],
    );
    const result = refused.steps.find((s) => s.kind === 'tool_result');
    expect(JSON.stringify(result?.content)).toContain('do not allow add_comment');
    await t.call(ada, 'PUT', R, { rules: { comment: 'allowed' } });
    await t.call(ada, 'PATCH', W('/agents/' + analyst), { autonomy: 'approve' });
    const asked = await until(
      await start([
        turn([use('add_comment', { itemId: item, body: 'hi' })], { input: 10, output: 10 }),
        say('Done.'),
      ]),
      ['waiting'],
    );
    expect(asked.steps.some((s) => s.kind === 'approval')).toBe(true);
    await t.call(ada, 'POST', W('/agent-runs/' + asked.run.id + '/cancel'));
    await t.call(ada, 'PATCH', W('/agents/' + analyst), { autonomy: 'scoped' });
  });

  it('pauses every agent and resumes them', async () => {
    expect((await t.call(cy, 'PUT', W('/agents/pause'), { paused: true })).status).toBe(403);
    await t.call(ada, 'PUT', W('/agents/pause'), { paused: true });
    const id = await start([say('Paused work finished. Then more.')]);
    await new Promise((r) => setTimeout(r, 400));
    expect((await t.call<{ run: Run }>(ada, 'GET', W('/agent-runs/' + id))).body.run.status).toBe(
      'queued',
    );
    const fleet = await t.call<{ paused: { by: string } | null }>(ada, 'GET', W('/agent-fleet'));
    expect(fleet.body.paused?.by).toBe('Ada');
    await t.call(ada, 'PUT', W('/agents/pause'), { paused: false });
    const done = await until(id, ['succeeded']);
    expect(done.run.summary).toBe('Paused work finished.');
    expect(done.run.promptVersion).toBe(4);
  });

  it('stops a run at its euro budget and falls back to the other model', async () => {
    // 1000 input tokens at 2000 USD a million = 2 USD = 1 € (100 cents) per turn
    await t.call(ada, 'PATCH', W('/agents/' + analyst), {
      runBudgetCents: 150,
      dayBudgetCents: null,
    });
    const over = await until(
      await start([
        turn([use('get_item', { itemId: item }, 'g1')]),
        turn([use('get_item', { itemId: item }, 'g2')]),
        say('never reached'),
      ]),
      ['failed'],
    );
    expect(over.run.error).toBe('The run reached its budget of 1,50 €');
    await t.call(ada, 'PATCH', W('/agents/' + analyst), { runBudgetCents: null });
    let calls = 0;
    const flaky: ModelProvider = {
      name: 'flaky',
      complete: (req) => {
        calls += 1;
        if (req.model !== 'backup-model') return Promise.reject(new ProviderError('overloaded'));
        return Promise.resolve(say('The backup answered.'));
      },
    };
    const fell = await until(await start(flaky), ['succeeded']);
    expect(calls).toBe(2);
    expect(
      fell.steps.some(
        (s) => s.kind === 'note' && String(s.content['text']).includes('backup-model takes over'),
      ),
    ).toBe(true);
  });

  it('reads money and quality back in euro', async () => {
    const fleet = await t.call<{ agents: { id: string; monthCents: number; runsToday: number }[] }>(
      ada,
      'GET',
      W('/agent-fleet'),
    );
    const mine = fleet.body.agents.find((a) => a.id === analyst);
    expect(mine?.runsToday).toBeGreaterThanOrEqual(5);
    expect(mine?.monthCents).toBeGreaterThanOrEqual(200);
    const costs = await t.call<{
      totalCents: number;
      wasteCents: number;
      rate: { usdEur: number };
      projects: { key: string }[];
      agents: { agentId: string; byProject: Record<string, number> }[];
    }>(ada, 'GET', W('/agent-costs'));
    expect(costs.body.rate.usdEur).toBe(0.5);
    expect(costs.body.projects.map((p) => p.key)).toEqual(['AGT']);
    expect(costs.body.wasteCents).toBeGreaterThanOrEqual(200);
    expect(costs.body.agents.find((a) => a.agentId === analyst)?.byProject[project]).toBe(
      costs.body.totalCents,
    );
    expect((await t.call(ada, 'GET', W('/agent-costs?month=2026-13'))).status).toBe(400);
    expect((await t.call(cy, 'GET', W('/agent-quality'))).status).toBe(403);
    const q = await t.call<
      { agentId: string; succeeded: number; failed: number; cancelled: number }[]
    >(ada, 'GET', W('/agent-quality'));
    expect(q.body.find((x) => x.agentId === analyst)).toMatchObject({ failed: 1, cancelled: 1 });
  });

  it('makes a new agent as a copy, switched off until someone turns it on', async () => {
    expect((await t.call(cy, 'POST', W('/agents'), { key: 'scribe', name: 'Scribe' })).status).toBe(
      403,
    );
    const made = await t.call<{ id: string }>(ada, 'POST', W('/agents'), {
      key: 'scribe',
      name: 'Scribe',
      copyOf: analyst,
    });
    expect(made.status).toBe(201);
    expect((await t.call(ada, 'POST', W('/agents'), { key: 'scribe', name: 'Again' })).status).toBe(
      409,
    );
    const list = await t.call<
      { id: string; enabled: boolean; systemPrompt: string; ownerName: string }[]
    >(ada, 'GET', W('/agents'));
    expect(list.body.find((a) => a.id === made.body.id)).toMatchObject({
      enabled: false,
      systemPrompt: 'Be brief.',
      ownerName: 'Ada',
    });
  });
});
