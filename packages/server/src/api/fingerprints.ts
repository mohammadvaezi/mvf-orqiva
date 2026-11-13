// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-104 | S15 | v0.1.0] Move the fingerprint scanner and index into the server; every loop step emits an event ──
//    Why:  the fingerprint index served from the server: which code was written for an item, and for a
//          project which files carry which tasks. `orq done` sends what its scan found; this keeps it per
//          item and answers both questions, as JSON and as the Markdown index the repositories carried.
import { indexMarkdown, type FingerprintHit } from '@orqiva/shared';
import type { Pool, PoolClient } from 'pg';
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s } from '../http/schema.js';
import { asMember, requireProject, type Access } from './access.js';

const uuid = s.string({ format: 'uuid' });

export interface FingerprintIn {
  path: string;
  line: number;
  kind: 'header' | 'block';
}

/** Replaces the item's markers with the ones of this done. */
export async function storeFingerprints(
  c: PoolClient,
  a: Access,
  it: { id: string; project_id: string },
  files: FingerprintIn[],
  meta: { commit: string | null; sprint: string; version: string },
): Promise<void> {
  await c.query('DELETE FROM item_fingerprints WHERE item_id = $1', [it.id]);
  const unique = new Map(files.map((f) => [f.path + ':' + String(f.line), f]));
  const rows = [...unique.values()];
  for (let at = 0; at < rows.length; at += 500) {
    const chunk = rows.slice(at, at + 500);
    await c.query(
      `INSERT INTO item_fingerprints (workspace_id, project_id, item_id, path, line, kind, commit, sprint_code, version, recorded_by)
       SELECT $1, $2, $3, f.path, f.line, f.kind, $4, $5, $6, $7
       FROM unnest($8::text[], $9::int[], $10::text[]) AS f(path, line, kind)`,
      [
        a.workspaceId,
        it.project_id,
        it.id,
        meta.commit,
        meta.sprint,
        meta.version,
        a.user.id,
        chunk.map((f) => f.path),
        chunk.map((f) => f.line),
        chunk.map((f) => f.kind),
      ],
    );
  }
}

interface Row {
  item_id: string;
  ref: string;
  title: string;
  state: string;
  path: string;
  line: number;
  kind: 'header' | 'block';
  commit: string | null;
  sprint_code: string;
  version: string;
  recorded_at: Date;
}

const SELECT = `SELECT f.item_id, pr.key || '-' || i.sequence AS ref, i.title, st.name AS state,
                       f.path, f.line, f.kind, f.commit, f.sprint_code, f.version, f.recorded_at
                FROM item_fingerprints f
                JOIN items i ON i.id = f.item_id
                JOIN projects pr ON pr.id = f.project_id
                JOIN project_states st ON st.id = i.state_id`;

const markerOut = s.object({
  path: s.string(),
  line: s.number({ integer: true }),
  kind: s.string(),
  commit: s.nullable(s.string()),
  sprint: s.string(),
  version: s.string(),
  recordedAt: s.string(),
});

const marker = (r: Row) => ({
  path: r.path,
  line: r.line,
  kind: r.kind,
  commit: r.commit,
  sprint: r.sprint_code,
  version: r.version,
  recordedAt: r.recorded_at.toISOString(),
});

interface TaskMarkers {
  itemId: string;
  ref: string;
  title: string;
  state: string;
  markers: ReturnType<typeof marker>[];
}

export function fingerprintRoutes(pool: Pool): Route[] {
  const ofItem = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/items/:itemId/fingerprints',
    summary: 'The code written for an item: every fingerprint its last done found',
    tags: ['fingerprints'],
    params: s.object({ workspaceId: uuid, itemId: uuid }),
    response: s.array(markerOut),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        const projectId = (
          await c.query<{ project_id: string }>('SELECT project_id FROM items WHERE id = $1', [
            params.itemId,
          ])
        ).rows[0]?.project_id;
        if (!projectId) throw new HttpError(404, 'not_found', 'Item not found');
        try {
          await requireProject(c, a, projectId);
        } catch {
          throw new HttpError(404, 'not_found', 'Item not found');
        }
        const rows = (
          await c.query<Row>(SELECT + ' WHERE f.item_id = $1 ORDER BY f.path, f.line', [
            params.itemId,
          ])
        ).rows;
        return { body: rows.map(marker) };
      }),
  });

  const index = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/projects/:projectId/fingerprints',
    summary:
      'The fingerprint index of a project: files and the tasks that shaped them (path: a folder or file prefix)',
    tags: ['fingerprints'],
    params: s.object({ workspaceId: uuid, projectId: uuid }),
    query: s.object({ path: s.optional(s.string({ max: 500 })) }),
    response: s.object({
      files: s.array(
        s.object({
          path: s.string(),
          tasks: s.array(
            s.object({
              itemId: s.string(),
              ref: s.string(),
              title: s.string(),
              state: s.string(),
              markers: s.array(markerOut),
            }),
          ),
        }),
      ),
      markdown: s.string(),
    }),
    handler: ({ params, query, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        const p = await requireProject(c, a, params.projectId);
        const prefix = query.path?.replace(/^\.?\//, '') ?? '';
        const rows = (
          await c.query<Row>(
            SELECT +
              ` WHERE f.project_id = $1 AND ($2 = '' OR f.path = $2 OR starts_with(f.path, rtrim($2, '/') || '/'))
                ORDER BY f.path, i.sequence, f.line`,
            [p.id, prefix],
          )
        ).rows;
        const files = new Map<string, Map<string, TaskMarkers>>();
        for (const r of rows) {
          const tasks = files.get(r.path) ?? new Map<string, TaskMarkers>();
          const t = tasks.get(r.item_id) ?? {
            itemId: r.item_id,
            ref: r.ref,
            title: r.title,
            state: r.state,
            markers: [],
          };
          t.markers.push(marker(r));
          tasks.set(r.item_id, t);
          files.set(r.path, tasks);
        }
        const hits: FingerprintHit[] = rows.map((r) => ({
          file: r.path,
          line: r.line,
          task: r.ref,
          sprint: r.sprint_code,
          version: r.version,
          title: r.title,
          kind: r.kind,
        }));
        return {
          body: {
            files: [...files].map(([path, tasks]) => ({ path, tasks: [...tasks.values()] })),
            markdown: indexMarkdown(hits, { name: p.name, key: p.key }),
          },
        };
      }),
  });

  return [ofItem, index];
}
