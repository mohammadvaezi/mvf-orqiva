// ── [PCODE-264 | S15 | v0.1.0] T27.6 Canvas pictures and sharing: PNG and PDF with page fitting, read-only share link with iCal subscription ──
// ── [PCODE-262 | S15 | v0.1.0] T27.4 Canvas views: timeline, mind map, portfolio; agents as resources and heat map; scenario diff; commits on bars ──
// ── [PCODE-260 | S15 | v0.1.0] T27.2 Interactive Gantt: drag, resize, link, shift-drag, split, zoom, colour rules, outline levels ──
// ── [PCODE-259 | S15 | v0.1.0] T27.1 Canvas engine: constraint types, split tasks, holidays, move with successors ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-165 | S15 | v0.1.0] B2.1 Planning and Canvas on the server: plan fields, dependencies, schedule, baselines, scenarios, drafts, retro, workload ──
//    Why:  the Canvas on real data. A project's plan is its tasks scheduled by the shared engine over the
//          team's working days: dependencies of the four kinds with lag, float and the critical path,
//          summary tasks, WBS codes. A baseline saves the plan to show what slipped; a scenario changes
//          dates, durations or people without touching the live plan, compares, then merges or is
//          discarded. Workload shows each person per day, and levelling moves tasks within their float,
//          first as a preview, then for real. Clients read their projects' plan; the team changes it.
import {
  levelResources,
  schedulePlan,
  successorsOf,
  type ConstraintType,
  type Split,
  WorkCalendar,
  workload,
  wouldCycle,
  isIsoDate,
  type PlanDependency,
  type PlanTask,
  type Schedule,
  type Weekday,
} from '@orqiva/shared';
import type { Pool, PoolClient } from 'pg';
import { recordEvent } from '../events/outbox.js';
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s } from '../http/schema.js';
import { numberSetting } from './settingvalue.js'; // [PCODE-262 | S15 | v0.1.0]
import {
  actorOf,
  asMember,
  atLeast,
  isUniqueViolation,
  requireProject,
  type Access,
  type ProjectRow,
} from './access.js';

const uuid = s.string({ format: 'uuid' });
const projectParams = s.object({ workspaceId: uuid, projectId: uuid });

export interface PlanRow {
  // [PCODE-263 | S15 | v0.1.0] read by the plan files too
  id: string;
  ref: string;
  title: string;
  kind: string;
  grp: string;
  assignee_id: string | null;
  estimate: number | null;
  start_date: string | null;
  due_date: string | null;
  duration_days: number | null;
  percent_done: number | null;
  schedule_mode: 'auto' | 'manual';
  constraint_type: ConstraintType; // [PCODE-259 | S15 | v0.1.0]
  constraint_date: string | null;
  splits: Split[];
  type_id: string | null; // [PCODE-260 | S15 | v0.1.0]
  agent_id: string | null; // [PCODE-262 | S15 | v0.1.0]
  parent_id: string | null;
  rank: number;
  sprint_id: string | null;
  crit_total: string;
  crit_done: string;
}

interface DepRow {
  id: string;
  predecessor_id: string;
  successor_id: string;
  kind: PlanDependency['kind'];
  lag_days: number;
}

/** What a scenario changes on a task. */
export interface TaskChange {
  startDate?: string | null;
  durationDays?: number | null;
  assigneeId?: string | null;
}

/** How far a task is: what people set, else done when finished, else its acceptance criteria. */
export const effectivePercent = (
  r: Pick<PlanRow, 'percent_done' | 'grp' | 'crit_total' | 'crit_done'>,
): number =>
  r.percent_done ??
  (r.grp === 'completed' || r.grp === 'cancelled'
    ? 100
    : Number(r.crit_total) > 0
      ? Math.round((Number(r.crit_done) / Number(r.crit_total)) * 100)
      : 0);

const WEEKDAY_SET = new Set(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);

/** The project's working days (project setting, else workspace, else Mon–Fri), anchored today in Berlin. */
async function calendarOf(
  c: PoolClient,
  a: Pick<Access, 'workspaceId'>, // [PCODE-264 | S15 | v0.1.0] a share link has a workspace, not a person
  projectId: string,
): Promise<{ cal: WorkCalendar; workingDays: Weekday[]; today: string }> {
  const rows = (
    await c.query<{ key: string; scope_type: string; value: unknown }>(
      `SELECT key, scope_type, value FROM settings WHERE key IN ('calendar.working_days', 'calendar.holidays')
         AND ((scope_type = 'workspace' AND scope_id = $1) OR (scope_type = 'project' AND scope_id = $2))`,
      [a.workspaceId, projectId],
    )
  ).rows;
  // [PCODE-259 | S15 | v0.1.0] the workspace's holidays (the project's, where it has its own) are no working days
  const of = (key: string) =>
    rows.find((r) => r.key === key && r.scope_type === 'project') ??
    rows.find((r) => r.key === key && r.scope_type === 'workspace');
  const pick = of('calendar.working_days');
  const hv = of('calendar.holidays')?.value;
  const holidays = Array.isArray(hv) ? (hv as unknown[]).filter(isIsoDate) : [];
  const days = Array.isArray(pick?.value)
    ? (pick.value as unknown[]).filter(
        (d): d is Weekday => typeof d === 'string' && WEEKDAY_SET.has(d),
      )
    : [];
  const workingDays: Weekday[] = days.length ? days : ['mon', 'tue', 'wed', 'thu', 'fri'];
  const today =
    (await c.query<{ d: string }>("SELECT (now() AT TIME ZONE 'Europe/Berlin')::date::text AS d"))
      .rows[0]?.d ?? '1970-01-01';
  return { cal: new WorkCalendar({ anchor: today, workingDays, holidays }), workingDays, today };
}

async function loadRows(
  c: PoolClient,
  projectId: string,
): Promise<{ rows: PlanRow[]; deps: DepRow[] }> {
  const rows = (
    await c.query<PlanRow>(
      `SELECT i.id, p.key || '-' || i.sequence AS ref, i.title, i.kind, st.grp, i.assignee_id, i.estimate,
              i.start_date::text AS start_date, i.due_date::text AS due_date, i.duration_days, i.percent_done,
              i.schedule_mode, i.parent_id, i.rank, i.sprint_id,
              i.constraint_type, i.constraint_date::text AS constraint_date, i.splits, i.type_id, i.agent_id,
              (SELECT count(*) FROM item_criteria k WHERE k.item_id = i.id) AS crit_total,
              (SELECT count(*) FROM item_criteria k WHERE k.item_id = i.id AND k.done) AS crit_done
         FROM items i JOIN projects p ON p.id = i.project_id JOIN project_states st ON st.id = i.state_id
        WHERE i.project_id = $1 AND st.grp <> 'cancelled'
        ORDER BY i.rank, i.sequence`,
      [projectId],
    )
  ).rows;
  const deps = (
    await c.query<DepRow>(
      'SELECT id, predecessor_id, successor_id, kind, lag_days FROM item_dependencies WHERE project_id = $1 ORDER BY created_at',
      [projectId],
    )
  ).rows;
  return { rows, deps };
}

