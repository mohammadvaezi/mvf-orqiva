// ── [PCODE-247 | S15 | v0.1.0] T25.2 Agent scopes enforced: files, branches, network, trace redaction ──
//    Why:  scopes and traces against the real database and worker: the scope check answers for a file, a
//          branch and a host; a task assigned to an agent brings its scope to orq; an agent without a
//          network scope is refused by fetch_url inside its run; a key and an Orqiva token in a model's answer
//          never reach the stored trace, and the token is revoked; a scheduled run acts as the accountable
//          person.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { scriptedProvider, type ModelReply } from '../../src/agents/provider.js';
import { scheduleRuns } from '../../src/agents/triggers.js';
import { inSystem } from '../../src/db/pool.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

process.env['ORQIVA_SECRET_KEY'] = 'd5'.repeat(32);

type Step = { kind: string; content: Record<string, unknown> };

describe.skipIf(!hasDatabase)('agent scopes and trace redaction (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let project = '';
  let item = '';
  let replies: ModelReply[] = [];
  const agents: Record<string, string> = {};
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  const runOf = async (id: string): Promise<{ run: { status: string }; steps: Step[] }> => {
    const end = Date.now() + 10_000;
    for (;;) {
      const r = await t.call<{ run: { status: string }; steps: Step[] }>(
        ada,
        'GET',
        W('/agent-runs/' + id),
      );
      if (['succeeded', 'failed'].includes(r.body.run.status)) return r.body;
      if (Date.now() > end) throw new Error('run stayed ' + r.body.run.status);
      await new Promise((res) => setTimeout(res, 50));
    }
  };
  const start = async (key: string): Promise<string> =>
    (
      await t.call<{ id: string }>(ada, 'POST', W('/projects/' + project + '/agent-runs'), {
        agentId: agents[key],
        instruction: 'Work on it',
        itemId: item,
      })
    ).body.id;

  beforeAll(async () => {
    t = await startTestApp({
      agents: { provider: () => Promise.resolve(scriptedProvider(replies.splice(0))) },
    });
    ada = await t.signup('Ada');
    project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'HEL', name: 'Helio' })
    ).body.id;
    item = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects/' + project + '/items'), {
        title: 'Export cancelled appointments',
        description: 'The export leaves out cancelled appointments; add them with their reason.',
      })
    ).body.id;
    for (const a of (await t.call<{ id: string; key: string }[]>(ada, 'GET', W('/agents'))).body)
      agents[a.key] = a.id;
    await t.call(ada, 'PATCH', W('/agents/' + String(agents['developer'])), {
      scope: { files: ['src/**', 'test/**'], branches: ['agent/*'], network: ['*.github.com'] },
    });
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('answers whether a file, a branch or a host is in the scope', async () => {
    const r = await t.call<Record<string, { allowed: boolean; reason: string }>>(
      ada,
      'GET',
      W(
        '/agents/' +
          String(agents['developer']) +
          '/scope-check?file=src/a.ts&branch=main&host=api.github.com',
      ),
    );
    expect(r.body).toEqual({
      files: { allowed: true, reason: 'src/a.ts is in the files scope (src/**)' },
      branches: {
        allowed: false,
        reason: "main is outside Developer agent's branches scope (agent/*)",
      },
      network: { allowed: true, reason: 'api.github.com is in the network scope (*.github.com)' },
    });
  });

  it('gives orq the scope of the agent a task is assigned to', async () => {
    await t.call(ada, 'PATCH', W('/items/' + item), { agentId: agents['developer'] });
    const r = await t.call<{ rules: { agent?: unknown } }>(ada, 'POST', W('/loop/start'), {
      ref: 'HEL-1',
      client: 'laptop:repo',
    });
    expect(r.status).toBe(200);
    expect(r.body.rules.agent).toEqual({
      name: 'Developer agent',
      files: ['src/**', 'test/**'],
      branches: ['agent/*'],
    });
  });

  it('refuses fetch_url in a run when the host is outside the scope', async () => {
    await t.call(ada, 'PATCH', W('/agents/' + String(agents['analyst'])), {
      tools: ['get_item', 'fetch_url'],
    });
    replies = [
      {
        content: [
          { type: 'tool_use', id: 'f1', name: 'fetch_url', input: { url: 'https://example.com/' } },
        ],
        stopReason: 'tool_use',
        usage: { input: 10, output: 10 },
      },
    ];
    const d = await runOf(await start('analyst'));
    const result = d.steps.find((s) => s.kind === 'tool_result');
    expect(JSON.stringify(result?.content)).toContain(
      'Refused: Analyst agent may reach no host: its network scope is empty',
    );
  });

  it('keeps keys and tokens out of the stored trace and revokes a leaked token', async () => {
    const token = (await t.call<{ token: string }>(ada, 'POST', '/auth/tokens', { name: 'laptop' }))
      .body.token;
    const key = 'sk-ant-api03-' + 'k'.repeat(40);
    replies = [
      {
        content: [{ type: 'text', text: 'Found ' + key + ' and ' + token + ' in the logs.' }],
        stopReason: 'end_turn',
        usage: { input: 10, output: 10 },
      },
    ];
    const id = await start('analyst');
    const d = await runOf(id);
    const all = JSON.stringify(d.steps);
    expect(all).not.toContain(key);
    expect(all).not.toContain(token);
    const model = d.steps.find((s) => s.kind === 'model');
    expect(model?.content['redacted']).toEqual(['Orqiva token', 'Anthropic key']);
    // nothing in the database either
    const stored = await inSystem(t.db.pool, async (c) =>
      (
        await c.query<{ content: unknown }>('SELECT content FROM agent_steps WHERE run_id = $1', [
          id,
        ])
      ).rows
        .map((r) => JSON.stringify(r.content))
        .join(''),
    );
    expect(stored).not.toContain(key);
    const leak = await inSystem(
      t.db.pool,
      async (c) =>
        (
          await c.query<{ found_in: string; token_name: string }>(
            'SELECT found_in, token_name FROM token_leaks',
          )
        ).rows,
    );
    expect(leak).toEqual([{ found_in: 'trace', token_name: 'laptop' }]);
    expect(
      (await fetch(t.base + '/auth/me', { headers: { authorization: 'Bearer ' + token } })).status,
    ).toBe(401);
  });

  it('lets a scheduled run act as the agent’s accountable person', async () => {
    await t.call(ada, 'PATCH', W('/agents/' + String(agents['planner'])), {
      ownerId: ada.id,
      triggers: [{ kind: 'schedule', value: '30 9 * * *', project: 'HEL' }],
    });
    expect(await scheduleRuns(t.db.pool, ada.workspaceId, new Date('2026-10-12T07:30:20Z'))).toBe(
      1,
    );
    const run = await inSystem(
      t.db.pool,
      async (c) =>
        (
          await c.query<{ requested_by: string }>(
            "SELECT requested_by FROM agent_runs WHERE trigger_kind = 'schedule'",
          )
        ).rows[0],
    );
    expect(run?.requested_by).toBe(ada.id);
  });
});
