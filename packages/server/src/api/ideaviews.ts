// ── [PCODE-274 | S15 | v0.1.0] T28.3 Stories with Given/When/Then and personas; value/effort matrix, evidence library, compare ──
//    Why:  the views across a project's ideas, and what they share. Personas belong to the project, so its
//          ideas and their stories speak of the same people. The matrix places the open ideas by the mean
//          value and effort people scored, so quick wins stand out. The evidence library gathers every
//          customer quote and every client request linked to an idea, and counts how often each need was
//          asked for and by how many voices. Ideation is the team's: reads need at least an auditor.
import { requestRef, type RequestKind } from '@orqiva/shared';
import type { Pool, PoolClient } from 'pg';
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s } from '../http/schema.js';
import { asMember, isUniqueViolation, requireProject, type Access } from './access.js';
import { visibleIdea, type IdeaRow } from './ideas.js';

const uuid = s.string({ format: 'uuid' });
const projectParams = s.object({ workspaceId: uuid, projectId: uuid });
const ideaParams = s.object({ workspaceId: uuid, ideaId: uuid });

// ── personas ──
export const personaOut = s.object({
  id: s.string(),
  name: s.string(),
  role: s.string(),
  goals: s.string(),
  pains: s.string(),
  quote: s.string(),
  sourceId: s.nullable(s.string()),
  stories: s.number({ integer: true }),
});
interface PersonaRow {
  id: string;
  name: string;
  role: string;
  goals: string;
  pains: string;
  quote: string;
  source_id: string | null;
  stories: string;
}
const PERSONA_SELECT = `SELECT p.id, p.name, p.role, p.goals, p.pains, p.quote, p.source_id,
       (SELECT count(*) FROM requirements r WHERE r.persona_id = p.id AND r.status <> 'rejected') AS stories
  FROM personas p`;
const personaJson = (r: PersonaRow) => ({
  id: r.id,
  name: r.name,
  role: r.role,
  goals: r.goals,
  pains: r.pains,
  quote: r.quote,
  sourceId: r.source_id,
  stories: Number(r.stories),
});

export const loadPersonas = async (
  c: PoolClient,
  projectId: string,
): Promise<ReturnType<typeof personaJson>[]> =>
  (
    await c.query<PersonaRow>(PERSONA_SELECT + ' WHERE p.project_id = $1 ORDER BY lower(p.name)', [
      projectId,
    ])
  ).rows.map(personaJson);

