// ── [PCODE-309 | S15 | v0.1.0] T31.8b Architecture graph, change coupling and bus factor on the code map ──
//    Why:  a code scan with imports gives the folder graph and its cycles; the Git history gives the files
//          that change together; the authors give the bus factor, with one-person folders first.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inSystem } from '../../src/db/pool.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

describe.skipIf(!hasDatabase)('architecture, coupling and bus factor (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let project = '';
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  const sys = <T>(sql: string, args: unknown[] = []): Promise<T[]> =>
    inSystem(t.db.pool, async (c) => (await c.query(sql, args)).rows as T[]);
  const get = <T>(p: string) => t.call<T>(ada, 'GET', W('/projects/' + project + p));

  beforeAll(async () => {
    t = await startTestApp();
    ada = await t.signup('Ada');
    project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'SHOP', name: 'Shop' })
    ).body.id;
    await t.call(ada, 'POST', W('/projects/' + project + '/code-scan'), {
      full: true,
      files: [
        {
          path: 'web/ui/cart.tsx',
          lines: 120,
          imports: ['web/api/client.ts', 'web/ui/button.tsx'],
          authors: { ada: 100, bob: 20 },
        },
        { path: 'web/ui/button.tsx', lines: 30, imports: [], authors: { ada: 30 } },
        {
          path: 'web/api/client.ts',
          lines: 80,
          imports: ['web/ui/button.tsx'],
          authors: { bob: 40, cy: 40, 'Coder agent': 200 },
        },
        { path: 'server/cart.ts', lines: 200, authors: { cy: 90, dan: 80, eve: 30 } },
      ],
    });
    const conn = (
      await t.call<{ connection: { id: string } }>(
        ada,
        'POST',
        W('/projects/' + project + '/git'),
        {
          provider: 'github',
          repo: 'acme/shop',
        },
      )
    ).body.connection.id;
    const commits: string[][] = [
      ['server/cart.ts', 'web/ui/cart.tsx'],
      ['server/cart.ts', 'web/ui/cart.tsx'],
      ['server/cart.ts', 'web/ui/cart.tsx', 'web/ui/button.tsx'],
      ['web/ui/cart.tsx', 'web/ui/button.tsx'],
      ['web/ui/cart.tsx', 'web/ui/button.tsx'],
      ['server/cart.ts'],
    ];
    let k = 0;
    for (const files of commits)
      await sys(
        `INSERT INTO git_commits (connection_id, sha, workspace_id, project_id, message, committed_at, branch, files)
         VALUES ($1, $2, $3, $4, 'work', now() - interval '3 days', 'main', $5)`,
        [
          conn,
          String(k++ + 1).repeat(40),
          ada.workspaceId,
          project,
          JSON.stringify({ added: [], modified: files, removed: [] }),
        ],
      );
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('draws the folders, their imports and the cycles', async () => {
    const g = await get<{
      nodes: { id: string; lines: number }[];
      edges: { from: string; to: string; imports: number }[];
      cycles: string[][];
      withoutImports: number;
    }>('/code-map/graph?depth=2');
    expect(g.body.nodes.map((n) => [n.id, n.lines])).toEqual([
      ['server', 200],
      ['web/ui', 150],
      ['web/api', 80],
    ]);
    expect(g.body.edges).toEqual([
      { from: 'web/ui', to: 'web/api', imports: 1 },
      { from: 'web/api', to: 'web/ui', imports: 1 },
    ]);
    expect(g.body.cycles).toEqual([['web/api', 'web/ui']]);
    expect(g.body.withoutImports).toBe(1);
  });

  it('pairs files that change together, hidden coupling first', async () => {
    const r = await get<{
      commits: number;
      pairs: { a: string; b: string; together: number; degree: number; crossFolder: boolean }[];
    }>('/code-map/coupling?min=3');
    expect(r.body.commits).toBe(6);
    expect(r.body.pairs).toEqual([
      { a: 'server/cart.ts', b: 'web/ui/cart.tsx', together: 3, degree: 0.75, crossFolder: true },
      { a: 'web/ui/button.tsx', b: 'web/ui/cart.tsx', together: 3, degree: 1, crossFolder: false },
    ]);
  });

  it('puts folders one person knows first', async () => {
    const r = await get<{ path: string; busFactor: number; owner: string; ownerShare: number }[]>(
      '/code-map/knowledge?depth=2',
    );
    // web/api: bob and cy wrote half each (the agent does not count), so both are needed
    expect(r.body.map((k) => [k.path, k.busFactor, k.owner, k.ownerShare])).toEqual([
      ['web/ui', 1, 'ada', 0.87],
      ['server', 2, 'cy', 0.45],
      ['web/api', 2, 'bob', 0.5],
    ]);
  });
});
