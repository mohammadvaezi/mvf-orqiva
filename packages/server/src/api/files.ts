// ── [PCODE-295 | S15 | v0.1.0] T30.8b Visual regression: baselines, pixel diff, orq visual check, the Visual tab ──
// ── [PCODE-241 | S15 | v0.1.0] T24.2 Reading files through the models: PDF, DOCX, images, audio ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-185 | S15 | v0.1.0] B7.1 Client requests live: portal requests, threads with internal notes, response times, change requests with impact and signature, ratings ──
// ── [PCODE-168 | S15 | v0.1.0] B3.1 Ideation and files on the server: blob store, sources, requirements, questions, risks, assumptions, decisions, glossary, scores, extraction ──
//    Why:  uploads for every section (idea sources, documents, mockups, assets, test evidence): the bytes
//          go to the blob store as they come (a raw body, not JSON, up to 25 MB), the record to PostgreSQL
//          under row-level security. Text files keep their text for search and agents. Images that are safe
//          to show (raster formats) open inline; everything else downloads.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { mayFileRequest } from '@orqiva/shared';
import type { Pool, PoolClient } from 'pg';
import { BlobStore } from '../files/blobstore.js';
import { queueRead } from '../files/reading.js'; // [PCODE-241 | S15 | v0.1.0]
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s, type Infer } from '../http/schema.js';
import { asMember, requireProject, type Access } from './access.js';

const uuid = s.string({ format: 'uuid' });
export const MAX_UPLOAD = 25 * 1024 * 1024;
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const UPLOAD = new RegExp('^/api/workspaces/(' + UUID + ')/files$', 'i');
const MIME = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,62}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,62}$/i;
const INLINE = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const TEXT_EXT = /\.(md|markdown|txt|csv|json|ya?ml|xml|log|feature)$/i;

/** Text an agent or search may read straight away; OCR and transcripts come from workers later. */
export function textOf(name: string, mime: string, data: Buffer): string | null {
  const textual =
    mime.startsWith('text/') ||
    ['application/json', 'application/xml', 'application/x-yaml'].includes(mime) ||
    TEXT_EXT.test(name);
  if (!textual) return null;
  return data
    .toString('utf8')
    .replace(/\u0000/g, '')
    .slice(0, 200_000);
}

export const fileOut = s.object({
  id: s.string(),
  projectId: s.nullable(s.string()),
  name: s.string(),
  mime: s.string(),
  sizeBytes: s.number({ integer: true }),
  sha256: s.string(),
  hasText: s.boolean(),
  clientVisible: s.boolean(),
  uploadedBy: s.nullable(s.string()),
  createdAt: s.string(),
  url: s.string(),
  // [PCODE-241 | S15 | v0.1.0] how the file's text came, or why it has none yet
  textKind: s.string(),
  read: s.nullable(
    s.object({
      method: s.string(),
      status: s.string(),
      provider: s.string(),
      model: s.string(),
      error: s.string(),
      costMicros: s.number({ integer: true }),
      finishedAt: s.nullable(s.string()),
    }),
  ),
});
export interface FileRow {
  id: string;
  project_id: string | null;
  name: string;
  mime: string;
  size_bytes: string;
  sha256: string;
  storage_key: string;
  text_kind: string;
  client_visible: boolean;
  uploader: string | null;
  created_at: Date;
  // [PCODE-241 | S15 | v0.1.0]
  read_method: string | null;
  read_status: string | null;
  read_provider: string | null;
  read_model: string | null;
  read_error: string | null;
  read_cost: string | null;
  read_finished_at: Date | null;
}
export const FILE_SELECT = `SELECT f.id, f.project_id, f.name, f.mime, f.size_bytes, f.sha256, f.storage_key, f.text_kind,
       f.client_visible, u.name AS uploader, f.created_at,
       fr.method AS read_method, fr.status AS read_status, fr.provider AS read_provider, fr.model AS read_model,
       fr.error AS read_error, fr.finished_at AS read_finished_at,
       (SELECT r.cost_micros FROM agent_runs r WHERE r.id = fr.run_id) AS read_cost
  FROM files f LEFT JOIN users u ON u.id = f.uploaded_by LEFT JOIN file_reads fr ON fr.file_id = f.id`;
