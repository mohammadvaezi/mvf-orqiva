// ── [PCODE-467 | S15 | v0.1.0] A project is planned for a client, and every task traces back to the client request it serves ──
//    Why:  before a project is planned it is clear for whom: the client it belongs to, or that it is internal.
//          The requests of that client the plan answers are taken into the project, and every task names
//          the request it serves. VS Code reads the binding to plan (the requests' words are part of what
//          Claude reads), sets it, and links the published tasks; the work record shows it per task.
import { requestRef, type RequestKind } from '@orqiva/shared';
import type { Pool, PoolClient } from 'pg';
import { recordEvent } from '../events/outbox.js';
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s } from '../http/schema.js';
import { actorOf, asMember, requireProject, type Access } from './access.js';

const uuid = s.string({ format: 'uuid' });
const params = s.object({ workspaceId: uuid, projectId: uuid });

const requestOut = s.object({
  id: s.string(),
  ref: s.string(),
  kind: s.string(),
  title: s.string(),
  state: s.string(),
  text: s.string(),
  /** taken into this project; otherwise an open request of the client, not planned anywhere yet */
  inProject: s.boolean(),
  items: s.array(s.object({ id: s.string(), ref: s.string() })),
});
const bindingOut = s.object({
  client: s.nullable(s.object({ id: s.string(), name: s.string() })),
  internal: s.boolean(),
  requests: s.array(requestOut),
});

interface ReqRow {
  id: string;
  kind: RequestKind;
  number: number;
  title: string;
  state: string;
  text: string | null;
  project_id: string | null;
  items: { id: string; ref: string }[] | null;
}

/** The project's client (or internal) and the requests: those in the project, and the client's open ones. */
export async function bindingOf(
  c: PoolClient,
  projectId: string,
): Promise<{
  client: { id: string; name: string } | null;
  internal: boolean;
  requests: {
    id: string;
    ref: string;
    kind: string;
    title: string;
    state: string;
    text: string;
    inProject: boolean;
    items: { id: string; ref: string }[];
  }[];
}> {
  const p = (
    await c.query<{ client_id: string | null; client_name: string | null; internal: boolean }>(
      `SELECT p.client_id, cl.name AS client_name, p.internal
         FROM projects p LEFT JOIN clients cl ON cl.id = p.client_id WHERE p.id = $1`,
      [projectId],
    )
  ).rows[0];
  if (!p) throw new HttpError(404, 'not_found', 'Project not found');
  const rows = p.client_id
    ? (
        await c.query<ReqRow>(
          `SELECT r.id, r.kind, r.number, r.title, r.state, r.project_id,
                  (SELECT m.body FROM client_request_messages m
                    WHERE m.request_id = r.id AND m.visibility = 'client' ORDER BY m.created_at LIMIT 1) AS text,
                  (SELECT json_agg(json_build_object('id', i.id, 'ref', pp.key || '-' || i.sequence) ORDER BY i.sequence)
                     FROM client_request_items ri JOIN items i ON i.id = ri.item_id JOIN projects pp ON pp.id = i.project_id
                    WHERE ri.request_id = r.id) AS items
             FROM client_requests r
            WHERE r.client_id = $1
              AND (r.project_id = $2 OR (r.project_id IS NULL AND r.state NOT IN ('done', 'declined')))
            ORDER BY r.created_at`,
          [p.client_id, projectId],
        )
      ).rows
    : [];
  return {
    client: p.client_id ? { id: p.client_id, name: p.client_name ?? '' } : null,
    internal: p.internal,
    requests: rows.map((r) => ({
      id: r.id,
      ref: requestRef(r.kind, r.number),
      kind: r.kind,
      title: r.title,
      state: r.state,
      text: r.text ?? '',
      inProject: r.project_id === projectId,
      items: r.items ?? [],
    })),
  };
}

async function projectEvent(
  c: PoolClient,
  a: Access,
  projectId: string,
  what: string,
): Promise<void> {
  const p = (
    await c.query<{ key: string; name: string }>('SELECT key, name FROM projects WHERE id = $1', [
      projectId,
    ])
  ).rows[0];
  await recordEvent(
    c,
    a.workspaceId,
    {
      actor: actorOf(a),
      verb: 'updated',
      object: { type: 'project', id: projectId, label: p?.key ?? '' },
      changes: { binding: { from: null, to: what } },
    },
    { projectId },
  );
}

