// ── [PCODE-295 | S15 | v0.1.0] T30.8b Visual regression: baselines, pixel diff, orq visual check, the Visual tab ──
//    Why:  a screen's look is kept as an approved screenshot; every check compares a new one with it pixel
//          by pixel and says pass or fail against the share of pixels the screen may change, with a diff
//          image that shows where. A screen without a baseline waits for a member to approve one; approving
//          a run makes it the new baseline, so an intended change is one click.
import type { Pool, PoolClient } from 'pg';
import type { BlobStore } from '../files/blobstore.js';
import { decodePng, encodePng, PngError, pixelDiff } from '../files/png.js';
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s } from '../http/schema.js';
import { asMember, requireProject, type Access } from './access.js';

const uuid = s.string({ format: 'uuid' });
const projectParams = s.object({ workspaceId: uuid, projectId: uuid });
const idParams = s.object({ workspaceId: uuid, id: uuid });
const fileUrl = (ws: string, id: string): string =>
  '/api/workspaces/' + ws + '/files/' + id + '/content';

/** A screen's name: words, digits, - _ . / and spaces, as file names and test titles are. */
export function screenName(raw: string): string | null {
  const n = raw.trim().replace(/\s+/g, ' ');
  return /^[\w][\w ./-]{0,119}$/.test(n) && !n.includes('..') ? n : null;
}

interface BaselineRow {
  id: string;
  project_id: string;
  name: string;
  file_id: string;
  width: number;
  height: number;
  max_diff: number;
  mockup_id: string | null;
  mockup_title: string | null;
  mockup_file: string | null;
  approver: string | null;
  approved_at: Date;
}
const BASELINE = `SELECT b.id, b.project_id, b.name, b.file_id, b.width, b.height, b.max_diff, b.mockup_id, m.title AS mockup_title,
       mv.file_id AS mockup_file, u.name AS approver, b.approved_at
  FROM visual_baselines b LEFT JOIN users u ON u.id = b.approved_by
  LEFT JOIN mockups m ON m.id = b.mockup_id LEFT JOIN mockup_versions mv ON mv.mockup_id = m.id AND mv.version = m.version`;

interface RunRow {
  id: string;
  project_id: string;
  name: string;
  file_id: string;
  diff_file_id: string | null;
  width: number;
  height: number;
  changed: number;
  ratio: number;
  box: { x: number; y: number; w: number; h: number } | null;
  status: string;
  reason: string;
  commit_sha: string;
  author: string | null;
  created_at: Date;
}
const RUN = `SELECT r.id, r.project_id, r.name, r.file_id, r.diff_file_id, r.width, r.height, r.changed, r.ratio, r.box, r.status, r.reason,
       r.commit_sha, u.name AS author, r.created_at
  FROM visual_runs r LEFT JOIN users u ON u.id = r.created_by`;

const runOut = s.object({
  id: s.string(),
  name: s.string(),
  status: s.string(),
  reason: s.string(),
  imageUrl: s.string(),
  diffUrl: s.nullable(s.string()),
  width: s.number({ integer: true }),
  height: s.number({ integer: true }),
  changed: s.number({ integer: true }),
  ratio: s.number(),
  box: s.nullable(s.anyObject()),
  commit: s.string(),
  author: s.nullable(s.string()),
  createdAt: s.string(),
});
const runJson = (r: RunRow, ws: string) => ({
  id: r.id,
  name: r.name,
  status: r.status,
  reason: r.reason,
  imageUrl: fileUrl(ws, r.file_id),
  diffUrl: r.diff_file_id ? fileUrl(ws, r.diff_file_id) : null,
  width: r.width,
  height: r.height,
  changed: r.changed,
  ratio: r.ratio,
  box: r.box,
  commit: r.commit_sha,
  author: r.author,
  createdAt: r.created_at.toISOString(),
});
const baselineOut = s.object({
  id: s.string(),
  imageUrl: s.string(),
  width: s.number({ integer: true }),
  height: s.number({ integer: true }),
  maxDiff: s.number(),
  mockupId: s.nullable(s.string()),
  mockupTitle: s.nullable(s.string()),
  mockupImageUrl: s.nullable(s.string()),
  approvedBy: s.nullable(s.string()),
  approvedAt: s.string(),
});
const baselineJson = (b: BaselineRow, ws: string) => ({
  id: b.id,
  imageUrl: fileUrl(ws, b.file_id),
  width: b.width,
  height: b.height,
  maxDiff: b.max_diff,
  mockupId: b.mockup_id,
  mockupTitle: b.mockup_title,
  mockupImageUrl: b.mockup_file ? fileUrl(ws, b.mockup_file) : null,
  approvedBy: b.approver,
  approvedAt: b.approved_at.toISOString(),
});

