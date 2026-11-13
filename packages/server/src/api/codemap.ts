// ── [PCODE-309 | S15 | v0.1.0] T31.8b Architecture graph, change coupling and bus factor on the code map ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-176 | S15 | v0.1.0] B4.2 Security and Code map on the server: risk score, workflow, SBOM, policies, campaigns, posture, code files, hotspots, API inventory ──
//    Why:  the Code map of the approved design. A code scan (the CLI sends it) leaves every file with its
//          size, complexity, churn, authors and the share agents wrote; the map rolls them up per folder
//          for the treemap, names the hot spots (churn × complexity) and their health, who owns what, and
//          where fingerprints are missing or point at tasks that are gone. The API inventory comes from the
//          project's OpenAPI document, with each endpoint's auth and the task behind it.
import { codeHealth, hotspots } from '@orqiva/shared';
import type { Pool } from 'pg';
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s } from '../http/schema.js';
import { asMember, requireProject } from './access.js';

const uuid = s.string({ format: 'uuid' });
const projectParams = s.object({ workspaceId: uuid, projectId: uuid });
const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];

interface FileRow {
  path: string;
  language: string;
  lines: number;
  complexity: number;
  churn: number;
  authors: Record<string, number>;
  agent_share: number;
  last_commit_at: Date | null;
  tasks: string[] | null;
}

/** The folder a path is in at a depth: src/api/x.ts at depth 2 is src/api. */
export const folderOf = (path: string, depth: number): string => {
  const parts = path.split('/');
  return parts.length <= 1 ? '(root)' : parts.slice(0, Math.min(depth, parts.length - 1)).join('/');
};

const o = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};

/** Endpoints of an OpenAPI 3 document: method, path, summary, tag and the auth it asks for. */
export function endpointsOf(
  doc: unknown,
): { method: string; path: string; summary: string; tag: string; auth: string }[] {
  const d = o(doc);
  const global = Array.isArray(d['security']) ? (d['security'] as unknown[]) : [];
  const authOf = (sec: unknown[]): string => {
    if (!sec.length) return 'none';
    const names = sec.flatMap((x) => Object.keys(o(x)));
    return names.length ? [...new Set(names)].join(', ').slice(0, 80) : 'none';
  };
  const out = [];
  for (const [path, item] of Object.entries(o(d['paths']))) {
    for (const [method, raw] of Object.entries(o(item))) {
      if (!METHODS.includes(method)) continue;
      const op = o(raw);
      const sec = Array.isArray(op['security']) ? (op['security'] as unknown[]) : global;
      const tags = Array.isArray(op['tags']) ? (op['tags'] as unknown[]) : [];
      out.push({
        method: method.toUpperCase(),
        path: path.slice(0, 500),
        summary: (typeof op['summary'] === 'string' ? op['summary'] : '').slice(0, 1000),
        tag: (typeof tags[0] === 'string' ? tags[0] : '').slice(0, 80),
        auth: authOf(sec),
      });
    }
  }
  return out;
}

const fileIn = s.object({
  path: s.string({ min: 1, max: 500 }),
  language: s.optional(s.string({ max: 40 })),
  lines: s.number({ integer: true, min: 0, max: 10_000_000 }),
  complexity: s.optional(s.number({ integer: true, min: 0, max: 10_000_000 })),
  churn: s.optional(s.number({ integer: true, min: 0, max: 1_000_000 })),
  authors: s.optional(s.anyObject()),
  agentShare: s.optional(s.number({ min: 0, max: 1 })),
  lastCommitAt: s.optional(s.nullable(s.string({ format: 'date-time' }))),
  // [PCODE-309 | S15 | v0.1.0] the repository's own files it imports
  imports: s.optional(s.array(s.string({ min: 1, max: 500 }), { max: 500 })),
});

