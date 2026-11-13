// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-163 | S15 | v0.1.0] B1.2 Roles, clients and portal sign-in on the server ──
// ── [PCODE-114 | S15 | v0.1.0] Add the Home dashboard and project overview with our own charts ──
//    Why:  the numbers behind the charts, counted where the data is. When a task was finished comes from
//          its moves into a completed state: Orqiva's own events, and for imported work the other
//          tool's history (item_history), so a project moved over from Plane keeps its past. A task that is
//          done but never moved there (created as done) counts by its last change. Guests see only the
//          projects they are invited to; the project route checks that, the workspace route filters by it.
import type { Pool, PoolClient } from 'pg';
import { route, type Route } from '../http/router.js';
import { s } from '../http/schema.js';
import { asMember, requireProject, type Access } from './access.js';

const uuid = s.string({ format: 'uuid' });
export const WEEKS = 12;

/**
 * Every finished item (optionally of one project) with the time it was finished. $1 workspace,
 * $2 project id or null, $3 role, $4 user id.
 */
const COMPLETED = `
  moves AS (
    SELECT e.object_id AS item_id, e.time AS at, e.envelope->'data'->'changes'->'state'->>'to' AS to_state
    FROM activity_events e
    WHERE e.workspace_id = $1 AND e.object_type = 'item'
      AND e.envelope->'data'->'changes'->'state' IS NOT NULL
      AND ($2::uuid IS NULL OR e.envelope->>'projectid' = $2::text)
    UNION ALL
    SELECT h.item_id::text, h.at, h.new_value
    FROM item_history h JOIN items hi ON hi.id = h.item_id
    WHERE h.field = 'state' AND ($2::uuid IS NULL OR hi.project_id = $2)
  ),
  visible AS (
    SELECT p.id FROM projects p
    WHERE ($2::uuid IS NULL OR p.id = $2)
      AND ($3 <> 'guest' OR guest_sees_project(p.id, $4))
  ),
  finished AS (
    SELECT i.id, i.project_id, i.sprint_id,
           coalesce(
             (SELECT max(m.at) FROM moves m
              WHERE m.item_id = i.id::text
                AND m.to_state IN (SELECT name FROM project_states d WHERE d.project_id = i.project_id AND d.grp = 'completed')),
             i.updated_at) AS at
    FROM items i JOIN project_states st ON st.id = i.state_id
    WHERE st.grp = 'completed' AND i.project_id IN (SELECT id FROM visible)
  )`;

interface WeekRow {
  week: string;
  created: string;
  completed: string;
}

async function weekly(
  c: PoolClient,
  a: Access,
  projectId: string | null,
): Promise<{ week: string; created: number; completed: number }[]> {
  const rows = (
    await c.query<WeekRow>(
      `WITH ${COMPLETED},
       weeks AS (
         SELECT generate_series(date_trunc('week', now()) - interval '${String(WEEKS - 1)} weeks', date_trunc('week', now()), interval '1 week') AS week
       )
       SELECT to_char(w.week, 'YYYY-MM-DD') AS week,
              (SELECT count(*) FROM items i WHERE i.project_id IN (SELECT id FROM visible)
                 AND i.created_at >= w.week AND i.created_at < w.week + interval '1 week') AS created,
              (SELECT count(*) FROM finished f WHERE f.at >= w.week AND f.at < w.week + interval '1 week') AS completed
       FROM weeks w ORDER BY w.week`,
      [a.workspaceId, projectId, a.role, a.user.id],
    )
  ).rows;
  return rows.map((r) => ({
    week: r.week,
    created: Number(r.created),
    completed: Number(r.completed),
  }));
}

const weekOut = s.array(
  s.object({
    week: s.string(),
    created: s.number({ integer: true }),
    completed: s.number({ integer: true }),
  }),
);