export const fileJson = (r: FileRow, workspaceId: string): Infer<typeof fileOut> => ({
  id: r.id,
  projectId: r.project_id,
  name: r.name,
  mime: r.mime,
  sizeBytes: Number(r.size_bytes),
  sha256: r.sha256,
  hasText: r.text_kind !== 'none',
  clientVisible: r.client_visible,
  uploadedBy: r.uploader,
  createdAt: r.created_at.toISOString(),
  url: '/api/workspaces/' + workspaceId + '/files/' + r.id + '/content',
  // [PCODE-241 | S15 | v0.1.0]
  textKind: r.text_kind,
  read: r.read_status
    ? {
        method: r.read_method ?? '',
        status: r.read_status,
        provider: r.read_provider ?? '',
        model: r.read_model ?? '',
        error: r.read_error ?? '',
        costMicros: Number(r.read_cost ?? 0),
        finishedAt: r.read_finished_at?.toISOString() ?? null,
      }
    : null,
});

/** The file, if it exists, is not deleted and its project is visible to the caller. */
export async function visibleFile(c: PoolClient, a: Access, id: string): Promise<FileRow> {
  const r = (
    await c.query<FileRow>(FILE_SELECT + ' WHERE f.id = $1 AND f.deleted_at IS NULL', [id])
  ).rows[0];
  if (!r) throw new HttpError(404, 'not_found', 'File not found');
  if (r.project_id)
    try {
      await requireProject(c, a, r.project_id);
    } catch {
      throw new HttpError(404, 'not_found', 'File not found');
    }
  else if (a.role === 'guest') throw new HttpError(404, 'not_found', 'File not found');
  return r;
}

function answer(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage, max: number): Promise<Buffer | 'too_large'> {
  const declared = Number(req.headers['content-length'] ?? 0);
  if (declared > max) return Promise.resolve('too_large');
  return new Promise((resolveBody, reject) => {
    const parts: Buffer[] = [];
    let size = 0;
    req.on('data', (d: Buffer) => {
      size += d.length;
      if (size > max) {
        resolveBody('too_large');
        req.resume();
        return;
      }
      parts.push(d);
    });
    req.on('end', () => {
      resolveBody(Buffer.concat(parts));
    });
    req.on('error', reject);
  });
}

