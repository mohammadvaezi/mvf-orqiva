// ── [PCODE-459 | S15 | v0.1.0] Planning in VS Code locks the project in the portal: banner on every tab, conflicting AI planning refused both ways ──
// ── [PCODE-352 | S15 | v0.1.0] T35.3c Policies for approvals, budgets and data, with a dry run ──
// ── [PCODE-253 | S15 | v0.1.0] T26.2 Capacity from profiles, absences, holidays and agents; Planner proposes assignees and new stories ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-165 | S15 | v0.1.0] B2.1 Planning and Canvas on the server: plan fields, dependencies, schedule, baselines, scenarios, drafts, retro, workload ──
// ── [PCODE-128 | S15 | v0.1.0] Add capacity, velocity and the sprint planning agent ──
//    Why:  sprint planning against facts: each person's capacity, the points already committed, and the
//          velocity measured from the project's finished sprints. The Planner agent suggests which backlog
//          tasks to take, with its reasons; the server keeps only known, estimated tasks that fit the room
//          left, in the agent's order, and a person decides by applying the suggestion.
import type { Pool, PoolClient } from 'pg';
import { assertNotLocked } from './planninglock.js'; // [PCODE-459 | S15 | v0.1.0]
import { askAgent } from '../agents/oneshot.js';
import { MODE_PLANNING } from '../agents/provider.js';
import type { ProviderFor } from '../agents/runner.js';
import { recordEvent } from '../events/outbox.js';
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s, type Infer } from '../http/schema.js';
import { jsonIn, personCapacity } from '@orqiva/shared';
import { unitOf } from './estimation.js'; // [PCODE-253 | S15 | v0.1.0]
import { numberSetting, settingFor } from './settingvalue.js';
import { actorOf, asMember, requireProject, requireUser, type Access } from './access.js';
import { sprintPolicy } from './policies.js'; // [PCODE-352 | S15 | v0.1.0]

const uuid = s.string({ format: 'uuid' });
const params = s.object({ workspaceId: uuid, sprintId: uuid });

/** How many finished sprints velocity is averaged over. */
export const VELOCITY_SPRINTS = 3;

export const PLANNING_PROMPT =
  MODE_PLANNING +
  ' You plan the next sprint. From the backlog below, in its order of priority, choose the tasks to take ' +
  'so that their points together stay within the room given. Prefer higher tasks and higher priority; keep ' +
  'tasks that belong together; skip tasks without an estimate; take a task that waits for another only with ' +
  // [PCODE-253 | S15 | v0.1.0] who takes it, tasks that are not ready, and stories the backlog lacks
  'it, after it; prefer tasks that are ready. For each task name who has room for it (one of the people ' +
  'listed, or nobody). If the sprint goal needs work the backlog does not have, propose up to three new ' +
  'stories with an estimate; never more than the room allows. Answer with one JSON object in a ```json block: ' +
  // [PCODE-165 | S15 | v0.1.0] a reason and a confidence per line, and what was considered
  '{"items": [{"ref": "REF-1", "why": "one sentence", "confidence": 0.8, "assignee": "Name or null"}, ...], ' +
  '"newItems": [{"title": "…", "description": "…", "estimate": 3, "why": "one sentence", "assignee": "Name or null"}], ' +
  '"reasons": "two or three sentences", ' +
  '"considered": ["one fact per line: velocity, milestones, dependencies, absences, tasks left out and why"]}.';

interface SprintRow {
  id: string;
  project_id: string;
  project_key: string;
  name: string;
  status: string;
}

async function visibleSprint(c: PoolClient, a: Access, id: string): Promise<SprintRow> {
  const sp = (
    await c.query<SprintRow>(
      'SELECT s.id, s.project_id, p.key AS project_key, s.name, s.status FROM sprints s JOIN projects p ON p.id = s.project_id WHERE s.id = $1',
      [id],
    )
  ).rows[0];
  if (!sp) throw new HttpError(404, 'not_found', 'Sprint not found');
  try {
    await requireProject(c, a, sp.project_id);
  } catch {
    throw new HttpError(404, 'not_found', 'Sprint not found');
  }
  return sp;
}

const capacityOut = s.object({
  sprintId: s.string(),
  members: s.array(
    s.object({
      userId: s.string(),
      name: s.string(),
      /** what counts: set by hand, else derived */
      points: s.number({ integer: true }),
      // [PCODE-253 | S15 | v0.1.0] derived from the profile, the sprint's days, holidays and absences
      derived: s.number({ integer: true }),
      manual: s.boolean(),
      hours: s.number(),
      absentDays: s.number(),
      focusFactor: s.number(),
      /** estimates of the sprint's tasks assigned to them */
      committed: s.number({ integer: true }),
    }),
  ),
  // [PCODE-253 | S15 | v0.1.0] the sprint's days, the unit and the agents' share
  window: s.object({ from: s.string(), to: s.string(), days: s.number({ integer: true }) }),
  unit: s.string(),
  agents: s.array(
    s.object({
      agentId: s.string(),
      name: s.string(),
      sprintBudgetCents: s.nullable(s.number({ integer: true })),
      tasks: s.number({ integer: true }),
      points: s.number({ integer: true }),
    }),
  ),
  capacity: s.number({ integer: true }),
  committed: s.number({ integer: true }),
  unestimated: s.number({ integer: true }),
  velocity: s.nullable(s.number()),
  velocitySprints: s.number({ integer: true }),
});
type CapacityJson = Infer<typeof capacityOut>;

