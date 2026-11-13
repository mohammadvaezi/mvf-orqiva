// ── [PCODE-428 | S15 | v0.1.0] T37 low: Request references count per kind ──
// ── [PCODE-337 | S15 | v0.1.0] T34.1b Request votes and duplicate merge, NPS survey, embeddable feedback widget ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-186 | S15 | v0.1.0] B7.2 Client portal live: roadmap, acceptance tests, approvals, releases with ratings, shared documents ──
// ── [PCODE-185 | S15 | v0.1.0] B7.1 Client requests live: portal requests, threads with internal notes, response times, change requests with impact and signature, ratings ──
//    Why:  requests are where a client and the team meet: the client files a bug, a change, a feature or a
//          question with files and sees when the first answer is due; the team answers, keeps internal
//          notes in the same thread (PostgreSQL hides them from the client), quotes a change's cost and
//          schedule, and turns the request into a task whose progress moves the request. Sponsors,
//          approvers and product owners sign a quote; anyone who filed can rate the result.
import { createHash } from 'node:crypto';
import {
  DEFAULT_RESPONSE_HOURS,
  STATE_TEXT,
  impactText,
  mayApproveChange,
  mayFileRequest,
  requestRef,
  responseState,
  stepOf,
  type RequestKind,
  type RequestState,
} from '@orqiva/shared';
import type { PoolClient, Pool } from 'pg';
import { recordEvent } from '../events/outbox.js';
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s, type Infer } from '../http/schema.js';
import { actorOf, asMember, atLeast, requireProject, type Access } from './access.js';

const uuid = s.string({ format: 'uuid' });
const sha256 = (v: string): string => createHash('sha256').update(v).digest('hex');
const KIND = s.enum(['bug', 'change', 'feature', 'question']);
const STATE = s.enum(['new', 'understood', 'quoted', 'planned', 'in_progress', 'done', 'declined']);
const impactIn = s.object({
  points: s.number({ min: 0, max: 1000 }),
  priceCents: s.number({ integer: true, min: 0, max: 1_000_000_000 }),
  days: s.number({ integer: true, min: -365, max: 365 }),
});

export const requestOut = s.object({
  id: s.string(),
  ref: s.string(),
  kind: s.string(),
  title: s.string(),
  state: s.string(),
  stateText: s.string(),
  step: s.number(),
  clientId: s.string(),
  clientName: s.string(),
  projectId: s.nullable(s.string()),
  projectKey: s.nullable(s.string()),
  itemId: s.nullable(s.string()),
  itemRef: s.nullable(s.string()),
  source: s.string(),
  requestedBy: s.nullable(s.object({ id: s.string(), name: s.string() })),
  responseDueAt: s.string(),
  firstResponseAt: s.nullable(s.string()),
  late: s.boolean(),
  responseText: s.string(),
  impact: s.nullable(s.anyObject()),
  approval: s.nullable(s.anyObject()),
  rating: s.nullable(s.number()),
  messages: s.number(),
  lastNote: s.nullable(s.string()),
  createdAt: s.string(),
  updatedAt: s.string(),
  closedAt: s.nullable(s.string()),
  // [PCODE-337 | S15 | v0.1.0] votes, the request it was merged into, the page a widget sent it from
  votes: s.number({ integer: true }),
  voterIds: s.array(s.string()),
  mergedInto: s.nullable(s.object({ id: s.string(), ref: s.string() })),
  pageUrl: s.string(),
});

export interface RequestRow {
  id: string;
  number: number;
  kind: RequestKind;
  title: string;
  state: RequestState;
  client_id: string;
  client_name: string;
  project_id: string | null;
  project_key: string | null;
  item_id: string | null;
  item_ref: string | null;
  source: string;
  requested_by: string | null;
  requester_name: string | null;
  response_due_at: Date;
  first_response_at: Date | null;
  impact: { points: number; priceCents: number; days: number } | null;
  approval: { decision: string; signedName: string; at: string } | null;
  rating: number | null;
  messages: string;
  last_note: string | null;
  created_at: Date;
  updated_at: Date;
  closed_at: Date | null;
  voter_ids: string[]; // [PCODE-337 | S15 | v0.1.0]
  merged_into: string | null;
  merged_kind: RequestKind | null;
  merged_number: number | null;
  page_url: string;
}

