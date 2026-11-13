// ── [PCODE-365 | S15 | v0.1.0] T36.1 Test suite stability ──
// ── [PCODE-312 | S15 | v0.1.0] T31.10 T31 exit check, docs and sprint close ──
//    Why:  the T31 exit as one team's path, end to end against the real server and a stand-in GitHub (its
//          recorded answers): commits and a tag arrive by webhook and plan the next version; a pull request
//          for a task lands in the review queue with its changed files read from the host; a line comment
//          and an approval are posted to the host; the merge policy passes and the merge queue merges it;
//          the merge closes the task; the code scan draws the architecture; an MCP client reads the code
//          and the pull request; and two environments are compared.
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inSystem } from '../../src/db/pool.js';
import { sign } from '../../src/git/webhook.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';
import { listenFetchable } from '../ports.js'; // [PCODE-365 | S15 | v0.1.0]

process.env['ORQIVA_SECRET_KEY'] = 'ab'.repeat(32);
const TOKEN = 'host-token-for-the-exit-stand-in';
const HEAD = 'a7'.repeat(20);
const sha = (c: string): string => c.repeat(40);
const book = (dir: string): Record<string, unknown> =>
  JSON.parse(
    readFileSync(new URL('../fixtures/' + dir + '/github.json', import.meta.url), 'utf8'),
  ) as Record<string, unknown>;
// one GitHub: the changed files (kept by path), the review answer, the mergeability and the merge
const ANSWERS: Record<string, unknown> = {
  ...Object.fromEntries(Object.entries(book('prfiles')).map(([k, v]) => ['GET ' + k, v])),
  ...book('prwrite'),
  ...book('prmerge'),
};

interface Sent {
  method: string;
  path: string;
  body: Record<string, unknown> | null;
}