/** Points finished in each of the project's last finished sprints, newest first. */
export async function finishedPoints(c: PoolClient, projectId: string): Promise<number[]> {
  return (
    await c.query<{ pts: string }>(
      `SELECT coalesce(sum(i.estimate) FILTER (WHERE st.grp = 'completed'), 0) AS pts
         FROM sprints s LEFT JOIN items i ON i.sprint_id = s.id LEFT JOIN project_states st ON st.id = i.state_id
        WHERE s.project_id = $1 AND s.status = 'completed'
        GROUP BY s.id, s.completed_at ORDER BY s.completed_at DESC NULLS LAST LIMIT $2`,
      [projectId, VELOCITY_SPRINTS],
    )
  ).rows.map((r) => Number(r.pts));
}

/** The average of the finished sprints, or null before the first one finishes. */
export const velocityOf = (points: readonly number[]): number | null =>
  points.length ? Math.round((points.reduce((n, p) => n + p, 0) / points.length) * 10) / 10 : null;

/**
 * [PCODE-253 | S15 | v0.1.0] The sprint's capacity. The people counted are the project's: with a role in it, a task in it, or
 * capacity set by hand. Each counts what was set by hand, else what their profile, the sprint's working
 * days, the workspace's holidays and their approved absences give.
 */
async function capacity(c: PoolClient, sp: SprintRow): Promise<CapacityJson> {
  const dates = (
    await c.query<{ from: string; to: string }>(
      `SELECT coalesce(start_date, current_date)::text AS from,
              coalesce(end_date, coalesce(start_date, current_date) + ($2::int * 7 - 1))::text AS to
         FROM sprints WHERE id = $1`,
      [sp.id, await numberSetting(c, 'planning.sprint_weeks', sp.project_id)],
    )
  ).rows[0] ?? { from: '', to: '' };
  const unit = await unitOf(c, sp.project_id);
  const hpp = await numberSetting(c, 'planning.hours_per_point', sp.project_id);
  const workingDaysSetting = await settingFor(c, 'calendar.working_days', null);
  const workingDays = Array.isArray(workingDaysSetting)
    ? workingDaysSetting.filter((x): x is string => typeof x === 'string')
    : ['mon', 'tue', 'wed', 'thu', 'fri'];
  const holidaysSetting = await settingFor(c, 'calendar.holidays', null);
  const holidays = Array.isArray(holidaysSetting)
    ? holidaysSetting.filter((x): x is string => typeof x === 'string')
    : [];
  const members = (
    await c.query<{
      user_id: string;
      name: string;
      points: number | null;
      hours_week: string | null;
      focus: string | null;
      committed: string;
    }>(
      `SELECT m.user_id, u.name, k.points, mp.capacity_hours_week AS hours_week, mp.focus_factor AS focus,
              (SELECT coalesce(sum(i.estimate), 0) FROM items i JOIN project_states st ON st.id = i.state_id
                WHERE i.sprint_id = $1 AND i.assignee_id = m.user_id AND st.grp <> 'cancelled') AS committed
         FROM workspace_members m JOIN users u ON u.id = m.user_id
         LEFT JOIN sprint_capacity k ON k.sprint_id = $1 AND k.user_id = m.user_id
         LEFT JOIN member_profiles mp ON mp.user_id = m.user_id
        WHERE m.role NOT IN ('guest', 'billing', 'auditor') AND m.suspended_at IS NULL
          AND (k.points IS NOT NULL
            OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = $2 AND pm.user_id = m.user_id AND pm.role <> 'viewer')
            OR EXISTS (SELECT 1 FROM items i WHERE i.project_id = $2 AND i.assignee_id = m.user_id))
        ORDER BY u.name`,
      [sp.id, sp.project_id],
    )
  ).rows;
  const absences = (
    await c.query<{ user_id: string; starts_on: string; ends_on: string; half_day: boolean }>(
      `SELECT user_id, starts_on::text, ends_on::text, half_day FROM absences
        WHERE state = 'approved' AND ends_on >= $1::date AND starts_on <= $2::date`,
      [dates.from, dates.to],
    )
  ).rows;
  const people = members.map((m) => {
    const d = personCapacity({
      from: dates.from,
      to: dates.to,
      workingDays,
      holidays,
      hoursPerWeek: Number(m.hours_week ?? 40),
      focusFactor: Number(m.focus ?? 0.75),
      absences: absences
        .filter((x) => x.user_id === m.user_id)
        .map((x) => ({ startsOn: x.starts_on, endsOn: x.ends_on, halfDay: x.half_day })),
      hoursPerPoint: hpp,
      unit,
    });
    return {
      userId: m.user_id,
      name: m.name,
      points: m.points ?? d.value,
      derived: d.value,
      manual: m.points !== null,
      hours: d.hours,
      absentDays: d.absentDays,
      focusFactor: Number(m.focus ?? 0.75),
      committed: Number(m.committed),
      days: d.days,
    };
  });
  const days =
    people[0]?.days ??
    personCapacity({
      from: dates.from,
      to: dates.to,
      workingDays,
      holidays,
      hoursPerWeek: 0,
      focusFactor: 0,
      absences: [],
      hoursPerPoint: 1,
      unit,
    }).days;
  const agents = (
    await c.query<{ id: string; name: string; day: string | null; tasks: string; pts: string }>(
      `SELECT a.id, a.name, a.day_budget_cents AS day,
              (SELECT count(*) FROM items i WHERE i.sprint_id = $1 AND i.agent_id = a.id) AS tasks,
              (SELECT coalesce(sum(i.estimate), 0) FROM items i WHERE i.sprint_id = $1 AND i.agent_id = a.id) AS pts
         FROM agents a
        WHERE a.enabled AND a.key <> 'reader'
          AND (a.day_budget_cents IS NOT NULL OR EXISTS (SELECT 1 FROM items i WHERE i.sprint_id = $1 AND i.agent_id = a.id))
        ORDER BY a.name`,
      [sp.id],
    )
  ).rows;
  const load = (
    await c.query<{ pts: string; unestimated: string }>(
      `SELECT coalesce(sum(i.estimate), 0) AS pts, count(*) FILTER (WHERE i.estimate IS NULL) AS unestimated
         FROM items i JOIN project_states st ON st.id = i.state_id
        WHERE i.sprint_id = $1 AND st.grp <> 'cancelled'`,
      [sp.id],
    )
  ).rows[0];
  const finished = await finishedPoints(c, sp.project_id);
  return {
    sprintId: sp.id,
    members: people.map((m) => ({
      userId: m.userId,
      name: m.name,
      points: m.points,
      derived: m.derived,
      manual: m.manual,
      hours: m.hours,
      absentDays: m.absentDays,
      focusFactor: m.focusFactor,
      committed: m.committed,
    })),
    window: { from: dates.from, to: dates.to, days },
    unit,
    agents: agents.map((x) => ({
      agentId: x.id,
      name: x.name,
      sprintBudgetCents: x.day === null ? null : Number(x.day) * days,
      tasks: Number(x.tasks),
      points: Number(x.pts),
    })),
    capacity: people.reduce((n, m) => n + m.points, 0),
    committed: Number(load?.pts ?? 0),
    unestimated: Number(load?.unestimated ?? 0),
    velocity: velocityOf(finished),
    velocitySprints: finished.length,
  };
}