const SELECT = `SELECT r.id, r.number, r.kind, r.title, r.state, r.client_id, cl.name AS client_name, r.project_id,
    p.key AS project_key, r.item_id, ip.key || '-' || i.sequence AS item_ref, r.source, r.requested_by,
    u.name AS requester_name, r.response_due_at, r.first_response_at, r.impact, r.created_at, r.updated_at, r.closed_at,
    (SELECT json_build_object('decision', x.decision, 'signedName', x.signed_name, 'at', x.created_at)
       FROM approvals x WHERE x.object_type = 'change_request' AND x.object_id = r.id::text
      ORDER BY x.created_at DESC LIMIT 1) AS approval,
    (SELECT round(avg(q.rating))::int FROM csat_ratings q WHERE q.object_type = 'request' AND q.object_id = r.id) AS rating,
    (SELECT count(*) FROM client_request_messages m WHERE m.request_id = r.id) AS messages,
    (SELECT m.body FROM client_request_messages m WHERE m.request_id = r.id AND m.visibility = 'team'
      ORDER BY m.created_at DESC LIMIT 1) AS last_note,
    (SELECT coalesce(array_agg(v.user_id ORDER BY v.created_at), '{}') FROM client_request_votes v WHERE v.request_id = r.id) AS voter_ids,
    r.merged_into, mr.kind AS merged_kind, mr.number AS merged_number, r.page_url
  FROM client_requests r JOIN clients cl ON cl.id = r.client_id
  LEFT JOIN client_requests mr ON mr.id = r.merged_into
  LEFT JOIN projects p ON p.id = r.project_id
  LEFT JOIN items i ON i.id = r.item_id LEFT JOIN projects ip ON ip.id = i.project_id
  LEFT JOIN users u ON u.id = r.requested_by`;

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

export function requestJson(r: RequestRow, now = new Date()): Infer<typeof requestOut> {
  const resp = responseState(r.response_due_at, r.first_response_at, r.created_at, now);
  return {
    id: r.id,
    ref: requestRef(r.kind, r.number),
    kind: r.kind,
    title: r.title,
    state: r.state,
    stateText: STATE_TEXT[r.state],
    step: stepOf(r.state),
    clientId: r.client_id,
    clientName: r.client_name,
    projectId: r.project_id,
    projectKey: r.project_key,
    itemId: r.item_id,
    itemRef: r.item_ref,
    source: r.source,
    requestedBy:
      r.requested_by && r.requester_name ? { id: r.requested_by, name: r.requester_name } : null,
    responseDueAt: r.response_due_at.toISOString(),
    firstResponseAt: iso(r.first_response_at),
    late: resp.late,
    responseText: resp.text,
    impact: r.impact,
    approval: r.approval,
    rating: r.rating,
    messages: Number(r.messages),
    lastNote: r.last_note,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
    closedAt: iso(r.closed_at),
    votes: r.voter_ids.length, // [PCODE-337 | S15 | v0.1.0]
    voterIds: r.voter_ids,
    mergedInto:
      r.merged_into && r.merged_kind && r.merged_number !== null
        ? { id: r.merged_into, ref: requestRef(r.merged_kind, r.merged_number) }
        : null,
    pageUrl: r.page_url,
  };
}

export async function loadRequest(c: PoolClient, id: string): Promise<RequestRow> {
  const row = (await c.query<RequestRow>(SELECT + ' WHERE r.id = $1', [id])).rows[0];
  if (!row) throw new HttpError(404, 'not_found', 'Request not found');
  return row;
}

