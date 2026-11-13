// ── [PCODE-284 | S15 | v0.1.0] T29.6 Documents: tree drag and drop, files, image annotation, read analytics, per-task knowledge, checked citations ──
//    Why:  what belongs to a page besides its text: its files (shown in the tree), who read which version
//          (and which watchers have not read the latest), and the tasks whose agents may read it.
import type { Pool, PoolClient } from 'pg';
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s } from '../http/schema.js';
import { asMember, type Access } from './access.js';
import { pageOf } from './documents.js';
import { visibleFile } from './files.js';

const uuid = s.string({ format: 'uuid' });
const pageParams = s.object({ workspaceId: uuid, pageId: uuid });
const fileOut = s.object({
  id: s.string(),
  name: s.string(),
  mime: s.string(),
  sizeBytes: s.number({ integer: true }),
  url: s.string(),
});

const filesOf = async (c: PoolClient, a: Access, pageId: string) =>
  (
    await c.query<{ id: string; name: string; mime: string; size_bytes: number }>(
      `SELECT f.id, f.name, f.mime, f.size_bytes::float8 AS size_bytes FROM doc_files df JOIN files f ON f.id = df.file_id AND f.deleted_at IS NULL
        WHERE df.page_id = $1 ORDER BY df.created_at`,
      [pageId],
    )
  ).rows.map((f) => ({
    id: f.id,
    name: f.name,
    mime: f.mime,
    sizeBytes: f.size_bytes,
    url: '/api/workspaces/' + a.workspaceId + '/files/' + f.id + '/content',
  }));