/** The project's persona of that name, created when there is none yet. */
export async function personaNamed(
  c: PoolClient,
  a: Access,
  projectId: string,
  p: {
    name: string;
    role?: string;
    goals?: string;
    pains?: string;
    quote?: string;
    sourceId?: string | null;
  },
): Promise<{ id: string; created: boolean }> {
  const name = p.name.trim().slice(0, 120);
  const found = (
    await c.query<{ id: string }>(
      'SELECT id FROM personas WHERE project_id = $1 AND lower(name) = lower($2)',
      [projectId, name],
    )
  ).rows[0];
  if (found) return { id: found.id, created: false };
  const id = (
    await c.query<{ id: string }>(
      `INSERT INTO personas (workspace_id, project_id, name, role, goals, pains, quote, source_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [
        a.workspaceId,
        projectId,
        name,
        (p.role ?? '').slice(0, 200),
        (p.goals ?? '').slice(0, 4000),
        (p.pains ?? '').slice(0, 4000),
        (p.quote ?? '').slice(0, 1000),
        p.sourceId ?? null,
        a.user.id,
      ],
    )
  ).rows[0]?.id;
  if (!id) throw new Error('persona insert returned nothing');
  return { id, created: true };
}

/** A persona of the project, or a clear refusal. */
export async function projectPersona(
  c: PoolClient,
  projectId: string,
  personaId: string,
  path = 'body.personaId',
): Promise<void> {
  const ok = await c.query('SELECT 1 FROM personas WHERE id = $1 AND project_id = $2', [
    personaId,
    projectId,
  ]);
  if (!ok.rowCount)
    throw new HttpError(400, 'invalid_request', 'The persona belongs to another project', [
      { path, message: 'is not a persona of this project' },
    ]);
}

// ── client requests linked to an idea ──
export const linkedRequestOut = s.object({
  id: s.string(),
  ref: s.string(),
  title: s.string(),
  kind: s.string(),
  state: s.string(),
  clientName: s.string(),
  createdAt: s.string(),
});
interface RequestRow {
  id: string;
  kind: RequestKind;
  number: number;
  title: string;
  state: string;
  client_name: string;
  client_id: string;
  idea_id: string | null;
  created_at: Date;
}
const REQUEST_SELECT = `SELECT r.id, r.kind, r.number, r.title, r.state, c.name AS client_name, r.client_id, r.idea_id, r.created_at
  FROM client_requests r JOIN clients c ON c.id = r.client_id`;
const requestJson = (r: RequestRow) => ({
  id: r.id,
  ref: requestRef(r.kind, r.number),
  title: r.title,
  kind: r.kind,
  state: r.state,
  clientName: r.client_name,
  createdAt: r.created_at.toISOString(),
});

export const linkedRequests = async (
  c: PoolClient,
  ideaId: string,
): Promise<ReturnType<typeof requestJson>[]> =>
  (
    await c.query<RequestRow>(REQUEST_SELECT + ' WHERE r.idea_id = $1 ORDER BY r.created_at', [
      ideaId,
    ])
  ).rows.map(requestJson);

/** The idea for a team member who changes it; approved ideas stay as signed. */
async function writable(c: PoolClient, a: Access, id: string): Promise<IdeaRow> {
  const idea = await visibleIdea(c, a, id);
  if (idea.status === 'approved')
    throw new HttpError(
      409,
      'conflict',
      'An approved idea is part of the plan; it stays as signed',
    );
  return idea;
}

// ── the matrix ──
/** Where an idea sits: value and effort from 1 to 10, the middle at 5.5. */
export function quadrantOf(value: number, effort: number): string {
  const high = value >= 5.5;
  const cheap = effort < 5.5;
  return high ? (cheap ? 'quick_win' : 'big_bet') : cheap ? 'fill_in' : 'money_pit';
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

export function ideaViewRoutes(pool: Pool): Route[] {
  const personas = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/projects/:projectId/personas',
    summary: 'The project’s personas with how many stories name each',
    tags: ['ideation'],
    params: projectParams,
    response: s.array(personaOut),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'auditor', async (c, a) => {
        await requireProject(c, a, params.projectId);
        return { body: await loadPersonas(c, params.projectId) };
      }),
  });

  const fields = {
    role: s.optional(s.string({ max: 200 })),
    goals: s.optional(s.string({ max: 4000 })),
    pains: s.optional(s.string({ max: 4000 })),
    quote: s.optional(s.string({ max: 1000 })),
  };
  const one = async (c: PoolClient, id: string) => {
    const r = (await c.query<PersonaRow>(PERSONA_SELECT + ' WHERE p.id = $1', [id])).rows[0];
    if (!r) throw new HttpError(404, 'not_found', 'Persona not found');
    return personaJson(r);
  };
  const taken = (): never => {
    throw new HttpError(409, 'conflict', 'The project has a persona of that name', [
      { path: 'body.name', message: 'is taken' },
    ]);
  };

  const addPersona = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/projects/:projectId/personas',
    summary: 'Add a persona to the project (member)',
    tags: ['ideation'],
    params: projectParams,
    body: s.object({ name: s.string({ min: 1, max: 120 }), ...fields }),
    response: personaOut,
    status: 201,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        await requireProject(c, a, params.projectId);
        const dup = await c.query(
          'SELECT 1 FROM personas WHERE project_id = $1 AND lower(name) = lower($2)',
          [params.projectId, body.name.trim()],
        );
        if (dup.rowCount) taken();
        const { id } = await personaNamed(c, a, params.projectId, {
          name: body.name,
          role: body.role?.trim() ?? '',
          goals: body.goals?.trim() ?? '',
          pains: body.pains?.trim() ?? '',
          quote: body.quote?.trim() ?? '',
        });
        return { status: 201, body: await one(c, id) };
      }),
  });

  const ownedPersona = async (c: PoolClient, a: Access, id: string): Promise<void> => {
    const r = (
      await c.query<{ project_id: string }>('SELECT project_id FROM personas WHERE id = $1', [id])
    ).rows[0];
    if (!r) throw new HttpError(404, 'not_found', 'Persona not found');
    try {
      await requireProject(c, a, r.project_id);
    } catch {
      throw new HttpError(404, 'not_found', 'Persona not found');
    }
  };

  const changePersona = route({
    method: 'PATCH',
    path: '/api/workspaces/:workspaceId/personas/:id',
    summary: 'Change a persona (member)',
    tags: ['ideation'],
    params: s.object({ workspaceId: uuid, id: uuid }),
    body: s.object({ name: s.optional(s.string({ min: 1, max: 120 })), ...fields }),
    response: personaOut,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        await ownedPersona(c, a, params.id);
        try {
          await c.query(
            `UPDATE personas SET name = coalesce($2, name), role = coalesce($3, role), goals = coalesce($4, goals),
                    pains = coalesce($5, pains), quote = coalesce($6, quote) WHERE id = $1`,
            [
              params.id,
              body.name?.trim() ?? null,
              body.role?.trim() ?? null,
              body.goals?.trim() ?? null,
              body.pains?.trim() ?? null,
              body.quote?.trim() ?? null,
            ],
          );
        } catch (e) {
          if (isUniqueViolation(e)) taken();
          throw e;
        }
        return { body: await one(c, params.id) };
      }),
  });

  const removePersona = route({
    method: 'DELETE',
    path: '/api/workspaces/:workspaceId/personas/:id',
    summary: 'Remove a persona; its stories stay, without a persona (member)',
    tags: ['ideation'],
    params: s.object({ workspaceId: uuid, id: uuid }),
    response: s.object({ removed: s.boolean() }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        await ownedPersona(c, a, params.id);
        await c.query('DELETE FROM personas WHERE id = $1', [params.id]);
        return { body: { removed: true } };
      }),
  });

  // ── client requests on an idea ──
  const candidates = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/ideas/:ideaId/request-candidates',
    summary: 'The project’s client requests that can be linked to the idea (not linked to it yet)',
    tags: ['ideation'],
    params: ideaParams,
    response: s.array(linkedRequestOut),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'auditor', async (c, a) => {
        const idea = await visibleIdea(c, a, params.ideaId);
        const rows = (
          await c.query<RequestRow>(
            REQUEST_SELECT +
              ` WHERE r.project_id = $1 AND r.idea_id IS DISTINCT FROM $2 AND r.kind IN ('feature', 'change', 'question')
                ORDER BY r.created_at DESC LIMIT 200`,
            [idea.project_id, idea.id],
          )
        ).rows;
        return { body: rows.map(requestJson) };
      }),
  });

  const link = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/ideas/:ideaId/requests',
    summary: 'Link a client request of the project to the idea, as evidence of the need (member)',
    tags: ['ideation'],
    params: ideaParams,
    body: s.object({ requestId: uuid }),
    response: s.array(linkedRequestOut),
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const idea = await writable(c, a, params.ideaId);
        const r = (
          await c.query<{ project_id: string | null }>(
            'SELECT project_id FROM client_requests WHERE id = $1',
            [body.requestId],
          )
        ).rows[0];
        if (!r) throw new HttpError(404, 'not_found', 'Client request not found');
        if (r.project_id !== idea.project_id)
          throw new HttpError(400, 'invalid_request', 'The request belongs to another project', [
            { path: 'body.requestId', message: 'is not a request of this project' },
          ]);
        await c.query('UPDATE client_requests SET idea_id = $2 WHERE id = $1', [
          body.requestId,
          idea.id,
        ]);
        await c.query('UPDATE ideas SET last_activity_at = now() WHERE id = $1', [idea.id]);
        return { body: await linkedRequests(c, idea.id) };
      }),
  });

  const unlink = route({
    method: 'DELETE',
    path: '/api/workspaces/:workspaceId/ideas/:ideaId/requests/:requestId',
    summary: 'Unlink a client request from the idea (member)',
    tags: ['ideation'],
    params: s.object({ workspaceId: uuid, ideaId: uuid, requestId: uuid }),
    response: s.array(linkedRequestOut),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const idea = await writable(c, a, params.ideaId);
        await c.query('UPDATE client_requests SET idea_id = NULL WHERE id = $1 AND idea_id = $2', [
          params.requestId,
          idea.id,
        ]);
        return { body: await linkedRequests(c, idea.id) };
      }),
  });

  // ── the value/effort matrix ──
  const matrix = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/projects/:projectId/idea-matrix',
    summary:
      'The project’s open ideas by mean value and effort (value/effort scores), with their quadrant',
    tags: ['ideation'],
    params: projectParams,
    response: s.array(
      s.object({
        id: s.string(),
        ref: s.string(),
        title: s.string(),
        status: s.string(),
        value: s.nullable(s.number()),
        effort: s.nullable(s.number()),
        scorers: s.number({ integer: true }),
        quadrant: s.nullable(s.string()),
      }),
    ),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'auditor', async (c, a) => {
        const project = await requireProject(c, a, params.projectId);
        const rows = (
          await c.query<{
            id: string;
            number: number;
            title: string;
            status: string;
            value: number | null;
            effort: number | null;
            scorers: string;
          }>(
            `SELECT i.id, i.number, i.title, i.status,
                    avg((s.inputs->>'value')::numeric)::float8 AS value,
                    avg((s.inputs->>'effort')::numeric)::float8 AS effort,
                    count(s.scorer_id) AS scorers
               FROM ideas i
               LEFT JOIN idea_scores s ON s.idea_id = i.id AND s.method = 'value_effort'
              WHERE i.project_id = $1 AND i.status NOT IN ('approved', 'declined') AND i.merged_into_id IS NULL
              GROUP BY i.id ORDER BY i.number`,
            [params.projectId],
          )
        ).rows;
        return {
          body: rows.map((r) => ({
            id: r.id,
            ref: project.key + '-I' + String(r.number),
            title: r.title,
            status: r.status,
            value: r.value === null ? null : round1(r.value),
            effort: r.effort === null ? null : round1(r.effort),
            scorers: Number(r.scorers),
            quadrant: r.value === null || r.effort === null ? null : quadrantOf(r.value, r.effort),
          })),
        };
      }),
  });

  // ── the evidence library ──
  const evidence = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/projects/:projectId/evidence',
    summary:
      'Every customer quote and linked client request of the project’s ideas, with counts per idea',
    tags: ['ideation'],
    params: projectParams,
    response: s.object({
      ideas: s.array(
        s.object({
          id: s.string(),
          ref: s.string(),
          title: s.string(),
          status: s.string(),
          quotes: s.number({ integer: true }),
          requests: s.number({ integer: true }),
          voices: s.number({ integer: true }),
        }),
      ),
      quotes: s.array(
        s.object({
          id: s.string(),
          ideaId: s.string(),
          ideaRef: s.string(),
          text: s.string(),
          saidBy: s.string(),
          createdAt: s.string(),
        }),
      ),
      requests: s.array(
        s.object({
          id: s.string(),
          ideaId: s.string(),
          ideaRef: s.string(),
          ref: s.string(),
          title: s.string(),
          kind: s.string(),
          state: s.string(),
          clientName: s.string(),
          createdAt: s.string(),
        }),
      ),
    }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'auditor', async (c, a) => {
        const project = await requireProject(c, a, params.projectId);
        const ideas = (
          await c.query<{ id: string; number: number; title: string; status: string }>(
            'SELECT id, number, title, status FROM ideas WHERE project_id = $1 AND merged_into_id IS NULL',
            [params.projectId],
          )
        ).rows;
        const refOf = new Map(ideas.map((i) => [i.id, project.key + '-I' + String(i.number)]));
        const quotes = (
          await c.query<{
            id: string;
            idea_id: string;
            body: string;
            said_by: string;
            created_at: Date;
          }>(
            `SELECT x.id, x.idea_id, x.body, x.said_by, x.created_at FROM idea_sources x
               JOIN ideas i ON i.id = x.idea_id
              WHERE i.project_id = $1 AND x.kind = 'quote' ORDER BY x.created_at DESC`,
            [params.projectId],
          )
        ).rows;
        const requests = (
          await c.query<RequestRow>(
            REQUEST_SELECT +
              ' JOIN ideas i ON i.id = r.idea_id WHERE i.project_id = $1 ORDER BY r.created_at DESC',
            [params.projectId],
          )
        ).rows;
        const counted = ideas
          .map((i) => {
            const q = quotes.filter((x) => x.idea_id === i.id);
            const rq = requests.filter((x) => x.idea_id === i.id);
            const voices = new Set([
              ...q.map((x) => 'q:' + (x.said_by.trim().toLowerCase() || x.id)),
              ...rq.map((x) => 'c:' + x.client_id),
            ]);
            return {
              id: i.id,
              ref: refOf.get(i.id) ?? '',
              title: i.title,
              status: i.status,
              quotes: q.length,
              requests: rq.length,
              voices: voices.size,
            };
          })
          .filter((i) => i.quotes + i.requests > 0)
          .sort((x, y) => y.voices - x.voices || y.quotes + y.requests - (x.quotes + x.requests));
        return {
          body: {
            ideas: counted,
            quotes: quotes.map((x) => ({
              id: x.id,
              ideaId: x.idea_id,
              ideaRef: refOf.get(x.idea_id) ?? '',
              text: x.body,
              saidBy: x.said_by,
              createdAt: x.created_at.toISOString(),
            })),
            requests: requests.map((r) => ({
              ...requestJson(r),
              ideaId: r.idea_id ?? '',
              ideaRef: refOf.get(r.idea_id ?? '') ?? '',
            })),
          },
        };
      }),
  });

  return [
    personas,
    addPersona,
    changePersona,
    removePersona,
    candidates,
    link,
    unlink,
    matrix,
    evidence,
  ];
}