/** A client contact's portal roles for their client. */
async function portalRoles(c: PoolClient, a: Access): Promise<string[]> {
  if (!a.clientId) return [];
  return (
    await c.query<{ portal_role: string }>(
      'SELECT portal_role FROM client_contacts WHERE client_id = $1 AND user_id = $2',
      [a.clientId, a.user.id],
    )
  ).rows.map((r) => r.portal_role);
}

/** Team members (member and up) and client contacts; other guests have no requests. */
export function mayUse(a: Access): void {
  if (a.role === 'guest' && !a.clientId)
    throw new HttpError(403, 'forbidden', 'Requests are for the team and its clients');
}

export function teamOnly(a: Access): void {
  if (a.clientId || !atLeast(a.role, 'member'))
    throw new HttpError(403, 'forbidden', 'This needs the member role or higher');
}

/** The files a message carries: each must be one the writer can see; the client then sees them too. */
async function attach(c: PoolClient, ids: string[], forClient: boolean): Promise<string[]> {
  if (!ids.length) return [];
  const found = (
    await c.query<{ id: string }>(
      'SELECT id FROM files WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL',
      [ids],
    )
  ).rows.map((r) => r.id);
  if (found.length !== new Set(ids).size)
    throw new HttpError(400, 'invalid_request', 'A file is missing', [
      { path: 'body.fileIds', message: 'must be files you uploaded' },
    ]);
  if (forClient)
    await c.query('UPDATE files SET client_visible = true WHERE id = ANY($1::uuid[])', [found]);
  return found;
}

const event = async (
  c: PoolClient,
  a: Access,
  r: RequestRow,
  verb: 'created' | 'updated' | 'commented',
  changes?: Record<string, { from: unknown; to: unknown }>,
): Promise<void> => {
  // no project on purpose: project guests never see request events, only the team does
  await recordEvent(c, a.workspaceId, {
    actor: actorOf(a),
    verb,
    object: {
      type: 'client_request',
      id: r.id,
      label: requestRef(r.kind, r.number) + ' ' + r.title,
    },
    parent: { type: 'client', id: r.client_id, label: r.client_name },
    ...(changes ? { changes } : {}),
  });
};

// [PCODE-186 | S15 | v0.1.0] filing a request is shared with the portal (a failed acceptance case files a bug)
export async function insertRequest(
  c: PoolClient,
  r: {
    workspaceId: string;
    clientId: string;
    projectId: string | null;
    number: number;
    responseHours: Record<string, number>;
    kind: RequestKind;
    title: string;
    source: 'portal' | 'team' | 'widget';
    userId: string | null; // [PCODE-337 | S15 | v0.1.0] none for a widget visitor
  },
): Promise<string> {
  const hours = r.responseHours[r.kind] ?? DEFAULT_RESPONSE_HOURS[r.kind];
  const id = (
    await c.query<{ id: string }>(
      `INSERT INTO client_requests (workspace_id, client_id, project_id, number, kind, title, source, requested_by, response_due_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now() + make_interval(mins => $9)) RETURNING id`,
      [
        r.workspaceId,
        r.clientId,
        r.projectId,
        r.number,
        r.kind,
        r.title,
        r.source,
        r.userId,
        Math.round(hours * 60),
      ],
    )
  ).rows[0]?.id;
  if (!id) throw new Error('request insert returned nothing');
  return id;
}