/** Keeps a file the server made (a diff image): no upload, no reading. */
async function keepFile(
  c: PoolClient,
  store: BlobStore,
  a: Access,
  projectId: string,
  name: string,
  data: Buffer,
): Promise<string> {
  const { sha256, key } = await store.put(data);
  const id = (
    await c.query<{ id: string }>(
      `INSERT INTO files (workspace_id, project_id, name, mime, size_bytes, sha256, storage_key, uploaded_by)
       VALUES ($1, $2, $3, 'image/png', $4, $5, $6, $7) RETURNING id`,
      [a.workspaceId, projectId, name, data.length, sha256, key, a.user.id],
    )
  ).rows[0]?.id;
  if (!id) throw new Error('file vanished');
  return id;
}

async function pngOf(
  c: PoolClient,
  store: BlobStore,
  fileId: string,
  projectId: string,
  field: string,
) {
  const f = (
    await c.query<{ project_id: string | null; storage_key: string }>(
      'SELECT project_id, storage_key FROM files WHERE id = $1 AND deleted_at IS NULL',
      [fileId],
    )
  ).rows[0];
  if (!f || f.project_id !== projectId)
    throw new HttpError(400, 'invalid_request', 'The file is not one of this project', [
      { path: 'body.' + field, message: 'is not a file of this project' },
    ]);
  try {
    return decodePng(await store.get(f.storage_key));
  } catch (e) {
    throw new HttpError(400, 'invalid_request', 'A screenshot is a PNG the server can read', [
      { path: 'body.' + field, message: e instanceof PngError ? e.message : 'is not a PNG' },
    ]);
  }
}

