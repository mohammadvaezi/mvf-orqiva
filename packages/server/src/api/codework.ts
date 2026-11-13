// ── [PCODE-308 | S15 | v0.1.0] T31.8a Code map by feature, sprint and version, and its time-lapse ──
//    Why:  the code map through the work. Each feature (the top of a task's tree), sprint or version is
//          the code its tasks' fingerprints sit in: files, lines, tasks, and how much of each folder it
//          makes up. Code without any task is its own group. The time-lapse is the folder map week by
//          week, coloured by the files the commits of that week changed, with the sprint that ran.
import { compareVersions, folderAt, folderShares, timelineFrames } from '@orqiva/shared';
import type { Pool } from 'pg';
import { route, type Route } from '../http/router.js';
import { s } from '../http/schema.js';
import { asMember, requireProject } from './access.js';

const uuid = s.string({ format: 'uuid' });
const projectParams = s.object({ workspaceId: uuid, projectId: uuid });
/** paths sent per group, for highlighting */
const PATHS_PER_GROUP = 400;

const groupOut = s.object({
  /** the feature's, sprint's or release's id; empty for code without one */
  key: s.string(),
  label: s.string(),
  files: s.number({ integer: true }),
  lines: s.number({ integer: true }),
  tasks: s.number({ integer: true }),
  /** the folders it lives in (depth 2), biggest first */
  folders: s.array(s.object({ path: s.string(), lines: s.number({ integer: true }) })),
  /** how much of each folder at the asked depth it makes up, 0 to 1 */
  shares: s.array(s.object({ path: s.string(), share: s.number() })),
  paths: s.array(s.string()),
});

interface Link {
  path: string;
  item_id: string;
  key: string | null;
  label: string | null;
  sort: string | null;
}