export function statsRoutes(pool: Pool): Route[] {
  const project = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/projects/:projectId/stats',
    summary:
      'A project in numbers: work by state and by person, created and finished per week, the sprint burndown',
    tags: ['stats'],
    params: s.object({ workspaceId: uuid, projectId: uuid }),
    response: s.object({
      byState: s.array(
        s.object({
          stateId: s.string(),
          name: s.string(),
          group: s.string(),
          color: s.string(),
          count: s.number({ integer: true }),
        }),
      ),
      byAssignee: s.array(
        s.object({
          userId: s.nullable(s.string()),
          name: s.string(),
          open: s.number({ integer: true }),
        }),
      ),
      weekly: weekOut,
      burndown: s.nullable(
        s.object({
          sprintId: s.string(),
          name: s.string(),
          total: s.number({ integer: true }),
          days: s.array(
            s.object({ date: s.string(), remaining: s.nullable(s.number({ integer: true })) }),
          ),
        }),
      ),
    }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        const p = await requireProject(c, a, params.projectId);
        const byState = (
          await c.query<{ id: string; name: string; grp: string; color: string; n: string }>(
            `SELECT st.id, st.name, st.grp, st.color, count(i.id) AS n
             FROM project_states st LEFT JOIN items i ON i.state_id = st.id
             WHERE st.project_id = $1 GROUP BY st.id ORDER BY st.position`,
            [p.id],
          )
        ).rows.map((r) => ({
          stateId: r.id,
          name: r.name,
          group: r.grp,
          color: r.color,
          count: Number(r.n),
        }));
        const byAssignee = (
          await c.query<{ user_id: string | null; name: string | null; n: string }>(
            `SELECT i.assignee_id AS user_id, u.name, count(*) AS n
             FROM items i JOIN project_states st ON st.id = i.state_id
             LEFT JOIN users u ON u.id = i.assignee_id
             WHERE i.project_id = $1 AND st.grp IN ('backlog', 'unstarted', 'started')
             GROUP BY i.assignee_id, u.name ORDER BY count(*) DESC LIMIT 12`,
            [p.id],
          )
        ).rows.map((r) => ({
          userId: r.user_id,
          name: r.user_id ? (r.name ?? 'Someone who left') : 'Unassigned',
          open: Number(r.n),
        }));

        const sprint = (
          await c.query<{
            id: string;
            name: string;
            start_date: string | null;
            end_date: string | null;
            started_at: Date | null;
          }>(
            `SELECT id, name, start_date::text AS start_date, end_date::text AS end_date, started_at
             FROM sprints WHERE project_id = $1 AND status = 'active'`,
            [p.id],
          )
        ).rows[0];
        let burndown = null;
        if (sprint) {
          const start =
            sprint.start_date ??
            sprint.started_at?.toISOString().slice(0, 10) ??
            new Date().toISOString().slice(0, 10);
          const end = sprint.end_date && sprint.end_date >= start ? sprint.end_date : start;
          const total = Number(
            (
              await c.query<{ n: string }>('SELECT count(*) AS n FROM items WHERE sprint_id = $1', [
                sprint.id,
              ])
            ).rows[0]?.n ?? 0,
          );
          const days = (
            await c.query<{ day: string; done: string; future: boolean }>(
              `WITH ${COMPLETED},
               days AS (SELECT generate_series($5::date, $6::date, interval '1 day')::date AS day)
               SELECT to_char(d.day, 'YYYY-MM-DD') AS day, d.day > current_date AS future,
                      (SELECT count(*) FROM finished f WHERE f.sprint_id = $7 AND f.at::date <= d.day) AS done
               FROM days d ORDER BY d.day`,
              [a.workspaceId, p.id, a.role, a.user.id, start, end, sprint.id],
            )
          ).rows;
          burndown = {
            sprintId: sprint.id,
            name: sprint.name,
            total,
            days: days.map((d) => ({
              date: d.day,
              remaining: d.future ? null : total - Number(d.done),
            })),
          };
        }
        return { body: { byState, byAssignee, weekly: await weekly(c, a, p.id), burndown } };
      }),
  });

  const workspace = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/stats',
    summary: 'The workspace in numbers: each project by state group, and finished work per week',
    tags: ['stats'],
    params: s.object({ workspaceId: uuid }),
    response: s.object({
      projects: s.array(
        s.object({
          projectId: s.string(),
          key: s.string(),
          name: s.string(),
          backlog: s.number({ integer: true }),
          unstarted: s.number({ integer: true }),
          started: s.number({ integer: true }),
          completed: s.number({ integer: true }),
          cancelled: s.number({ integer: true }),
        }),
      ),
      weekly: weekOut,
    }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        const rows = (
          await c.query<{ id: string; key: string; name: string; grp: string | null; n: string }>(
            `SELECT p.id, p.key, p.name, st.grp, count(i.id) AS n
             FROM projects p
             LEFT JOIN items i ON i.project_id = p.id
             LEFT JOIN project_states st ON st.id = i.state_id
             WHERE p.archived_at IS NULL
               AND ($1 <> 'guest' OR guest_sees_project(p.id, $2))
             GROUP BY p.id, st.grp ORDER BY p.name`,
            [a.role, a.user.id],
          )
        ).rows;
        const byProject = new Map<
          string,
          {
            projectId: string;
            key: string;
            name: string;
            backlog: number;
            unstarted: number;
            started: number;
            completed: number;
            cancelled: number;
          }
        >();
        for (const r of rows) {
          const e = byProject.get(r.id) ?? {
            projectId: r.id,
            key: r.key,
            name: r.name,
            backlog: 0,
            unstarted: 0,
            started: 0,
            completed: 0,
            cancelled: 0,
          };
          if (
            r.grp === 'backlog' ||
            r.grp === 'unstarted' ||
            r.grp === 'started' ||
            r.grp === 'completed' ||
            r.grp === 'cancelled'
          )
            e[r.grp] += Number(r.n);
          byProject.set(r.id, e);
        }
        return { body: { projects: [...byProject.values()], weekly: await weekly(c, a, null) } };
      }),
  });

  return [project, workspace];
}