/** [PCODE-186 | S15 | v0.1.0] A client contact files a request from inside the portal (in system mode, checked by the caller). */
export async function fileRequestFor(
  c: PoolClient,
  a: Access,
  r: { clientId: string; projectId: string; kind: RequestKind; title: string; body: string },
): Promise<{ id: string; ref: string }> {
  const client = (
    await c.query<{ response_hours: Record<string, number>; no: number }>(
      // [PCODE-428 | S15 | v0.1.0] the client's row is locked by the update; each kind counts on its own
      'UPDATE clients SET next_request_no = next_request_no + 1 WHERE id = $1 RETURNING response_hours, (SELECT coalesce(max(number), 0) + 1 FROM client_requests WHERE client_id = $1 AND kind = $2) AS no',
      [r.clientId, r.kind],
    )
  ).rows[0];
  if (!client) throw new HttpError(404, 'not_found', 'Client not found');
  const id = await insertRequest(c, {
    workspaceId: a.workspaceId,
    clientId: r.clientId,
    projectId: r.projectId,
    number: client.no,
    responseHours: client.response_hours,
    kind: r.kind,
    title: r.title.slice(0, 255),
    source: 'portal',
    userId: a.user.id,
  });
  await c.query(
    `INSERT INTO client_request_messages (workspace_id, request_id, author_id, body, visibility)
     VALUES ($1, $2, $3, $4, 'client')`,
    [a.workspaceId, id, a.user.id, r.body.slice(0, 20000)],
  );
  const row = await loadRequest(c, id);
  await event(c, a, row, 'created');
  return { id, ref: requestRef(row.kind, row.number) };
}