interface Candidate {
  id: string;
  ref: string;
  title: string;
  estimate: number | null;
  // [PCODE-253 | S15 | v0.1.0] what the Planner weighs too
  priority?: string;
  ready?: boolean;
  /** refs of unfinished tasks outside the sprint it waits for */
  waits?: string[];
}

/** [PCODE-165 | S15 | v0.1.0] A line of the answer: a ref, or an object with ref, why and confidence. */
export function readLine(v: unknown): { ref: string; why: string; confidence: number } {
  if (typeof v === 'string') return { ref: v, why: '', confidence: 0.5 };
  const o = (typeof v === 'object' && v !== null ? v : {}) as Record<string, unknown>;
  const c = typeof o['confidence'] === 'number' ? o['confidence'] : 0.5;
  return {
    ref: typeof o['ref'] === 'string' ? o['ref'] : '',
    why: typeof o['why'] === 'string' ? o['why'].slice(0, 500) : '',
    confidence: Math.max(0, Math.min(1, c > 1 ? c / 100 : c)),
  };
}

/** The suggestion cut to what is real and fits: known refs, estimated, within the room, in order. */
export function fitSuggestion(
  refs: readonly unknown[],
  candidates: readonly Candidate[],
  room: number,
): { chosen: Candidate[]; dropped: { ref: string; why: string }[] } {
  const byRef = new Map(candidates.map((x) => [x.ref.toUpperCase(), x]));
  const chosen: Candidate[] = [];
  const dropped: { ref: string; why: string }[] = [];
  let used = 0;
  for (const r of refs) {
    const ref = typeof r === 'string' ? r.trim().toUpperCase() : '';
    const it = byRef.get(ref);
    if (!it) dropped.push({ ref: String(r), why: 'not an open backlog task' });
    else if (chosen.includes(it)) continue;
    else if (it.estimate === null) dropped.push({ ref, why: 'has no estimate' });
    // [PCODE-253 | S15 | v0.1.0] a task waits for its unfinished predecessors: they must be taken before it
    else if (
      (it.waits ?? []).some((w) => !chosen.some((x) => x.ref.toUpperCase() === w.toUpperCase()))
    )
      dropped.push({ ref, why: 'waits for ' + (it.waits ?? []).join(', ') });
    else if (used + it.estimate > room) dropped.push({ ref, why: 'does not fit the room left' });
    else {
      chosen.push(it);
      used += it.estimate;
    }
  }
  return { chosen, dropped };
}

const candidateOut = s.object({
  id: s.string(),
  ref: s.string(),
  title: s.string(),
  estimate: s.nullable(s.number({ integer: true })),
});

// [PCODE-165 | S15 | v0.1.0] one line of a kept draft
const lineOut = s.object({
  id: s.string(),
  ref: s.string(),
  title: s.string(),
  estimate: s.nullable(s.number({ integer: true })),
  why: s.string(),
  confidence: s.number(),
  decision: s.nullable(s.string()),
  reason: s.string(),
  // [PCODE-253 | S15 | v0.1.0] who the Planner thinks has room for it
  assigneeId: s.nullable(s.string()),
  assigneeName: s.nullable(s.string()),
});

// [PCODE-253 | S15 | v0.1.0] a story the Planner proposes that the backlog lacks
const newOut = s.object({
  id: s.string(),
  title: s.string(),
  description: s.string(),
  estimate: s.nullable(s.number({ integer: true })),
  why: s.string(),
  assigneeId: s.nullable(s.string()),
  assigneeName: s.nullable(s.string()),
  decision: s.nullable(s.string()),
  reason: s.string(),
  itemId: s.nullable(s.string()),
});

