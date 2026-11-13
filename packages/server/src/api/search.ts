// ── [PCODE-346 | S15 | v0.1.0] T35.1a Cmd-K over agents, runs, people and settings; keyboard shortcut sheet ──
// ── [PCODE-283 | S15 | v0.1.0] T29.5 Documents: named versions in the screen, visual diff, mentions in comments, page search and Cmd-K ──
// ── [PCODE-255 | S15 | v0.1.0] T26.4 Planning details: keys, bulk edit, undo, shared views, item history, Git moves, bug SLAs ──
// ── [PCODE-163 | S15 | v0.1.0] B1.2 Roles, clients and portal sign-in on the server ──
// ── [PCODE-100 | S15 | v0.1.0] Add filters, search and the keyboard command bar ──
//    Why:  find anything in a workspace from one box: items by words of their title or description (as
//          prefixes, so "pass" finds "password"), items by their reference (APP-12), and projects by key or
//          name. It answers only with what the person may see; guests only their projects. Saved filters
//          keep a person's views of a project.
import { SETTINGS } from '@orqiva/shared'; // [PCODE-346 | S15 | v0.1.0]
import type { Pool } from 'pg';
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s } from '../http/schema.js';
import { asMember, requireProject } from './access.js';

/**
 * A tsquery from what someone typed: up to 8 words of letters and digits, each a prefix, all required.
 * Only letters and digits reach the query, so typed operators cannot change its meaning. Null: no words.
 */
export function searchQuery(text: string): string | null {
  const words = (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).slice(0, 8);
  return words.length ? words.map((w) => w + ':*').join(' & ') : null;
}

const uuid = s.string({ format: 'uuid' });

const hitOut = s.object({
  // [PCODE-283 | S15 | v0.1.0]
  docs: s.array(
    s.object({
      id: s.string(),
      title: s.string(),
      projectId: s.string(),
      projectKey: s.string(),
      snippet: s.string(),
    }),
  ),
  items: s.array(
    s.object({
      id: s.string(),
      ref: s.string(),
      title: s.string(),
      projectId: s.string(),
      projectKey: s.string(),
    }),
  ),
  projects: s.array(s.object({ id: s.string(), key: s.string(), name: s.string() })),
  // [PCODE-346 | S15 | v0.1.0] for the team: agents, their runs, people and settings
  agents: s.array(s.object({ id: s.string(), key: s.string(), name: s.string() })),
  runs: s.array(
    s.object({ id: s.string(), instruction: s.string(), status: s.string(), agent: s.string() }),
  ),
  people: s.array(s.object({ id: s.string(), name: s.string(), email: s.string() })),
  settings: s.array(s.object({ key: s.string(), label: s.string() })),
});

/** [PCODE-346 | S15 | v0.1.0] The settings whose name or key contains the words typed. */
export function matchingSettings(text: string): { key: string; label: string }[] {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return SETTINGS.filter((d) =>
    words.every((w) => d.label.toLowerCase().includes(w) || d.key.toLowerCase().includes(w)),
  )
    .slice(0, 8)
    .map((d) => ({ key: d.key, label: d.label }));
}

const filterQuery = s.object({
  q: s.optional(s.string({ max: 200 })),
  stateId: s.optional(uuid),
  assigneeId: s.optional(s.string({ pattern: /^(me|none|[0-9a-f-]{36})$/ })),
  labelId: s.optional(uuid),
  sprintId: s.optional(s.string({ pattern: /^(backlog|[0-9a-f-]{36})$/ })),
  // [PCODE-255 | S15 | v0.1.0] a board's view: lanes and quick filters
  lanes: s.optional(s.enum(['none', 'epic', 'person'])),
  quick: s.optional(s.array(s.string({ max: 20 }), { max: 10 })),
});
const filterOut = s.object({
  id: s.string(),
  name: s.string(),
  projectId: s.nullable(s.string()),
  query: filterQuery,
  // [PCODE-255 | S15 | v0.1.0] where it is used, whether the team sees it, and whose it is
  surface: s.string(),
  shared: s.boolean(),
  mine: s.boolean(),
  owner: s.string(),
});

