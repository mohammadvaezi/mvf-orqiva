// ── [PCODE-333 | S15 | v0.1.0] T33.4b Sandbox per run with repo tools, pull requests by a bot Git identity ──
//    Why:  against the real database, worker and a stand-in GitHub: a run reads the repository, writes
//          only into its sandbox (inside its file scope), and cannot push until an admin allows it; then
//          its pull request is committed by the agent's bot identity with the run in a trailer, and the run
//          links to that commit.
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ModelProvider, ModelReply } from '../../src/agents/provider.js';
import { inSystem } from '../../src/db/pool.js';
import { listenFetchable, startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

process.env['ORQIVA_SECRET_KEY'] = 'ab'.repeat(32);
const TOKEN = 'ghp_' + 'z'.repeat(36);

describe.skipIf(!hasDatabase)('agent sandbox (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let project = '';
  let analyst = '';
  const branches = new Map([['main', new Map([['src/app.ts', 'export const a = 1;\n']])]]);
  const puts: Record<string, unknown>[] = [];
  const pulls: Record<string, unknown>[] = [];
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
      const path = u.pathname.replace(/^\/repos\/acme\/app/, '');
      const send = (status: number, body: unknown): void => {
        res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
      };
      if (req.headers.authorization !== 'Bearer ' + TOKEN) {
        send(401, { message: 'Bad credentials' });
        return;
      }
      const body = await read(req);
      const file = /^\/contents\/(.+)$/.exec(path)?.[1];
      if (req.method === 'GET' && path === '') send(200, { default_branch: 'main' });
      else if (req.method === 'GET' && file) {
        const text = branches
          .get(u.searchParams.get('ref') ?? 'main')
          ?.get(decodeURIComponent(file));
        if (text === undefined) send(404, { message: 'Not Found' });
        else send(200, { sha: 'sha-' + file, content: Buffer.from(text).toString('base64') });
      } else if (req.method === 'GET' && path === '/git/ref/heads/main')
        send(200, { object: { sha: 'abc123' } });
      else if (req.method === 'POST' && path === '/git/refs') {
        branches.set(String(body['ref']).replace('refs/heads/', ''), new Map(branches.get('main')));
        send(201, {});
      } else if (req.method === 'PUT' && file) {
        puts.push({ ...body, path: decodeURIComponent(file) });
        send(200, {});
      } else if (req.method === 'POST' && path === '/pulls') {
        pulls.push(body);
        send(201, {
          number: pulls.length,
          html_url: 'https://github.test/acme/app/pull/' + String(pulls.length),
        });
      } else send(404, { message: 'Not Found' });
    })();
  });

  // read, write three files (one outside the repository, one outside the scope), open a pull request
  const turn = (content: ModelReply['content']): ModelReply => ({
    content,
    stopReason: content.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn',
    usage: { input: 200, output: 20 },
  });
  const use = (id: string, name: string, input: Record<string, unknown>) =>
    ({ type: 'tool_use', id, name, input }) as const;
  const provider: ModelProvider = {
    name: 'scripted',
    complete: (req) => {
      const n = req.messages.filter((m) => m.role === 'assistant').length;
      return Promise.resolve(
        [
          turn([use('r', 'read_repo_file', { path: 'src/app.ts' })]),
          turn([
            use('w1', 'write_file', { path: 'src/app.ts', text: 'export const a = 2;\n' }),
            use('w2', 'write_file', { path: '../etc/passwd', text: 'x' }),
            use('w3', 'write_file', { path: 'secrets/key.txt', text: 'x' }),
            use('w4', 'write_file', { path: 'docs/new.md', text: '# New\n' }),
          ]),
          turn([use('p', 'open_pull_request', { title: 'Raise a', body: 'a is 2 now.' })]),
          turn([{ type: 'text', text: 'Done.' }]),
        ][n] ?? turn([{ type: 'text', text: 'Done.' }]),
      );
    },
  };
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  type Detail = {
    run: { status: string; sandboxPrUrl: string };
    steps: { kind: string; content: { results?: { content: string }[] } }[];
    commits: { sha: string }[];
  };
  const runOnce = async (): Promise<{ id: string; results: string[] }> => {
    const id = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects/' + project + '/agent-runs'), {
        agentId: analyst,
        instruction: 'Raise a to 2',
      })
    ).body.id;
    const end = Date.now() + 15_000;
    for (;;) {
      const d = (await t.call<Detail>(ada, 'GET', W('/agent-runs/' + id))).body;
      if (d.run.status === 'succeeded' || d.run.status === 'failed')
        return {
          id,
          results: d.steps
            .flatMap((x) => (x.kind === 'tool_result' ? (x.content.results ?? []) : []))
            .map((x) => x.content),
        };
      if (Date.now() > end) throw new Error('run stayed ' + d.run.status);
      await new Promise((r) => setTimeout(r, 50));
    }
  };

  beforeAll(async () => {
    await listenFetchable(host);
    t = await startTestApp({ agents: { provider: () => Promise.resolve(provider) } });
    ada = await t.signup('Ada');
    project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'SBX', name: 'Sandbox' })
    ).body.id;
    const agent = (
      await t.call<{ id: string; key: string; tools: string[] }[]>(ada, 'GET', W('/agents'))
    ).body.find((a) => a.key === 'analyst');
    analyst = agent?.id ?? '';
    const r = await t.call(ada, 'PATCH', W('/agents/' + analyst), {
      tools: [...(agent?.tools ?? []), 'read_repo_file', 'write_file', 'open_pull_request'],
      autonomy: 'autonomous',
      scope: { files: ['src/**', 'docs/**'], branches: ['agent/*'] },
    });
    expect(r.status).toBe(200);
    const conn = (
      await t.call<{ connection: { id: string } }>(
        ada,
        'POST',
        W('/projects/' + project + '/git'),
        {
          provider: 'github',
          repo: 'acme/app',
        },
      )
    ).body.connection.id;
    await t.call(ada, 'PUT', W('/git/' + conn + '/api'), {
      token: TOKEN,
      apiUrl: 'http://127.0.0.1:' + String((host.address() as AddressInfo).port),
    });
  }, 60_000);

  afterAll(async () => {
    await t.stop();
    await new Promise((r) => host.close(r));
  });

  it('reads the repository and writes only into its sandbox; pushing is not allowed yet', async () => {
    const { id, results } = await runOnce();
    expect(results[0]).toContain('"from":"repository"');
    expect(results[0]).toContain('export const a = 1;');
    expect(results[1]).toContain('"from":"repository"');
    expect(results[2]).toBe('That path is not inside the repository');
    expect(results[3]).toMatch(/^Refused: /);
    expect(results[4]).toContain('"from":"new"');
    expect(results[5]).toBe('The rules of this agent do not allow open_pull_request');
    expect(puts).toHaveLength(0);
    const sb = await t.call<{ files: { path: string; state: string }[]; pullRequest: string }>(
      ada,
      'GET',
      W('/agent-runs/' + id + '/sandbox'),
    );
    expect(sb.body.files.map((f) => [f.path, f.state])).toEqual([
      ['docs/new.md', 'new'],
      ['src/app.ts', 'changed'],
    ]);
    expect(sb.body.pullRequest).toBe('');
  });

  it('opens the pull request as the agent once an admin allows pushing', async () => {
    await t.call(ada, 'PUT', W('/agents/' + analyst + '/rules'), { rules: { push: 'allowed' } });
    const { id, results } = await runOnce();
    expect(results[5]).toContain('"url":"https://github.test/acme/app/pull/1"');
    expect(puts.map((p) => p['path'])).toEqual(['docs/new.md', 'src/app.ts']);
    expect(puts[0]?.['author']).toEqual({
      name: 'Analyst agent (Orqiva)',
      email: 'analyst@agents.orqiva.local',
    });
    expect(puts[0]?.['committer']).toEqual(puts[0]?.['author']);
    expect(String(puts[0]?.['message'])).toBe('Raise a\n\nOrqiva-Run: ' + id);
    expect(String(puts[0]?.['branch'])).toBe('agent/analyst-' + id.slice(0, 8));
    expect(String(pulls[0]?.['body'])).toContain('Orqiva run ' + id);
    const d = (await t.call<Detail>(ada, 'GET', W('/agent-runs/' + id))).body;
    expect(d.run.sandboxPrUrl).toBe('https://github.test/acme/app/pull/1');

    // the commit the host reports back names the run, and the run lists it
    const conn = await inSystem(
      t.db.pool,
      async (c) =>
        (
          await c.query<{ id: string }>('SELECT id FROM git_connections WHERE project_id = $1', [
            project,
          ])
        ).rows[0]?.id,
    );
    await inSystem(t.db.pool, (c) =>
      c.query(
        `INSERT INTO git_commits (connection_id, sha, workspace_id, project_id, message, committed_at)
         VALUES ($1, 'abc1234', $2, $3, $4, now() + interval '1 minute')`,
        [conn, ada.workspaceId, project, 'Raise a\n\nOrqiva-Run: ' + id],
      ),
    );
    const again = (await t.call<Detail>(ada, 'GET', W('/agent-runs/' + id))).body;
    expect(again.commits.map((g) => g.sha)).toEqual(['abc1234']);
  });
});