export function clientRequestRoutes(pool: Pool): Route[] {
  const list = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/client-requests',
    summary: 'Client requests: the team sees all (or one client’s), a contact their own client’s',
    tags: ['clients'],
    params: s.object({ workspaceId: uuid }),
    query: s.object({
      clientId: s.optional(uuid),
      open: s.optional(s.enum(['1', '0'])),
    }),
    response: s.array(requestOut),
    handler: ({ params, query, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        mayUse(a);
        const rows = (
          await c.query<RequestRow>(
            SELECT +
              ` WHERE ($1::uuid IS NULL OR r.client_id = $1) AND (NOT $2 OR r.closed_at IS NULL)
                ORDER BY (r.closed_at IS NULL) DESC, (r.first_response_at IS NULL) DESC, r.response_due_at, r.updated_at DESC
                LIMIT 300`,
            [query.clientId ?? null, query.open === '1'],
          )
        ).rows;
        const now = new Date();
        return { body: rows.map((r) => requestJson(r, now)) };
      }),
  });

  const create = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/client-requests',
    summary: 'File a request (a client contact for their client, or the team for a client)',
    tags: ['clients'],
    params: s.object({ workspaceId: uuid }),
    body: s.object({
      kind: KIND,
      title: s.string({ min: 1, max: 255 }),
      body: s.optional(s.string({ max: 20000 })),
      clientId: s.optional(uuid),
      projectId: s.optional(uuid),
      fileIds: s.optional(s.array(uuid, { max: 20 })),
    }),
    response: requestOut,
    status: 201,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        mayUse(a);
        let clientId = body.clientId;
        if (a.clientId) {
          if (!mayFileRequest(await portalRoles(c, a)))
            throw new HttpError(
              403,
              'forbidden',
              'Viewers read requests; ask your team to add you',
            );
          clientId = a.clientId;
        } else teamOnly(a);
        if (!clientId)
          throw new HttpError(400, 'invalid_request', 'Which client is it for?', [
            { path: 'body.clientId', message: 'is required' },
          ]);
        const client = (
          await c.query<{ id: string; response_hours: Record<string, number>; no: number }>(
            // [PCODE-428 | S15 | v0.1.0]
            'UPDATE clients SET next_request_no = next_request_no + 1 WHERE id = $1 RETURNING id, response_hours, (SELECT coalesce(max(number), 0) + 1 FROM client_requests WHERE client_id = $1 AND kind = $2) AS no',
            [clientId, body.kind],
          )
        ).rows[0];
        if (!client) throw new HttpError(404, 'not_found', 'Client not found');
        let projectId = body.projectId ?? null;
        if (projectId) {
          await requireProject(c, a, projectId);
          const own = (
            await c.query('SELECT 1 FROM projects WHERE id = $1 AND client_id = $2', [
              projectId,
              clientId,
            ])
          ).rowCount;
          if (!own)
            throw new HttpError(400, 'invalid_request', 'The project is not this client’s', [
              { path: 'body.projectId', message: 'belongs to another client' },
            ]);
        } else {
          // the client's only project, when it has one
          const ps = (
            await c.query<{ id: string }>(
              'SELECT id FROM projects WHERE client_id = $1 AND archived_at IS NULL LIMIT 2',
              [clientId],
            )
          ).rows;
          if (ps.length === 1) projectId = ps[0]?.id ?? null;
        }
        const id = await insertRequest(c, {
          workspaceId: a.workspaceId,
          clientId,
          projectId,
          number: client.no,
          responseHours: client.response_hours,
          kind: body.kind,
          title: body.title.trim(),
          source: a.clientId ? 'portal' : 'team',
          userId: a.user.id,
        });
        const row = { id };
        const files = await attach(c, body.fileIds ?? [], true);
        const text = body.body?.trim() || body.title.trim();
        await c.query(
          `INSERT INTO client_request_messages (workspace_id, request_id, author_id, body, visibility, file_ids)
           VALUES ($1, $2, $3, $4, 'client', $5)`,
          [a.workspaceId, row.id, a.user.id, text, files],
        );
        const r = await loadRequest(c, row.id);
        await event(c, a, r, 'created');
        return { status: 201, body: requestJson(r) };
      }),
  });

  const messageOut = s.object({
    id: s.string(),
    author: s.nullable(s.object({ id: s.string(), name: s.string(), client: s.boolean() })),
    body: s.string(),
    internal: s.boolean(),
    files: s.array(
      s.object({ id: s.string(), name: s.string(), mime: s.string(), size: s.number() }),
    ),
    createdAt: s.string(),
  });

  const detail = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/client-requests/:requestId',
    summary: 'A request with its thread (internal notes only for the team)',
    tags: ['clients'],
    params: s.object({ workspaceId: uuid, requestId: uuid }),
    response: s.object({ request: requestOut, messages: s.array(messageOut) }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        mayUse(a);
        const r = await loadRequest(c, params.requestId);
        const msgs = (
          await c.query<{
            id: string;
            author_id: string | null;
            author_name: string | null;
            from_client: boolean;
            body: string;
            visibility: string;
            files: { id: string; name: string; mime: string; size: number }[] | null;
            created_at: Date;
          }>(
            `SELECT m.id, m.author_id, u.name AS author_name,
                EXISTS (SELECT 1 FROM client_contacts cc WHERE cc.user_id = m.author_id AND cc.client_id = $2) AS from_client,
                m.body, m.visibility, m.created_at,
                (SELECT json_agg(json_build_object('id', f.id, 'name', f.name, 'mime', f.mime, 'size', f.size_bytes) ORDER BY f.name)
                   FROM files f WHERE f.id = ANY(m.file_ids) AND f.deleted_at IS NULL) AS files
               FROM client_request_messages m LEFT JOIN users u ON u.id = m.author_id
              WHERE m.request_id = $1 ORDER BY m.created_at, m.id`,
            [r.id, r.client_id],
          )
        ).rows;
        return {
          body: {
            request: requestJson(r),
            messages: msgs.map((m) => ({
              id: m.id,
              author:
                m.author_id && m.author_name
                  ? { id: m.author_id, name: m.author_name, client: m.from_client }
                  : null,
              body: m.body,
              internal: m.visibility === 'team',
              files: m.files ?? [],
              createdAt: m.created_at.toISOString(),
            })),
          },
        };
      }),
  });

  const message = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/client-requests/:requestId/messages',
    summary: 'Write in a request’s thread; the team can keep an internal note',
    tags: ['clients'],
    params: s.object({ workspaceId: uuid, requestId: uuid }),
    body: s.object({
      body: s.string({ min: 1, max: 20000 }),
      internal: s.optional(s.boolean()),
      fileIds: s.optional(s.array(uuid, { max: 20 })),
    }),
    response: requestOut,
    status: 201,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        mayUse(a);
        const r = await loadRequest(c, params.requestId);
        const internal = body.internal === true;
        if (a.clientId) {
          if (internal) throw new HttpError(403, 'forbidden', 'Internal notes are for the team');
          if (!mayFileRequest(await portalRoles(c, a)))
            throw new HttpError(403, 'forbidden', 'Viewers read requests only');
        } else teamOnly(a);
        const files = await attach(c, body.fileIds ?? [], !internal);
        await c.query(
          `INSERT INTO client_request_messages (workspace_id, request_id, author_id, body, visibility, file_ids)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [a.workspaceId, r.id, a.user.id, body.body.trim(), internal ? 'team' : 'client', files],
        );
        // the team's first word to the client is the first answer; a received request is then understood
        if (!a.clientId && !internal)
          await c.query(
            `UPDATE client_requests SET first_response_at = coalesce(first_response_at, now()),
                state = CASE WHEN state = 'new' THEN 'understood' ELSE state END, updated_at = now()
              WHERE id = $1`,
            [r.id],
          );
        else await c.query('UPDATE client_requests SET updated_at = now() WHERE id = $1', [r.id]);
        await event(c, a, r, 'commented', {
          visibility: { from: null, to: internal ? 'team' : 'client' },
          from: { from: null, to: a.clientId ? 'client' : 'team' },
        });
        return { status: 201, body: requestJson(await loadRequest(c, r.id)) };
      }),
  });

  const update = route({
    method: 'PATCH',
    path: '/api/workspaces/:workspaceId/client-requests/:requestId',
    summary: 'Move a request, set its project, or quote a change’s impact (member)',
    tags: ['clients'],
    params: s.object({ workspaceId: uuid, requestId: uuid }),
    body: s.object({
      state: s.optional(STATE),
      projectId: s.optional(s.nullable(uuid)),
      impact: s.optional(impactIn),
    }),
    response: requestOut,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        teamOnly(a);
        const r = await loadRequest(c, params.requestId);
        const changes: Record<string, { from: unknown; to: unknown }> = {};
        let projectId = r.project_id;
        if (body.projectId !== undefined && body.projectId !== r.project_id) {
          if (body.projectId) {
            await requireProject(c, a, body.projectId);
            const own = (
              await c.query('SELECT 1 FROM projects WHERE id = $1 AND client_id = $2', [
                body.projectId,
                r.client_id,
              ])
            ).rowCount;
            if (!own)
              throw new HttpError(400, 'invalid_request', 'The project is not this client’s', [
                { path: 'body.projectId', message: 'belongs to another client' },
              ]);
          }
          projectId = body.projectId;
          changes['project'] = { from: r.project_id, to: projectId };
        }
        let state = body.state ?? r.state;
        let impact = r.impact;
        let quoted = false;
        if (body.impact) {
          if (r.kind !== 'change' && r.kind !== 'feature')
            throw new HttpError(409, 'conflict', 'Only changes and features get a quote');
          if (!['new', 'understood', 'quoted'].includes(r.state))
            throw new HttpError(409, 'conflict', 'The request is past quoting');
          if (!projectId)
            throw new HttpError(
              409,
              'conflict',
              'Choose the project first: the quote belongs to it',
            );
          impact = body.impact;
          state = 'quoted';
          quoted = true;
          changes['impact'] = { from: r.impact, to: impact };
        } else if (body.state === 'quoted' && !r.impact)
          throw new HttpError(409, 'conflict', 'Set the impact to quote a change');
        if (state !== r.state) changes['state'] = { from: r.state, to: state };
        const closing = state === 'done' || state === 'declined';
        await c.query(
          `UPDATE client_requests SET state = $2, project_id = $3, impact = $4,
              quoted_at = CASE WHEN $5 THEN now() ELSE quoted_at END,
              closed_at = CASE WHEN $6 THEN coalesce(closed_at, now()) ELSE NULL END,
              first_response_at = CASE WHEN $5 THEN coalesce(first_response_at, now()) ELSE first_response_at END,
              updated_at = now()
            WHERE id = $1`,
          [r.id, state, projectId, impact ? JSON.stringify(impact) : null, quoted, closing],
        );
        if (Object.keys(changes).length) await event(c, a, r, 'updated', changes);
        return { body: requestJson(await loadRequest(c, r.id)) };
      }),
  });

  const task = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/client-requests/:requestId/task',
    summary: 'Turn a request into a task; the task’s progress then moves the request (member)',
    tags: ['clients'],
    params: s.object({ workspaceId: uuid, requestId: uuid }),
    body: s.object({}),
    response: requestOut,
    status: 201,
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        teamOnly(a);
        const r = await loadRequest(c, params.requestId);
        if (r.item_id) throw new HttpError(409, 'conflict', 'This request is a task already');
        if (r.state === 'quoted')
          throw new HttpError(409, 'conflict', 'The quote waits for the client’s approval');
        if (r.state === 'declined' || r.state === 'done')
          throw new HttpError(409, 'conflict', 'The request is closed');
        if (!r.project_id)
          throw new HttpError(409, 'conflict', 'Choose the project first: the task belongs to it');
        const p = await requireProject(c, a, r.project_id);
        const stateId = (
          await c.query<{ id: string }>(
            `SELECT id FROM project_states WHERE project_id = $1
              ORDER BY (grp = 'unstarted') DESC, position LIMIT 1`,
            [p.id],
          )
        ).rows[0]?.id;
        const seq = (
          await c.query<{ seq: number }>(
            'UPDATE projects SET next_item_seq = next_item_seq + 1 WHERE id = $1 RETURNING next_item_seq - 1 AS seq',
            [p.id],
          )
        ).rows[0]?.seq;
        const first = (
          await c.query<{ body: string }>(
            "SELECT body FROM client_request_messages WHERE request_id = $1 AND visibility = 'client' ORDER BY created_at LIMIT 1",
            [r.id],
          )
        ).rows[0]?.body;
        const ref = requestRef(r.kind, r.number);
        const title = (ref + ': ' + r.title).slice(0, 255);
        const description = [
          first ?? r.title,
          '',
          'From ' +
            r.client_name +
            '’s request ' +
            ref +
            '. Moving this task moves the request the client sees.',
        ].join('\n');
        const id = (
          await c.query<{ id: string }>(
            `INSERT INTO items (workspace_id, project_id, sequence, title, description, state_id, created_by, rank, kind, estimate)
             VALUES ($1, $2, $3, $4, $5, $6, $7, (SELECT coalesce(min(rank), 0) - 1 FROM items WHERE project_id = $2), $8, $9)
             RETURNING id`,
            [
              a.workspaceId,
              p.id,
              seq,
              title,
              description,
              stateId,
              a.user.id,
              r.kind === 'bug' ? 'bug' : r.kind === 'question' ? 'task' : 'story',
              r.impact?.points ?? null,
            ],
          )
        ).rows[0]?.id;
        if (!id) throw new Error('item insert returned nothing');
        await c.query(
          `UPDATE client_requests SET item_id = $2,
              state = CASE WHEN state IN ('new', 'understood') THEN 'planned' ELSE state END, updated_at = now()
            WHERE id = $1`,
          [r.id, id],
        );
        await recordEvent(
          c,
          a.workspaceId,
          {
            actor: actorOf(a),
            verb: 'created',
            object: { type: 'item', id, label: p.key + '-' + String(seq) + ' ' + title },
            parent: { type: 'project', id: p.id, label: p.key },
          },
          { projectId: p.id },
        );
        await event(c, a, r, 'updated', { task: { from: null, to: p.key + '-' + String(seq) } });
        return { status: 201, body: requestJson(await loadRequest(c, r.id)) };
      }),
  });

  const decision = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/client-requests/:requestId/decision',
    summary:
      'Approve a quoted change with a typed signature, or decline it (sponsor, approver, product owner)',
    tags: ['clients'],
    params: s.object({ workspaceId: uuid, requestId: uuid }),
    body: s.object({
      decision: s.enum(['approved', 'declined']),
      signedName: s.optional(s.string({ max: 200 })),
      note: s.optional(s.string({ max: 4000 })),
    }),
    response: requestOut,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        if (!a.clientId || !mayApproveChange(await portalRoles(c, a)))
          throw new HttpError(
            403,
            'forbidden',
            'A sponsor, approver or product owner of the client decides on a quote',
          );
        const r = await loadRequest(c, params.requestId);
        if (r.state !== 'quoted' || !r.impact)
          throw new HttpError(409, 'conflict', 'There is no quote waiting');
        const signed = (body.signedName ?? '').trim();
        if (body.decision === 'approved' && signed.length < 3)
          throw new HttpError(400, 'invalid_request', 'Type your full name to sign', [
            { path: 'body.signedName', message: 'is required to approve' },
          ]);
        const ref = requestRef(r.kind, r.number);
        await c.query(
          `INSERT INTO approvals (workspace_id, project_id, object_type, object_id, version_hash, approver_id, decision, signed_name, note)
           VALUES ($1, $2, 'change_request', $3, $4, $5, $6, $7, $8)`,
          [
            a.workspaceId,
            r.project_id,
            r.id,
            sha256(impactText(ref, r.title, r.impact)),
            a.user.id,
            body.decision,
            signed,
            body.note ?? '',
          ],
        );
        const state = body.decision === 'approved' ? 'planned' : 'declined';
        await c.query(
          `UPDATE client_requests SET state = $2, updated_at = now(),
              closed_at = CASE WHEN $2 = 'declined' THEN now() ELSE closed_at END WHERE id = $1`,
          [r.id, state],
        );
        await event(c, a, r, 'updated', { state: { from: r.state, to: state } });
        return { body: requestJson(await loadRequest(c, r.id)) };
      }),
  });

  const rating = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/client-requests/:requestId/rating',
    summary: 'Rate how a finished request went, 1 to 5 (client contact)',
    tags: ['clients'],
    params: s.object({ workspaceId: uuid, requestId: uuid }),
    body: s.object({
      rating: s.number({ integer: true, min: 1, max: 5 }),
      comment: s.optional(s.string({ max: 2000 })),
    }),
    response: requestOut,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        if (!a.clientId) throw new HttpError(403, 'forbidden', 'Clients rate their requests');
        const r = await loadRequest(c, params.requestId);
        if (r.state !== 'done')
          throw new HttpError(409, 'conflict', 'A request is rated once it is done');
        await c.query(
          `INSERT INTO csat_ratings (workspace_id, client_id, user_id, object_type, object_id, rating, comment)
           VALUES ($1, $2, $3, 'request', $4, $5, $6)
           ON CONFLICT (object_type, object_id, user_id) DO UPDATE SET rating = EXCLUDED.rating, comment = EXCLUDED.comment, created_at = now()`,
          [a.workspaceId, r.client_id, a.user.id, r.id, body.rating, body.comment ?? ''],
        );
        await event(c, a, r, 'updated', { rating: { from: null, to: body.rating } });
        return { body: requestJson(await loadRequest(c, r.id)) };
      }),
  });

  const hours = route({
    method: 'PUT',
    path: '/api/workspaces/:workspaceId/clients/:clientId/response-hours',
    summary: 'The first-answer times promised to a client, in hours per kind (admin)',
    tags: ['clients'],
    params: s.object({ workspaceId: uuid, clientId: uuid }),
    body: s.object({
      bug: s.number({ min: 0.25, max: 720 }),
      change: s.number({ min: 0.25, max: 720 }),
      feature: s.number({ min: 0.25, max: 720 }),
      question: s.number({ min: 0.25, max: 720 }),
    }),
    response: s.anyObject(),
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'admin', async (c) => {
        const n = (
          await c.query('UPDATE clients SET response_hours = $2 WHERE id = $1', [
            params.clientId,
            JSON.stringify(body),
          ])
        ).rowCount;
        if (!n) throw new HttpError(404, 'not_found', 'Client not found');
        return { body };
      }),
  });

  return [list, create, detail, message, update, task, decision, rating, hours];
}
