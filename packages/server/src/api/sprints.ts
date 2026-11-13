// ── [PCODE-165 | S15 | v0.1.0] B2.1 Planning and Canvas on the server: plan fields, dependencies, schedule, baselines, scenarios, drafts, retro, workload ──
// ── [PCODE-99 | S15 | v0.1.0] Build sprints, backlog, board and list views ──
// ── [PCODE-105 | S15 | v0.1.0] Move the VS Code extension to the new API over WebSocket and remove polling ──
//    Why:  team sprints. Members plan sprints, start one (one active per project, the database guarantees
//          it), and complete it; completing moves every unfinished item to the backlog or to a sprint the
//          person picks, so nothing is left behind in a closed sprint. Deleting a sprint returns its items to
//          the backlog. Every step is an activity event.
import type { Pool, PoolClient } from 'pg';
import { recordEvent } from '../events/outbox.js';
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s, type Infer } from '../http/schema.js';
import { actorOf, asMember, requireProject, type Access, type ProjectRow } from './access.js';

const uuid = s.string({ format: 'uuid' });
const date = s.string({ pattern: /^\d{4}-\d{2}-\d{2}$/ });
const projectParams = s.object({ workspaceId: uuid, projectId: uuid });
const sprintParams = s.object({ workspaceId: uuid, sprintId: uuid });

const sprintOut = s.object({
  id: s.string(),
  projectId: s.string(),
  // [PCODE-105 | S15 | v0.1.0] the number behind the S code of fingerprints (S03)
  number: s.number({ integer: true }),
  name: s.string(),
  goal: s.string(),
  startDate: s.nullable(s.string()),
  endDate: s.nullable(s.string()),
  status: s.string(),
  itemCount: s.number({ integer: true }),
  doneCount: s.number({ integer: true }),
  estimateTotal: s.number({ integer: true }),
  estimateDone: s.number({ integer: true }),
  // [PCODE-165 | S15 | v0.1.0] the goal's verdict, and the work added after the start
  goalMet: s.nullable(s.boolean()),
  addedCount: s.number({ integer: true }),
});

interface SprintRow {
  id: string;
  project_id: string;
  number: number;
  name: string;
  goal: string;
  start_date: string | null;
  end_date: string | null;
  status: 'planned' | 'active' | 'completed';
  item_count: string;
  done_count: string;
  estimate_total: string;
  estimate_done: string;
  goal_met: boolean | null;
  added_count: string;
}

// dates as text, so no time zone can move them by a day
const SPRINT_SELECT = `
  SELECT sp.id, sp.project_id, sp.number, sp.name, sp.goal, sp.start_date::text AS start_date, sp.end_date::text AS end_date, sp.status,
         count(i.id) AS item_count,
         count(i.id) FILTER (WHERE st.grp IN ('completed', 'cancelled')) AS done_count,
         coalesce(sum(i.estimate), 0) AS estimate_total,
         coalesce(sum(i.estimate) FILTER (WHERE st.grp = 'completed'), 0) AS estimate_done,
         sp.goal_met,
         count(i.id) FILTER (WHERE sp.scope_snapshot IS NOT NULL
           AND NOT sp.scope_snapshot @> jsonb_build_array(jsonb_build_object('itemId', i.id::text))) AS added_count
  FROM sprints sp
  LEFT JOIN items i ON i.sprint_id = sp.id
  LEFT JOIN project_states st ON st.id = i.state_id`;
const GROUP = ' GROUP BY sp.id';

const sprintJson = (r: SprintRow): Infer<typeof sprintOut> => ({
  id: r.id,
  projectId: r.project_id,
  number: r.number,
  name: r.name,
  goal: r.goal,
  startDate: r.start_date,
  endDate: r.end_date,
  status: r.status,
  itemCount: Number(r.item_count),
  doneCount: Number(r.done_count),
  estimateTotal: Number(r.estimate_total),
  estimateDone: Number(r.estimate_done),
  goalMet: r.goal_met,
  addedCount: Number(r.added_count),
});