export function codeMapRoutes(pool: Pool): Route[] {
  const scan = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/projects/:projectId/code-scan',
    summary:
      'Take a code scan: every file with its metrics; a full scan forgets files it no longer lists (member)',
    tags: ['codemap'],
    params: projectParams,
    body: s.object({ files: s.array(fileIn, { max: 20_000 }), full: s.optional(s.boolean()) }),
    response: s.object({
      files: s.number({ integer: true }),
      removed: s.number({ integer: true }),
    }),
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const p = await requireProject(c, a, params.projectId);
        for (const f of body.files) {
          if (f.path.includes('..') || f.path.startsWith('/'))
            throw new HttpError(400, 'invalid_request', 'Paths are relative to the repository', [
              { path: 'body.files', message: f.path + ' is not a relative path' },
            ]);
          if (f.authors && !Object.values(f.authors).every((v) => typeof v === 'number' && v >= 0))
            throw new HttpError(400, 'invalid_request', 'Authors map names to line counts', [
              { path: 'body.files', message: f.path + ' has an author without a line count' },
            ]);
        }
        for (const f of body.files)
          await c.query(
            `INSERT INTO code_files (workspace_id, project_id, path, language, lines, complexity, churn, authors, agent_share, last_commit_at, imports, scanned_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())
             ON CONFLICT (project_id, path) DO UPDATE SET language = $4, lines = $5, complexity = $6, churn = $7, authors = $8, agent_share = $9,
               last_commit_at = $10, imports = $11, scanned_at = now()`,
            [
              a.workspaceId,
              p.id,
              f.path,
              f.language ?? '',
              f.lines,
              f.complexity ?? 0,
              f.churn ?? 0,
              JSON.stringify(f.authors ?? {}),
              f.agentShare ?? 0,
              f.lastCommitAt ?? null,
              f.imports ?? null, // [PCODE-309 | S15 | v0.1.0]
            ],
          );
        const removed = body.full
          ? await c.query(
              'DELETE FROM code_files WHERE project_id = $1 AND NOT (path = ANY($2::text[]))',
              [p.id, body.files.map((f) => f.path)],
            )
          : null;
        return { body: { files: body.files.length, removed: removed?.rowCount ?? 0 } };
      }),
  });

  const fileOut = s.object({
    path: s.string(),
    language: s.string(),
    lines: s.number({ integer: true }),
    complexity: s.number({ integer: true }),
    churn: s.number({ integer: true }),
    health: s.number(),
    hotspot: s.number({ integer: true }),
    agentShare: s.number(),
    owner: s.nullable(s.string()),
    tasks: s.array(s.string()),
  });
  const FILES = `SELECT f.path, f.language, f.lines, f.complexity, f.churn, f.authors, f.agent_share, f.last_commit_at,
         (SELECT array_agg(DISTINCT p.key || '-' || i.sequence) FROM item_fingerprints x JOIN items i ON i.id = x.item_id JOIN projects p ON p.id = i.project_id
           WHERE x.project_id = f.project_id AND x.path = f.path) AS tasks
    FROM code_files f WHERE f.project_id = $1`;
  const ownerOf = (authors: Record<string, number>): string | null =>
    Object.entries(authors).sort((x, y) => y[1] - x[1])[0]?.[0] ?? null;
  const fileJson = (f: FileRow & { hotspot: number }) => ({
    path: f.path,
    language: f.language,
    lines: f.lines,
    complexity: f.complexity,
    churn: f.churn,
    health: codeHealth(f),
    hotspot: f.hotspot,
    agentShare: Math.round(f.agent_share * 100) / 100,
    owner: ownerOf(f.authors),
    tasks: (f.tasks ?? []).sort(),
  });

  const map = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/projects/:projectId/code-map',
    summary:
      'The code map: folders for the treemap (size, health, hot spots, agent share), the hottest files, ownership and fingerprint coverage',
    tags: ['codemap'],
    params: projectParams,
    query: s.object({ depth: s.optional(s.string({ min: 1, max: 1 })) }),
    response: s.object({
      totals: s.object({
        files: s.number({ integer: true }),
        lines: s.number({ integer: true }),
        health: s.number(),
        agentShare: s.number(),
        fingerprinted: s.number(),
        scannedAt: s.nullable(s.string()),
      }),
      folders: s.array(
        s.object({
          path: s.string(),
          files: s.number({ integer: true }),
          lines: s.number({ integer: true }),
          health: s.number(),
          hotspot: s.number({ integer: true }),
          agentShare: s.number(),
        }),
      ),
      hotspots: s.array(fileOut),
      owners: s.array(
        s.object({ author: s.string(), lines: s.number({ integer: true }), share: s.number() }),
      ),
    }),
    handler: ({ params, query, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        await requireProject(c, a, params.projectId);
        const depth = Math.max(1, Math.min(4, Number(query.depth ?? 2) || 2));
        const files = hotspots((await c.query<FileRow>(FILES, [params.projectId])).rows);
        const scanned =
          (
            await c.query<{ at: Date | null }>(
              'SELECT max(scanned_at) AS at FROM code_files WHERE project_id = $1',
              [params.projectId],
            )
          ).rows[0]?.at ?? null;
        const lines = files.reduce((n, f) => n + f.lines, 0);
        const weighted = (get: (f: (typeof files)[number]) => number, list = files): number => {
          const l = list.reduce((n, f) => n + f.lines, 0);
          return l
            ? Math.round((list.reduce((n, f) => n + get(f) * f.lines, 0) / l) * 100) / 100
            : 0;
        };
        const byFolder = new Map<string, typeof files>();
        for (const f of files)
          byFolder.set(folderOf(f.path, depth), [
            ...(byFolder.get(folderOf(f.path, depth)) ?? []),
            f,
          ]);
        const authors = new Map<string, number>();
        for (const f of files)
          for (const [k, v] of Object.entries(f.authors)) authors.set(k, (authors.get(k) ?? 0) + v);
        const authored = [...authors.values()].reduce((n, v) => n + v, 0);
        return {
          body: {
            totals: {
              files: files.length,
              lines,
              health: weighted((f) => codeHealth(f)),
              agentShare: weighted((f) => f.agent_share),
              fingerprinted: files.length
                ? Math.round((files.filter((f) => f.tasks?.length).length / files.length) * 100) /
                  100
                : 0,
              scannedAt: scanned?.toISOString() ?? null,
            },
            folders: [...byFolder]
              .map(([path, list]) => ({
                path,
                files: list.length,
                lines: list.reduce((n, f) => n + f.lines, 0),
                health: weighted((f) => codeHealth(f), list),
                hotspot: Math.max(0, ...list.map((f) => f.hotspot)),
                agentShare: weighted((f) => f.agent_share, list),
              }))
              .sort((x, y) => y.lines - x.lines),
            hotspots: [...files]
              .sort((x, y) => y.hotspot - x.hotspot || y.churn - x.churn)
              .slice(0, 30)
              .map(fileJson),
            owners: [...authors]
              .map(([author, l]) => ({
                author,
                lines: l,
                share: authored ? Math.round((l / authored) * 1000) / 1000 : 0,
              }))
              .sort((x, y) => y.lines - x.lines)
              .slice(0, 30),
          },
        };
      }),
  });

  const filesRoute = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/projects/:projectId/code-map/files',
    summary:
      'The files under a folder with their health, hot-spot score, owner and the tasks that shaped them',
    tags: ['codemap'],
    params: projectParams,
    query: s.object({ prefix: s.optional(s.string({ max: 500 })) }),
    response: s.array(fileOut),
    handler: ({ params, query, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        await requireProject(c, a, params.projectId);
        const all = hotspots((await c.query<FileRow>(FILES, [params.projectId])).rows);
        const prefix = (query.prefix ?? '').replace(/\/$/, '');
        return {
          body: all
            .filter((f) => !prefix || f.path === prefix || f.path.startsWith(prefix + '/'))
            .sort((x, y) => x.path.localeCompare(y.path))
            .slice(0, 2000)
            .map(fileJson),
        };
      }),
  });

  const hygiene = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/projects/:projectId/code-hygiene',
    summary: 'Code without fingerprints, and fingerprints pointing at cancelled tasks',
    tags: ['codemap'],
    params: projectParams,
    response: s.object({
      unfingerprinted: s.array(s.object({ path: s.string(), lines: s.number({ integer: true }) })),
      unfingerprintedLines: s.number({ integer: true }),
      cancelledTasks: s.array(
        s.object({ ref: s.string(), title: s.string(), paths: s.array(s.string()) }),
      ),
    }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        await requireProject(c, a, params.projectId);
        const bare = (
          await c.query<{ path: string; lines: number }>(
            'SELECT f.path, f.lines FROM code_files f WHERE f.project_id = $1 AND NOT EXISTS (SELECT 1 FROM item_fingerprints x WHERE x.project_id = f.project_id AND x.path = f.path) ORDER BY f.lines DESC',
            [params.projectId],
          )
        ).rows;
        const cancelled = (
          await c.query<{ ref: string; title: string; paths: string[] }>(
            `SELECT p.key || '-' || i.sequence AS ref, i.title, array_agg(DISTINCT x.path ORDER BY x.path) AS paths
               FROM item_fingerprints x JOIN items i ON i.id = x.item_id JOIN projects p ON p.id = i.project_id JOIN project_states st ON st.id = i.state_id
              WHERE x.project_id = $1 AND st.grp = 'cancelled' GROUP BY p.key, i.sequence, i.title ORDER BY i.sequence`,
            [params.projectId],
          )
        ).rows;
        return {
          body: {
            unfingerprinted: bare.slice(0, 100),
            unfingerprintedLines: bare.reduce((n, f) => n + f.lines, 0),
            cancelledTasks: cancelled,
          },
        };
      }),
  });

  const endpointOut = s.object({
    id: s.string(),
    kind: s.string(),
    method: s.string(),
    path: s.string(),
    summary: s.string(),
    auth: s.string(),
    tag: s.string(),
    itemId: s.nullable(s.string()),
    itemRef: s.nullable(s.string()),
    tests: s.number({ integer: true }),
    source: s.string(),
  });
  const importApi = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/projects/:projectId/api-endpoints/import',
    summary:
      'Read the project’s OpenAPI document into the API inventory; endpoints it no longer lists are dropped (member)',
    tags: ['codemap'],
    params: projectParams,
    body: s.object({ openapi: s.anyObject() }),
    response: s.object({
      endpoints: s.number({ integer: true }),
      removed: s.number({ integer: true }),
      unauthenticated: s.number({ integer: true }),
    }),
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const p = await requireProject(c, a, params.projectId);
        const list = endpointsOf(body.openapi);
        if (!list.length)
          throw new HttpError(
            400,
            'invalid_request',
            'The document has no paths (send an OpenAPI 3 JSON document)',
            [{ path: 'body.openapi', message: 'has no operations' }],
          );
        for (const e of list)
          await c.query(
            `INSERT INTO api_endpoints (workspace_id, project_id, kind, method, path, summary, auth, tag, source, seen_at) VALUES ($1, $2, 'http', $3, $4, $5, $6, $7, 'openapi', now())
             ON CONFLICT (project_id, kind, method, path) DO UPDATE SET summary = $5, auth = $6, tag = $7, seen_at = now()`,
            [a.workspaceId, p.id, e.method, e.path, e.summary, e.auth, e.tag],
          );
        const removed = await c.query(
          "DELETE FROM api_endpoints WHERE project_id = $1 AND source = 'openapi' AND NOT ((method || ' ' || path) = ANY($2::text[]))",
          [p.id, list.map((e) => e.method + ' ' + e.path)],
        );
        return {
          body: {
            endpoints: list.length,
            removed: removed.rowCount ?? 0,
            unauthenticated: list.filter((e) => e.auth === 'none').length,
          },
        };
      }),
  });

  const endpoints = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/projects/:projectId/api-endpoints',
    summary:
      'The API inventory: each endpoint with its auth, the task behind it and the test cases that mention it',
    tags: ['codemap'],
    params: projectParams,
    response: s.array(endpointOut),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        await requireProject(c, a, params.projectId);
        const rows = (
          await c.query<{
            id: string;
            kind: string;
            method: string;
            path: string;
            summary: string;
            auth: string;
            tag: string;
            item_id: string | null;
            item_ref: string | null;
            tests: string;
            source: string;
          }>(
            `SELECT e.id, e.kind, e.method, e.path, e.summary, e.auth, e.tag, e.item_id, p.key || '-' || i.sequence AS item_ref, e.source,
                    (SELECT count(*) FROM test_cases tc WHERE tc.project_id = e.project_id
                       AND (position(e.path IN tc.title) > 0 OR position(e.path IN tc.steps) > 0 OR position(e.path IN tc.key) > 0)) AS tests
               FROM api_endpoints e LEFT JOIN items i ON i.id = e.item_id LEFT JOIN projects p ON p.id = i.project_id
              WHERE e.project_id = $1 ORDER BY e.tag, e.path, e.method`,
            [params.projectId],
          )
        ).rows;
        return {
          body: rows.map((r) => ({
            id: r.id,
            kind: r.kind,
            method: r.method,
            path: r.path,
            summary: r.summary,
            auth: r.auth,
            tag: r.tag,
            itemId: r.item_id,
            itemRef: r.item_ref,
            tests: Number(r.tests),
            source: r.source,
          })),
        };
      }),
  });

  const changeEndpoint = route({
    method: 'PATCH',
    path: '/api/workspaces/:workspaceId/api-endpoints/:endpointId',
    summary: 'Name the task behind an endpoint (member)',
    tags: ['codemap'],
    params: s.object({ workspaceId: uuid, endpointId: uuid }),
    body: s.object({ itemId: s.nullable(uuid) }),
    response: s.object({ id: s.string(), itemId: s.nullable(s.string()) }),
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const e = (
          await c.query<{ project_id: string }>(
            'SELECT project_id FROM api_endpoints WHERE id = $1',
            [params.endpointId],
          )
        ).rows[0];
        if (!e) throw new HttpError(404, 'not_found', 'Endpoint not found');
        await requireProject(c, a, e.project_id);
        if (body.itemId) {
          const it = (
            await c.query<{ project_id: string }>('SELECT project_id FROM items WHERE id = $1', [
              body.itemId,
            ])
          ).rows[0];
          if (it?.project_id !== e.project_id)
            throw new HttpError(400, 'invalid_request', 'The task belongs to another project', [
              { path: 'body.itemId', message: 'is not a task of this project' },
            ]);
        }
        await c.query('UPDATE api_endpoints SET item_id = $2 WHERE id = $1', [
          params.endpointId,
          body.itemId,
        ]);
        return { body: { id: params.endpointId, itemId: body.itemId } };
      }),
  });

  return [scan, map, filesRoute, hygiene, importApi, endpoints, changeEndpoint];
}