/** [PCODE-253 | S15 | v0.1.0] A proposed story made a task of the sprint: the first open state, the end of the order. */
async function createStory(
  c: PoolClient,
  a: Access,
  sp: SprintRow,
  n: { title: string; description: string; estimate: number | null; assignee_id: string | null },
): Promise<string> {
  const seq = (
    await c.query<{ seq: number }>(
      'UPDATE projects SET next_item_seq = next_item_seq + 1 WHERE id = $1 RETURNING next_item_seq - 1 AS seq',
      [sp.project_id],
    )
  ).rows[0]?.seq;
  const state = (
    await c.query<{ id: string }>(
      "SELECT id FROM project_states WHERE project_id = $1 AND grp IN ('unstarted', 'backlog') ORDER BY (grp = 'unstarted') DESC, position LIMIT 1",
      [sp.project_id],
    )
  ).rows[0]?.id;
  if (seq === undefined || !state)
    throw new HttpError(409, 'conflict', 'The project has no open state');
  const id = (
    await c.query<{ id: string }>(
      `INSERT INTO items (workspace_id, project_id, sequence, title, description, state_id, assignee_id, estimate, created_by, sprint_id, rank, kind)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, (SELECT coalesce(max(rank), 0) + 1 FROM items WHERE project_id = $2), 'story')
       RETURNING id`,
      [
        a.workspaceId,
        sp.project_id,
        seq,
        n.title,
        n.description,
        state,
        n.assignee_id,
        n.estimate,
        a.user.id,
        sp.id,
      ],
    )
  ).rows[0]?.id;
  if (!id) throw new Error('story insert returned nothing');
  await recordEvent(
    c,
    a.workspaceId,
    {
      actor: actorOf(a),
      verb: 'created',
      object: { type: 'item', id, label: sp.project_key + '-' + String(seq) + ' ' + n.title },
      parent: { type: 'project', id: sp.project_id, label: sp.project_key },
      changes: {
        sprint: { from: null, to: sp.name },
        proposedBy: { from: null, to: 'Planner agent' },
      },
    },
    { projectId: sp.project_id },
  );
  return id;
}

/** Moves the tasks into the sprint, each with its event; tasks already there stay. */
async function takeIntoSprint(
  c: PoolClient,
  a: Access,
  sp: SprintRow,
  itemIds: readonly string[],
): Promise<void> {
  const rows = (
    await c.query<{ id: string; label: string; sprint_name: string | null }>(
      `SELECT i.id, $2::text || '-' || i.sequence || ' ' || i.title AS label, s.name AS sprint_name
         FROM items i LEFT JOIN sprints s ON s.id = i.sprint_id
        WHERE i.id = ANY($1::uuid[]) AND i.project_id = $3`,
      [itemIds, sp.project_key, sp.project_id],
    )
  ).rows;
  if (rows.length !== new Set(itemIds).size)
    throw new HttpError(400, 'invalid_request', 'Some tasks are not in this project', [
      { path: 'body.itemIds', message: 'must all be tasks of the sprint’s project' },
    ]);
  // [PCODE-352 | S15 | v0.1.0] the tasks that enter the sprint keep the workspace's rules
  await sprintPolicy(
    c,
    sp.project_id,
    rows.filter((r) => r.sprint_name !== sp.name).map((r) => r.id),
  );
  for (const r of rows) {
    if (r.sprint_name === sp.name) continue;
    await c.query(
      'UPDATE items SET sprint_id = $2, version = version + 1, updated_at = now() WHERE id = $1',
      [r.id, sp.id],
    );
    await recordEvent(
      c,
      a.workspaceId,
      {
        actor: actorOf(a),
        verb: 'updated',
        object: { type: 'item', id: r.id, label: r.label },
        changes: { sprint: { from: r.sprint_name ?? 'Backlog', to: sp.name } },
      },
      { projectId: sp.project_id },
    );
  }
}

/** [PCODE-253 | S15 | v0.1.0] A draft's lines and proposed stories, with who the Planner named for each. */
async function draftParts(c: PoolClient, draftId: string, key: string) {
  const lines = (
    await c.query<{
      id: string;
      ref: string;
      title: string;
      estimate: number | null;
      why: string;
      confidence: number;
      decision: string | null;
      reason: string;
      assignee_id: string | null;
      assignee_name: string | null;
    }>(
      `SELECT i.id, $2::text || '-' || i.sequence AS ref, i.title, i.estimate, l.why, l.confidence, l.decision, l.reason,
              l.assignee_id, u.name AS assignee_name
         FROM plan_draft_lines l JOIN items i ON i.id = l.item_id LEFT JOIN users u ON u.id = l.assignee_id
        WHERE l.draft_id = $1 ORDER BY l.position`,
      [draftId, key],
    )
  ).rows.map(({ assignee_id, assignee_name, ...l }) => ({
    ...l,
    assigneeId: assignee_id,
    assigneeName: assignee_name,
  }));
  const newItems = (
    await c.query<{
      id: string;
      title: string;
      description: string;
      estimate: number | null;
      why: string;
      assignee_id: string | null;
      assignee_name: string | null;
      decision: string | null;
      reason: string;
      item_id: string | null;
    }>(
      `SELECT n.id, n.title, n.description, n.estimate, n.why, n.assignee_id, u.name AS assignee_name, n.decision, n.reason, n.item_id
         FROM plan_draft_new n LEFT JOIN users u ON u.id = n.assignee_id WHERE n.draft_id = $1 ORDER BY n.position`,
      [draftId],
    )
  ).rows.map((n) => ({
    id: n.id,
    title: n.title,
    description: n.description,
    estimate: n.estimate,
    why: n.why,
    assigneeId: n.assignee_id,
    assigneeName: n.assignee_name,
    decision: n.decision,
    reason: n.reason,
    itemId: n.item_id,
  }));
  return { lines, newItems };
}