async function loadSprint(c: PoolClient, sprintId: string): Promise<SprintRow | undefined> {
  return (await c.query<SprintRow>(SPRINT_SELECT + ' WHERE sp.id = $1' + GROUP, [sprintId]))
    .rows[0];
}

/** The sprint and its project, if the caller may see the project. */
async function requireSprint(
  c: PoolClient,
  a: Access,
  sprintId: string,
): Promise<{ sprint: SprintRow; project: ProjectRow }> {
  const sprint = await loadSprint(c, sprintId);
  if (!sprint) throw new HttpError(404, 'not_found', 'Sprint not found');
  try {
    return { sprint, project: await requireProject(c, a, sprint.project_id) };
  } catch {
    throw new HttpError(404, 'not_found', 'Sprint not found');
  }
}

function checkDates(start: string | null | undefined, end: string | null | undefined): void {
  if (start && end && end < start) {
    throw new HttpError(400, 'invalid_request', 'A sprint cannot end before it starts', [
      { path: 'body.endDate', message: 'is before the start date' },
    ]);
  }
}

const sprintRef = (sp: {
  id: string;
  name: string;
}): { type: 'sprint'; id: string; label: string } => ({
  type: 'sprint',
  id: sp.id,
  label: sp.name,
});

export function sprintRoutes(pool: Pool): Route[] {
  const list = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/projects/:projectId/sprints',
    summary: 'The sprints of a project: active first, then planned, then completed',
    tags: ['sprints'],
    params: projectParams,
    response: s.array(sprintOut),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        const p = await requireProject(c, a, params.projectId);
        const rows = (
          await c.query<SprintRow>(
            SPRINT_SELECT +
              ' WHERE sp.project_id = $1' +
              GROUP +
              " ORDER BY CASE sp.status WHEN 'active' THEN 0 WHEN 'planned' THEN 1 ELSE 2 END, sp.start_date NULLS LAST, sp.created_at",
            [p.id],
          )
        ).rows;
        return { body: rows.map(sprintJson) };
      }),
  });

  const create = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/projects/:projectId/sprints',
    summary: 'Plan a sprint (member)',
    tags: ['sprints'],
    params: projectParams,
    body: s.object({
      name: s.string({ min: 1, max: 120 }),
      goal: s.optional(s.string({ max: 2000 })),
      startDate: s.optional(s.nullable(date)),
      endDate: s.optional(s.nullable(date)),
    }),
    response: sprintOut,
    status: 201,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const p = await requireProject(c, a, params.projectId);
        checkDates(body.startDate, body.endDate);
        const id = (
          await c.query<{ id: string }>(
            // [PCODE-102 | S15 | v0.1.0] the next number of the project gives the S code in fingerprints
            `INSERT INTO sprints (workspace_id, project_id, name, goal, start_date, end_date, number)
             VALUES ($1, $2, $3, $4, $5, $6, (SELECT coalesce(max(number), 0) + 1 FROM sprints WHERE project_id = $2)) RETURNING id`,
            [
              a.workspaceId,
              p.id,
              body.name.trim(),
              body.goal ?? '',
              body.startDate ?? null,
              body.endDate ?? null,
            ],
          )
        ).rows[0]?.id;
        const sp = id ? await loadSprint(c, id) : undefined;
        if (!sp) throw new Error('sprint insert returned nothing');
        await recordEvent(
          c,
          a.workspaceId,
          {
            actor: actorOf(a),
            verb: 'created',
            object: sprintRef(sp),
            parent: { type: 'project', id: p.id, label: p.key },
          },
          { projectId: p.id },
        );
        return { status: 201, body: sprintJson(sp) };
      }),
  });

  const update = route({
    method: 'PATCH',
    path: '/api/workspaces/:workspaceId/sprints/:sprintId',
    summary: 'Rename a sprint or change its goal and dates (member)',
    tags: ['sprints'],
    params: sprintParams,
    body: s.object({
      name: s.optional(s.string({ min: 1, max: 120 })),
      goal: s.optional(s.string({ max: 2000 })),
      startDate: s.optional(s.nullable(date)),
      endDate: s.optional(s.nullable(date)),
    }),
    response: sprintOut,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const { sprint, project } = await requireSprint(c, a, params.sprintId);
        if (sprint.status === 'completed')
          throw new HttpError(409, 'conflict', 'A completed sprint does not change any more');
        const next = {
          name: body.name?.trim() ?? sprint.name,
          goal: body.goal ?? sprint.goal,
          start: body.startDate !== undefined ? body.startDate : sprint.start_date,
          end: body.endDate !== undefined ? body.endDate : sprint.end_date,
        };
        checkDates(next.start, next.end);
        const changes: Record<string, { from: unknown; to: unknown }> = {};
        if (next.name !== sprint.name) changes['name'] = { from: sprint.name, to: next.name };
        if (next.goal !== sprint.goal) changes['goal'] = { from: sprint.goal, to: next.goal };
        if (next.start !== sprint.start_date)
          changes['startDate'] = { from: sprint.start_date, to: next.start };
        if (next.end !== sprint.end_date)
          changes['endDate'] = { from: sprint.end_date, to: next.end };
        if (Object.keys(changes).length === 0) return { body: sprintJson(sprint) };
        await c.query(
          'UPDATE sprints SET name = $2, goal = $3, start_date = $4, end_date = $5 WHERE id = $1',
          [sprint.id, next.name, next.goal, next.start, next.end],
        );
        const after = await loadSprint(c, sprint.id);
        if (!after) throw new Error('sprint vanished');
        await recordEvent(
          c,
          a.workspaceId,
          {
            actor: actorOf(a),
            verb: 'updated',
            object: sprintRef(after),
            parent: { type: 'project', id: project.id, label: project.key },
            changes,
          },
          { projectId: project.id },
        );
        return { body: sprintJson(after) };
      }),
  });

  const start = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/sprints/:sprintId/start',
    summary: 'Start a planned sprint; only one sprint per project is active (member)',
    tags: ['sprints'],
    params: sprintParams,
    response: sprintOut,
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const { sprint, project } = await requireSprint(c, a, params.sprintId);
        if (sprint.status !== 'planned')
          throw new HttpError(
            409,
            'conflict',
            'Only a planned sprint can start; this one is ' + sprint.status,
          );
        const active = (
          await c.query<{ name: string }>(
            "SELECT name FROM sprints WHERE project_id = $1 AND status = 'active'",
            [project.id],
          )
        ).rows[0];
        if (active)
          throw new HttpError(409, 'conflict', active.name + ' is still active; complete it first');
        // [PCODE-165 | S15 | v0.1.0] the scope at the start: what is added later shows as mid-sprint work
        await c.query(
          `UPDATE sprints SET status = 'active', started_at = now(), start_date = coalesce(start_date, current_date),
                  scope_snapshot = (SELECT coalesce(jsonb_agg(jsonb_build_object('itemId', i.id::text, 'estimate', i.estimate)), '[]'::jsonb)
                                      FROM items i WHERE i.sprint_id = $1)
            WHERE id = $1`,
          [sprint.id],
        );
        const after = await loadSprint(c, sprint.id);
        if (!after) throw new Error('sprint vanished');
        await recordEvent(
          c,
          a.workspaceId,
          {
            actor: actorOf(a),
            verb: 'started',
            object: sprintRef(after),
            parent: { type: 'project', id: project.id, label: project.key },
          },
          { projectId: project.id },
        );
        return { body: sprintJson(after) };
      }),
  });

  const complete = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/sprints/:sprintId/complete',
    summary:
      'Complete the active sprint; unfinished items move to the backlog or to the sprint named (member)',
    tags: ['sprints'],
    params: sprintParams,
    // [PCODE-165 | S15 | v0.1.0] and whether the sprint's goal was met
    body: s.object({ moveTo: s.nullable(uuid), goalMet: s.optional(s.nullable(s.boolean())) }),
    response: s.object({ sprint: sprintOut, moved: s.number({ integer: true }) }),
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const { sprint, project } = await requireSprint(c, a, params.sprintId);
        if (sprint.status !== 'active')
          throw new HttpError(409, 'conflict', 'Only the active sprint can be completed');
        let targetName = 'Backlog';
        if (body.moveTo) {
          const target = (
            await c.query<{ name: string; status: string }>(
              'SELECT name, status FROM sprints WHERE id = $1 AND project_id = $2',
              [body.moveTo, project.id],
            )
          ).rows[0];
          if (!target || target.status !== 'planned' || body.moveTo === sprint.id) {
            throw new HttpError(
              400,
              'invalid_request',
              'Unfinished items can move to the backlog or a planned sprint of this project',
              [{ path: 'body.moveTo', message: 'is not a planned sprint of this project' }],
            );
          }
          targetName = target.name;
        }
        // unfinished: any item whose state is not in the completed or cancelled group
        const moved = (
          await c.query<{ id: string }>(
            // [PCODE-165 | S15 | v0.1.0] each carry-over is counted on the task
            `UPDATE items i SET sprint_id = $2, carried_count = carried_count + 1, version = version + 1, updated_at = now()
             FROM project_states st
             WHERE i.sprint_id = $1 AND st.id = i.state_id AND st.grp NOT IN ('completed', 'cancelled')
             RETURNING i.id`,
            [sprint.id, body.moveTo],
          )
        ).rows;
        await c.query(
          "UPDATE sprints SET status = 'completed', completed_at = now(), end_date = coalesce(end_date, current_date), goal_met = $2 WHERE id = $1",
          [sprint.id, body.goalMet ?? null],
        );
        const after = await loadSprint(c, sprint.id);
        if (!after) throw new Error('sprint vanished');
        await recordEvent(
          c,
          a.workspaceId,
          {
            actor: actorOf(a),
            verb: 'completed',
            object: sprintRef(after),
            parent: { type: 'project', id: project.id, label: project.key },
            changes: { unfinished: { from: sprint.name, to: targetName } },
          },
          { projectId: project.id },
        );
        // each moved item gets its own event, so open boards and item pages update
        for (const m of moved) {
          await recordEvent(
            c,
            a.workspaceId,
            {
              actor: actorOf(a),
              verb: 'updated',
              object: { type: 'item', id: m.id },
              parent: { type: 'project', id: project.id, label: project.key },
              changes: { sprint: { from: sprint.name, to: targetName } },
            },
            { projectId: project.id },
          );
        }
        return { body: { sprint: sprintJson(after), moved: moved.length } };
      }),
  });

  const remove = route({
    method: 'DELETE',
    path: '/api/workspaces/:workspaceId/sprints/:sprintId',
    summary: 'Delete a sprint that is not active; its items return to the backlog (member)',
    tags: ['sprints'],
    params: sprintParams,
    response: s.object({ ok: s.literal(true) }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const { sprint, project } = await requireSprint(c, a, params.sprintId);
        if (sprint.status === 'active')
          throw new HttpError(409, 'conflict', 'Complete the active sprint before deleting it');
        await c.query('DELETE FROM sprints WHERE id = $1', [sprint.id]);
        await recordEvent(
          c,
          a.workspaceId,
          {
            actor: actorOf(a),
            verb: 'deleted',
            object: sprintRef(sprint),
            parent: { type: 'project', id: project.id, label: project.key },
          },
          { projectId: project.id },
        );
        return { body: { ok: true as const } };
      }),
  });

  return [list, create, update, start, complete, remove];
}
