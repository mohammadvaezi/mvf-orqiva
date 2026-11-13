// ── [PCODE-335 | S15 | v0.1.0] T33.5 T33 exit check, docs and sprint close ──
//    Why:  the T33 exit as one team's path against the real server and worker, with a scripted model, the
//          demo judge, a stand-in GitHub and Orqiva's own MCP endpoint as the outside server. A run on a
//          task reads from the cache and is priced with it at the day's rate; it is judged, marked good and
//          its task done; the month charges it to the client with a unit cost; an estimate is given before
//          the next run; a playground experiment and an eval run go through; a run changes a file in its
//          sandbox and opens a pull request as the agent's bot; another calls an outside MCP tool; the
//          trace keeps each step's time; and the connection's health counts the calls.
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { usageCost } from '@orqiva/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  demoProvider,
  MODE_JUDGE,
  type ModelProvider,
  type ModelReply,
} from '../../src/agents/provider.js';
import { inSystem } from '../../src/db/pool.js';
import { listenFetchable, startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

process.env['ORQIVA_SECRET_KEY'] = '3c'.repeat(32);
const HOST_TOKEN = 'ghp_' + 't33exit'.repeat(5);

describe.skipIf(!hasDatabase)('T33 exit: agents and costs (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let project = '';
  let item = '';
  let analyst = '';
  let connection = '';
  let firstRun = '';
  const demo = demoProvider();
  const puts: Record<string, unknown>[] = [];
  const read = (req: IncomingMessage): Promise<Record<string, unknown>> =>
    new Promise((res) => {
      let b = '';
      req.on('data', (d: Buffer) => (b += d.toString()));
      req.on('end', () => {
        res(b ? (JSON.parse(b) as Record<string, unknown>) : {});
      });
    });
  const host = createServer((req, res) => {
    void (async () => {
      const u = new URL(req.url ?? '', 'http://x');
      const path = u.pathname.replace(/^\/repos\/acme\/xt/, '');
      const send = (status: number, body: unknown): void => {
        res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
      };
      if (req.headers.authorization !== 'Bearer ' + HOST_TOKEN) {
        send(401, { message: 'Bad credentials' });
        return;
      }
      const body = await read(req);
      const file = /^\/contents\/(.+)$/.exec(path)?.[1];
      if (req.method === 'GET' && path === '') send(200, { default_branch: 'main' });
      else if (req.method === 'GET' && file)
        send(200, {
          sha: 's1',
          content: Buffer.from('export const rows = [];\n').toString('base64'),
        });
      else if (req.method === 'GET' && path === '/git/ref/heads/main')
        send(200, { object: { sha: 'abc' } });
      else if (req.method === 'POST' && path === '/git/refs') send(201, {});
      else if (req.method === 'PUT' && file) {
        puts.push(body);
        send(200, {});
      } else if (req.method === 'POST' && path === '/pulls')
        send(201, { number: 7, html_url: 'https://github.test/acme/xt/pull/7' });
      else send(404, { message: 'Not Found' });
    })();
  });

  // the instruction says what the scripted model does; the judge is the demo Reviewer
  const usage = { input: 1000, output: 100, cacheRead: 9000 };
  const say = (text: string): ModelReply => ({
    content: [{ type: 'text', text }],
    stopReason: 'end_turn',
    usage,
  });
  const use = (name: string, input: Record<string, unknown>): ModelReply => ({
    content: [{ type: 'tool_use', id: name + '-1', name, input }],
    stopReason: 'tool_use',
    usage,
  });
  const provider: ModelProvider = {
    name: 'demo',
    get connectionId() {
      return connection;
    },
    complete: (req) => {
      if (req.system.includes(MODE_JUDGE)) return demo.complete(req);
      const ask = req.messages[0]?.content.find((b) => b.type === 'text')?.text ?? '';
      const turn = req.messages.filter((m) => m.role === 'assistant').length;
      if (ask.includes('Change the file'))
        return Promise.resolve(
          [
            use('write_file', { path: 'src/rows.ts', text: 'export const rows = ["header"];\n' }),
            use('open_pull_request', { title: 'Add the header row' }),
          ][turn] ?? say('Opened the pull request.'),
        );
      if (ask.includes('Use the outside tool'))
        return Promise.resolve(
          turn ? say('XT is the only project.') : use('mcp_self__list_projects', {}),
        );
      return Promise.resolve(say('The export needs a header row.'));
    },
  };
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  const P = (p: string): string => W('/projects/' + project + p);
  const sys = <T>(sql: string, args: unknown[] = []): Promise<T[]> =>
    inSystem(t.db.pool, async (c) => (await c.query(sql, args)).rows as T[]);
  type Detail = {
    run: { status: string; sandboxPrUrl: string };
    steps: {
      kind: string;
      latencyMs: number | null;
      parentSeq: number | null;
      content: Record<string, unknown>;
    }[];
  };
  const finished = async (id: string): Promise<Detail> => {
    const end = Date.now() + 20_000;
    for (;;) {
      const d = (await t.call<Detail>(ada, 'GET', W('/agent-runs/' + id))).body;
      if (['succeeded', 'failed'].includes(d.run.status)) return d;
      if (Date.now() > end) throw new Error('run stayed ' + d.run.status);
      await new Promise((r) => setTimeout(r, 50));
    }
  };
  const start = async (instruction: string, itemId?: string): Promise<string> =>
    (
      await t.call<{ id: string }>(ada, 'POST', P('/agent-runs'), {
        agentId: analyst,
        instruction,
        ...(itemId ? { itemId } : {}),
      })
    ).body.id;

  beforeAll(async () => {
    await listenFetchable(host);
    t = await startTestApp({ agents: { provider: () => Promise.resolve(provider) } });
    ada = await t.signup('Ada');
    project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'XT', name: 'Exports' })
    ).body.id;
    item = (await t.call<{ id: string }>(ada, 'POST', P('/items'), { title: 'Export as CSV' })).body
      .id;
    const client = (
      await sys<{ id: string }>(
        "INSERT INTO clients (workspace_id, name, short_name) VALUES ($1, 'Nordwind Logistik GmbH', 'Nordwind') RETURNING id",
        [ada.workspaceId],
      )
    )[0]?.id;
    await sys('UPDATE projects SET client_id = $2 WHERE id = $1', [project, client]);
    await t.call(ada, 'PATCH', W('/projects/' + project), { costCentre: '4711 Logistics' });
    const agent = (
      await t.call<{ id: string; key: string; tools: string[] }[]>(ada, 'GET', W('/agents'))
    ).body.find((a) => a.key === 'analyst');
    analyst = agent?.id ?? '';
    await t.call(ada, 'PATCH', W('/agents/' + analyst), {
      tools: [...(agent?.tools ?? []), 'read_repo_file', 'write_file', 'open_pull_request'],
      autonomy: 'autonomous',
      scope: { files: ['src/**'], branches: ['agent/*'] },
    });
    await t.call(ada, 'PUT', W('/agents/' + analyst + '/rules'), { rules: { push: 'allowed' } });
    // $2000 per million input tokens makes the cents readable; no cache price, so the usual shares apply
    await t.call(ada, 'PUT', W('/agents/provider'), {
      provider: 'demo',
      inputPricePerMillion: 2000,
      outputPricePerMillion: 0,
    });
    connection = (
      await t.call<{ id: string }>(ada, 'POST', W('/ai/connections'), {
        provider: 'demo',
        label: 'Exit line',
        requestsPerMinute: 1000,
      })
    ).body.id;
    const git = (
      await t.call<{ connection: { id: string } }>(ada, 'POST', P('/git'), {
        provider: 'github',
        repo: 'acme/xt',
      })
    ).body.connection.id;
    await t.call(ada, 'PUT', W('/git/' + git + '/api'), {
      token: HOST_TOKEN,
      apiUrl: 'http://127.0.0.1:' + String((host.address() as AddressInfo).port),
    });
  }, 60_000);

  afterAll(async () => {
    await t.stop();
    await new Promise((r) => host.close(r));
  });

  it('prices a run with its cache at the day’s rate, and times its steps', async () => {
    firstRun = await start('Review the export', item);
    const d = await finished(firstRun);
    expect(d.run.status).toBe('succeeded');
    expect(d.steps[0]?.latencyMs).not.toBeNull();
    const row = (
      await sys<{
        cost_micros: string;
        tokens_cache_read: string;
        usd_eur: number | null;
        today: number | null;
      }>(
        `SELECT cost_micros, tokens_cache_read, usd_eur,
                (SELECT usd_eur::real FROM fx_rates WHERE day <= current_date ORDER BY day DESC LIMIT 1) AS today
           FROM agent_runs WHERE id = $1`,
        [firstRun],
      )
    )[0];
    expect(Number(row?.tokens_cache_read)).toBe(9000);
    expect(Number(row?.cost_micros)).toBe(usageCost(usage, { in: 2_000_000_000, out: 0 }));
    expect(row?.usd_eur ?? null).toBe(row?.today ?? null);
  });

  it('judges it, keeps what people say and follows its task to done', async () => {
    const Q = W('/agent-runs/' + firstRun);
    expect(
      (await t.call<{ judge: { score: number } }>(ada, 'POST', Q + '/judge')).body.judge.score,
    ).toBe(4);
    await t.call(ada, 'PUT', Q + '/annotation', { verdict: 'good', tags: ['saved time'] });
    await sys("UPDATE items SET completed_at = now() + interval '1 second' WHERE id = $1", [item]);
    const q = (
      await t.call<{ outcome: string; annotations: unknown[] }>(ada, 'GET', Q + '/quality')
    ).body;
    expect(q.outcome).toBe('done');
    expect(q.annotations).toHaveLength(1);
    const board = (
      await t.call<{ agentId: string; good: number; judgeAvg: number | null }[]>(
        ada,
        'GET',
        W('/agent-quality'),
      )
    ).body.find((r) => r.agentId === analyst);
    expect(board).toMatchObject({ good: 1, judgeAvg: 4 });
  });

  it('charges the month to the client and the cost centre, prices a result and estimates the next run', async () => {
    const c = (
      await t.call<{
        byClient: { group: string; runs: number }[];
        byCostCentre: { group: string }[];
        units: { tasksDone: number; perTaskCents: number | null };
      }>(ada, 'GET', W('/agent-costs'))
    ).body;
    expect(c.byClient.map((x) => x.group)).toEqual(['Nordwind Logistik GmbH']);
    expect(c.byCostCentre.map((x) => x.group)).toEqual(['4711 Logistics']);
    expect(c.units.tasksDone).toBe(1);
    expect(c.units.perTaskCents).toBeGreaterThan(0);
    const csv = await fetch(t.base + W('/agent-costs/chargeback?by=cost-centre'), {
      headers: { cookie: ada.cookie },
    });
    expect(await csv.text()).toContain('"4711 Logistics","XT"');
    const e = (
      await t.call<{ basis: string; midCents: number }>(ada, 'POST', P('/agent-runs/estimate'), {
        agentId: analyst,
        instruction: 'Review the export again',
      })
    ).body;
    expect(e.basis).toBe('rough');
    expect(e.midCents).toBeGreaterThan(0);
  });

  it('tries the agent in the playground and in an eval, without acting', async () => {
    const x = await t.call<{ id: string }>(ada, 'POST', P('/agent-experiments'), {
      name: 'Cool against warm',
      agentId: analyst,
      instruction: 'Review the export',
      variants: [
        { label: 'cool', temperature: 0.1 },
        { label: 'warm', temperature: 0.9 },
      ],
    });
    expect(x.status).toBe(201);
    const set = (
      await t.call<{ id: string }>(ada, 'POST', P('/agent-eval-sets'), {
        agentId: analyst,
        name: 'Export reviews',
      })
    ).body.id;
    await t.call(ada, 'POST', W('/agent-eval-sets/' + set + '/cases'), {
      fromRunId: firstRun,
      mustContain: ['header row'],
      minJudge: 3,
    });
    const er = (
      await t.call<{ id: string }>(ada, 'POST', W('/agent-eval-sets/' + set + '/runs'), {
        label: 'as is',
      })
    ).body.id;
    const end = Date.now() + 20_000;
    for (;;) {
      const r = (
        await t.call<{ cases: { result: string }[] }>(ada, 'GET', W('/agent-eval-runs/' + er))
      ).body;
      if (!r.cases.some((k) => k.result === 'running')) break;
      if (Date.now() > end) throw new Error('eval did not finish');
      await new Promise((res) => setTimeout(res, 100));
    }
    const judged = (
      await t.call<{ passRate: number | null }>(ada, 'POST', W('/agent-eval-runs/' + er + '/judge'))
    ).body;
    expect(judged.passRate).toBe(1);
    const exp = (
      await t.call<{ variants: { finished: number }[] }>(
        ada,
        'GET',
        W('/agent-experiments/' + x.body.id),
      )
    ).body;
    expect(exp.variants.map((v) => v.finished)).toEqual([1, 1]);
  });

  it('changes a file in its sandbox and opens a pull request as its bot', async () => {
    const id = await start('Change the file to add the header row');
    const d = await finished(id);
    expect(d.run.sandboxPrUrl).toBe('https://github.test/acme/xt/pull/7');
    expect(puts[0]?.['author']).toEqual({
      name: 'Analyst agent (Orqiva)',
      email: 'analyst@agents.orqiva.local',
    });
    expect(String(puts[0]?.['message'])).toContain('Orqiva-Run: ' + id);
    expect(d.steps.find((x) => x.kind === 'tool_result')?.parentSeq).toBe(1);
  });

  it('calls an outside MCP tool and counts the connection’s calls', async () => {
    const tokenRes = await fetch(t.base + '/auth/tokens', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'mcp', email: ada.email, password: 'a test password 1' }),
    });
    const token = ((await tokenRes.json()) as { token: string }).token;
    const server = (
      await t.call<{ id: string }>(ada, 'POST', W('/mcp-servers'), {
        name: 'self',
        url: t.base + '/mcp/' + ada.workspaceId,
        secret: token,
        actionClass: 'read',
        allowedTools: ['list_projects'],
      })
    ).body.id;
    await t.call(ada, 'PATCH', W('/agents/' + analyst), { mcpServers: [server] });
    const d = await finished(await start('Use the outside tool to list the projects'));
    const result = (
      d.steps.find((x) => x.kind === 'tool_result')?.content['results'] as { content: string }[]
    )[0];
    expect(result?.content).toContain('XT');
    const health = (
      await t.call<{ connections: { id: string; health: { status: string; calls: number } }[] }>(
        ada,
        'GET',
        W('/ai/connections'),
      )
    ).body.connections.find((c) => c.id === connection)?.health;
    expect(health?.status).toBe('ok');
    expect(health?.calls).toBeGreaterThanOrEqual(8);
  });
});