export function planningRoutes(pool: Pool, models: ProviderFor): Route[] {
  const get = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/sprints/:sprintId/capacity',
    summary: 'The sprint’s capacity per person, points committed and the measured velocity',
    tags: ['sprints'],
    params,
    response: capacityOut,
    handler: ({ params: p, req }) =>
      asMember(pool, req, p.workspaceId, 'guest', async (c, a) => ({
        body: await capacity(c, await visibleSprint(c, a, p.sprintId)),
      })),
  });

  const set = route({
    method: 'PUT',
    path: '/api/workspaces/:workspaceId/sprints/:sprintId/capacity',
    summary: 'Set people’s capacity in points for the sprint (member)',
    tags: ['sprints'],
    params,
    body: s.object({
      entries: s.array(
        s.object({ userId: uuid, points: s.number({ integer: true, min: 0, max: 1000 }) }),
        { max: 500 },
      ),
    }),
    response: capacityOut,
    handler: ({ params: p, body, req }) =>
      asMember(pool, req, p.workspaceId, 'member', async (c, a) => {
        const sp = await visibleSprint(c, a, p.sprintId);
        // [PCODE-459 | S15 | v0.1.0] not while the project is planned in VS Code (or by another Planner run)
        await assertNotLocked(c, sp.project_id);
        if (sp.status === 'completed')
          throw new HttpError(409, 'conflict', 'The sprint is completed');
        for (const e of body.entries) {
          const member = (
            await c.query(
              "SELECT 1 FROM workspace_members WHERE user_id = $1 AND role <> 'guest'",
              [e.userId],
            )
          ).rowCount;
          if (!member)
            throw new HttpError(
              400,
              'invalid_request',
              'Capacity is for members of the workspace',
              [{ path: 'body.entries', message: e.userId + ' is not a member' }],
            );
          await c.query(
            `INSERT INTO sprint_capacity (workspace_id, sprint_id, user_id, points) VALUES ($1, $2, $3, $4)
             ON CONFLICT (sprint_id, user_id) DO UPDATE SET points = $4`,
            [a.workspaceId, sp.id, e.userId, e.points],
          );
        }
        return { body: await capacity(c, sp) };
      }),
  });

  const draft = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/sprints/:sprintId/plan/draft',
    summary:
      'The Planner agent suggests backlog tasks for the sprint within its room; nothing changes until decided (member)',
    tags: ['sprints'],
    params,
    // [PCODE-165 | S15 | v0.1.0] a redo carries a person's note for the Planner
    body: s.optional(s.object({ note: s.optional(s.string({ max: 2000 })) })),
    response: s.object({
      draftId: s.string(),
      lines: s.array(lineOut),
      newItems: s.array(newOut), // [PCODE-253 | S15 | v0.1.0]
      considered: s.array(s.string()),
      room: s.number({ integer: true }),
      basis: s.string(),
      items: s.array(candidateOut),
      points: s.number({ integer: true }),
      reasons: s.string(),
      dropped: s.array(s.object({ ref: s.string(), why: s.string() })),
      runId: s.string(),
    }),
    handler: async ({ params: p, body, req }) => {
      const note = body?.note?.trim() ?? '';
      const before = await asMember(pool, req, p.workspaceId, 'member', async (c, a) => {
        const sp = await visibleSprint(c, a, p.sprintId);
        if (sp.status === 'completed')
          throw new HttpError(409, 'conflict', 'The sprint is completed');
        const cap = await capacity(c, sp);
        const limit = cap.capacity || Math.floor(cap.velocity ?? 0);
        if (!limit)
          throw new HttpError(
            409,
            'conflict',
            'Set the team’s capacity for this sprint first; there is no finished sprint to measure velocity from',
          );
        // [PCODE-253 | S15 | v0.1.0] with priority, readiness and the unfinished tasks outside the sprint each waits for
        const candidates = (
          await c.query<
            Omit<Candidate, 'waits'> & { waits: string[] | null; assignee: string | null }
          >(
            `SELECT i.id, $2::text || '-' || i.sequence AS ref, i.title, i.estimate, i.priority, i.ready,
                    u.name AS assignee,
                    (SELECT array_agg($2::text || '-' || pi.sequence ORDER BY pi.sequence)
                       FROM item_dependencies d JOIN items pi ON pi.id = d.predecessor_id
                       JOIN project_states ps ON ps.id = pi.state_id
                      WHERE d.successor_id = i.id AND ps.grp NOT IN ('completed', 'cancelled')
                        AND pi.sprint_id IS DISTINCT FROM $3) AS waits
               FROM items i JOIN project_states st ON st.id = i.state_id LEFT JOIN users u ON u.id = i.assignee_id
              WHERE i.project_id = $1 AND i.sprint_id IS NULL AND st.grp IN ('backlog', 'unstarted')
              ORDER BY i.rank, i.sequence LIMIT 80`,
            [sp.project_id, sp.project_key, sp.id],
          )
        ).rows.map((x) => ({ ...x, waits: x.waits ?? [] }));
        const dor = await settingFor(c, 'planning.definition_of_ready', sp.project_id);
        if (!candidates.length)
          throw new HttpError(409, 'conflict', 'The backlog has no open tasks');
        return {
          sp,
          candidates,
          room: Math.max(0, limit - cap.committed),
          basis: cap.capacity ? 'capacity' : 'velocity',
          // [PCODE-253 | S15 | v0.1.0]
          people: cap.members.map((m) => ({
            id: m.userId,
            name: m.name,
            free: m.points - m.committed,
          })),
          absences: cap.members.filter((m) => m.absentDays > 0),
          window: cap.window,
          dor: Array.isArray(dor) ? dor.filter((x): x is string => typeof x === 'string') : [],
        };
      });
      const user = await requireUser(pool, req);
      const brief =
        'Sprint: ' +
        before.sp.name +
        '\nRoom: ' +
        String(before.room) +
        ' points\n' +
        // [PCODE-253 | S15 | v0.1.0] the days, who has room, who is away, what ready means
        'Days: ' +
        before.window.from +
        ' to ' +
        before.window.to +
        ' (' +
        String(before.window.days) +
        ' working days)\nPeople (name: points free): ' +
        (before.people.map((x) => x.name + ': ' + String(x.free)).join(', ') || 'nobody yet') +
        '\n' +
        (before.absences.length
          ? 'Away: ' +
            before.absences.map((x) => x.name + ' ' + String(x.absentDays) + ' days').join(', ') +
            '\n'
          : '') +
        (before.dor.length ? 'Definition of ready: ' + before.dor.join(', ') + '\n' : '') +
        '\nBacklog (ref | points | priority | ready | assignee | waits for | title):\n' +
        before.candidates
          .map((x) =>
            [
              x.ref,
              x.estimate === null ? '?' : String(x.estimate),
              x.priority ?? 'none',
              x.ready ? 'ready' : 'not ready',
              x.assignee ?? '-',
              x.waits.join(' ') || '-',
              x.title,
            ].join(' | '),
          )
          .join('\n') +
        (note ? '\n\nThe team asks you to redo the draft with this in mind: ' + note : '');
      const asked = await askAgent(pool, models, {
        workspaceId: p.workspaceId,
        projectId: before.sp.project_id,
        agentKey: 'planner',
        requestedBy: user.id,
        instruction: 'Suggest the tasks for ' + before.sp.name,
        system: PLANNING_PROMPT,
        messages: [{ role: 'user', content: [{ type: 'text', text: brief }] }],
      });
      const answer = jsonIn(asked.text);
      const obj = (typeof answer === 'object' && answer !== null ? answer : {}) as Record<
        string,
        unknown
      >;
      if (!Array.isArray(obj['items']))
        throw new HttpError(
          502,
          'bad_gateway',
          'The Planner agent’s answer could not be read. Try again.',
        );
      const read = obj['items'].map(readLine);
      const { chosen, dropped } = fitSuggestion(
        read.map((x) => x.ref),
        before.candidates,
        before.room,
      );
      const info = new Map(read.map((x) => [x.ref.trim().toUpperCase(), x]));
      const considered = Array.isArray(obj['considered'])
        ? obj['considered']
            .filter((x): x is string => typeof x === 'string')
            .slice(0, 12)
            .map((x) => x.slice(0, 300))
        : [];
      const reasons = typeof obj['reasons'] === 'string' ? obj['reasons'].slice(0, 2000) : '';
      // [PCODE-253 | S15 | v0.1.0] who takes each task, by name among the people with room; new stories within the room left
      const personBy = (name: unknown): string | null =>
        typeof name === 'string'
          ? (before.people.find((x) => x.name.toLowerCase() === name.trim().toLowerCase())?.id ??
            null)
          : null;
      const assignees = new Map(
        (obj['items'] as unknown[]).map((x) => {
          const o = (typeof x === 'object' && x !== null ? x : {}) as Record<string, unknown>;
          return [
            (typeof o['ref'] === 'string' ? o['ref'] : '').trim().toUpperCase(),
            personBy(o['assignee']),
          ];
        }),
      );
      let left = before.room - chosen.reduce((n, x) => n + (x.estimate ?? 0), 0);
      const proposed: {
        title: string;
        description: string;
        estimate: number | null;
        why: string;
        assignee: string | null;
      }[] = [];
      for (const raw of Array.isArray(obj['newItems']) ? obj['newItems'].slice(0, 3) : []) {
        const o = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
        const title = typeof o['title'] === 'string' ? o['title'].trim().slice(0, 255) : '';
        const est =
          typeof o['estimate'] === 'number' && o['estimate'] >= 0
            ? Math.min(1000, Math.round(o['estimate']))
            : null;
        if (!title) continue;
        if (est !== null && est > left) {
          dropped.push({ ref: title, why: 'a new story that does not fit the room left' });
          continue;
        }
        left -= est ?? 0;
        proposed.push({
          title,
          description: typeof o['description'] === 'string' ? o['description'].slice(0, 4000) : '',
          estimate: est,
          why: typeof o['why'] === 'string' ? o['why'].slice(0, 500) : '',
          assignee: personBy(o['assignee']),
        });
      }
      // [PCODE-165 | S15 | v0.1.0] the draft is kept: people decide it line by line, later too
      const draftId = await asMember(pool, req, p.workspaceId, 'member', async (c, a) => {
        await c.query(
          "UPDATE plan_drafts SET status = 'replaced' WHERE sprint_id = $1 AND status = 'open'",
          [before.sp.id],
        );
        const id = (
          await c.query<{ id: string }>(
            `INSERT INTO plan_drafts (workspace_id, project_id, sprint_id, agent_run_id, room, basis, reasons, considered, note, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
            [
              a.workspaceId,
              before.sp.project_id,
              before.sp.id,
              asked.runId,
              before.room,
              before.basis,
              reasons,
              JSON.stringify(considered),
              note,
              a.user.id,
            ],
          )
        ).rows[0]?.id;
        if (!id) throw new Error('draft insert returned nothing');
        let pos = 0;
        for (const x of chosen) {
          const i = info.get(x.ref.toUpperCase());
          await c.query(
            `INSERT INTO plan_draft_lines (workspace_id, draft_id, position, item_id, why, confidence, assignee_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
              a.workspaceId,
              id,
              pos++,
              x.id,
              i?.why ?? '',
              i?.confidence ?? 0.5,
              assignees.get(x.ref.toUpperCase()) ?? null,
            ],
          );
        }
        // [PCODE-253 | S15 | v0.1.0]
        let npos = 0;
        for (const n of proposed)
          await c.query(
            `INSERT INTO plan_draft_new (workspace_id, draft_id, position, title, description, estimate, why, assignee_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [a.workspaceId, id, npos++, n.title, n.description, n.estimate, n.why, n.assignee],
          );
        return id;
      });
      const kept = await asMember(pool, req, p.workspaceId, 'member', async (c) =>
        draftParts(c, draftId, before.sp.project_key),
      );
      return {
        body: {
          draftId,
          lines: kept.lines,
          newItems: kept.newItems,
          considered,
          room: before.room,
          basis: before.basis,
          items: chosen.map((x) => ({
            id: x.id,
            ref: x.ref,
            title: x.title,
            estimate: x.estimate,
          })),
          points: chosen.reduce((n, x) => n + (x.estimate ?? 0), 0),
          reasons,
          dropped,
          runId: asked.runId,
        },
      };
    },
  });

  const apply = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/sprints/:sprintId/plan/apply',
    summary: 'Take the chosen backlog tasks into the sprint (member)',
    tags: ['sprints'],
    params,
    body: s.object({ itemIds: s.array(uuid, { min: 1, max: 200 }) }),
    response: capacityOut,
    handler: ({ params: p, body, req }) =>
      asMember(pool, req, p.workspaceId, 'member', async (c, a) => {
        const sp = await visibleSprint(c, a, p.sprintId);
        if (sp.status === 'completed')
          throw new HttpError(409, 'conflict', 'The sprint is completed');
        await takeIntoSprint(c, a, sp, body.itemIds);
        return { body: await capacity(c, sp) };
      }),
  });

  // [PCODE-165 | S15 | v0.1.0] the kept draft, and deciding it line by line
  const draftOut = s.object({
    id: s.string(),
    sprintId: s.string(),
    status: s.string(),
    room: s.number({ integer: true }),
    basis: s.string(),
    reasons: s.string(),
    considered: s.array(s.string()),
    note: s.string(),
    runId: s.nullable(s.string()),
    createdAt: s.string(),
    lines: s.array(lineOut),
    newItems: s.array(newOut), // [PCODE-253 | S15 | v0.1.0]
  });
  interface DraftRow {
    id: string;
    sprint_id: string;
    status: string;
    room: number;
    basis: string;
    reasons: string;
    considered: string[];
    note: string;
    agent_run_id: string | null;
    created_at: Date;
  }
  const draftJson = async (c: PoolClient, d: DraftRow, key: string) => ({
    id: d.id,
    sprintId: d.sprint_id,
    status: d.status,
    room: d.room,
    basis: d.basis,
    reasons: d.reasons,
    considered: d.considered,
    note: d.note,
    runId: d.agent_run_id,
    createdAt: d.created_at.toISOString(),
    ...(await draftParts(c, d.id, key)),
  });
  const DRAFT_SELECT =
    'SELECT id, sprint_id, status, room, basis, reasons, considered, note, agent_run_id, created_at FROM plan_drafts';

  const latest = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/sprints/:sprintId/plan/draft',
    summary: 'The newest draft of the Planner for this sprint, with each line’s decision',
    tags: ['sprints'],
    params,
    response: s.nullable(draftOut),
    handler: ({ params: p, req }) =>
      asMember(pool, req, p.workspaceId, 'member', async (c, a) => {
        const sp = await visibleSprint(c, a, p.sprintId);
        const d = (
          await c.query<DraftRow>(
            DRAFT_SELECT +
              " WHERE sprint_id = $1 AND status <> 'replaced' ORDER BY created_at DESC LIMIT 1",
            [sp.id],
          )
        ).rows[0];
        return { body: d ? await draftJson(c, d, sp.project_key) : null };
      }),
  });

  const decide = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/plan-drafts/:draftId/decide',
    summary:
      'Accept lines (the tasks move into the sprint) and decline others with a reason (member)',
    tags: ['sprints'],
    params: s.object({ workspaceId: uuid, draftId: uuid }),
    body: s.object({
      accept: s.optional(s.array(uuid, { max: 200 })),
      decline: s.optional(
        s.array(s.object({ itemId: uuid, reason: s.optional(s.string({ max: 500 })) }), {
          max: 200,
        }),
      ),
      // [PCODE-253 | S15 | v0.1.0] proposed stories: accepted ones become tasks of the sprint
      acceptNew: s.optional(s.array(uuid, { max: 20 })),
      declineNew: s.optional(
        s.array(s.object({ id: uuid, reason: s.optional(s.string({ max: 500 })) }), { max: 20 }),
      ),
    }),
    response: s.object({ draft: draftOut, capacity: capacityOut }),
    handler: ({ params: p, body, req }) =>
      asMember(pool, req, p.workspaceId, 'member', async (c, a) => {
        const d = (await c.query<DraftRow>(DRAFT_SELECT + ' WHERE id = $1', [p.draftId])).rows[0];
        if (!d) throw new HttpError(404, 'not_found', 'Draft not found');
        const sp = await visibleSprint(c, a, d.sprint_id);
        if (d.status !== 'open') throw new HttpError(409, 'conflict', 'The draft is ' + d.status);
        if (sp.status === 'completed')
          throw new HttpError(409, 'conflict', 'The sprint is completed');
        const open = new Set(
          (
            await c.query<{ item_id: string }>(
              'SELECT item_id FROM plan_draft_lines WHERE draft_id = $1 AND decision IS NULL',
              [d.id],
            )
          ).rows.map((x) => x.item_id),
        );
        const accept = [...new Set(body.accept ?? [])];
        const decline = body.decline ?? [];
        for (const id of [...accept, ...decline.map((x) => x.itemId)])
          if (!open.has(id))
            throw new HttpError(400, 'invalid_request', 'Decide only open lines of this draft', [
              { path: 'body', message: id + ' is not an open line' },
            ]);
        if (accept.length) await takeIntoSprint(c, a, sp, accept);
        // [PCODE-253 | S15 | v0.1.0] a task nobody has yet goes to whom the Planner named
        for (const id of accept) {
          const named = (
            await c.query<{ assignee_id: string | null; label: string; who: string | null }>(
              `SELECT l.assignee_id, $3::text || '-' || i.sequence || ' ' || i.title AS label, u.name AS who
                 FROM plan_draft_lines l JOIN items i ON i.id = l.item_id LEFT JOIN users u ON u.id = l.assignee_id
                WHERE l.draft_id = $1 AND l.item_id = $2 AND i.assignee_id IS NULL`,
              [d.id, id, sp.project_key],
            )
          ).rows[0];
          if (!named?.assignee_id) continue;
          await c.query(
            'UPDATE items SET assignee_id = $2, version = version + 1, updated_at = now() WHERE id = $1',
            [id, named.assignee_id],
          );
          await recordEvent(
            c,
            a.workspaceId,
            {
              actor: actorOf(a),
              verb: 'updated',
              object: { type: 'item', id, label: named.label },
              changes: { assigneeId: { from: null, to: named.assignee_id } },
            },
            { projectId: sp.project_id },
          );
        }
        const openNew = (
          await c.query<{
            id: string;
            title: string;
            description: string;
            estimate: number | null;
            assignee_id: string | null;
          }>(
            'SELECT id, title, description, estimate, assignee_id FROM plan_draft_new WHERE draft_id = $1 AND decision IS NULL',
            [d.id],
          )
        ).rows;
        for (const id of [...(body.acceptNew ?? []), ...(body.declineNew ?? []).map((x) => x.id)])
          if (!openNew.some((n) => n.id === id))
            throw new HttpError(400, 'invalid_request', 'Decide only open stories of this draft', [
              { path: 'body', message: id + ' is not an open story' },
            ]);
        for (const id of new Set(body.acceptNew ?? [])) {
          const n = openNew.find((x) => x.id === id);
          if (!n) continue;
          const itemId = await createStory(c, a, sp, n);
          await c.query(
            "UPDATE plan_draft_new SET decision = 'accepted', item_id = $2, decided_by = $3, decided_at = now() WHERE id = $1",
            [id, itemId, a.user.id],
          );
        }
        for (const x of body.declineNew ?? [])
          await c.query(
            "UPDATE plan_draft_new SET decision = 'declined', reason = $2, decided_by = $3, decided_at = now() WHERE id = $1",
            [x.id, x.reason?.trim() ?? '', a.user.id],
          );
        for (const id of accept)
          await c.query(
            "UPDATE plan_draft_lines SET decision = 'accepted', decided_by = $3, decided_at = now() WHERE draft_id = $1 AND item_id = $2",
            [d.id, id, a.user.id],
          );
        for (const x of decline)
          await c.query(
            "UPDATE plan_draft_lines SET decision = 'declined', reason = $3, decided_by = $4, decided_at = now() WHERE draft_id = $1 AND item_id = $2",
            [d.id, x.itemId, x.reason?.trim() ?? '', a.user.id],
          );
        await c.query(
          `UPDATE plan_drafts SET status = 'decided'
            WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM plan_draft_lines WHERE draft_id = $1 AND decision IS NULL)
              AND NOT EXISTS (SELECT 1 FROM plan_draft_new WHERE draft_id = $1 AND decision IS NULL)`,
          [d.id],
        );
        const after = (await c.query<DraftRow>(DRAFT_SELECT + ' WHERE id = $1', [d.id])).rows[0];
        if (!after) throw new Error('draft vanished');
        return {
          body: {
            draft: await draftJson(c, after, sp.project_key),
            capacity: await capacity(c, sp),
          },
        };
      }),
  });

  return [get, set, draft, apply, latest, decide];
}
