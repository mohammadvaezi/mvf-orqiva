// ── [PCODE-309 | S15 | v0.1.0] T31.8b Architecture graph, change coupling and bus factor on the code map ──
//    Why:  three views of the code beyond its size. The architecture graph: folders and the imports
//          between them (from the code scan), with import cycles named. Change coupling: files that
//          change in the same commits (from the Git history), hidden coupling across folders first. The
//          bus factor: per folder, the fewest people who wrote more than half of it.
import { changeCoupling, folderAt, folderGraph, importCycles, knowledgeOf } from '@orqiva/shared';
import type { Pool } from 'pg';
import { route, type Route } from '../http/router.js';
import { s } from '../http/schema.js';
import { asMember, requireProject } from './access.js';

const uuid = s.string({ format: 'uuid' });
const projectParams = s.object({ workspaceId: uuid, projectId: uuid });
const depthQ = s.optional(s.string({ pattern: /^[1-4]$/ }));

export function codeArchRoutes(pool: Pool): Route[] {
  const graph = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/projects/:projectId/code-map/graph',
    summary:
      'The architecture graph: folders sized by lines, the imports between them, and folders that import each other in a circle',
    tags: ['codemap'],
    params: projectParams,
    query: s.object({ depth: depthQ }),
    response: s.object({
      nodes: s.array(
        s.object({
          id: s.string(),
          files: s.number({ integer: true }),
          lines: s.number({ integer: true }),
        }),
      ),
      edges: s.array(
        s.object({ from: s.string(), to: s.string(), imports: s.number({ integer: true }) }),
      ),
      cycles: s.array(s.array(s.string())),
      /** files the scan sent without their imports (an older orq) */
      withoutImports: s.number({ integer: true }),
    }),
    handler: ({ params, query, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        await requireProject(c, a, params.projectId);
        const files = (
          await c.query<{ path: string; lines: number; imports: string[] | null }>(
            'SELECT path, lines, imports FROM code_files WHERE project_id = $1',
            [params.projectId],
          )
        ).rows;
        const g = folderGraph(
          files.map((f) => ({ ...f, imports: f.imports ?? [] })),
          Number(query.depth ?? '2'),
        );
        return {
          body: {
            ...g,
            cycles: importCycles(g.edges),
            withoutImports: files.filter((f) => f.imports === null).length,
          },
        };
      }),
  });

  const coupling = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/projects/:projectId/code-map/coupling',
    summary:
      'Files that change together in the same commits, how often and how strongly; pairs in different folders first',
    tags: ['codemap'],
    params: projectParams,
    query: s.object({
      days: s.optional(s.string({ pattern: /^\d{1,3}$/ })),
      min: s.optional(s.string({ pattern: /^\d{1,2}$/ })),
      depth: depthQ,
    }),
    response: s.object({
      commits: s.number({ integer: true }),
      pairs: s.array(
        s.object({
          a: s.string(),
          b: s.string(),
          together: s.number({ integer: true }),
          degree: s.number(),
          crossFolder: s.boolean(),
        }),
      ),
    }),
    handler: ({ params, query, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        await requireProject(c, a, params.projectId);
        const days = Math.min(730, Math.max(7, Number(query.days ?? '180')));
        const rows = (
          await c.query<{ files: { added: string[]; modified: string[]; removed: string[] } }>(
            `SELECT DISTINCT ON (sha) files FROM git_commits
              WHERE project_id = $1 AND files IS NOT NULL AND committed_at > now() - make_interval(days => $2)
                AND reverts IS NULL AND reverted_by IS NULL
              ORDER BY sha LIMIT 20000`,
            [params.projectId, days],
          )
        ).rows;
        // with a code scan, only its files pair up: the bookkeeping a commit also touches is left out
        const scanned = new Set(
          (
            await c.query<{ path: string }>('SELECT path FROM code_files WHERE project_id = $1', [
              params.projectId,
            ])
          ).rows.map((r) => r.path),
        );
        const keep = (p: string): boolean => !scanned.size || scanned.has(p);
        return {
          body: {
            commits: rows.length,
            pairs: changeCoupling(
              rows.map((r) => [...r.files.added, ...r.files.modified].filter(keep)),
              {
                minTogether: Math.max(2, Number(query.min ?? '3')),
                maxFiles: 30,
                depth: Number(query.depth ?? '2'),
                limit: 60,
              },
            ),
          },
        };
      }),
  });

  const knowledge = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/projects/:projectId/code-map/knowledge',
    summary:
      'The bus factor per folder: the fewest people who wrote more than half of it, and who knows it best',
    tags: ['codemap'],
    params: projectParams,
    query: s.object({ depth: depthQ }),
    response: s.array(
      s.object({
        path: s.string(),
        lines: s.number({ integer: true }),
        files: s.number({ integer: true }),
        busFactor: s.number({ integer: true }),
        owner: s.nullable(s.string()),
        ownerShare: s.number(),
        authors: s.number({ integer: true }),
      }),
    ),
    handler: ({ params, query, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        await requireProject(c, a, params.projectId);
        const depth = Number(query.depth ?? '2');
        const files = (
          await c.query<{ path: string; lines: number; authors: Record<string, number> }>(
            'SELECT path, lines, authors FROM code_files WHERE project_id = $1',
            [params.projectId],
          )
        ).rows;
        const folders = new Map<
          string,
          { lines: number; files: number; by: Record<string, number> }
        >();
        for (const f of files) {
          const d = folderAt(f.path, depth);
          const x = folders.get(d) ?? { lines: 0, files: 0, by: {} };
          x.lines += f.lines;
          x.files += 1;
          for (const [who, n] of Object.entries(f.authors))
            if (typeof n === 'number') x.by[who] = (x.by[who] ?? 0) + n;
          folders.set(d, x);
        }
        const out = [...folders.entries()].map(([path, x]) => ({
          path,
          lines: x.lines,
          files: x.files,
          ...knowledgeOf(x.by),
        }));
        // one person first (knowledge at risk), then the biggest
        const risk = (k: number): number => (k === 1 ? 0 : k === 0 ? 2 : 1);
        return {
          body: out.sort((p, q) => risk(p.busFactor) - risk(q.busFactor) || q.lines - p.lines),
        };
      }),
  });

  return [graph, coupling, knowledge];
}