export function docExtraRoutes(pool: Pool): Route[] {
  const files = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/docs/:pageId/files',
    summary: 'The files attached to a page',
    tags: ['documents'],
    params: pageParams,
    response: s.array(fileOut),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'auditor', async (c, a) => {
        await pageOf(c, a, params.pageId);
        return { body: await filesOf(c, a, params.pageId) };
      }),
  });

  const attach = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/docs/:pageId/files',
    summary: 'Attach an uploaded file of the project to a page (member)',
    tags: ['documents'],
    params: pageParams,
    body: s.object({ fileId: uuid }),
    response: s.array(fileOut),
    status: 201,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const p = await pageOf(c, a, params.pageId);
        const f = await visibleFile(c, a, body.fileId);
        if (f.project_id && f.project_id !== p.project_id)
          throw new HttpError(400, 'invalid_request', 'The file belongs to another project', [
            { path: 'body.fileId', message: 'is not a file of this project' },
          ]);
        await c.query(
          'INSERT INTO doc_files (workspace_id, page_id, file_id, added_by) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
          [a.workspaceId, p.id, body.fileId, a.user.id],
        );
        return { status: 201, body: await filesOf(c, a, p.id) };
      }),
  });

  const detach = route({
    method: 'DELETE',
    path: '/api/workspaces/:workspaceId/docs/:pageId/files/:fileId',
    summary: 'Take a file off a page (the file itself stays) (member)',
    tags: ['documents'],
    params: s.object({ workspaceId: uuid, pageId: uuid, fileId: uuid }),
    response: s.array(fileOut),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const p = await pageOf(c, a, params.pageId);
        await c.query('DELETE FROM doc_files WHERE page_id = $1 AND file_id = $2', [
          p.id,
          params.fileId,
        ]);
        return { body: await filesOf(c, a, p.id) };
      }),
  });

  const readers = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/docs/:pageId/readers',
    summary:
      'Who read the page, which version last and how often; the watchers who have not read the latest version',
    tags: ['documents'],
    params: pageParams,
    response: s.object({
      version: s.number({ integer: true }),
      readers: s.array(
        s.object({
          userId: s.string(),
          name: s.string(),
          version: s.number({ integer: true }),
          reads: s.number({ integer: true }),
          lastAt: s.string(),
          latest: s.boolean(),
        }),
      ),
      unreadWatchers: s.array(s.object({ userId: s.string(), name: s.string() })),
    }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'auditor', async (c, a) => {
        const p = await pageOf(c, a, params.pageId);
        const rows = (
          await c.query<{
            user_id: string;
            name: string;
            version: number;
            reads: number;
            last_at: Date;
          }>(
            `SELECT r.user_id, u.name, r.version, r.reads, r.last_at FROM doc_reads r JOIN users u ON u.id = r.user_id
              WHERE r.page_id = $1 ORDER BY r.last_at DESC LIMIT 200`,
            [p.id],
          )
        ).rows;
        const unread = (
          await c.query<{ user_id: string; name: string }>(
            `SELECT w.user_id, u.name FROM doc_watchers w JOIN users u ON u.id = w.user_id
              LEFT JOIN doc_reads r ON r.page_id = w.page_id AND r.user_id = w.user_id
             WHERE w.page_id = $1 AND (r.version IS NULL OR r.version < $2) ORDER BY u.name`,
            [p.id, p.version],
          )
        ).rows;
        return {
          body: {
            version: p.version,
            readers: rows.map((r) => ({
              userId: r.user_id,
              name: r.name,
              version: r.version,
              reads: r.reads,
              lastAt: r.last_at.toISOString(),
              latest: r.version >= p.version,
            })),
            unreadWatchers: unread.map((r) => ({ userId: r.user_id, name: r.name })),
          },
        };
      }),
  });

  const taskOut = s.array(s.object({ itemId: s.string(), ref: s.string(), title: s.string() }));
  const tasksOf = async (c: PoolClient, pageId: string) =>
    (
      await c.query<{ id: string; ref: string; title: string }>(
        `SELECT i.id, p.key || '-' || i.sequence AS ref, i.title FROM item_knowledge k
           JOIN items i ON i.id = k.item_id JOIN projects p ON p.id = i.project_id
          WHERE k.page_id = $1 ORDER BY i.sequence`,
        [pageId],
      )
    ).rows.map((r) => ({ itemId: r.id, ref: r.ref, title: r.title }));

  const tasks = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/docs/:pageId/tasks',
    summary: 'The tasks whose agents may read this page (and what is under it)',
    tags: ['documents'],
    params: pageParams,
    response: taskOut,
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'auditor', async (c, a) => {
        await pageOf(c, a, params.pageId);
        return { body: await tasksOf(c, params.pageId) };
      }),
  });

  const addTask = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/docs/:pageId/tasks',
    summary:
      'Open the page to the agents working on a task of the project, by its reference (member)',
    tags: ['documents'],
    params: pageParams,
    body: s.object({ ref: s.string({ min: 3, max: 30 }) }),
    response: taskOut,
    status: 201,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const p = await pageOf(c, a, params.pageId);
        const m = /^\s*([A-Za-z][A-Za-z0-9]{1,9})-(\d+)\s*$/.exec(body.ref);
        const item = m
          ? (
              await c.query<{ id: string }>(
                `SELECT i.id FROM items i JOIN projects pr ON pr.id = i.project_id
                  WHERE pr.id = $1 AND pr.key = upper($2) AND i.sequence = $3`,
                [p.project_id, m[1], Number(m[2])],
              )
            ).rows[0]
          : undefined;
        if (!item)
          throw new HttpError(
            400,
            'invalid_request',
            'No task ' + body.ref.trim() + ' in this project',
            [{ path: 'body.ref', message: 'is not a task of this project' }],
          );
        await c.query(
          'INSERT INTO item_knowledge (workspace_id, item_id, page_id, created_by) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
          [a.workspaceId, item.id, p.id, a.user.id],
        );
        return { status: 201, body: await tasksOf(c, p.id) };
      }),
  });

  const removeTask = route({
    method: 'DELETE',
    path: '/api/workspaces/:workspaceId/docs/:pageId/tasks/:itemId',
    summary: 'Close the page again to a task’s agents (member)',
    tags: ['documents'],
    params: s.object({ workspaceId: uuid, pageId: uuid, itemId: uuid }),
    response: taskOut,
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const p = await pageOf(c, a, params.pageId);
        await c.query('DELETE FROM item_knowledge WHERE page_id = $1 AND item_id = $2', [
          p.id,
          params.itemId,
        ]);
        return { body: await tasksOf(c, p.id) };
      }),
  });

  return [files, attach, detach, readers, tasks, addTask, removeTask];
}
