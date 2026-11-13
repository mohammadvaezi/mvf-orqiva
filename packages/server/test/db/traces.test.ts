// ── [PCODE-332 | S15 | v0.1.0] T33.4a Nested traces with latency and commits, agent rate limits, provider limits and health ──
//    Why:  against the real database and worker: steps keep their time and the turn they belong to, with
//          each tool's time; a run lists the commits for its task; an agent held to one run an hour keeps
//          the next one waiting; and calls through a connection make its health, down after a failure.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ProviderError, type ModelProvider } from '../../src/agents/provider.js';
import { inSystem } from '../../src/db/pool.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

process.env['ORQIVA_SECRET_KEY'] = 'ab'.repeat(32);

describe.skipIf(!hasDatabase)('traces, limits and health (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let project = '';
  let item = '';
  let analyst = '';
  let connection = '';
  let fail = false;
  // reads the task list, then answers; calls go through the test's connection
  const provider: ModelProvider = {
    name: 'demo',
    get connectionId() {
      return connection;
    },
    complete: async (req) => {
      await new Promise((r) => setTimeout(r, 20));
      if (fail) throw new ProviderError('overloaded');
      const answered = req.messages.at(-1)?.content.some((b) => b.type === 'tool_result');
      return answered
        ? {
            content: [{ type: 'text', text: 'Two tasks are open.' }],
            stopReason: 'end_turn',
            usage: { input: 400, output: 20 },
          }
        : {
            content: [{ type: 'tool_use', id: 'l1', name: 'list_items', input: {} }],
            stopReason: 'tool_use',
            usage: { input: 300, output: 10 },
          };
    },
  };
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  type Detail = {
    run: { status: string };
    steps: {
      seq: number;
      kind: string;
      latencyMs: number | null;
      parentSeq: number | null;
      content: Record<string, unknown>;
    }[];
    commits: { sha: string; message: string; reverted: boolean }[];
  };
  const start = async (): Promise<string> =>
    (
      await t.call<{ id: string }>(ada, 'POST', W('/projects/' + project + '/agent-runs'), {
        agentId: analyst,
        instruction: 'What is open?',
        itemId: item,
      })
    ).body.id;
  const until = async (id: string, statuses: string[], ms = 10_000): Promise<Detail> => {
    const end = Date.now() + ms;
    for (;;) {
      const r = (await t.call<Detail>(ada, 'GET', W('/agent-runs/' + id))).body;
      if (statuses.includes(r.run.status)) return r;
      if (Date.now() > end) throw new Error('run stayed ' + r.run.status);
      await new Promise((res) => setTimeout(res, 50));
    }
  };

  beforeAll(async () => {
    t = await startTestApp({ agents: { provider: () => Promise.resolve(provider) } });
    ada = await t.signup('Ada');
    project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'TRC', name: 'Traces' })
    ).body.id;
    item = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects/' + project + '/items'), {
        title: 'Open work',
      })
    ).body.id;
    analyst =
      (await t.call<{ id: string; key: string }[]>(ada, 'GET', W('/agents'))).body.find(
        (a) => a.key === 'analyst',
      )?.id ?? '';
    const c = await t.call<{ id: string; requestsPerMinute: number | null }>(
      ada,
      'POST',
      W('/ai/connections'),
      { provider: 'demo', label: 'Test line', requestsPerMinute: 100 },
    );
    expect(c.body.requestsPerMinute).toBe(100);
    connection = c.body.id;
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('times each step and nests tool results under their turn', async () => {
    const run = await start();
    const d = await until(run, ['succeeded']);
    expect(d.steps.map((x) => [x.seq, x.kind, x.parentSeq])).toEqual([
      [1, 'model', null],
      [2, 'tool_result', 1],
      [3, 'model', null],
    ]);
    expect(d.steps[0]?.latencyMs).toBeGreaterThanOrEqual(15);
    expect(d.steps[1]?.latencyMs).not.toBeNull();
    expect(d.steps[1]?.content['durations']).toEqual([
      expect.objectContaining({ toolUseId: 'l1', tool: 'list_items' }),
    ]);

    // commits for the task after the run started, not another task's
    const conn = (
      await t.call<{ connection: { id: string } }>(
        ada,
        'POST',
        W('/projects/' + project + '/git'),
        {
          provider: 'github',
          repo: 'acme/trc',
        },
      )
    ).body.connection.id;
    await inSystem(t.db.pool, (c) =>
      c.query(
        `INSERT INTO git_commits (connection_id, sha, workspace_id, project_id, message, committed_at, url, reverted_by)
         VALUES ($1, 'abcdef1', $2, $3, 'TRC-1: list open work\nbody', now() + interval '1 minute', 'https://example.test/c/abcdef1', NULL),
                ($1, 'abcdef2', $2, $3, 'TRC-12 other', now() + interval '1 minute', '', NULL),
                ($1, 'abcdef3', $2, $3, 'fix TRC-1 again', now() + interval '2 minutes', '', 'fffffff')`,
        [conn, ada.workspaceId, project],
      ),
    );
    const again = (await t.call<Detail>(ada, 'GET', W('/agent-runs/' + run))).body;
    expect(again.commits.map((g) => [g.sha, g.message, g.reverted])).toEqual([
      ['abcdef1', 'TRC-1: list open work', false],
      ['abcdef3', 'fix TRC-1 again', true],
    ]);
  });

  it('keeps a run waiting while its agent is at its runs an hour', async () => {
    const r = await t.call<{ runsPerHour: number | null }>(ada, 'PATCH', W('/agents/' + analyst), {
      runsPerHour: 1,
    });
    expect(r.body.runsPerHour).toBe(1);
    const held = await start();
    await new Promise((res) => setTimeout(res, 1500));
    expect((await t.call<Detail>(ada, 'GET', W('/agent-runs/' + held))).body.run.status).toBe(
      'queued',
    );
    await t.call(ada, 'PATCH', W('/agents/' + analyst), { runsPerHour: null });
    expect((await until(held, ['succeeded'], 15_000)).run.status).toBe('succeeded');
  });

  it('shows the connection’s health from its calls', async () => {
    type Conn = {
      id: string;
      health: { status: string; calls: number; failures: number; avgMs: number | null };
    };
    const ok = (
      await t.call<{ connections: Conn[] }>(ada, 'GET', W('/ai/connections'))
    ).body.connections.find((c) => c.id === connection);
    expect(ok?.health.status).toBe('ok');
    expect(ok?.health.calls).toBe(4);
    expect(ok?.health.avgMs).toBeGreaterThanOrEqual(15);
    fail = true;
    expect((await until(await start(), ['failed'])).run.status).toBe('failed');
    fail = false;
    const down = (
      await t.call<{ connections: Conn[] }>(ada, 'GET', W('/ai/connections'))
    ).body.connections.find((c) => c.id === connection);
    expect(down?.health).toMatchObject({ status: 'down', calls: 5, failures: 1 });
    const cleared = await t.call<{
      requestsPerMinute: number | null;
      tokensPerMinute: number | null;
    }>(ada, 'PATCH', W('/ai/connections/' + connection), {
      requestsPerMinute: null,
      tokensPerMinute: 5000,
    });
    expect(cleared.body).toMatchObject({ requestsPerMinute: null, tokensPerMinute: 5000 });
  });
});
