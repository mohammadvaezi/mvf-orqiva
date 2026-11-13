// ── [PCODE-256 | S15 | v0.1.0] T26.5 Planning charts: burndown and burnup in points, cumulative flow, control chart, lead time ──
//    Why:  the charts of a sprint and a project, read from what happened: each task's state and sprint on
//          every day are rebuilt from when it was made and each move the activity kept, so a finished sprint's
//          burndown is as true as the running one's. Burndown and burnup in points and in tasks with the scope
//          as it changed; cumulative flow per state group; each finished task's cycle and lead time with the
//          average, spread and percentiles.
import {
  daysBetween,
  daysBetweenTimes,
  histogram,
  stats,
  valueOn,
  type Step,
} from '@orqiva/shared';
import type { Pool, PoolClient } from 'pg';
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s } from '../http/schema.js';
import { asMember, requireProject } from './access.js';

const uuid = s.string({ format: 'uuid' });
const GROUPS = ['backlog', 'unstarted', 'started', 'completed'] as const;

interface TaskRow {
  id: string;
  created_at: Date;
  state_grp: string;
  state_name: string;
  sprint_id: string | null;
  estimate: number | null;
}

interface Change {
  object_id: string;
  time: Date;
  changes: Record<string, { from: unknown; to: unknown }> | null;
}

const today = (): string => new Date().toISOString().slice(0, 10);

async function tasksOf(c: PoolClient, projectId: string): Promise<TaskRow[]> {
  return (
    await c.query<TaskRow>(
      `SELECT i.id, i.created_at, st.grp AS state_grp, st.name AS state_name, i.sprint_id, i.estimate
         FROM items i JOIN project_states st ON st.id = i.state_id WHERE i.project_id = $1`,
      [projectId],
    )
  ).rows;
}

async function changesOf(c: PoolClient, ids: readonly string[]): Promise<Map<string, Change[]>> {
  const rows = (
    await c.query<Change>(
      `SELECT object_id, time, envelope->'data'->'changes' AS changes FROM activity_events
        WHERE object_type = 'item' AND object_id = ANY($1::text[]) ORDER BY sequence`,
      [ids],
    )
  ).rows;
  const by = new Map<string, Change[]>();
  for (const r of rows) by.set(r.object_id, [...(by.get(r.object_id) ?? []), r]);
  return by;
}

/** A task's state groups over time: from its creation, through every move. */
function stateSteps(
  t: TaskRow,
  changes: readonly Change[],
  groupOf: Map<string, string>,
): Step<string>[] {
  const moves = changes.filter((ch) => ch.changes?.['state']);
  const first = moves[0]?.changes?.['state']?.from;
  const start =
    typeof first === 'string' ? (groupOf.get(first.toLowerCase()) ?? t.state_grp) : t.state_grp;
  const steps: Step<string>[] = [{ at: t.created_at.toISOString(), value: start }];
  for (const m of moves) {
    const to = m.changes?.['state']?.to;
    if (typeof to === 'string')
      steps.push({ at: m.time.toISOString(), value: groupOf.get(to.toLowerCase()) ?? t.state_grp });
  }
  return steps;
}

/** Whether the task was in the sprint, over time: from its creation, through every sprint change. */
function sprintSteps(
  t: TaskRow,
  changes: readonly Change[],
  sprint: { id: string; name: string },
): Step<boolean>[] {
  const isThis = (v: unknown): boolean => v === sprint.id || v === sprint.name;
  const moves = changes.filter((ch) => ch.changes?.['sprint'] ?? ch.changes?.['sprintId']);
  const of = (ch: Change) => ch.changes?.['sprint'] ?? ch.changes?.['sprintId'];
  const first = moves[0] ? of(moves[0]) : undefined;
  const start = first ? isThis(first.from) : t.sprint_id === sprint.id;
  const steps: Step<boolean>[] = [{ at: t.created_at.toISOString(), value: start }];
  for (const m of moves) steps.push({ at: m.time.toISOString(), value: isThis(of(m)?.to) });
  return steps;
}

async function groupNames(c: PoolClient, projectId: string): Promise<Map<string, string>> {
  return new Map(
    (
      await c.query<{ name: string; grp: string }>(
        'SELECT name, grp FROM project_states WHERE project_id = $1',
        [projectId],
      )
    ).rows.map((r) => [r.name.toLowerCase(), r.grp]),
  );
}