describe.skipIf(!hasDatabase)('T31 exit: code review and versions (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let host: Server;
  let project = '';
  let item = '';
  let pull = '';
  let token = '';
  const conn = { id: '', path: '', secret: '' };
  const sent: Sent[] = [];
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  const P = (p: string): string => W('/projects/' + project + p);
  const sys = <T>(sql: string, args: unknown[] = []): Promise<T[]> =>
    inSystem(t.db.pool, async (c) => (await c.query(sql, args)).rows as T[]);
  const github = async (event: string, payload: Record<string, unknown>): Promise<void> => {
    const body = Buffer.from(
      JSON.stringify({
        repository: { full_name: 'acme/shop', default_branch: 'main' },
        ...payload,
      }),
    );
    const res = await fetch(t.base + conn.path, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-github-event': event,
        'x-hub-signature-256': 'sha256=' + sign(conn.secret, body),
      },
      body,
    });
    expect(res.status).toBe(200);
  };
  let minute = 0;
  const push = (ref: string, commits: { id: string; message: string; files?: string[] }[]) =>
    github('push', {
      ref,
      after: commits.at(-1)?.id,
      commits: commits.map((c) => ({
        id: c.id,
        message: c.message,
        url: 'https://github.com/acme/shop/commit/' + c.id,
        timestamp: new Date(Date.UTC(2026, 9, 13, 9, minute++)).toISOString(),
        author: { name: 'Ada', username: 'ada' },
        added: [],
        modified: c.files ?? [],
        removed: [],
      })),
    });
  const pullRequest = (action: string, extra: Record<string, unknown> = {}) =>
    github('pull_request', {
      action,
      number: 7,
      pull_request: {
        number: 7,
        title: 'SHOP-1 Cart keeps items between visits',
        body: 'Closes SHOP-1.',
        html_url: 'https://github.com/acme/shop/pull/7',
        state: 'open',
        draft: false,
        user: { login: 'bob' },
        head: { ref: 'feature/cart', sha: HEAD },
        base: { ref: 'main' },
        additions: 5,
        deletions: 0,
        changed_files: 4,
        created_at: '2026-10-13T09:30:00Z',
        updated_at: '2026-10-13T09:30:00Z',
        ...extra,
      },
    });
  const mcp = async (name: string, args: Record<string, unknown>) => {
    const res = await fetch(t.base + '/mcp/' + ada.workspaceId, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name, arguments: args },
      }),
    });
    const r = ((await res.json()) as { result: { isError: boolean; content: { text: string }[] } })
      .result;
    expect(r.isError).toBe(false);
    return JSON.parse(r.content[0]?.text ?? '{}') as Record<string, unknown>;
  };

  beforeAll(async () => {
    host = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const path = (req.url ?? '').split('?')[0] ?? '';
        const method = req.method ?? 'GET';
        const text = Buffer.concat(chunks).toString('utf8');
        sent.push({
          method,
          path,
          body: text ? (JSON.parse(text) as Record<string, unknown>) : null,
        });
        const answer = ANSWERS[method + ' ' + path];
        if (req.headers['authorization'] !== 'Bearer ' + TOKEN || answer === undefined) {
          res.writeHead(answer === undefined ? 404 : 401, { 'content-type': 'application/json' });
          res.end('{"message":"Not Found"}');
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        // the files come in pages; the second is empty
        const page = new URL(req.url ?? '/', 'http://x').searchParams.get('page');
        res.end(JSON.stringify(page && page !== '1' ? [] : answer));
      });
    });
    await listenFetchable(host); // [PCODE-365 | S15 | v0.1.0]
    const base = 'http://127.0.0.1:' + String((host.address() as AddressInfo).port);

    t = await startTestApp();
    ada = await t.signup('Ada');
    project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'SHOP', name: 'Shop' })
    ).body.id;
    item = (
      await t.call<{ id: string }>(ada, 'POST', P('/items'), {
        title: 'Cart keeps items between visits',
      })
    ).body.id;
    const r = await t.call<{ connection: { id: string; webhookPath: string }; secret: string }>(
      ada,
      'POST',
      P('/git'),
      { provider: 'github', repo: 'acme/shop' },
    );
    Object.assign(conn, {
      id: r.body.connection.id,
      path: r.body.connection.webhookPath,
      secret: r.body.secret,
    });
    await t.call(ada, 'PUT', W('/git/' + conn.id + '/api'), { token: TOKEN, apiUrl: base });
    const tok = await fetch(t.base + '/auth/tokens', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'mcp', email: ada.email, password: 'a test password 1' }),
    });
    token = ((await tok.json()) as { token: string }).token;
  }, 60_000);

  afterAll(async () => {
    await t.stop();
    host.close();
  });

  it('keeps the history from the webhooks and plans the next version from it', async () => {
    await push('refs/heads/main', [{ id: sha('1'), message: 'feat: the shop opens' }]);
    await github('push', { ref: 'refs/tags/v1.2.0', after: sha('1'), commits: [] });
    await push('refs/heads/main', [
      { id: sha('2'), message: 'feat(cart): keep items between visits', files: ['src/cart.ts'] },
      { id: sha('3'), message: 'fix: totals round to cents', files: ['src/money.ts'] },
    ]);
    const refs = await sys<{ kind: string; name: string }>(
      'SELECT kind, name FROM git_refs WHERE connection_id = $1 ORDER BY kind, name',
      [conn.id],
    );
    expect(refs.map((x) => x.kind + ' ' + x.name)).toEqual(['branch main', 'tag v1.2.0']);
    const [plan] = (
      await t.call<{ lastTag: string; commits: number; bump: string; next: string }[]>(
        ada,
        'GET',
        P('/version-plan'),
      )
    ).body;
    expect(plan).toMatchObject({ lastTag: 'v1.2.0', commits: 2, bump: 'minor', next: '1.3.0' });
  });

  it('puts the pull request in the review queue with its files from the host', async () => {
    await pullRequest('opened');
    const queue = (
      await t.call<{ id: string; number: number; itemRef: string | null }[]>(
        ada,
        'GET',
        P('/review-queue'),
      )
    ).body;
    expect(queue.map((q) => [q.number, q.itemRef])).toEqual([[7, 'SHOP-1']]);
    pull = queue[0]?.id ?? '';
    const files = await t.call<{ files: { path: string; status: string }[] }>(
      ada,
      'GET',
      W('/pull-requests/' + pull + '/files'),
    );
    expect(files.body.files.map((f) => f.path + ' ' + f.status)).toEqual([
      'src/cart.ts modified',
      'server/migrations/0007_cart.sql added',
      'README.md modified',
      'assets/logo.png modified',
    ]);
    expect(sent.at(-1)?.path).toBe('/repos/acme/shop/pulls/7/files');
  });

  it('posts a line comment with an approval to the host', async () => {
    expect(
      (
        await t.call(ada, 'POST', W('/pull-requests/' + pull + '/comments'), {
          path: 'src/cart.ts',
          line: 5,
          body: 'Save after remove, too.',
        })
      ).status,
    ).toBe(201);
    const r = await t.call<{ posted: number }>(
      ada,
      'POST',
      W('/pull-requests/' + pull + '/reviews'),
      {
        decision: 'approve',
        body: 'Good to go.',
      },
    );
    expect(r.body.posted).toBe(1);
    const review = sent.find((x) => x.method === 'POST' && x.path.endsWith('/pulls/7/reviews'));
    expect(review?.body).toMatchObject({
      event: 'APPROVE',
      comments: [{ path: 'src/cart.ts', line: 5, side: 'RIGHT' }],
    });
  });

  it('passes the merge policy and merges through the queue', async () => {
    await t.call(ada, 'PUT', P('/merge-policy'), {
      requireTask: true,
      requireFingerprints: false,
      requireApproval: true,
      requireChecks: false,
      requireSensitiveApproval: false,
      blockConflicts: true,
      postStatus: false,
    });
    const v = await t.call<{ state: string; rules: { key: string; state: string }[] }>(
      ada,
      'POST',
      W('/pull-requests/' + pull + '/policy/check'),
    );
    expect(v.body.rules.map((x) => [x.key, x.state])).toEqual([
      ['requireTask', 'met'],
      ['requireApproval', 'met'],
      ['blockConflicts', 'met'],
    ]);
    expect(v.body.state).toBe('success');
    expect(
      (await t.call(ada, 'POST', W('/pull-requests/' + pull + '/queue'), { method: 'squash' }))
        .status,
    ).toBe(201);
    const out = await t.call<{ outcome: string; number: number }>(
      ada,
      'POST',
      P('/merge-queue/next'),
      { lane: conn.id + ':main' },
    );
    expect(out.body).toMatchObject({ outcome: 'merged', number: 7 });
    expect(sent.find((x) => x.method === 'PUT')?.body).toMatchObject({
      merge_method: 'squash',
      sha: HEAD,
    });
  });

  it('closes the task when the merge comes back from the host', async () => {
    await pullRequest('closed', {
      state: 'closed',
      merged: true,
      merged_at: '2026-10-13T10:00:00Z',
    });
    const [state] = await sys<{ grp: string }>(
      'SELECT st.grp FROM items i JOIN project_states st ON st.id = i.state_id WHERE i.id = $1',
      [item],
    );
    expect(state?.grp).toBe('completed');
  });

  it('draws the architecture and answers an MCP client about the code and the review', async () => {
    await t.call(ada, 'POST', P('/code-scan'), {
      full: true,
      files: [
        { path: 'src/cart.ts', lines: 60, imports: ['src/money.ts'], authors: { bob: 60 } },
        { path: 'src/money.ts', lines: 30, imports: [], authors: { ada: 30 } },
        { path: 'web/cart.tsx', lines: 90, imports: ['src/cart.ts'], authors: { ada: 90 } },
      ],
    });
    const g = await t.call<{ edges: { from: string; to: string }[]; cycles: string[][] }>(
      ada,
      'GET',
      P('/code-map/graph?depth=1'),
    );
    expect(g.body.edges).toEqual([{ from: 'web', to: 'src', imports: 1 }]);
    expect(g.body.cycles).toEqual([]);
    const deps = await mcp('code_dependencies', { project: 'SHOP', path: 'src/cart.ts' });
    expect(deps).toMatchObject({
      imports: [{ path: 'src/money.ts', count: 1 }],
      importedBy: [{ path: 'web/cart.tsx', count: 1 }],
    });
    const pr = await mcp('get_pull_request', { project: 'SHOP', number: 7 });
    expect(pr).toMatchObject({ state: 'merged', task: 'SHOP-1', reviewState: 'approved' });
    expect(pr['comments']).toEqual([
      expect.objectContaining({ path: 'src/cart.ts', line: 5, state: 'posted' }),
    ]);
  });

  it('compares two environments, secrets without their values', async () => {
    const env: Record<string, string> = {};
    for (const key of ['staging', 'production'])
      env[key] = (
        await t.call<{ id: string }>(ada, 'POST', P('/environments'), {
          key,
          name: key,
          kind: 'compose',
          settings: { dir: '/srv/' + key, file: 'compose.yaml' },
        })
      ).body.id;
    await t.call(ada, 'PUT', W('/environments/' + (env['staging'] ?? '') + '/vars/LOG_LEVEL'), {
      value: 'debug',
    });
    await t.call(ada, 'PUT', W('/environments/' + (env['production'] ?? '') + '/vars/LOG_LEVEL'), {
      value: 'info',
    });
    for (const [e, v] of [
      ['staging', 'postgres://staging'],
      ['production', 'postgres://production'],
    ] as const)
      await t.call(ada, 'PUT', W('/environments/' + (env[e] ?? '') + '/secrets/DATABASE_URL'), {
        value: v,
      });
    const d = await t.call<{
      rows: { area: string; name: string; a: string; b: string; state: string }[];
    }>(ada, 'GET', P('/env-diff?a=' + (env['staging'] ?? '') + '&b=' + (env['production'] ?? '')));
    expect(d.body.rows.map((x) => [x.area, x.name, x.a, x.b, x.state])).toEqual(
      expect.arrayContaining([
        ['variable', 'LOG_LEVEL', 'debug', 'info', 'different'],
        ['secret', 'DATABASE_URL', 'set', 'set', 'different'],
      ]),
    );
    expect(JSON.stringify(d.body)).not.toContain('postgres://');
  });
});