const toTask = (r: PlanRow, change?: TaskChange): PlanTask => ({
  id: r.id,
  parentId: r.parent_id,
  rank: r.rank,
  kind: r.kind,
  startDate: change?.startDate !== undefined ? change.startDate : r.start_date,
  dueDate: change?.durationDays !== undefined ? null : r.due_date,
  durationDays: change?.durationDays !== undefined ? change.durationDays : r.duration_days,
  mode: r.schedule_mode,
  percentDone: effectivePercent(r),
  assigneeId: change?.assigneeId !== undefined ? change.assigneeId : r.assignee_id,
  constraintType: r.constraint_type, // [PCODE-259 | S15 | v0.1.0]
  constraintDate: r.constraint_date,
  splits: r.splits,
});
const toDep = (d: DepRow): PlanDependency => ({
  predecessorId: d.predecessor_id,
  successorId: d.successor_id,
  kind: d.kind,
  lagDays: d.lag_days,
});

export async function computePlan(
  c: PoolClient,
  a: Pick<Access, 'workspaceId'>, // [PCODE-264 | S15 | v0.1.0]
  projectId: string,
  changes: Record<string, TaskChange> = {},
): Promise<{
  rows: PlanRow[];
  deps: DepRow[];
  tasks: PlanTask[];
  sched: Schedule;
  cal: WorkCalendar;
  workingDays: Weekday[];
  today: string;
}> {
  const { cal, workingDays, today } = await calendarOf(c, a, projectId);
  const { rows, deps } = await loadRows(c, projectId);
  const tasks = rows.map((r) => toTask(r, changes[r.id]));
  return {
    rows,
    deps,
    tasks,
    sched: schedulePlan(tasks, deps.map(toDep), cal),
    cal,
    workingDays,
    today,
  };
}

export const scheduledOut = s.object({
  id: s.string(),
  wbs: s.string(),
  level: s.number({ integer: true }),
  summary: s.boolean(),
  milestone: s.boolean(),
  start: s.string(),
  finish: s.string(),
  durationDays: s.number({ integer: true }),
  percentDone: s.number({ integer: true }),
  totalFloat: s.number({ integer: true }),
  critical: s.boolean(),
  violations: s.array(s.string()),
  // [PCODE-259 | S15 | v0.1.0]
  constraintBroken: s.boolean(),
  segments: s.array(s.object({ start: s.string(), finish: s.string() })),
});
const taskOut = s.object({
  id: s.string(),
  ref: s.string(),
  title: s.string(),
  kind: s.string(),
  stateGroup: s.string(),
  assigneeId: s.nullable(s.string()),
  estimate: s.nullable(s.number({ integer: true })),
  parentId: s.nullable(s.string()),
  sprintId: s.nullable(s.string()),
  startDate: s.nullable(s.string()),
  dueDate: s.nullable(s.string()),
  durationDays: s.nullable(s.number({ integer: true })),
  scheduleMode: s.string(),
  // [PCODE-259 | S15 | v0.1.0]
  constraintType: s.string(),
  constraintDate: s.nullable(s.string()),
  splits: s.array(
    s.object({ after: s.number({ integer: true }), gap: s.number({ integer: true }) }),
  ),
  typeId: s.nullable(s.string()), // [PCODE-260 | S15 | v0.1.0]
  agentId: s.nullable(s.string()), // [PCODE-262 | S15 | v0.1.0]
});
// [PCODE-262 | S15 | v0.1.0] what a scenario changes on a task, against the live plan
const diffOut = s.object({
  itemId: s.string(),
  ref: s.string(),
  title: s.string(),
  startFrom: s.string(),
  startTo: s.string(),
  finishFrom: s.string(),
  finishTo: s.string(),
  durationFrom: s.number({ integer: true }),
  durationTo: s.number({ integer: true }),
  assigneeFrom: s.nullable(s.string()),
  assigneeTo: s.nullable(s.string()),
  /** changed in the scenario itself, not only moved by others */
  direct: s.boolean(),
});
const gitOut = s.object({
  itemId: s.string(),
  kind: s.string(),
  ref: s.string(),
  title: s.string(),
  url: s.string(),
  state: s.string(),
  date: s.string(),
});
const depOut = s.object({
  id: s.string(),
  predecessorId: s.string(),
  successorId: s.string(),
  kind: s.string(),
  lagDays: s.number({ integer: true }),
});
const depJson = (d: DepRow) => ({
  id: d.id,
  predecessorId: d.predecessor_id,
  successorId: d.successor_id,
  kind: d.kind,
  lagDays: d.lag_days,
});
const varianceOut = s.object({
  itemId: s.string(),
  start: s.nullable(s.string()),
  finish: s.nullable(s.string()),
  /** working days later (+) or earlier (−) than the baseline */
  startSlip: s.nullable(s.number({ integer: true })),
  finishSlip: s.nullable(s.number({ integer: true })),
});

async function requireDependency(
  c: PoolClient,
  a: Access,
  id: string,
): Promise<DepRow & { project_id: string; project: ProjectRow }> {
  const d = (
    await c.query<DepRow & { project_id: string }>(
      'SELECT id, project_id, predecessor_id, successor_id, kind, lag_days FROM item_dependencies WHERE id = $1',
      [id],
    )
  ).rows[0];
  if (!d) throw new HttpError(404, 'not_found', 'Dependency not found');
  try {
    return { ...d, project: await requireProject(c, a, d.project_id) };
  } catch {
    throw new HttpError(404, 'not_found', 'Dependency not found');
  }
}

async function itemLabel(c: PoolClient, id: string): Promise<string> {
  return (
    (
      await c.query<{ label: string }>(
        "SELECT p.key || '-' || i.sequence || ' ' || i.title AS label FROM items i JOIN projects p ON p.id = i.project_id WHERE i.id = $1",
        [id],
      )
    ).rows[0]?.label ?? ''
  );
}

interface ScenarioRow {
  id: string;
  project_id: string;
  name: string;
  changes: Record<string, TaskChange>;
  status: string;
  created_at: Date;
  updated_at: Date;
}
const scenarioOut = s.object({
  id: s.string(),
  name: s.string(),
  status: s.string(),
  changes: s.anyObject(),
  changed: s.number({ integer: true }),
  createdAt: s.string(),
  updatedAt: s.string(),
});
const scenarioJson = (r: ScenarioRow) => ({
  id: r.id,
  name: r.name,
  status: r.status,
  changes: r.changes,
  changed: Object.keys(r.changes).length,
  createdAt: r.created_at.toISOString(),
  updatedAt: r.updated_at.toISOString(),
});