export function chartRoutes(pool: Pool): Route[] {
  const burn = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/sprints/:sprintId/charts/burn',
    summary:
      'Burndown and burnup of a sprint, any sprint, in points and in tasks, with the scope as it changed (guest)',
    tags: ['planning'],
    params: s.object({ workspaceId: uuid, sprintId: uuid }),
    response: s.object({
      sprint: s.object({ id: s.string(), name: s.string(), from: s.string(), to: s.string() }),
      days: s.array(
        s.object({
          day: s.string(),
          scopePoints: s.number(),
          donePoints: s.number(),
          scopeTasks: s.number({ integer: true }),
          doneTasks: s.number({ integer: true }),
        }),
      ),
    }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        const sp = (
          await c.query<{
            id: string;
            name: string;
            project_id: string;
            from: string | null;
            to: string | null;
          }>(
            'SELECT id, name, project_id, start_date::text AS from, end_date::text AS to FROM sprints WHERE id = $1',
            [params.sprintId],
          )
        ).rows[0];
        if (!sp) throw new HttpError(404, 'not_found', 'Sprint not found');
        await requireProject(c, a, sp.project_id);
        const from = sp.from ?? today();
        const to = sp.to ?? today();
        const tasks = await tasksOf(c, sp.project_id);
        const changes = await changesOf(
          c,
          tasks.map((t) => t.id),
        );
        const groupOf = await groupNames(c, sp.project_id);
        const lines = tasks.map((t) => ({
          t,
          states: stateSteps(t, changes.get(t.id) ?? [], groupOf),
          inSprint: sprintSteps(t, changes.get(t.id) ?? [], sp),
        }));
        // days to come have no points yet
        const days = daysBetween(from, to < today() ? to : today()).map((day) => {
          let scopePoints = 0;
          let donePoints = 0;
          let scopeTasks = 0;
          let doneTasks = 0;
          for (const l of lines) {
            if (!valueOn(l.inSprint, day)) continue;
            const g = valueOn(l.states, day);
            if (g === null || g === 'cancelled') continue;
            scopeTasks++;
            scopePoints += l.t.estimate ?? 0;
            if (g === 'completed') {
              doneTasks++;
              donePoints += l.t.estimate ?? 0;
            }
          }
          return { day, scopePoints, donePoints, scopeTasks, doneTasks };
        });
        return { body: { sprint: { id: sp.id, name: sp.name, from, to }, days } };
      }),
  });

  const flow = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/projects/:projectId/charts/flow',
    summary: 'Cumulative flow: how many tasks stood in each state group on each day (guest)',
    tags: ['planning'],
    params: s.object({ workspaceId: uuid, projectId: uuid }),
    query: s.object({ days: s.optional(s.string({ pattern: /^\d{1,3}$/ })) }),
    response: s.object({
      days: s.array(
        s.object({
          day: s.string(),
          backlog: s.number({ integer: true }),
          unstarted: s.number({ integer: true }),
          started: s.number({ integer: true }),
          completed: s.number({ integer: true }),
        }),
      ),
    }),
    handler: ({ params, query, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        const p = await requireProject(c, a, params.projectId);
        const n = Math.min(365, Math.max(7, Number(query.days ?? 30)));
        const to = today();
        const from = new Date(Date.parse(to) - (n - 1) * 86_400_000).toISOString().slice(0, 10);
        const tasks = await tasksOf(c, p.id);
        const changes = await changesOf(
          c,
          tasks.map((t) => t.id),
        );
        const groupOf = await groupNames(c, p.id);
        const lines = tasks.map((t) => stateSteps(t, changes.get(t.id) ?? [], groupOf));
        const days = daysBetween(from, to).map((day) => {
          const row = { day, backlog: 0, unstarted: 0, started: 0, completed: 0 };
          for (const l of lines) {
            const g = valueOn(l, day);
            if (g && (GROUPS as readonly string[]).includes(g)) row[g as (typeof GROUPS)[number]]++;
          }
          return row;
        });
        return { body: { days } };
      }),
  });

  const statsOut = s.object({
    count: s.number({ integer: true }),
    mean: s.nullable(s.number()),
    sd: s.nullable(s.number()),
    p50: s.nullable(s.number()),
    p85: s.nullable(s.number()),
  });
  const cycle = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/projects/:projectId/charts/cycle',
    summary:
      'Control chart and lead time: each task finished in the period, its cycle and lead time in days, with the statistics (guest)',
    tags: ['planning'],
    params: s.object({ workspaceId: uuid, projectId: uuid }),
    query: s.object({ days: s.optional(s.string({ pattern: /^\d{1,3}$/ })) }),
    response: s.object({
      tasks: s.array(
        s.object({
          itemId: s.string(),
          ref: s.string(),
          title: s.string(),
          kind: s.string(),
          completedAt: s.string(),
          cycleDays: s.nullable(s.number()),
          leadDays: s.number(),
        }),
      ),
      cycle: statsOut,
      lead: statsOut,
      leadHistogram: s.array(s.object({ from: s.number(), count: s.number({ integer: true }) })),
    }),
    handler: ({ params, query, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        const p = await requireProject(c, a, params.projectId);
        const n = Math.min(365, Math.max(7, Number(query.days ?? 90)));
        const rows = (
          await c.query<{
            id: string;
            ref: string;
            title: string;
            kind: string;
            created_at: Date;
            started_at: Date | null;
            completed_at: Date;
          }>(
            `SELECT i.id, $2::text || '-' || i.sequence AS ref, i.title, i.kind, i.created_at, i.started_at, i.completed_at
               FROM items i JOIN project_states st ON st.id = i.state_id
              WHERE i.project_id = $1 AND st.grp = 'completed' AND i.completed_at >= now() - make_interval(days => $3::int)
              ORDER BY i.completed_at`,
            [p.id, p.key, n],
          )
        ).rows;
        const tasks = rows.map((r) => ({
          itemId: r.id,
          ref: r.ref,
          title: r.title,
          kind: r.kind,
          completedAt: r.completed_at.toISOString(),
          cycleDays: r.started_at
            ? daysBetweenTimes(r.started_at.toISOString(), r.completed_at.toISOString())
            : null,
          leadDays: daysBetweenTimes(r.created_at.toISOString(), r.completed_at.toISOString()),
        }));
        const leads = tasks.map((t) => t.leadDays);
        return {
          body: {
            tasks,
            cycle: stats(tasks.flatMap((t) => (t.cycleDays === null ? [] : [t.cycleDays]))),
            lead: stats(leads),
            leadHistogram: histogram(leads, leads.length && Math.max(...leads) > 30 ? 7 : 1),
          },
        };
      }),
  });

  return [burn, flow, cycle];
}
