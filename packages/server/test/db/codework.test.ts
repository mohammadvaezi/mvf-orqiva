// ── [PCODE-308 | S15 | v0.1.0] T31.8a Code map by feature, sprint and version, and its time-lapse ──
//    Why:  the code a feature, a sprint or a version consists of comes from the fingerprints of its tasks;
//          code without a task is a group of its own; the time-lapse counts each week's changed files per
//          folder and names the sprint that ran.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inSystem } from '../../src/db/pool.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

interface Group {
  key: string;
  label: string;
  files: number;
  lines: number;
  tasks: number;
  folders: { path: string; lines: number }[];
  shares: { path: string; share: number }[];
  paths: string[];
}
interface Timeline {
  folders: { path: string; lines: number }[];
  frames: {
    start: string;
    commits: number;
    changes: { path: string; files: number }[];
    sprint: string | null;
  }[];
  withoutFiles: number;
}

const day = (n: number): string => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

describe.skipIf(!hasDatabase)('code map by work and over time (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let project = '';
  const items: Record<string, string> = {};
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  const sys = <T>(sql: string, args: unknown[] = []): Promise<T[]> =>
    inSystem(t.db.pool, async (c) => (await c.query(sql, args)).rows as T[]);
  const work = async (by: string): Promise<Group[]> =>
    (await t.call<Group[]>(ada, 'GET', W('/projects/' + project + '/code-map/work?by=' + by))).body;

  beforeAll(async () => {
    t = await startTestApp();
    ada = await t.signup('Ada');
    project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'SHOP', name: 'Shop' })
    ).body.id;
    const sprint = async (name: string, from: number, to: number): Promise<string> =>
      (
        await t.call<{ id: string }>(ada, 'POST', W('/projects/' + project + '/sprints'), {
          name,
          startDate: day(from),
          endDate: day(to),
        })
      ).body.id;
    const s1 = await sprint('Sprint 1', -20, -8);
    const s2 = await sprint('Sprint 2', -6, 6);
    const item = async (title: string, extra: Record<string, unknown> = {}): Promise<string> =>
      (
        await t.call<{ id: string }>(ada, 'POST', W('/projects/' + project + '/items'), {
          title,
          ...extra,
        })
      ).body.id;
    items['epic'] = await item('Checkout');
    items['t1'] = await item('Cart keeps items', { parentId: items['epic'], sprintId: s1 });
    items['t2'] = await item('Pay by card', { parentId: items['epic'], sprintId: s2 });
    items['t3'] = await item('Tidy the logs');
    await t.call(ada, 'POST', W('/projects/' + project + '/code-scan'), {
      full: true,
      files: [
        { path: 'server/src/cart.ts', lines: 100 },
        { path: 'server/src/log.ts', lines: 50 },
        { path: 'web/src/pay.tsx', lines: 200 },
        { path: 'README.md', lines: 10 },
      ],
    });
    for (const [task, path] of [
      ['t1', 'server/src/cart.ts'],
      ['t2', 'web/src/pay.tsx'],
      ['t3', 'server/src/log.ts'],
    ] as const)
      await sys(
        `INSERT INTO item_fingerprints (workspace_id, project_id, item_id, path, line, kind, sprint_code, version)
         VALUES ($1, $2, $3, $4, 1, 'header', 'S1', 'v0.1.0')`,
        [ada.workspaceId, project, items[task], path],
      );
    const rel = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects/' + project + '/releases'), {
        version: '1.0.0',
      })
    ).body.id;
    await t.call(ada, 'POST', W('/releases/' + rel + '/items'), { itemIds: [items['t1']] });

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
    const commit = (sha: string, daysAgo: number, files: string[] | null) =>
      sys(
        `INSERT INTO git_commits (connection_id, sha, workspace_id, project_id, message, committed_at, branch, files)
         VALUES ($1, $2, $3, $4, 'work', now() - make_interval(days => $5), 'main', $6)`,
        [
          conn,
          sha,
          ada.workspaceId,
          project,
          daysAgo,
          files ? JSON.stringify({ added: [], modified: files, removed: [] }) : null,
        ],
      );
    await commit('a'.repeat(40), 0, ['server/src/cart.ts', 'server/src/log.ts']);
    await commit('b'.repeat(40), 7, ['web/src/pay.tsx']);
    await commit('c'.repeat(40), 0, null);
    await commit('d'.repeat(40), 200, ['README.md']);
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('groups the code by feature, with code no task wrote apart', async () => {
    const g = await work('feature');
    expect(g.map((x) => [x.label, x.files, x.lines, x.tasks])).toEqual([
      ['Checkout', 2, 300, 2],
      ['No feature (tasks without a parent)', 1, 50, 1],
      ['Code without a task', 1, 10, 0],
    ]);
    expect(g[0]?.key).toBe(items['epic']);
    expect(g[0]?.shares).toEqual([
      { path: 'server/src', share: 0.67 },
      { path: 'web/src', share: 1 },
    ]);
    expect(g[0]?.folders).toEqual([
      { path: 'web/src', lines: 200 },
      { path: 'server/src', lines: 100 },
    ]);
  });

  it('groups by sprint, newest first, and by version', async () => {
    expect((await work('sprint')).map((x) => [x.label, x.paths])).toEqual([
      ['Sprint 2', ['web/src/pay.tsx']],
      ['Sprint 1', ['server/src/cart.ts']],
      ['No sprint', ['server/src/log.ts']],
      ['Code without a task', ['README.md']],
    ]);
    expect((await work('version')).map((x) => [x.label, x.files])).toEqual([
      ['1.0.0', 1],
      ['In no version yet', 2],
      ['Code without a task', 1],
    ]);
  });

  it('plays the map week by week with the sprint that ran', async () => {
    const r = await t.call<Timeline>(
      ada,
      'GET',
      W('/projects/' + project + '/code-map/timeline?weeks=4&depth=1'),
    );
    expect(r.status).toBe(200);
    expect(r.body.frames).toHaveLength(4);
    const last = r.body.frames.at(-1);
    expect(last?.commits).toBe(2);
    expect(last?.changes).toEqual([{ path: 'server', files: 2 }]);
    expect(last?.sprint).toBe('Sprint 2');
    expect(r.body.frames.at(-2)?.changes).toEqual([{ path: 'web', files: 1 }]);
    expect(r.body.withoutFiles).toBe(1);
    expect(r.body.folders.map((f) => f.path)).toEqual(['web', 'server', '(root)']);
  });
});
