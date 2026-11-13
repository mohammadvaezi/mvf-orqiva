// ── [PCODE-241 | S15 | v0.1.0] T24.2 Reading files through the models: PDF, DOCX, images, audio ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-120 | S15 | v0.1.0] Build the agent runtime: agents, queued runs, model providers, tools with approvals, budgets, streamed steps ──
//    Why:  the runtime against the real database and worker, with a scripted model: what the agent does,
//          when it must wait for a person, what stops it, and what it may never do.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
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
): ModelReply['content'][number] => ({ type: 'tool_use', id, name, input });
const turn = (content: ModelReply['content'], usage = { input: 100, output: 50 }): ModelReply => ({
  content,
  stopReason: content.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn',
  usage,
});

describe.skipIf(!hasDatabase)('the agent runtime (PostgreSQL)', () => {
  let t: TestApp & { agents: unknown };
  let ada: Person;
  let cy: Person;
  let project = '';
  let item = '';
  let analyst = '';
  let current: (ModelProvider & { requests: { messages: unknown[] }[] }) | null = null;
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  type Run = {
    id: string;
    status: string;
    error: string;
    tokensIn: number;
    tokensOut: number;
    costMicros: number;
  };
  type Step = { seq: number; kind: string; content: Record<string, unknown> };

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
    instruction: string,
    replies: ModelReply[],
    agentId = analyst,
  ): Promise<string> => {
    current = scriptedProvider(replies);
    const r = await t.call<Run>(ada, 'POST', W('/projects/' + project + '/agent-runs'), {
      agentId,
      instruction,
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
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'APP', name: 'App' })
    ).body.id;
    item = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects/' + project + '/items'), {
        title: 'Export the report',
      })
    ).body.id;
    const agents = await t.call<{ id: string; key: string }[]>(ada, 'GET', W('/agents'));
    // [PCODE-241 | S15 | v0.1.0] twelve agents and the Reader
    expect(agents.body).toHaveLength(13);
    analyst = agents.body.find((a) => a.key === 'analyst')?.id ?? '';
    await t.call(ada, 'PUT', W('/agents/provider'), {
      provider: 'anthropic',
      inputPricePerMillion: 3,
      outputPricePerMillion: 15,
    });
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('works through tools, waits for a person before moving a task, and finishes after the approval', async () => {
    const id = await start('Look at APP-1 and start it', [
      turn([{ type: 'text', text: 'Listing first.' }, use('list_items', {})]),
      turn([
        use('add_comment', { ref: 'APP-1', body: 'I looked at it.' }),
        use('move_item', { ref: 'APP-1', state: 'In Progress' }),
      ]),
      turn([{ type: 'text', text: 'Done.' }]),
    ]);
    const waiting = await until(id, ['waiting']);
    expect(waiting.steps.map((s) => s.kind)).toEqual(['model', 'tool_result', 'model', 'approval']);
    expect(waiting.steps[1]?.content['results']).toEqual([
      expect.objectContaining({
        tool_use_id: 'list_items-1',
        content: expect.stringContaining('APP-1') as string,
      }),
    ]);
    expect(waiting.steps[3]?.content).toMatchObject({
      tool: 'move_item',
      input: { ref: 'APP-1', state: 'In Progress' },
    });
    // nothing of the waiting turn has happened yet
    expect((await t.call<unknown[]>(ada, 'GET', W('/items/' + item + '/comments'))).body).toEqual(
      [],
    );

    expect(
      (
        await t.call(cy, 'POST', W('/agent-runs/' + id + '/decision'), {
          approve: true,
          note: 'go',
        })
      ).status,
    ).toBe(200);
    const done = await until(id, ['succeeded']);
    expect(done.steps.map((s) => s.kind)).toEqual([
      'model',
      'tool_result',
      'model',
      'approval',
      'decision',
      'tool_result',
      'model',
    ]);
    expect(done.steps[4]?.content).toMatchObject({ approve: true, by: 'Cy', note: 'go' });
    // tokens and cost of three turns: 300 in, 150 out at 3 and 15 USD per million
    expect(done.run).toMatchObject({ tokensIn: 300, tokensOut: 150, costMicros: 3150 });

    const comments = await t.call<{ authorName: string; body: string }[]>(
      ada,
      'GET',
      W('/items/' + item + '/comments'),
    );
    expect(comments.body).toEqual([
      expect.objectContaining({ authorName: 'Analyst agent', body: 'I looked at it.' }),
    ]);
    const it2 = await t.call<{ stateId: string }>(ada, 'GET', W('/items/' + item));
    const states = (
      await t.call<{ states: { id: string; name: string }[] }>(
        ada,
        'GET',
        W('/projects/' + project),
      )
    ).body.states;
    expect(states.find((s) => s.id === it2.body.stateId)?.name).toBe('In Progress');
    // the change is the agent's, not a person's
    const events = await inSystem(
      t.db.pool,
      async (c) =>
        (
          await c.query<{ actor_kind: string; type: string }>(
            "SELECT actor_kind, type FROM activity_events WHERE type = 'orqiva.item.moved'",
          )
        ).rows,
    );
    expect(events).toEqual([{ actor_kind: 'agent', type: 'orqiva.item.moved' }]);
  });

  it('passes a declined action back to the model as an error', async () => {
    const id = await start('Move it back', [
      turn([use('move_item', { ref: 'APP-1', state: 'Todo' }, 'mv')]),
      turn([{ type: 'text', text: 'Leaving it.' }]),
    ]);
    await until(id, ['waiting']);
    await t.call(ada, 'POST', W('/agent-runs/' + id + '/decision'), {
      approve: false,
      note: 'not now',
    });
    await until(id, ['succeeded']);
    const last = JSON.stringify(current?.requests[1]?.messages.at(-1));
    expect(last).toContain('declined this action: not now');
    expect(last).toContain('"is_error":true');
  });

  it('never lets an agent finish work, and refuses writes to a read-only agent', async () => {
    const id = await start('Close it', [
      turn([use('move_item', { ref: 'APP-1', state: 'Done' }, 'dn')]),
      turn([{ type: 'text', text: 'ok' }]),
    ]);
    await until(id, ['waiting']);
    await t.call(ada, 'POST', W('/agent-runs/' + id + '/decision'), { approve: true });
    const r = await until(id, ['succeeded']);
    expect(JSON.stringify(r.steps.find((s) => s.kind === 'tool_result' && s.seq > 2))).toContain(
      'Finishing or cancelling work is for people',
    );

    await t.call(ada, 'PATCH', W('/agents/' + analyst), { role: 'guest' });
    const id2 = await start('Comment', [
      turn([use('add_comment', { ref: 'APP-1', body: 'x' })]),
      turn([{ type: 'text', text: 'ok' }]),
    ]);
    const r2 = await until(id2, ['succeeded']);
    expect(JSON.stringify(r2.steps[1]?.content)).toContain('may read but not change anything');
    await t.call(ada, 'PATCH', W('/agents/' + analyst), { role: 'member' });
  });

  it('stops a run at its token budget', async () => {
    await t.call(ada, 'PATCH', W('/agents/' + analyst), { maxTokensPerRun: 1000 });
    const id = await start('Spend', [
      turn([use('list_items', {})], { input: 900, output: 200 }),
      turn([{ type: 'text', text: 'never' }]),
    ]);
    const r = await until(id, ['failed']);
    expect(r.run.error).toContain('used its budget of 1000 tokens');
    expect(r.steps.map((s) => s.kind)).toEqual(['model', 'tool_result', 'error']);
    expect(current?.requests).toHaveLength(1);
    await t.call(ada, 'PATCH', W('/agents/' + analyst), { maxTokensPerRun: 200000 });
  });

  it('keeps the provider key encrypted and never shows it; only admins set it', async () => {
    expect((await t.call(cy, 'PUT', W('/agents/provider'), { provider: 'demo' })).status).toBe(403);
    const r = await t.call<{ hasKey: boolean }>(ada, 'PUT', W('/agents/provider'), {
      provider: 'anthropic',
      apiKey: 'sk-ant-test-123',
    });
    expect(r.body.hasKey).toBe(true);
    expect(JSON.stringify(r.body)).not.toContain('sk-ant');
    const stored = await inSystem(
      t.db.pool,
      async (c) =>
        (await c.query<{ k: string }>('SELECT key_ciphertext AS k FROM agent_provider_settings'))
          .rows[0]?.k ?? '',
    );
    expect(stored.startsWith('v1.')).toBe(true);
    expect(stored).not.toContain('sk-ant');
  });

  it('lets the starter cancel a waiting run', async () => {
    const id = await start('Wait', [
      turn([use('move_item', { ref: 'APP-1', state: 'Todo' }, 'w')]),
    ]);
    await until(id, ['waiting']);
    expect((await t.call(cy, 'POST', W('/agent-runs/' + id + '/cancel'))).status).toBe(403);
    expect((await t.call<Run>(ada, 'POST', W('/agent-runs/' + id + '/cancel'))).body.status).toBe(
      'cancelled',
    );
    const active = await t.call<Run[]>(ada, 'GET', W('/agent-runs?active=1&projectId=' + project));
    expect(active.body).toEqual([]);
  });
});