export function projectBindingRoutes(pool: Pool): Route[] {
  const get = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/projects/:projectId/binding',
    summary:
      'For whom the project is: its client or internal, and the client requests it answers (guest)',
    tags: ['clients'],
    params,
    response: bindingOut,
    handler: ({ params: p, req }) =>
      asMember(pool, req, p.workspaceId, 'guest', async (c, a) => {
        await requireProject(c, a, p.projectId);
        return { body: await bindingOf(c, p.projectId) };
      }),
  });

  // ── [PCODE-467 | S15 | v0.1.0] set it: a client, or internal on purpose ──
  const put = route({
    method: 'PUT',
    path: '/api/workspaces/:workspaceId/projects/:projectId/binding',
    summary: 'Link the project to a client, or mark it internal (member)',
    tags: ['clients'],
    params,
    body: s.object({ clientId: s.nullable(uuid), internal: s.boolean() }),
    response: bindingOut,
    handler: ({ params: p, body, req }) =>
      asMember(pool, req, p.workspaceId, 'member', async (c, a) => {
        await requireProject(c, a, p.projectId);
        if (body.clientId && body.internal)
          throw new HttpError(400, 'invalid_request', 'A project for a client is not internal', [
            { path: 'body.internal', message: 'must be false with a client' },
          ]);
        if (!body.clientId && !body.internal)
          throw new HttpError(
            400,
            'invalid_request',
            'Name the client, or mark the project internal',
            [{ path: 'body.clientId', message: 'is required unless internal' }],
          );
        if (
          body.clientId &&
          !(
            await c.query('SELECT 1 FROM clients WHERE id = $1 AND archived_at IS NULL', [
              body.clientId,
            ])
          ).rowCount
        )
          throw new HttpError(404, 'not_found', 'Client not found');
        await c.query('UPDATE projects SET client_id = $2, internal = $3 WHERE id = $1', [
          p.projectId,
          body.clientId,
          body.internal,
        ]);
        await projectEvent(c, a, p.projectId, body.internal ? 'internal' : 'client');
        return { body: await bindingOf(c, p.projectId) };
      }),
  });

  // ── [PCODE-467 | S15 | v0.1.0] a request of the client is answered in this project ──
  const take = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/projects/:projectId/binding/requests',
    summary:
      "Take a request of the project's client into the project: the plan answers it (member)",
    tags: ['clients'],
    params,
    body: s.object({ requestId: uuid }),
    response: bindingOut,
    status: 201,
    handler: ({ params: p, body, req }) =>
      asMember(pool, req, p.workspaceId, 'member', async (c, a) => {
        await requireProject(c, a, p.projectId);
        const done = await c.query(
          `UPDATE client_requests r SET project_id = $2,
                  state = CASE WHEN r.state IN ('new', 'understood', 'quoted') THEN 'planned' ELSE r.state END,
                  updated_at = now()
            WHERE r.id = $1 AND r.client_id = (SELECT client_id FROM projects WHERE id = $2)
              AND (r.project_id IS NULL OR r.project_id = $2)`,
          [body.requestId, p.projectId],
        );
        if (!done.rowCount)
          throw new HttpError(
            409,
            'conflict',
            "The request is not one of this project's client, or it is planned elsewhere",
          );
        await projectEvent(c, a, p.projectId, 'request');
        return { status: 201, body: await bindingOf(c, p.projectId) };
      }),
  });

  // ── [PCODE-467 | S15 | v0.1.0] the requests a task serves ──
  const link = route({
    method: 'PUT',
    path: '/api/workspaces/:workspaceId/items/:itemId/requests',
    summary:
      'Name the client requests a task serves; an empty list: not requested by the client (member)',
    tags: ['clients'],
    params: s.object({ workspaceId: uuid, itemId: uuid }),
    body: s.object({ requestIds: s.array(uuid, { max: 20 }) }),
    response: s.object({
      requests: s.array(s.object({ id: s.string(), ref: s.string(), title: s.string() })),
    }),
    handler: ({ params: p, body, req }) =>
      asMember(pool, req, p.workspaceId, 'member', async (c, a) => {
        const it = (
          await c.query<{ project_id: string }>('SELECT project_id FROM items WHERE id = $1', [
            p.itemId,
          ])
        ).rows[0];
        if (!it) throw new HttpError(404, 'not_found', 'Item not found');
        await requireProject(c, a, it.project_id);
        const ok = (
          await c.query<{ id: string }>(
            'SELECT id FROM client_requests WHERE id = ANY($1::uuid[]) AND project_id = $2',
            [body.requestIds, it.project_id],
          )
        ).rows.map((r) => r.id);
        if (ok.length !== new Set(body.requestIds).size)
          throw new HttpError(400, 'invalid_request', 'A request is not one this project answers', [
            { path: 'body.requestIds', message: 'names a request outside the project' },
          ]);
        await c.query(
          'DELETE FROM client_request_items WHERE item_id = $1 AND NOT (request_id = ANY($2::uuid[]))',
          [p.itemId, ok],
        );
        for (const r of ok)
          await c.query(
            'INSERT INTO client_request_items (workspace_id, request_id, item_id, created_by) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
            [a.workspaceId, r, p.itemId, a.user.id],
          );
        return { body: { requests: await requestsOfItem(c, p.itemId) } };
      }),
  });

  return [get, put, take, link];
}

/** The requests a task serves, for its work record. */
export async function requestsOfItem(
  c: PoolClient,
  itemId: string,
): Promise<{ id: string; ref: string; title: string }[]> {
  return (
    await c.query<{ id: string; kind: RequestKind; number: number; title: string }>(
      `SELECT r.id, r.kind, r.number, r.title FROM client_request_items ri JOIN client_requests r ON r.id = ri.request_id
        WHERE ri.item_id = $1 ORDER BY r.created_at`,
      [itemId],
    )
  ).rows.map((r) => ({ id: r.id, ref: requestRef(r.kind, r.number), title: r.title }));
}