async function requireScenario(
  c: PoolClient,
  a: Access,
  id: string,
): Promise<ScenarioRow & { project: ProjectRow }> {
  const r = (
    await c.query<ScenarioRow>(
      'SELECT id, project_id, name, changes, status, created_at, updated_at FROM plan_scenarios WHERE id = $1',
      [id],
    )
  ).rows[0];
  if (!r) throw new HttpError(404, 'not_found', 'Scenario not found');
  try {
    return { ...r, project: await requireProject(c, a, r.project_id) };
  } catch {
    throw new HttpError(404, 'not_found', 'Scenario not found');
  }
}

/** A scenario's changes are about tasks of its project, with real dates and durations. */
function checkChanges(
  changes: Record<string, unknown>,
  ids: ReadonlySet<string>,
): Record<string, TaskChange> {
  const out: Record<string, TaskChange> = {};
  for (const [id, raw] of Object.entries(changes)) {
    const bad = (m: string): never => {
      throw new HttpError(400, 'invalid_request', 'A change names a task and what differs', [
        { path: 'body.changes.' + id, message: m },
      ]);
    };
    if (!ids.has(id)) bad('is not a task of this project');
    if (raw === null) continue;
    if (typeof raw !== 'object') bad('must be an object');
    const v = raw as Record<string, unknown>;
    const ch: TaskChange = {};
    if ('startDate' in v) {
      if (v['startDate'] !== null && !isIsoDate(v['startDate'])) bad('startDate is not a date');
      ch.startDate = v['startDate'] as string | null;
    }
    if ('durationDays' in v) {
      const d = v['durationDays'];
      if (d !== null && (typeof d !== 'number' || !Number.isInteger(d) || d < 0 || d > 3650))
        bad('durationDays is 0 to 3650');
      ch.durationDays = d as number | null;
    }
    if ('assigneeId' in v) {
      if (v['assigneeId'] !== null && typeof v['assigneeId'] !== 'string')
        bad('assigneeId is a user id');
      ch.assigneeId = v['assigneeId'] as string | null;
    }
    out[id] = ch;
  }
  return out;
}

// [PCODE-262 | S15 | v0.1.0]
/** Every task whose dates, duration or person differ between the live plan and a scenario's. */
export function scenarioDiff(
  live: { sched: Schedule; rows: PlanRow[] },
  scen: { sched: Schedule; tasks: PlanTask[] },
  changes: Record<string, TaskChange>,
): {
  itemId: string;
  ref: string;
  title: string;
  startFrom: string;
  startTo: string;
  finishFrom: string;
  finishTo: string;
  durationFrom: number;
  durationTo: number;
  assigneeFrom: string | null;
  assigneeTo: string | null;
  direct: boolean;
}[] {
  const was = new Map(live.sched.tasks.map((t) => [t.id, t]));
  const row = new Map(live.rows.map((r) => [r.id, r]));
  const who = new Map(scen.tasks.map((t) => [t.id, t.assigneeId ?? null]));
  return scen.sched.tasks.flatMap((t) => {
    const a = was.get(t.id);
    const r = row.get(t.id);
    if (!a || !r || t.summary) return [];
    const to = who.get(t.id) ?? null;
    if (
      a.start === t.start &&
      a.finish === t.finish &&
      a.durationDays === t.durationDays &&
      r.assignee_id === to
    )
      return [];
    return [
      {
        itemId: t.id,
        ref: r.ref,
        title: r.title,
        startFrom: a.start,
        startTo: t.start,
        finishFrom: a.finish,
        finishTo: t.finish,
        durationFrom: a.durationDays,
        durationTo: t.durationDays,
        assigneeFrom: r.assignee_id,
        assigneeTo: to,
        direct: changes[t.id] !== undefined,
      },
    ];
  });
}