/** POST /api/workspaces/:ws/files?name=…&projectId=…&clientVisible=1 with the bytes as the body (member). */
export function fileUploads(pool: Pool, store: BlobStore) {
  return (req: IncomingMessage, res: ServerResponse): boolean => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const m = UPLOAD.exec(url.pathname);
    if (!m || req.method !== 'POST') return false;
    void (async () => {
      try {
        const workspaceId = (m[1] ?? '').toLowerCase();
        const name = (url.searchParams.get('name') ?? '').trim().replace(/[\\/]/g, '_');
        const projectId = url.searchParams.get('projectId');
        const mime =
          (req.headers['content-type'] ?? 'application/octet-stream')
            .split(';')[0]
            ?.trim()
            .toLowerCase() ?? '';
        const issues: { path: string; message: string }[] = [];
        if (!name || name.length > 255)
          issues.push({ path: 'query.name', message: 'is required, at most 255 characters' });
        if (projectId !== null && !new RegExp('^' + UUID + '$', 'i').test(projectId))
          issues.push({ path: 'query.projectId', message: 'is not an id' });
        if (!MIME.test(mime))
          issues.push({ path: 'header.content-type', message: 'is not a media type' });
        if (issues.length)
          throw new HttpError(400, 'invalid_request', 'The upload is not complete', issues);
        const data = await readBody(req, MAX_UPLOAD);
        if (data === 'too_large')
          throw new HttpError(413, 'payload_too_large', 'Files can be at most 25 MB');
        if (!data.length)
          throw new HttpError(400, 'invalid_request', 'The file is empty', [
            { path: 'body', message: 'is empty' },
          ]);
        const body = await asMember(pool, req, workspaceId, 'guest', async (c, a) => {
          // [PCODE-185 | S15 | v0.1.0] a client contact uploads into their client's project, for their requests;
          // what they upload is the client's to see. Other guests still upload nothing.
          if (a.role === 'guest' && (!a.clientId || !projectId))
            throw new HttpError(
              403,
              'forbidden',
              'This needs the member role or higher; you are guest',
            );
          if (a.clientId) {
            const roles = (
              await c.query<{ portal_role: string }>(
                'SELECT portal_role FROM client_contacts WHERE client_id = $1 AND user_id = $2',
                [a.clientId, a.user.id],
              )
            ).rows.map((r) => r.portal_role);
            if (!mayFileRequest(roles))
              throw new HttpError(403, 'forbidden', 'Viewers read only; ask your team to add you');
          }
          if (projectId) await requireProject(c, a, projectId);
          const { sha256, key } = await store.put(data);
          const text = textOf(name, mime, data);
          const id = (
            await c.query<{ id: string }>(
              `INSERT INTO files (workspace_id, project_id, name, mime, size_bytes, sha256, storage_key, text_content, text_kind, client_visible, uploaded_by)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
              [
                a.workspaceId,
                projectId,
                name,
                mime,
                data.length,
                sha256,
                key,
                text ?? '',
                text === null ? 'none' : 'extracted',
                Boolean(a.clientId) || url.searchParams.get('clientVisible') === '1',
                a.user.id,
              ],
            )
          ).rows[0]?.id;
          // [PCODE-241 | S15 | v0.1.0] files without text are read in the background
          // [PCODE-295 | S15 | v0.1.0] read=0: the uploader needs no reading (screenshots for visual checks)
          if (id && text === null && url.searchParams.get('read') !== '0')
            await queueRead(c, { id, workspaceId: a.workspaceId, name, mime, userId: a.user.id });
          const row = (await c.query<FileRow>(FILE_SELECT + ' WHERE f.id = $1', [id])).rows[0];
          if (!row) throw new Error('file vanished');
          return fileJson(row, a.workspaceId);
        });
        answer(res, 201, body);
      } catch (e) {
        if (e instanceof HttpError)
          answer(res, e.status, {
            error: {
              code: e.code,
              message: e.message,
              ...(e.details ? { details: e.details } : {}),
            },
          });
        else answer(res, 500, { error: { code: 'internal', message: 'The upload failed' } });
      }
    })();
    return true;
  };
}

export function fileRoutes(pool: Pool, store: BlobStore): Route[] {
  const fileParams = s.object({ workspaceId: uuid, fileId: uuid });
  const meta = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/files/:fileId',
    summary: 'One file’s record',
    tags: ['files'],
    params: fileParams,
    response: fileOut,
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => ({
        body: fileJson(await visibleFile(c, a, params.fileId), a.workspaceId),
      })),
  });
  // [PCODE-241 | S15 | v0.1.0] read a file (again): after a failure, a better connection or a new model
  const reread = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/files/:fileId/read',
    summary:
      'Read the file’s text again through the workspace’s reading or audio connection (member)',
    tags: ['files'],
    params: fileParams,
    response: fileOut,
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const f = await visibleFile(c, a, params.fileId);
        const method = await queueRead(c, {
          id: f.id,
          workspaceId: a.workspaceId,
          name: f.name,
          mime: f.mime,
          userId: a.user.id,
        });
        if (!method)
          throw new HttpError(409, 'conflict', 'This kind of file is not read by a model');
        const row = (await c.query<FileRow>(FILE_SELECT + ' WHERE f.id = $1', [f.id])).rows[0];
        if (!row) throw new Error('file vanished');
        return { body: fileJson(row, a.workspaceId) };
      }),
  });
  const content = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/files/:fileId/content',
    summary: 'The file’s bytes; raster images open inline, everything else downloads',
    tags: ['files'],
    params: fileParams,
    response: s.anyObject(),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        const f = await visibleFile(c, a, params.fileId);
        const data = await store.get(f.storage_key).catch(() => {
          throw new HttpError(
            410,
            'gone',
            'The file’s bytes are missing from the store; restore the backup',
          );
        });
        return {
          body: {},
          file: {
            data,
            contentType: f.mime,
            name: f.name,
            ...(INLINE.has(f.mime) ? { inline: true } : {}),
          },
        };
      }),
  });
  const list = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/projects/:projectId/files',
    summary: 'The files of a project, newest first',
    tags: ['files'],
    params: s.object({ workspaceId: uuid, projectId: uuid }),
    response: s.array(fileOut),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        await requireProject(c, a, params.projectId);
        const rows = (
          await c.query<FileRow>(
            FILE_SELECT +
              ' WHERE f.project_id = $1 AND f.deleted_at IS NULL ORDER BY f.created_at DESC LIMIT 500',
            [params.projectId],
          )
        ).rows;
        return { body: rows.map((r) => fileJson(r, a.workspaceId)) };
      }),
  });
  const remove = route({
    method: 'DELETE',
    path: '/api/workspaces/:workspaceId/files/:fileId',
    summary: 'Remove a file from lists (the bytes stay until the store is cleaned) (member)',
    tags: ['files'],
    params: fileParams,
    response: s.object({ removed: s.boolean() }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const f = await visibleFile(c, a, params.fileId);
        await c.query('UPDATE files SET deleted_at = now() WHERE id = $1', [f.id]);
        return { body: { removed: true } };
      }),
  });
  return [meta, reread, content, list, remove];
}