export function codeWorkRoutes(pool: Pool): Route[] {
  const work = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/projects/:projectId/code-map/work',
    summary:
      'The code map by feature, sprint or version: the files each one’s tasks wrote (from the fingerprints), and code without a task',
    tags: ['codemap'],
    params: projectParams,
    query: s.object({
      by: s.enum(['feature', 'sprint', 'version']),
      depth: s.optional(s.string({ pattern: /^[1-4]$/ })),
    }),
    response: s.array(groupOut),
    handler: ({ params, query, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        await requireProject(c, a, params.projectId);
        const depth = Number(query.depth ?? '2');
        const sql =
          query.by === 'feature'
            ? `WITH RECURSIVE up AS (
                 SELECT i.id AS start, i.id, i.parent_id, 0 AS hops FROM items i WHERE i.project_id = $1
                 UNION ALL SELECT up.start, p.id, p.parent_id, up.hops + 1 FROM items p JOIN up ON p.id = up.parent_id WHERE up.hops < 20)
               SELECT DISTINCT x.path, x.item_id, r.id AS key, r.title AS label, r.title AS sort
                 FROM item_fingerprints x
                 LEFT JOIN up ON up.start = x.item_id AND up.parent_id IS NULL AND up.hops > 0
                 LEFT JOIN items r ON r.id = up.id
                WHERE x.project_id = $1`
            : query.by === 'sprint'
              ? `SELECT DISTINCT x.path, x.item_id, sp.id AS key, sp.name AS label,
                        coalesce(sp.start_date::text, sp.created_at::date::text) AS sort
                   FROM item_fingerprints x JOIN items i ON i.id = x.item_id LEFT JOIN sprints sp ON sp.id = i.sprint_id
                  WHERE x.project_id = $1`
              : `SELECT DISTINCT x.path, x.item_id, r.id AS key,
                        CASE WHEN r.component <> '' THEN r.component || ' ' || r.version ELSE r.version END AS label, r.version AS sort
                   FROM item_fingerprints x LEFT JOIN release_items ri ON ri.item_id = x.item_id
                   LEFT JOIN releases r ON r.id = ri.release_id
                  WHERE x.project_id = $1`;
        const links = (await c.query<Link>(sql, [params.projectId])).rows;
        const files = (
          await c.query<{ path: string; lines: number }>(
            'SELECT path, lines FROM code_files WHERE project_id = $1',
            [params.projectId],
          )
        ).rows;
        const linesOf = new Map(files.map((f) => [f.path, f.lines]));
        const none =
          query.by === 'feature'
            ? 'No feature (tasks without a parent)'
            : query.by === 'sprint'
              ? 'No sprint'
              : 'In no version yet';
        const groups = new Map<
          string,
          { label: string; sort: string; paths: Set<string>; tasks: Set<string> }
        >();
        const add = (
          key: string,
          label: string,
          sort: string,
          path: string,
          task: string | null,
        ) => {
          const g = groups.get(key) ?? { label, sort, paths: new Set(), tasks: new Set() };
          g.paths.add(path);
          if (task) g.tasks.add(task);
          groups.set(key, g);
        };
        for (const l of links)
          add(l.key ?? '', l.key ? (l.label ?? '') : none, l.sort ?? '', l.path, l.item_id);
        // code no task wrote
        const marked = new Set(links.map((l) => l.path));
        for (const f of files)
          if (!marked.has(f.path)) add('-', 'Code without a task', '', f.path, null);
        const order = [...groups.entries()].sort(([ka, x], [kb, y]) => {
          const rank = (k: string): number => (k === '-' ? 2 : k === '' ? 1 : 0);
          if (rank(ka) !== rank(kb)) return rank(ka) - rank(kb);
          if (query.by === 'version') return compareVersions(y.sort, x.sort);
          if (query.by === 'sprint') return y.sort.localeCompare(x.sort);
          return x.sort.localeCompare(y.sort);
        });
        return {
          body: order.map(([key, g]) => {
            const lines = [...g.paths].reduce((n, p) => n + (linesOf.get(p) ?? 0), 0);
            const byFolder: Record<string, number> = {};
            for (const p of g.paths)
              byFolder[folderAt(p, 2)] = (byFolder[folderAt(p, 2)] ?? 0) + (linesOf.get(p) ?? 0);
            return {
              key: key === '-' ? '' : key,
              label: g.label,
              files: g.paths.size,
              lines,
              tasks: g.tasks.size,
              folders: Object.entries(byFolder)
                .map(([path, n]) => ({ path, lines: n }))
                .sort((x, y) => y.lines - x.lines)
                .slice(0, 6),
              shares: Object.entries(folderShares(g.paths, files, depth))
                .filter(([, share]) => share > 0)
                .map(([path, share]) => ({ path, share })),
              paths: [...g.paths].sort().slice(0, PATHS_PER_GROUP),
            };
          }),
        };
      }),
  });

  const timeline = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/projects/:projectId/code-map/timeline',
    summary:
      'The code map week by week: the files each week’s commits changed, per folder, with the sprint that ran',
    tags: ['codemap'],
    params: projectParams,
    query: s.object({
      weeks: s.optional(s.string({ pattern: /^\d{1,2}$/ })),
      depth: s.optional(s.string({ pattern: /^[1-4]$/ })),
    }),
    response: s.object({
      folders: s.array(s.object({ path: s.string(), lines: s.number({ integer: true }) })),
      frames: s.array(
        s.object({
          start: s.string(),
          commits: s.number({ integer: true }),
          changes: s.array(s.object({ path: s.string(), files: s.number({ integer: true }) })),
          sprint: s.nullable(s.string()),
        }),
      ),
      /** commits whose changed files the host did not list (Azure DevOps pushes) */
      withoutFiles: s.number({ integer: true }),
    }),
    handler: ({ params, query, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        await requireProject(c, a, params.projectId);
        const weeks = Math.min(52, Math.max(2, Number(query.weeks ?? '12')));
        const depth = Number(query.depth ?? '1');
        const since = new Date(Date.now() - weeks * 7 * 86_400_000);
        const commits = (
          await c.query<{
            committed_at: Date;
            files: { added: string[]; modified: string[]; removed: string[] } | null;
          }>(
            // a commit pushed to several branches is one change: kept once per sha
            `SELECT DISTINCT ON (sha) committed_at, files FROM git_commits
              WHERE project_id = $1 AND committed_at >= $2 ORDER BY sha, committed_at`,
            [params.projectId, since],
          )
        ).rows;
        const sprints = (
          await c.query<{ name: string; start_date: string | null; end_date: string | null }>(
            'SELECT name, start_date::text, end_date::text FROM sprints WHERE project_id = $1',
            [params.projectId],
          )
        ).rows;
        const files = (
          await c.query<{ path: string; lines: number }>(
            'SELECT path, lines FROM code_files WHERE project_id = $1',
            [params.projectId],
          )
        ).rows;
        const folders: Record<string, number> = {};
        for (const f of files)
          folders[folderAt(f.path, depth)] = (folders[folderAt(f.path, depth)] ?? 0) + f.lines;
        const frames = timelineFrames(
          commits.map((x) => ({
            at: x.committed_at.toISOString(),
            paths: x.files ? [...x.files.added, ...x.files.modified, ...x.files.removed] : [],
          })),
          sprints.map((x) => ({ name: x.name, start: x.start_date, end: x.end_date })),
          { weeks, depth, now: Date.now() },
        );
        // folders that changed but are not in the scan still show
        for (const f of frames) for (const d of Object.keys(f.changes)) folders[d] ??= 0;
        return {
          body: {
            folders: Object.entries(folders)
              .map(([path, lines]) => ({ path, lines }))
              .sort((x, y) => y.lines - x.lines),
            frames: frames.map((f) => ({
              ...f,
              changes: Object.entries(f.changes).map(([path, n]) => ({ path, files: n })),
            })),
            withoutFiles: commits.filter((x) => !x.files).length,
          },
        };
      }),
  });

  return [work, timeline];
}
