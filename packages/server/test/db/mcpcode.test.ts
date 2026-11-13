// ── [PCODE-310 | S15 | v0.1.0] T31.9a MCP tools for the code map and pull requests ──
//    Why:  an MCP client reads the code map by folder, what a file depends on and what depends on it, the
//          project's pull requests and one of them with a file's numbered patch, and leaves a draft comment
//          that only its person sees; a guest is refused, and wrong lines and unknown numbers come back as
//          the tool's error text.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inSystem } from '../../src/db/pool.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

const HEAD = 'c4'.repeat(20);
const PATCH =
  '@@ -1,3 +1,4 @@\n import { total } from "./money";\n-export const a = 1;\n+export const a = 2;\n+export const b = total([a]);\n \n';

describe.skipIf(!hasDatabase)('the MCP code and pull request tools (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let gus: Person;
  let adaToken = '';
  let gusToken = '';
  let pull = '';
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  const sys = <T>(sql: string, args: unknown[] = []): Promise<T[]> =>
    inSystem(t.db.pool, async (c) => (await c.query(sql, args)).rows as T[]);

  const tokenFor = async (email: string, n: number): Promise<string> => {
    const res = await fetch(t.base + '/auth/tokens', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'mcp', email, password: 'a test password ' + String(n) }),
    });
    return ((await res.json()) as { token: string }).token;
  };
  let nextId = 0;
  const call = async (
    token: string,
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ isError: boolean; text: string; json: Record<string, unknown> }> => {
    const res = await fetch(t.base + '/mcp/' + ada.workspaceId, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: ++nextId,
        method: 'tools/call',
        params: { name, arguments: args },
      }),
    });
    const body = (await res.json()) as {
      result: { isError: boolean; content: { text: string }[] };
    };
    const text = body.result.content[0]?.text ?? '';
    let json: Record<string, unknown> = {};
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      // an error text
    }
    return { isError: body.result.isError, text, json };
  };

  beforeAll(async () => {
    t = await startTestApp();
    ada = await t.signup('Ada');
    gus = await t.signup('Gus');
    await t.call(ada, 'POST', W('/members'), { email: gus.email, role: 'guest' });
    const app = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'APP', name: 'App' })
    ).body.id;
    await t.call(ada, 'POST', W('/projects/' + app + '/guests'), { userId: gus.id });
    const item = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects/' + app + '/items'), {
        title: 'Totals in the cart',
      })
    ).body.id;
    const file = (
      path: string,
      lines: number,
      authors: Record<string, number>,
      imports: string[],
    ) => ({
      path,
      language: 'typescript',
      lines,
      complexity: 3,
      churn: 2,
      authors,
      agentShare: 0.5,
      imports,
    });
    expect(
      (
        await t.call(ada, 'POST', W('/projects/' + app + '/code-scan'), {
          files: [
            file('src/api/cart.ts', 120, { Ada: 100, 'Coder agent': 20 }, ['src/lib/money.ts']),
            file('src/api/orders.ts', 80, { Bob: 80 }, ['src/lib/money.ts', 'src/api/cart.ts']),
            file('src/lib/money.ts', 40, { Ada: 40 }, []),
            file('README.md', 10, { Ada: 10 }, []),
          ],
        })
      ).status,
    ).toBe(200);
    const conn = (
      await t.call<{ connection: { id: string } }>(ada, 'POST', W('/projects/' + app + '/git'), {
        provider: 'github',
        repo: 'acme/shop',
      })
    ).body.connection.id;
    pull =
      (
        await sys<{ id: string }>(
          `INSERT INTO pull_requests (workspace_id, project_id, connection_id, number, title, author, branch, base, head_sha,
                                      additions, deletions, changed_files, checks_state, item_id, files_sha, files_read_at)
           VALUES ($1, $2, $3, 7, 'APP-1 Totals in the cart', 'bob', 'feat/totals', 'main', $4, 2, 1, 1, 'passing', $5, $4, now())
           RETURNING id`,
          [ada.workspaceId, app, conn, HEAD, item],
        )
      )[0]?.id ?? '';
    await sys(
      `INSERT INTO pull_requests (workspace_id, project_id, connection_id, number, title, state, merged_at)
       VALUES ($1, $2, $3, 5, 'Older work', 'merged', now())`,
      [ada.workspaceId, app, conn],
    );
    await sys(
      `INSERT INTO pull_request_files (pull_request_id, path, workspace_id, position, status, additions, deletions, patch, patch_hash)
       VALUES ($1, 'src/api/cart.ts', $2, 0, 'modified', 2, 1, $3, 'h1')`,
      [pull, ada.workspaceId, PATCH],
    );
    adaToken = await tokenFor(ada.email, 1);
    gusToken = await tokenFor(gus.email, 2);
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('lists the code tools', async () => {
    const res = await fetch(t.base + '/mcp/' + ada.workspaceId, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + adaToken },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    const names = (
      (await res.json()) as { result: { tools: { name: string }[] } }
    ).result.tools.map((x) => x.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'code_map',
        'code_dependencies',
        'list_pull_requests',
        'get_pull_request',
        'comment_on_pull_request',
      ]),
    );
  });

  it('reads the code map by folder, and inside a folder', async () => {
    const top = await call(adaToken, 'code_map', { project: 'app' });
    expect(top.isError).toBe(false);
    expect(top.json).toMatchObject({ project: 'APP', files: 4, lines: 250, depth: 1 });
    expect(top.json['folders']).toEqual([
      expect.objectContaining({ folder: 'src', files: 3, lines: 240 }),
      expect.objectContaining({ folder: '(root)', files: 1, lines: 10 }),
    ]);
    const api = await call(adaToken, 'code_map', { project: 'APP', folder: './src/api/' });
    expect(api.json['folders']).toEqual([
      expect.objectContaining({
        folder: 'src/api',
        files: 2,
        lines: 200,
        owners: [
          { name: 'Ada', share: 0.5 },
          { name: 'Bob', share: 0.4 },
          { name: 'Coder agent', share: 0.1 },
        ],
      }),
    ]);
    const deeper = await call(adaToken, 'code_map', { project: 'APP', folder: 'src' });
    expect((deeper.json['folders'] as { folder: string }[]).map((f) => f.folder)).toEqual([
      'src/api',
      'src/lib',
    ]);
  });

  it('says what a file or folder imports and what imports it', async () => {
    const money = await call(adaToken, 'code_dependencies', {
      project: 'APP',
      path: 'src/lib/money.ts',
    });
    expect(money.json).toMatchObject({ files: 1, imports: [] });
    expect(money.json['importedBy']).toEqual([
      { path: 'src/api/cart.ts', via: ['src/lib/money.ts'], count: 1 },
      { path: 'src/api/orders.ts', via: ['src/lib/money.ts'], count: 1 },
    ]);
    const api = await call(adaToken, 'code_dependencies', { project: 'APP', path: 'src/api' });
    expect(api.json['imports']).toEqual([
      { path: 'src/lib/money.ts', via: ['src/api/cart.ts', 'src/api/orders.ts'], count: 2 },
    ]);
    expect(api.json['importedBy']).toEqual([]);
    const none = await call(adaToken, 'code_dependencies', { project: 'APP', path: 'src/nope' });
    expect(none).toMatchObject({
      isError: true,
      text: 'No scanned file or folder src/nope in APP',
    });
  });

  it('lists the pull requests and reads one with a numbered patch', async () => {
    const open = await call(adaToken, 'list_pull_requests', { project: 'APP' });
    expect(open.json['pullRequests']).toEqual([
      expect.objectContaining({
        number: 7,
        repo: 'acme/shop',
        branch: 'feat/totals',
        checksState: 'passing',
        task: 'APP-1',
        conflicts: false,
      }),
    ]);
    const all = await call(adaToken, 'list_pull_requests', { project: 'APP', state: 'all' });
    expect((all.json['pullRequests'] as unknown[]).length).toBe(2);

    const one = await call(adaToken, 'get_pull_request', {
      project: 'APP',
      number: 7,
      path: 'src/api/cart.ts',
    });
    expect(one.isError).toBe(false);
    expect(one.json).toMatchObject({
      number: 7,
      task: 'APP-1',
      files: [{ path: 'src/api/cart.ts', status: 'modified', additions: 2, deletions: 1 }],
      comments: [],
    });
    expect(one.json['note']).toBeUndefined();
    const text = (one.json['patch'] as { text: string }).text;
    expect(text).toContain('FILE src/api/cart.ts');
    expect(text).toContain('    3 + export const b = total([a]);');
    expect((await call(adaToken, 'get_pull_request', { project: 'APP', number: 9 })).text).toBe(
      'No pull request #9 in APP',
    );
  });

  it('keeps a comment as its person’s draft, on a changed line only', async () => {
    const wrong = await call(adaToken, 'comment_on_pull_request', {
      project: 'APP',
      number: 7,
      path: 'src/api/cart.ts',
      line: 40,
      body: 'Here?',
    });
    expect(wrong).toMatchObject({
      isError: true,
      text: 'Line 40 is not part of the change shown for src/api/cart.ts',
    });
    const ok = await call(adaToken, 'comment_on_pull_request', {
      project: 'APP',
      number: 7,
      path: 'src/api/cart.ts',
      line: 3,
      body: 'Round the total.',
    });
    expect(ok.json).toMatchObject({ draft: true });
    const rows = await sys<{ state: string; source: string; line: number }>(
      'SELECT state, source, line FROM pull_request_comments WHERE pull_request_id = $1',
      [pull],
    );
    expect(rows).toEqual([{ state: 'draft', source: 'person', line: 3 }]);
    // the draft shows in the app's thread for its writer
    const thread = await t.call<{ comments: { body: string; mine: boolean }[] }>(
      ada,
      'GET',
      W('/pull-requests/' + pull + '/comments'),
    );
    expect(thread.body.comments).toEqual([
      expect.objectContaining({ body: 'Round the total.', mine: true }),
    ]);
    const seen = await call(adaToken, 'get_pull_request', { project: 'APP', number: 7 });
    expect(seen.json['comments']).toEqual([
      expect.objectContaining({ line: 3, state: 'draft', author: 'Ada', outdated: false }),
    ]);
  });

  it('refuses a guest', async () => {
    const r = await call(gusToken, 'code_map', { project: 'APP' });
    expect(r).toMatchObject({
      isError: true,
      text: 'The code and pull requests are for members of the workspace',
    });
    expect((await call(gusToken, 'get_pull_request', { project: 'APP', number: 7 })).isError).toBe(
      true,
    );
  });
});