export function visualRoutes(pool: Pool, store: BlobStore): Route[] {
  const screens = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/projects/:projectId/visual',
    summary: 'The screens under visual checks: each baseline with the latest check',
    tags: ['uikit'],
    params: projectParams,
    response: s.array(
      s.object({
        name: s.string(),
        baseline: s.nullable(baselineOut),
        latest: s.nullable(runOut),
        checks: s.number({ integer: true }),
      }),
    ),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'auditor', async (c, a) => {
        await requireProject(c, a, params.projectId);
        const bs = (
          await c.query<BaselineRow>(BASELINE + ' WHERE b.project_id = $1', [params.projectId])
        ).rows;
        const latest = (
          await c.query<RunRow & { checks: string }>(
            RUN.replace(
              'SELECT r.id',
              'SELECT DISTINCT ON (r.name) count(*) OVER (PARTITION BY r.name) AS checks, r.id',
            ) + ' WHERE r.project_id = $1 ORDER BY r.name, r.created_at DESC',
            [params.projectId],
          )
        ).rows;
        const names = [...new Set([...bs.map((b) => b.name), ...latest.map((r) => r.name)])].sort();
        // failing screens first, then waiting ones, then the rest by name
        const rank = (n: string): number => {
          const st = latest.find((r) => r.name === n)?.status;
          return st === 'fail' ? 0 : st === 'new' ? 1 : 2;
        };
        return {
          body: names
            .sort((x, y) => rank(x) - rank(y) || x.localeCompare(y))
            .map((n) => {
              const b = bs.find((x) => x.name === n);
              const r = latest.find((x) => x.name === n);
              return {
                name: n,
                baseline: b ? baselineJson(b, a.workspaceId) : null,
                latest: r ? runJson(r, a.workspaceId) : null,
                checks: Number(r?.checks ?? 0),
              };
            }),
        };
      }),
  });

  const history = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/projects/:projectId/visual/runs',
    summary: 'The checks of one screen, latest first',
    tags: ['uikit'],
    params: projectParams,
    query: s.object({ name: s.string({ min: 1, max: 120 }) }),
    response: s.array(runOut),
    handler: ({ params, query, req }) =>
      asMember(pool, req, params.workspaceId, 'auditor', async (c, a) => {
        await requireProject(c, a, params.projectId);
        return {
          body: (
            await c.query<RunRow>(
              RUN + ' WHERE r.project_id = $1 AND r.name = $2 ORDER BY r.created_at DESC LIMIT 50',
              [params.projectId, query.name],
            )
          ).rows.map((r) => runJson(r, a.workspaceId)),
        };
      }),
  });

  const check = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/projects/:projectId/visual/checks',
    summary:
      'Check a screenshot (an uploaded PNG) against its screen’s baseline: pass, fail with a diff image, or new (member)',
    tags: ['uikit'],
    params: projectParams,
    body: s.object({
      name: s.string({ min: 1, max: 120 }),
      fileId: uuid,
      commit: s.optional(s.string({ max: 64 })),
    }),
    response: runOut,
    status: 201,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        await requireProject(c, a, params.projectId);
        const name = screenName(body.name);
        if (!name)
          throw new HttpError(
            400,
            'invalid_request',
            'A screen name of words, digits, - _ . / and spaces',
            [{ path: 'body.name', message: 'is not a screen name' }],
          );
        const commit = (body.commit ?? '').trim();
        if (commit && !/^[0-9a-f]{4,64}$/i.test(commit))
          throw new HttpError(400, 'invalid_request', 'A commit is its hash', [
            { path: 'body.commit', message: 'is not a commit hash' },
          ]);
        const next = await pngOf(c, store, body.fileId, params.projectId, 'fileId');
        const b = (
          await c.query<BaselineRow>(BASELINE + ' WHERE b.project_id = $1 AND b.name = $2', [
            params.projectId,
            name,
          ])
        ).rows[0];
        let status = 'new';
        let reason = 'No baseline yet: approve this screenshot to make it one';
        let changed = 0;
        let ratio = 0;
        let box: unknown = null;
        let diffId: string | null = null;
        if (b) {
          const base = await pngOf(c, store, b.file_id, params.projectId, 'fileId');
          if (base.width !== next.width || base.height !== next.height) {
            status = 'fail';
            reason =
              'The size changed: ' +
              String(base.width) +
              ' × ' +
              String(base.height) +
              ' to ' +
              String(next.width) +
              ' × ' +
              String(next.height);
            ratio = 1;
          } else {
            const d = pixelDiff(base, next);
            changed = d.changed;
            ratio = d.ratio;
            box = d.box;
            status = d.ratio <= b.max_diff ? 'pass' : 'fail';
            reason =
              d.changed === 0
                ? 'No pixel changed'
                : String(d.changed) +
                  ' pixels changed (' +
                  (d.ratio * 100).toFixed(2) +
                  ' %, ' +
                  (status === 'pass' ? 'within' : 'over') +
                  ' the ' +
                  (b.max_diff * 100).toFixed(2) +
                  ' % allowed)';
            if (d.changed)
              diffId = await keepFile(
                c,
                store,
                a,
                params.projectId,
                'diff-' + name.replace(/[/ ]/g, '-') + '.png',
                encodePng(d.image),
              );
          }
        }
        const id = (
          await c.query<{ id: string }>(
            `INSERT INTO visual_runs (workspace_id, project_id, name, file_id, diff_file_id, width, height, changed, ratio, box, status, reason, commit_sha, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING id`,
            [
              a.workspaceId,
              params.projectId,
              name,
              body.fileId,
              diffId,
              next.width,
              next.height,
              changed,
              ratio,
              box === null ? null : JSON.stringify(box),
              status,
              reason,
              commit,
              a.user.id,
            ],
          )
        ).rows[0]?.id;
        const r = (await c.query<RunRow>(RUN + ' WHERE r.id = $1', [id])).rows[0];
        if (!r) throw new Error('check vanished');
        return { status: 201, body: runJson(r, a.workspaceId) };
      }),
  });

  const approve = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/visual-runs/:id/approve',
    summary: 'Make a checked screenshot its screen’s baseline (member)',
    tags: ['uikit'],
    params: idParams,
    body: s.object({}),
    response: baselineOut,
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const r = (await c.query<RunRow>(RUN + ' WHERE r.id = $1', [params.id])).rows[0];
        if (!r) throw new HttpError(404, 'not_found', 'Check not found');
        try {
          await requireProject(c, a, r.project_id);
        } catch {
          throw new HttpError(404, 'not_found', 'Check not found');
        }
        await c.query(
          `INSERT INTO visual_baselines (workspace_id, project_id, name, file_id, width, height, approved_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (project_id, name) DO UPDATE SET file_id = EXCLUDED.file_id, width = EXCLUDED.width, height = EXCLUDED.height,
             approved_by = EXCLUDED.approved_by, approved_at = now()`,
          [a.workspaceId, r.project_id, r.name, r.file_id, r.width, r.height, a.user.id],
        );
        await c.query("UPDATE visual_runs SET status = 'approved' WHERE id = $1", [r.id]);
        const b = (
          await c.query<BaselineRow>(BASELINE + ' WHERE b.project_id = $1 AND b.name = $2', [
            r.project_id,
            r.name,
          ])
        ).rows[0];
        if (!b) throw new Error('baseline vanished');
        return { body: baselineJson(b, a.workspaceId) };
      }),
  });

  const baselineOf = async (c: PoolClient, a: Access, id: string): Promise<BaselineRow> => {
    const b = (await c.query<BaselineRow>(BASELINE + ' WHERE b.id = $1', [id])).rows[0];
    if (!b) throw new HttpError(404, 'not_found', 'Baseline not found');
    try {
      await requireProject(c, a, b.project_id);
    } catch {
      throw new HttpError(404, 'not_found', 'Baseline not found');
    }
    return b;
  };

  const change = route({
    method: 'PATCH',
    path: '/api/workspaces/:workspaceId/visual-baselines/:id',
    summary: 'Change how much a screen may change, or the mockup it is built from (member)',
    tags: ['uikit'],
    params: idParams,
    body: s.object({
      maxDiff: s.optional(s.number({ min: 0, max: 1 })),
      mockupId: s.optional(s.nullable(uuid)),
    }),
    response: baselineOut,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const b = await baselineOf(c, a, params.id);
        if (body.mockupId) {
          const ok = (
            await c.query('SELECT 1 FROM mockups WHERE id = $1 AND project_id = $2', [
              body.mockupId,
              b.project_id,
            ])
          ).rowCount;
          if (!ok)
            throw new HttpError(400, 'invalid_request', 'The mockup is not one of this project', [
              { path: 'body.mockupId', message: 'is not a mockup of this project' },
            ]);
        }
        await c.query(
          'UPDATE visual_baselines SET max_diff = coalesce($2, max_diff), mockup_id = CASE WHEN $3 THEN $4::uuid ELSE mockup_id END WHERE id = $1',
          [b.id, body.maxDiff ?? null, body.mockupId !== undefined, body.mockupId ?? null],
        );
        return { body: baselineJson(await baselineOf(c, a, b.id), a.workspaceId) };
      }),
  });

  const remove = route({
    method: 'DELETE',
    path: '/api/workspaces/:workspaceId/visual-baselines/:id',
    summary: 'Stop checking a screen: its baseline goes, its checks stay as history (member)',
    tags: ['uikit'],
    params: idParams,
    response: s.object({ removed: s.boolean() }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const b = await baselineOf(c, a, params.id);
        await c.query('DELETE FROM visual_baselines WHERE id = $1', [b.id]);
        return { body: { removed: true } };
      }),
  });

  return [screens, history, check, approve, change, remove];
}