export function planRoutes(pool: Pool): Route[] {
  // [PCODE-262 | S15 | v0.1.0] every project on one time axis
  const portfolio = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/plan/portfolio',
    summary:
      "Every open project's plan in short: start, finish, % done, slip against its latest baseline, critical tasks, milestones (member)",
    tags: ['plan'],
    params: s.object({ workspaceId: uuid }),
    response: s.object({
      today: s.string(),
      projects: s.array(
        s.object({
          id: s.string(),
          key: s.string(),
          name: s.string(),
          tasks: s.number({ integer: true }),
          start: s.nullable(s.string()),
          finish: s.nullable(s.string()),
          percentDone: s.number({ integer: true }),
          critical: s.number({ integer: true }),
          late: s.number({ integer: true }),
          baseline: s.nullable(
            s.object({ name: s.string(), finish: s.string(), slip: s.number({ integer: true }) }),
          ),
          milestones: s.array(s.object({ id: s.string(), title: s.string(), date: s.string() })),
        }),
      ),
    }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const projects = (
          await c.query<{ id: string; key: string; name: string }>(
            'SELECT id, key, name FROM projects WHERE archived_at IS NULL ORDER BY name LIMIT 200',
          )
        ).rows;
        let today = '';
        const out = [];
        for (const pr of projects) {
          const p = await computePlan(c, a, pr.id);
          today = p.today;
          const leaves = p.sched.tasks.filter((t) => !t.summary);
          const row = new Map(p.rows.map((r) => [r.id, r]));
          const weight = (t: { durationDays: number }): number => Math.max(1, t.durationDays);
          const total = leaves.reduce((n, t) => n + weight(t), 0);
          const b = (
            await c.query<{ name: string; finish: string | null }>(
              `SELECT b.name, (SELECT max(finish_date)::text FROM baseline_items x WHERE x.baseline_id = b.id) AS finish
                 FROM baselines b WHERE b.project_id = $1 ORDER BY b.created_at DESC LIMIT 1`,
              [pr.id],
            )
          ).rows[0];
          out.push({
            id: pr.id,
            key: pr.key,
            name: pr.name,
            tasks: leaves.length,
            start: leaves.length ? p.sched.start : null,
            finish: leaves.length ? p.sched.finish : null,
            percentDone: total
              ? Math.round(leaves.reduce((n, t) => n + t.percentDone * weight(t), 0) / total)
              : 0,
            critical: leaves.filter((t) => t.critical && t.percentDone < 100).length,
            late: leaves.filter((t) => {
              const due = row.get(t.id)?.due_date;
              return t.percentDone < 100 && ((due && t.finish > due) || t.finish < p.today);
            }).length,
            baseline:
              b?.finish && leaves.length
                ? {
                    name: b.name,
                    finish: b.finish,
                    slip: p.cal.index(p.sched.finish) - p.cal.index(b.finish),
                  }
                : null,
            milestones: leaves
              .filter((t) => t.milestone)
              .map((t) => ({ id: t.id, title: row.get(t.id)?.title ?? '', date: t.start })),
          });
        }
        if (!today)
          today =
            (
              await c.query<{ d: string }>(
                "SELECT (now() AT TIME ZONE 'Europe/Berlin')::date::text AS d",
              )
            ).rows[0]?.d ?? '';
        return { body: { today, projects: out } };
      }),
  });

  const plan = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/projects/:projectId/plan',
    summary:
      'The project plan: tasks, dependencies and the schedule; with a baseline, what slipped; with a scenario, its plan',
    tags: ['plan'],
    params: projectParams,
    query: s.object({ baselineId: s.optional(uuid), scenarioId: s.optional(uuid) }),
    response: s.object({
      today: s.string(),
      workingDays: s.array(s.string()),
      start: s.string(),
      finish: s.string(),
      tasks: s.array(taskOut),
      schedule: s.array(scheduledOut),
      dependencies: s.array(depOut),
      cycle: s.array(s.string()),
      ignored: s.array(s.string()),
      baseline: s.nullable(
        s.object({
          id: s.string(),
          name: s.string(),
          finish: s.nullable(s.string()),
          variance: s.array(varianceOut),
        }),
      ),
      scenario: s.nullable(
        s.object({
          id: s.string(),
          name: s.string(),
          liveFinish: s.string(),
          changed: s.number({ integer: true }),
          diff: s.array(diffOut), // [PCODE-262 | S15 | v0.1.0]
        }),
      ),
      git: s.array(gitOut), // [PCODE-262 | S15 | v0.1.0]
    }),
    handler: ({ params, query, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        await requireProject(c, a, params.projectId);
        let scenario: ScenarioRow | null = null;
        if (query.scenarioId) {
          scenario = await requireScenario(c, a, query.scenarioId);
          if (scenario.project_id !== params.projectId)
            throw new HttpError(404, 'not_found', 'Scenario not found');
        }
        const p = await computePlan(c, a, params.projectId, scenario?.changes ?? {});
        // [PCODE-262 | S15 | v0.1.0] the live plan beside a scenario: its finish and every task that differs
        const livePlan = scenario ? await computePlan(c, a, params.projectId) : p;
        const live = livePlan.sched.finish;
        const diff = scenario ? scenarioDiff(livePlan, p, scenario.changes) : [];
        // commits and pull requests on the bars, for the team (not clients)
        const git = atLeast(a.role, 'member')
          ? (
              await c.query<{
                item_id: string;
                kind: string;
                ref: string;
                title: string;
                url: string;
                state: string;
                day: string;
              }>(
                `SELECT l.item_id, l.kind, l.ref, l.title, l.url, l.state,
                        (l.at AT TIME ZONE 'Europe/Berlin')::date::text AS day
                   FROM item_git_links l JOIN items i ON i.id = l.item_id
                  WHERE i.project_id = $1 ORDER BY l.at DESC LIMIT 1000`,
                [params.projectId],
              )
            ).rows.map((g) => ({
              itemId: g.item_id,
              kind: g.kind,
              ref: g.ref,
              title: g.title,
              url: g.url,
              state: g.state,
              date: g.day,
            }))
          : [];
        let baseline = null;
        if (query.baselineId) {
          const b = (
            await c.query<{ id: string; name: string; project_id: string }>(
              'SELECT id, name, project_id FROM baselines WHERE id = $1',
              [query.baselineId],
            )
          ).rows[0];
          if (!b || b.project_id !== params.projectId)
            throw new HttpError(404, 'not_found', 'Baseline not found');
          const saved = new Map(
            (
              await c.query<{
                item_id: string;
                start_date: string | null;
                finish_date: string | null;
              }>(
                'SELECT item_id, start_date::text AS start_date, finish_date::text AS finish_date FROM baseline_items WHERE baseline_id = $1',
                [b.id],
              )
            ).rows.map((r) => [r.item_id, r]),
          );
          const slip = (from: string | null, to: string): number | null =>
            from ? p.cal.index(to) - p.cal.index(from) : null;
          baseline = {
            id: b.id,
            name: b.name,
            finish: [...saved.values()].reduce<string | null>(
              (m, r) => (r.finish_date && (!m || r.finish_date > m) ? r.finish_date : m),
              null,
            ),
            variance: p.sched.tasks.map((t) => {
              const was = saved.get(t.id);
              return {
                itemId: t.id,
                start: was?.start_date ?? null,
                finish: was?.finish_date ?? null,
                startSlip: was ? slip(was.start_date, t.start) : null,
                finishSlip: was ? slip(was.finish_date, t.finish) : null,
              };
            }),
          };
        }
        return {
          body: {
            today: p.today,
            workingDays: p.workingDays,
            start: p.sched.start,
            finish: p.sched.finish,
            tasks: p.rows.map((r) => ({
              id: r.id,
              ref: r.ref,
              title: r.title,
              kind: r.kind,
              stateGroup: r.grp,
              assigneeId:
                scenario?.changes[r.id]?.assigneeId !== undefined
                  ? (scenario.changes[r.id]?.assigneeId ?? null)
                  : r.assignee_id,
              estimate: r.estimate,
              parentId: r.parent_id,
              sprintId: r.sprint_id,
              startDate: r.start_date,
              dueDate: r.due_date,
              durationDays: r.duration_days,
              scheduleMode: r.schedule_mode,
              constraintType: r.constraint_type, // [PCODE-259 | S15 | v0.1.0]
              constraintDate: r.constraint_date,
              splits: r.splits,
              typeId: r.type_id, // [PCODE-260 | S15 | v0.1.0]
              agentId: r.agent_id, // [PCODE-262 | S15 | v0.1.0]
            })),
            schedule: p.sched.tasks,
            dependencies: p.deps.map(depJson),
            cycle: p.sched.cycle,
            ignored: p.deps
              .filter((d) =>
                p.sched.ignored.some(
                  (x) => x.predecessorId === d.predecessor_id && x.successorId === d.successor_id,
                ),
              )
              .map((d) => d.id),
            baseline,
            scenario: scenario
              ? {
                  id: scenario.id,
                  name: scenario.name,
                  liveFinish: live,
                  changed: Object.keys(scenario.changes).length,
                  diff,
                }
              : null,
            git,
          },
        };
      }),
  });

  // [PCODE-259 | S15 | v0.1.0] shift-drag on the Gantt: a task and everything behind it moves by working days
  const shift = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/projects/:projectId/plan/shift',
    summary:
      'Move a task by working days; with successors, every task that follows it through dependencies moves too',
    tags: ['plan'],
    params: projectParams,
    body: s.object({
      itemId: uuid,
      days: s.number({ integer: true, min: -3650, max: 3650 }),
      withSuccessors: s.optional(s.boolean()),
      scenarioId: s.optional(uuid),
    }),
    response: s.object({
      moved: s.array(s.object({ id: s.string(), from: s.string(), to: s.string() })),
    }),
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const project = await requireProject(c, a, params.projectId);
        let scenario: ScenarioRow | null = null;
        if (body.scenarioId) {
          scenario = await requireScenario(c, a, body.scenarioId);
          if (scenario.project_id !== project.id || scenario.status !== 'open')
            throw new HttpError(404, 'not_found', 'Scenario not found');
        }
        const p = await computePlan(c, a, project.id, scenario?.changes ?? {});
        const row = p.rows.find((r) => r.id === body.itemId);
        if (!row) throw new HttpError(404, 'not_found', 'Task not found in this project');
        const at = new Map(p.sched.tasks.map((t) => [t.id, t]));
        const leaf = (id: string): boolean => at.get(id)?.summary === false;
        const ids = [
          body.itemId,
          ...(body.withSuccessors ? successorsOf(p.deps.map(toDep), body.itemId) : []),
        ].filter(leaf);
        if (!ids.length)
          throw new HttpError(400, 'invalid_request', 'A summary task moves with its tasks', [
            { path: 'body.itemId', message: 'is a summary task' },
          ]);
        const moved = ids.map((id) => {
          const from = at.get(id)?.start ?? p.today;
          return { id, from, to: p.cal.addWorkdays(from, body.days) };
        });
        if (body.days === 0) return { body: { moved: [] } };
        if (scenario) {
          const changes = { ...scenario.changes };
          for (const m of moved) changes[m.id] = { ...changes[m.id], startDate: m.to };
          await c.query(
            'UPDATE plan_scenarios SET changes = $2, updated_at = now() WHERE id = $1',
            [scenario.id, JSON.stringify(changes)],
          );
          return { body: { moved } };
        }
        for (const m of moved) {
          const r = p.rows.find((x) => x.id === m.id);
          if (!r) continue;
          // the start moves; a set due date keeps the task's length
          const due = r.due_date
            ? p.cal.addWorkdays(p.cal.prevWorkday(r.due_date), body.days)
            : null;
          await c.query(
            'UPDATE items SET start_date = $2, due_date = $3, version = version + 1, updated_at = now() WHERE id = $1',
            [m.id, m.to, due],
          );
          await recordEvent(
            c,
            a.workspaceId,
            {
              actor: actorOf(a),
              verb: 'updated',
              object: { type: 'item', id: m.id, label: r.ref + ' ' + r.title },
              parent: { type: 'project', id: project.id, label: project.key },
              changes: { startDate: { from: r.start_date, to: m.to } },
            },
            { projectId: project.id },
          );
        }
        return { body: { moved } };
      }),
  });

  // ── dependencies ──
  const addDep = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/projects/:projectId/dependencies',
    summary: 'Link two tasks of the project: the successor waits for the predecessor (member)',
    tags: ['plan'],
    params: projectParams,
    body: s.object({
      predecessorId: uuid,
      successorId: uuid,
      kind: s.optional(s.enum(['FS', 'SS', 'FF', 'SF'])),
      lagDays: s.optional(s.number({ integer: true, min: -365, max: 365 })),
    }),
    response: depOut,
    status: 201,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const project = await requireProject(c, a, params.projectId);
        if (body.predecessorId === body.successorId)
          throw new HttpError(400, 'invalid_request', 'A task cannot wait for itself', [
            { path: 'body.successorId', message: 'is the predecessor' },
          ]);
        const found = (
          await c.query<{ id: string }>(
            'SELECT id FROM items WHERE project_id = $1 AND id = ANY($2::uuid[])',
            [project.id, [body.predecessorId, body.successorId]],
          )
        ).rows;
        if (found.length !== 2)
          throw new HttpError(400, 'invalid_request', 'Both tasks must belong to this project', [
            { path: 'body', message: 'names a task of another project' },
          ]);
        const existing = (
          await c.query<DepRow>(
            'SELECT id, predecessor_id, successor_id, kind, lag_days FROM item_dependencies WHERE project_id = $1',
            [project.id],
          )
        ).rows;
        if (wouldCycle(existing.map(toDep), body.predecessorId, body.successorId))
          throw new HttpError(
            409,
            'conflict',
            'This link would make a loop: the predecessor already waits for the successor',
          );
        let row: DepRow | undefined;
        try {
          row = (
            await c.query<DepRow>(
              `INSERT INTO item_dependencies (workspace_id, project_id, predecessor_id, successor_id, kind, lag_days, created_by)
               VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, predecessor_id, successor_id, kind, lag_days`,
              [
                a.workspaceId,
                project.id,
                body.predecessorId,
                body.successorId,
                body.kind ?? 'FS',
                body.lagDays ?? 0,
                a.user.id,
              ],
            )
          ).rows[0];
        } catch (e) {
          if (isUniqueViolation(e))
            throw new HttpError(409, 'conflict', 'These tasks are already linked');
          throw e;
        }
        if (!row) throw new Error('dependency insert returned nothing');
        await recordEvent(
          c,
          a.workspaceId,
          {
            actor: actorOf(a),
            verb: 'updated',
            object: {
              type: 'item',
              id: body.successorId,
              label: await itemLabel(c, body.successorId),
            },
            parent: { type: 'project', id: project.id, label: project.key },
            changes: {
              waitsFor: {
                from: null,
                to:
                  (await itemLabel(c, body.predecessorId)) +
                  ' (' +
                  row.kind +
                  (row.lag_days ? ' ' + String(row.lag_days) + 'd' : '') +
                  ')',
              },
            },
          },
          { projectId: project.id },
        );
        return { status: 201, body: depJson(row) };
      }),
  });

  const depParams = s.object({ workspaceId: uuid, dependencyId: uuid });
  const changeDep = route({
    method: 'PATCH',
    path: '/api/workspaces/:workspaceId/dependencies/:dependencyId',
    summary: 'Change the kind or the lag of a dependency (member)',
    tags: ['plan'],
    params: depParams,
    body: s.object({
      kind: s.optional(s.enum(['FS', 'SS', 'FF', 'SF'])),
      lagDays: s.optional(s.number({ integer: true, min: -365, max: 365 })),
    }),
    response: depOut,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const d = await requireDependency(c, a, params.dependencyId);
        const row = (
          await c.query<DepRow>(
            'UPDATE item_dependencies SET kind = coalesce($2, kind), lag_days = coalesce($3, lag_days) WHERE id = $1 RETURNING id, predecessor_id, successor_id, kind, lag_days',
            [d.id, body.kind ?? null, body.lagDays ?? null],
          )
        ).rows[0];
        if (!row) throw new Error('dependency vanished');
        await recordEvent(
          c,
          a.workspaceId,
          {
            actor: actorOf(a),
            verb: 'updated',
            object: { type: 'item', id: d.successor_id, label: await itemLabel(c, d.successor_id) },
            parent: { type: 'project', id: d.project.id, label: d.project.key },
            changes: {
              waitsFor: {
                from: d.kind + ' ' + String(d.lag_days) + 'd',
                to: row.kind + ' ' + String(row.lag_days) + 'd',
              },
            },
          },
          { projectId: d.project.id },
        );
        return { body: depJson(row) };
      }),
  });

  const removeDep = route({
    method: 'DELETE',
    path: '/api/workspaces/:workspaceId/dependencies/:dependencyId',
    summary: 'Remove a dependency (member)',
    tags: ['plan'],
    params: depParams,
    response: s.object({ removed: s.boolean() }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const d = await requireDependency(c, a, params.dependencyId);
        await c.query('DELETE FROM item_dependencies WHERE id = $1', [d.id]);
        await recordEvent(
          c,
          a.workspaceId,
          {
            actor: actorOf(a),
            verb: 'updated',
            object: { type: 'item', id: d.successor_id, label: await itemLabel(c, d.successor_id) },
            parent: { type: 'project', id: d.project.id, label: d.project.key },
            changes: { waitsFor: { from: await itemLabel(c, d.predecessor_id), to: null } },
          },
          { projectId: d.project.id },
        );
        return { body: { removed: true } };
      }),
  });

  // ── baselines ──
  const baselineOut = s.object({
    id: s.string(),
    name: s.string(),
    tasks: s.number({ integer: true }),
    createdAt: s.string(),
  });
  const listBaselines = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/projects/:projectId/baselines',
    summary: 'The saved baselines of the project, newest first',
    tags: ['plan'],
    params: projectParams,
    response: s.array(baselineOut),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        await requireProject(c, a, params.projectId);
        const rows = (
          await c.query<{ id: string; name: string; tasks: string; created_at: Date }>(
            `SELECT b.id, b.name, b.created_at, (SELECT count(*) FROM baseline_items x WHERE x.baseline_id = b.id) AS tasks
               FROM baselines b WHERE b.project_id = $1 ORDER BY b.created_at DESC`,
            [params.projectId],
          )
        ).rows;
        return {
          body: rows.map((r) => ({
            id: r.id,
            name: r.name,
            tasks: Number(r.tasks),
            createdAt: r.created_at.toISOString(),
          })),
        };
      }),
  });

  const saveBaseline = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/projects/:projectId/baselines',
    summary: 'Save the plan as it is now, to measure later slips against it (member)',
    tags: ['plan'],
    params: projectParams,
    body: s.object({ name: s.string({ min: 1, max: 120 }) }),
    response: baselineOut,
    status: 201,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const project = await requireProject(c, a, params.projectId);
        const p = await computePlan(c, a, project.id);
        const estimate = new Map(p.rows.map((r) => [r.id, r.estimate]));
        let b: { id: string; created_at: Date } | undefined;
        try {
          b = (
            await c.query<{ id: string; created_at: Date }>(
              'INSERT INTO baselines (workspace_id, project_id, name, created_by) VALUES ($1, $2, $3, $4) RETURNING id, created_at',
              [a.workspaceId, project.id, body.name.trim(), a.user.id],
            )
          ).rows[0];
        } catch (e) {
          if (isUniqueViolation(e))
            throw new HttpError(409, 'conflict', 'A baseline of this name exists');
          throw e;
        }
        if (!b) throw new Error('baseline insert returned nothing');
        for (const t of p.sched.tasks)
          await c.query(
            `INSERT INTO baseline_items (workspace_id, baseline_id, item_id, start_date, finish_date, duration_days, percent_done, estimate)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
              a.workspaceId,
              b.id,
              t.id,
              t.start,
              t.finish,
              t.durationDays,
              t.percentDone,
              estimate.get(t.id) ?? null,
            ],
          );
        await recordEvent(
          c,
          a.workspaceId,
          {
            actor: actorOf(a),
            verb: 'created',
            object: { type: 'project', id: project.id, label: project.key },
            changes: { baseline: { from: null, to: body.name.trim() } },
          },
          { projectId: project.id },
        );
        return {
          status: 201,
          body: {
            id: b.id,
            name: body.name.trim(),
            tasks: p.sched.tasks.length,
            createdAt: b.created_at.toISOString(),
          },
        };
      }),
  });

  const removeBaseline = route({
    method: 'DELETE',
    path: '/api/workspaces/:workspaceId/baselines/:baselineId',
    summary: 'Delete a baseline (member)',
    tags: ['plan'],
    params: s.object({ workspaceId: uuid, baselineId: uuid }),
    response: s.object({ removed: s.boolean() }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const b = (
          await c.query<{ project_id: string }>('SELECT project_id FROM baselines WHERE id = $1', [
            params.baselineId,
          ])
        ).rows[0];
        if (!b) throw new HttpError(404, 'not_found', 'Baseline not found');
        await requireProject(c, a, b.project_id);
        await c.query('DELETE FROM baselines WHERE id = $1', [params.baselineId]);
        return { body: { removed: true } };
      }),
  });

  // ── scenarios ──
  const listScenarios = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/projects/:projectId/scenarios',
    summary: 'The open scenarios of the project, and the recently closed ones',
    tags: ['plan'],
    params: projectParams,
    response: s.array(scenarioOut),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        await requireProject(c, a, params.projectId);
        const rows = (
          await c.query<ScenarioRow>(
            `SELECT id, project_id, name, changes, status, created_at, updated_at FROM plan_scenarios
              WHERE project_id = $1 AND (status = 'open' OR closed_at > now() - interval '30 days')
              ORDER BY status = 'open' DESC, updated_at DESC`,
            [params.projectId],
          )
        ).rows;
        return { body: rows.map(scenarioJson) };
      }),
  });

  const createScenario = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/projects/:projectId/scenarios',
    summary: 'Branch the plan: a scenario changes tasks without touching the live plan (member)',
    tags: ['plan'],
    params: projectParams,
    body: s.object({ name: s.string({ min: 1, max: 120 }), changes: s.optional(s.anyObject()) }),
    response: scenarioOut,
    status: 201,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const project = await requireProject(c, a, params.projectId);
        const ids = new Set(
          (
            await c.query<{ id: string }>('SELECT id FROM items WHERE project_id = $1', [
              project.id,
            ])
          ).rows.map((r) => r.id),
        );
        const changes = checkChanges(body.changes ?? {}, ids);
        const row = (
          await c.query<ScenarioRow>(
            `INSERT INTO plan_scenarios (workspace_id, project_id, name, changes, created_by) VALUES ($1, $2, $3, $4, $5)
             RETURNING id, project_id, name, changes, status, created_at, updated_at`,
            [a.workspaceId, project.id, body.name.trim(), JSON.stringify(changes), a.user.id],
          )
        ).rows[0];
        if (!row) throw new Error('scenario insert returned nothing');
        return { status: 201, body: scenarioJson(row) };
      }),
  });

  const scenarioParams = s.object({ workspaceId: uuid, scenarioId: uuid });
  const changeScenario = route({
    method: 'PATCH',
    path: '/api/workspaces/:workspaceId/scenarios/:scenarioId',
    summary:
      'Rename an open scenario or change its tasks; a task set to null leaves the scenario (member)',
    tags: ['plan'],
    params: scenarioParams,
    body: s.object({
      name: s.optional(s.string({ min: 1, max: 120 })),
      changes: s.optional(s.anyObject()),
    }),
    response: scenarioOut,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const sc = await requireScenario(c, a, params.scenarioId);
        if (sc.status !== 'open')
          throw new HttpError(409, 'conflict', 'The scenario is ' + sc.status);
        const ids = new Set(
          (
            await c.query<{ id: string }>('SELECT id FROM items WHERE project_id = $1', [
              sc.project_id,
            ])
          ).rows.map((r) => r.id),
        );
        const next = new Map<string, TaskChange>(Object.entries(sc.changes));
        if (body.changes) {
          const incoming = checkChanges(body.changes, ids);
          for (const [id, raw] of Object.entries(body.changes)) {
            if (raw === null) next.delete(id);
            else next.set(id, { ...(next.get(id) ?? {}), ...(incoming[id] ?? {}) });
          }
        }
        const row = (
          await c.query<ScenarioRow>(
            `UPDATE plan_scenarios SET name = coalesce($2, name), changes = $3, updated_at = now() WHERE id = $1
             RETURNING id, project_id, name, changes, status, created_at, updated_at`,
            [sc.id, body.name?.trim() ?? null, JSON.stringify(Object.fromEntries(next))],
          )
        ).rows[0];
        if (!row) throw new Error('scenario vanished');
        return { body: scenarioJson(row) };
      }),
  });

  const mergeScenario = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/scenarios/:scenarioId/merge',
    summary: 'Make the scenario the live plan: its changes are written to the tasks (member)',
    tags: ['plan'],
    params: scenarioParams,
    response: s.object({ scenario: scenarioOut, changedTasks: s.number({ integer: true }) }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const sc = await requireScenario(c, a, params.scenarioId);
        if (sc.status !== 'open')
          throw new HttpError(409, 'conflict', 'The scenario is ' + sc.status);
        let n = 0;
        for (const [id, ch] of Object.entries(sc.changes)) {
          const before = (
            await c.query<{
              start_date: string | null;
              duration_days: number | null;
              assignee_id: string | null;
            }>(
              'SELECT start_date::text AS start_date, duration_days, assignee_id FROM items WHERE id = $1 AND project_id = $2 FOR UPDATE',
              [id, sc.project_id],
            )
          ).rows[0];
          if (!before) continue;
          const changes: Record<string, { from: unknown; to: unknown }> = {};
          if (ch.startDate !== undefined && ch.startDate !== before.start_date)
            changes['startDate'] = { from: before.start_date, to: ch.startDate };
          if (ch.durationDays !== undefined && ch.durationDays !== before.duration_days)
            changes['durationDays'] = { from: before.duration_days, to: ch.durationDays };
          if (ch.assigneeId !== undefined && ch.assigneeId !== before.assignee_id)
            changes['assigneeId'] = { from: before.assignee_id, to: ch.assigneeId };
          if (!Object.keys(changes).length) continue;
          if (ch.assigneeId) {
            const ok = await c.query(
              "SELECT 1 FROM workspace_members m WHERE m.user_id = $1 AND (m.role <> 'guest' OR guest_sees_project($2, $1))",
              [ch.assigneeId, sc.project_id],
            );
            if (!ok.rowCount)
              throw new HttpError(
                409,
                'conflict',
                'The scenario assigns a task to someone who cannot see the project',
              );
          }
          await c.query(
            `UPDATE items SET start_date = CASE WHEN $2 THEN $3::date ELSE start_date END,
                              due_date = CASE WHEN $2 OR $4 THEN NULL ELSE due_date END,
                              duration_days = CASE WHEN $4 THEN $5 ELSE duration_days END,
                              assignee_id = CASE WHEN $6 THEN $7::uuid ELSE assignee_id END,
                              version = version + 1, updated_at = now()
              WHERE id = $1`,
            [
              id,
              'startDate' in changes,
              ch.startDate ?? null,
              'durationDays' in changes,
              ch.durationDays ?? null,
              'assigneeId' in changes,
              ch.assigneeId ?? null,
            ],
          );
          await recordEvent(
            c,
            a.workspaceId,
            {
              actor: actorOf(a),
              verb: 'updated',
              object: { type: 'item', id, label: await itemLabel(c, id) },
              parent: { type: 'project', id: sc.project.id, label: sc.project.key },
              changes,
            },
            { projectId: sc.project.id },
          );
          n++;
        }
        const row = (
          await c.query<ScenarioRow>(
            `UPDATE plan_scenarios SET status = 'merged', closed_at = now(), updated_at = now() WHERE id = $1
             RETURNING id, project_id, name, changes, status, created_at, updated_at`,
            [sc.id],
          )
        ).rows[0];
        if (!row) throw new Error('scenario vanished');
        await recordEvent(
          c,
          a.workspaceId,
          {
            actor: actorOf(a),
            verb: 'updated',
            object: { type: 'project', id: sc.project.id, label: sc.project.key },
            changes: { scenarioMerged: { from: null, to: sc.name } },
          },
          { projectId: sc.project.id },
        );
        return { body: { scenario: scenarioJson(row), changedTasks: n } };
      }),
  });

  const discardScenario = route({
    method: 'DELETE',
    path: '/api/workspaces/:workspaceId/scenarios/:scenarioId',
    summary: 'Discard an open scenario; the live plan stays as it is (member)',
    tags: ['plan'],
    params: scenarioParams,
    response: scenarioOut,
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const sc = await requireScenario(c, a, params.scenarioId);
        if (sc.status !== 'open')
          throw new HttpError(409, 'conflict', 'The scenario is ' + sc.status);
        const row = (
          await c.query<ScenarioRow>(
            `UPDATE plan_scenarios SET status = 'discarded', closed_at = now(), updated_at = now() WHERE id = $1
             RETURNING id, project_id, name, changes, status, created_at, updated_at`,
            [sc.id],
          )
        ).rows[0];
        if (!row) throw new Error('scenario vanished');
        return { body: scenarioJson(row) };
      }),
  });

  // ── workload and levelling ──
  const loadOut = s.object({
    from: s.string(),
    to: s.string(),
    people: s.array(
      s.object({
        userId: s.string(),
        name: s.string(),
        peak: s.number({ integer: true }),
        overDays: s.number({ integer: true }),
        kind: s.enum(['person', 'agent']), // [PCODE-262 | S15 | v0.1.0]
        tasksPerDay: s.number({ integer: true }),
        days: s.array(
          s.object({
            date: s.string(),
            percent: s.number({ integer: true }),
            taskIds: s.array(s.string()),
          }),
        ),
      }),
    ),
    levelling: s.object({
      moves: s.array(
        s.object({ id: s.string(), ref: s.string(), from: s.string(), to: s.string() }),
      ),
      finishBefore: s.string(),
      finishAfter: s.string(),
    }),
  });
  const workloadRoute = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/projects/:projectId/workload',
    summary: 'Each person per working day (100 = one full task), and what levelling would move',
    tags: ['plan'],
    params: projectParams,
    query: s.object({
      from: s.optional(s.string({ min: 10, max: 10 })),
      to: s.optional(s.string({ min: 10, max: 10 })),
    }),
    response: loadOut,
    handler: ({ params, query, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        await requireProject(c, a, params.projectId);
        for (const [f, v] of [
          ['from', query.from],
          ['to', query.to],
        ] as const)
          if (v !== undefined && !isIsoDate(v))
            throw new HttpError(400, 'invalid_request', 'Dates are written YYYY-MM-DD', [
              { path: 'query.' + f, message: 'is not a date' },
            ]);
        const p = await computePlan(c, a, params.projectId);
        const from = query.from ?? p.today;
        const to = query.to ?? p.cal.addWorkdays(from, 39);
        if (p.cal.index(to) - p.cal.index(from) > 260)
          throw new HttpError(400, 'invalid_request', 'Ask for at most a year at a time', [
            { path: 'query.to', message: 'is too far' },
          ]);
        // [PCODE-262 | S15 | v0.1.0] a task given to an agent (and nobody else) loads the agent
        const agentOf = new Map(p.rows.map((r) => [r.id, r.agent_id]));
        const loadTasks = p.tasks.map((t) => {
          const ag = agentOf.get(t.id);
          return !t.assigneeId && ag ? { ...t, assigneeId: 'agent:' + ag } : t;
        });
        const parallel = Math.max(
          1,
          Math.round(await numberSetting(c, 'planning.agent_parallel_tasks', params.projectId)) ||
            3,
        );
        const rows = workload(p.sched, loadTasks, p.cal, from, to).map((r) => {
          if (!r.assigneeId.startsWith('agent:')) return r;
          const days = r.days.map((d) => ({ ...d, percent: Math.round(d.percent / parallel) }));
          return {
            ...r,
            days,
            peak: Math.max(0, ...days.map((d) => d.percent)),
            overDays: days.filter((d) => d.percent > 100).length,
          };
        });
        const ids = rows.map((r) => r.assigneeId);
        const names = new Map([
          ...(
            await c.query<{ id: string; name: string }>(
              'SELECT id, name FROM users WHERE id = ANY($1::uuid[])',
              [ids.filter((x) => !x.startsWith('agent:'))],
            )
          ).rows.map((u) => [u.id, u.name] as const),
          ...(
            await c.query<{ id: string; name: string }>(
              'SELECT id, name FROM agents WHERE id = ANY($1::uuid[])',
              [ids.filter((x) => x.startsWith('agent:')).map((x) => x.slice(6))],
            )
          ).rows.map((g) => ['agent:' + g.id, g.name] as const),
        ]);
        const lev = levelResources(p.tasks, p.deps.map(toDep), p.cal);
        const refs = new Map(p.rows.map((r) => [r.id, r.ref]));
        return {
          body: {
            from,
            to,
            people: rows
              .map((r) => ({
                userId: r.assigneeId,
                name: names.get(r.assigneeId) ?? 'Someone',
                peak: r.peak,
                overDays: r.overDays,
                days: r.days,
                kind: r.assigneeId.startsWith('agent:') ? ('agent' as const) : ('person' as const), // [PCODE-262 | S15 | v0.1.0]
                tasksPerDay: r.assigneeId.startsWith('agent:') ? parallel : 1,
              }))
              .sort((x, y) => x.kind.localeCompare(y.kind) * -1 || x.name.localeCompare(y.name)),
            levelling: {
              moves: lev.moves.map((m) => ({ ...m, ref: refs.get(m.id) ?? '' })),
              finishBefore: lev.finishBefore,
              finishAfter: lev.finishAfter,
            },
          },
        };
      }),
  });

  const level = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/projects/:projectId/plan/level',
    summary: 'Apply levelling: moved tasks start no earlier than their new dates (member)',
    tags: ['plan'],
    params: projectParams,
    response: s.object({
      moved: s.number({ integer: true }),
      finishBefore: s.string(),
      finishAfter: s.string(),
    }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const project = await requireProject(c, a, params.projectId);
        const p = await computePlan(c, a, project.id);
        const lev = levelResources(p.tasks, p.deps.map(toDep), p.cal);
        const before = new Map(p.rows.map((r) => [r.id, r.start_date]));
        for (const m of lev.moves) {
          await c.query(
            'UPDATE items SET start_date = $2, due_date = NULL, version = version + 1, updated_at = now() WHERE id = $1',
            [m.id, m.to],
          );
          await recordEvent(
            c,
            a.workspaceId,
            {
              actor: actorOf(a),
              verb: 'updated',
              object: { type: 'item', id: m.id, label: await itemLabel(c, m.id) },
              parent: { type: 'project', id: project.id, label: project.key },
              changes: { startDate: { from: before.get(m.id) ?? m.from, to: m.to } },
            },
            { projectId: project.id },
          );
        }
        return {
          body: {
            moved: lev.moves.length,
            finishBefore: lev.finishBefore,
            finishAfter: lev.finishAfter,
          },
        };
      }),
  });

  return [
    plan,
    addDep,
    changeDep,
    removeDep,
    listBaselines,
    saveBaseline,
    removeBaseline,
    listScenarios,
    createScenario,
    changeScenario,
    mergeScenario,
    discardScenario,
    workloadRoute,
    level,
    shift, // [PCODE-259 | S15 | v0.1.0]
    portfolio, // [PCODE-262 | S15 | v0.1.0]
  ];
}