export function searchRoutes(pool: Pool): Route[] {
  const search = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/search',
    summary: 'Find items and projects by words or by reference (APP-12)',
    tags: ['search'],
    params: s.object({ workspaceId: uuid }),
    query: s.object({ q: s.string({ max: 200 }) }),
    response: hitOut,
    handler: ({ params, query, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        // what this person may see: guests only the projects they are invited to
        const visible = "($1 <> 'guest' OR guest_sees_project(p.id, $2))";
        const ref = /^\s*([A-Za-z][A-Za-z0-9]{1,9})-(\d+)\s*$/.exec(query.q);
        const ts = searchQuery(query.q);
        const items = ref
          ? (
              await c.query<{
                id: string;
                ref: string;
                title: string;
                project_id: string;
                key: string;
              }>(
                `SELECT i.id, p.key || '-' || i.sequence AS ref, i.title, i.project_id, p.key
                 FROM items i JOIN projects p ON p.id = i.project_id
                 WHERE ${visible} AND p.key = upper($3) AND i.sequence = $4`,
                [a.role, a.user.id, ref[1], Number(ref[2])],
              )
            ).rows
          : ts
            ? (
                await c.query<{
                  id: string;
                  ref: string;
                  title: string;
                  project_id: string;
                  key: string;
                }>(
                  `SELECT i.id, p.key || '-' || i.sequence AS ref, i.title, i.project_id, p.key
                   FROM items i JOIN projects p ON p.id = i.project_id
                   WHERE ${visible} AND i.search @@ to_tsquery('simple', $3)
                   ORDER BY ts_rank(i.search, to_tsquery('simple', $3)) DESC, i.updated_at DESC
                   LIMIT 20`,
                  [a.role, a.user.id, ts],
                )
              ).rows
            : [];
        const term = query.q.trim();
        const projects = term
          ? (
              await c.query<{ id: string; key: string; name: string }>(
                `SELECT p.id, p.key, p.name FROM projects p
                 WHERE ${visible} AND p.archived_at IS NULL
                   AND (p.key ILIKE $3 || '%' OR p.name ILIKE '%' || $3 || '%')
                 ORDER BY p.name LIMIT 10`,
                [a.role, a.user.id, term.replace(/[\\%_]/g, (ch) => '\\' + ch)],
              )
            ).rows
          : [];
        // [PCODE-283 | S15 | v0.1.0] pages, for team members, in the projects they see
        const docs =
          ts && a.role !== 'guest'
            ? (
                await c.query<{
                  id: string;
                  title: string;
                  project_id: string;
                  key: string;
                  snippet: string;
                }>(
                  `SELECT d.id, d.title, d.project_id, p.key,
                          ts_headline('simple', d.body, to_tsquery('simple', $3), 'MaxWords=16, MinWords=6, StartSel=«, StopSel=»') AS snippet
                     FROM doc_pages d JOIN projects p ON p.id = d.project_id
                    WHERE ${visible} AND d.deleted_at IS NULL AND d.kind = 'page' AND d.search @@ to_tsquery('simple', $3)
                    ORDER BY ts_rank(d.search, to_tsquery('simple', $3)) DESC LIMIT 10`,
                  [a.role, a.user.id, ts],
                )
              ).rows
            : [];
        // [PCODE-346 | S15 | v0.1.0] agents, runs, people and settings: the team only, not guests or clients
        const team = a.role !== 'guest' && !a.clientId && term.length >= 2;
        const like = '%' + term.replace(/[\\%_]/g, (ch) => '\\' + ch) + '%';
        const agents = team
          ? (
              await c.query<{ id: string; key: string; name: string }>(
                `SELECT id, key, name FROM agents WHERE name ILIKE $1 OR key ILIKE $1 OR description ILIKE $1
                  ORDER BY name LIMIT 6`,
                [like],
              )
            ).rows
          : [];
        const runs = team
          ? (
              await c.query<{ id: string; instruction: string; status: string; agent: string }>(
                `SELECT r.id, left(r.instruction, 120) AS instruction, r.status, ag.name AS agent
                   FROM agent_runs r JOIN agents ag ON ag.id = r.agent_id
                  WHERE r.instruction ILIKE $1 ORDER BY r.created_at DESC LIMIT 6`,
                [like],
              )
            ).rows
          : [];
        const people = team
          ? (
              await c.query<{ id: string; name: string; email: string }>(
                `SELECT u.id, u.name, u.email FROM workspace_members m JOIN users u ON u.id = m.user_id
                  WHERE m.suspended_at IS NULL AND NOT u.is_service AND (u.name ILIKE $1 OR u.email ILIKE $1)
                  ORDER BY u.name LIMIT 6`,
                [like],
              )
            ).rows
          : [];
        return {
          body: {
            agents,
            runs,
            people,
            settings: team ? matchingSettings(term) : [],
            docs: docs.map((d) => ({
              id: d.id,
              title: d.title,
              projectId: d.project_id,
              projectKey: d.key,
              snippet: d.snippet,
            })),
            items: items.map((r) => ({
              id: r.id,
              ref: r.ref,
              title: r.title,
              projectId: r.project_id,
              projectKey: r.key,
            })),
            projects,
          },
        };
      }),
  });

  const listFilters = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/projects/:projectId/filters',
    summary: 'The caller’s saved filters for a project, and the ones others shared (guest)',
    tags: ['search'],
    params: s.object({ workspaceId: uuid, projectId: uuid }),
    query: s.object({ surface: s.optional(s.string({ max: 40 })) }),
    response: s.array(filterOut),
    handler: ({ params, query, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        const p = await requireProject(c, a, params.projectId);
        const rows = (
          await c.query<{
            id: string;
            name: string;
            project_id: string | null;
            query: Record<string, string>;
            surface: string;
            shared: boolean;
            user_id: string;
            owner: string;
          }>(
            `SELECT f.id, f.name, f.project_id, f.query, f.surface, f.shared, f.user_id, u.name AS owner
               FROM saved_filters f JOIN users u ON u.id = f.user_id
              WHERE (f.user_id = $1 OR f.shared) AND f.project_id = $2 AND f.surface = $3
              ORDER BY f.user_id <> $1, lower(f.name)`,
            [a.user.id, p.id, query.surface ?? 'items'],
          )
        ).rows;
        return {
          body: rows.map((r) => ({
            id: r.id,
            name: r.name,
            projectId: r.project_id,
            query: r.query,
            surface: r.surface,
            shared: r.shared,
            mine: r.user_id === a.user.id,
            owner: r.owner,
          })),
        };
      }),
  });

  const saveFilter = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/projects/:projectId/filters',
    summary: 'Save the current filter of a project under a name (for the caller only)',
    tags: ['search'],
    params: s.object({ workspaceId: uuid, projectId: uuid }),
    body: s.object({
      name: s.string({ min: 1, max: 80 }),
      query: filterQuery,
      surface: s.optional(s.string({ min: 1, max: 40 })), // [PCODE-255 | S15 | v0.1.0]
      shared: s.optional(s.boolean()),
    }),
    response: filterOut,
    status: 201,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        const p = await requireProject(c, a, params.projectId);
        const id = (
          await c.query<{ id: string }>(
            'INSERT INTO saved_filters (workspace_id, user_id, project_id, name, query, surface, shared) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
            [
              a.workspaceId,
              a.user.id,
              p.id,
              body.name.trim(),
              JSON.stringify(body.query),
              body.surface ?? 'items',
              body.shared ?? false,
            ],
          )
        ).rows[0]?.id;
        if (!id) throw new Error('filter insert returned nothing');
        return {
          status: 201,
          body: {
            id,
            name: body.name.trim(),
            projectId: p.id,
            query: body.query,
            surface: body.surface ?? 'items',
            shared: body.shared ?? false,
            mine: true,
            owner: a.user.name,
          },
        };
      }),
  });

  const deleteFilter = route({
    method: 'DELETE',
    path: '/api/workspaces/:workspaceId/filters/:filterId',
    summary: 'Delete one of the caller’s saved filters',
    tags: ['search'],
    params: s.object({ workspaceId: uuid, filterId: uuid }),
    response: s.object({ ok: s.literal(true) }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        const gone = await c.query('DELETE FROM saved_filters WHERE id = $1 AND user_id = $2', [
          params.filterId,
          a.user.id,
        ]);
        if (!gone.rowCount) throw new HttpError(404, 'not_found', 'Filter not found');
        return { body: { ok: true as const } };
      }),
  });

  return [search, listFilters, saveFilter, deleteFilter];
}
