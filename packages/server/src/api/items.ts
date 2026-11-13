// ── [PCODE-352 | S15 | v0.1.0] T35.3c Policies for approvals, budgets and data, with a dry run ──
// ── [PCODE-259 | S15 | v0.1.0] T27.1 Canvas engine: constraint types, split tasks, holidays, move with successors ──
// ── [PCODE-257 | S15 | v0.1.0] T26.6 Hierarchy: initiatives, custom item types, custom fields ──
// ── [PCODE-254 | S15 | v0.1.0] T26.3 Flow and backlog: links, WIP limits, warnings, definition of done, triage, templates, recurring tasks ──
// ── [PCODE-250 | S15 | v0.1.0] T25.5 Profiles, GDPR export and erasure, version check on task edits ──
// ── [PCODE-246 | S15 | v0.1.0] T25.1 Agent triggers act: assignment, label, mention, CI failure, schedule, webhook ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-181 | S15 | v0.1.0] B5.2 Tokens and costs live: AI spend, budgets, prices, provider keys per project, access tokens with scopes, policy, leak revocation ──
// ── [PCODE-165 | S15 | v0.1.0] B2.1 Planning and Canvas on the server: plan fields, dependencies, schedule, baselines, scenarios, drafts, retro, workload ──
// ── [PCODE-163 | S15 | v0.1.0] B1.2 Roles, clients and portal sign-in on the server ──
// ── [PCODE-93 | S15 | v0.1.0] Add items, states, labels and comments with full history ──
// ── [PCODE-99 | S15 | v0.1.0] Build sprints, backlog, board and list views ──
// ── [PCODE-100 | S15 | v0.1.0] Add filters, search and the keyboard command bar ──
// ── [PCODE-107 | S15 | v0.1.0] Build the Plane importer: projects, items, states, comments, cycles, history ──
//    Why:  the work itself. Members create and change items; guests read and comment on the projects they
//          are invited to. Every change is checked against the item's project (its states, labels, parent
//          items, who may be assigned) and recorded as an activity event naming each field that changed,
//          from what, to what. An item's history is that stream, read back.
// [PCODE-181 | S15 | v0.1.0] leaked tokens are revoked
import { revokeLeaks } from '../auth/leaks.js';
import {
  CONSTRAINT_TYPES,
  isIsoDate,
  splitsProblem,
  type ActivityData,
  type Split,
  type Verb,
} from '@orqiva/shared'; // [PCODE-259 | S15 | v0.1.0]
import type { Pool, PoolClient } from 'pg';
import { recordEvent } from '../events/outbox.js';
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s } from '../http/schema.js';
import { searchQuery } from './search.js';
import { doneGate } from './flow.js'; // [PCODE-254 | S15 | v0.1.0]
import { nextCustom, typeOf } from './hierarchy.js'; // [PCODE-257 | S15 | v0.1.0]
import {
  actorOf,
  asMember,
  atLeast,
  isUniqueViolation,
  requireProject,
  type Access,
  type ProjectRow,
} from './access.js';
import { sprintPolicy } from './policies.js'; // [PCODE-352 | S15 | v0.1.0]

const uuid = s.string({ format: 'uuid' });
const projectParams = s.object({ workspaceId: uuid, projectId: uuid });
const itemParams = s.object({ workspaceId: uuid, itemId: uuid });
const commentParams = s.object({ workspaceId: uuid, commentId: uuid });

export const itemOut = s.object({
  id: s.string(),
  ref: s.string(),
  projectId: s.string(),
  sequence: s.number({ integer: true }),
  title: s.string(),
  description: s.string(),
  stateId: s.string(),
  assigneeId: s.nullable(s.string()),
  estimate: s.nullable(s.number({ integer: true })),
  parentId: s.nullable(s.string()),
  labelIds: s.array(s.string()),
  sprintId: s.nullable(s.string()),
  rank: s.number(),
  version: s.number({ integer: true }),
  commentCount: s.number({ integer: true }),
  createdAt: s.string(),
  updatedAt: s.string(),
  // [PCODE-165 | S15 | v0.1.0] what Planning and the Canvas need of a task
  kind: s.string(),
  priority: s.string(),
  startDate: s.nullable(s.string()),
  dueDate: s.nullable(s.string()),
  durationDays: s.nullable(s.number({ integer: true })),
  percentDone: s.nullable(s.number({ integer: true })),
  ready: s.boolean(),
  carriedCount: s.number({ integer: true }),
  scheduleMode: s.string(),
  // [PCODE-259 | S15 | v0.1.0] the constraint and the pauses of the task
  constraintType: s.string(),
  constraintDate: s.nullable(s.string()),
  splits: s.array(
    s.object({ after: s.number({ integer: true }), gap: s.number({ integer: true }) }),
  ),
  agentId: s.nullable(s.string()), // [PCODE-246 | S15 | v0.1.0] the agent the task is assigned to
  // [PCODE-254 | S15 | v0.1.0] the definitions ticked off, and whether it waits in triage
  checks: s.object({ ready: s.array(s.string()), done: s.array(s.string()) }),
  triage: s.boolean(),
  // [PCODE-257 | S15 | v0.1.0] the project's own type and fields
  typeId: s.nullable(s.string()),
  custom: s.anyObject(),
});

export interface ItemJson {
  id: string;
  ref: string;
  projectId: string;
  sequence: number;
  title: string;
  description: string;
  stateId: string;
  assigneeId: string | null;
  estimate: number | null;
  parentId: string | null;
  labelIds: string[];
  sprintId: string | null;
  rank: number;
  version: number;
  commentCount: number;
  createdAt: string;
  updatedAt: string;
  // [PCODE-165 | S15 | v0.1.0]
  kind: string;
  priority: string;
  startDate: string | null;
  dueDate: string | null;
  durationDays: number | null;
  percentDone: number | null;
  ready: boolean;
  carriedCount: number;
  scheduleMode: string;
  constraintType: string; // [PCODE-259 | S15 | v0.1.0]
  constraintDate: string | null;
  splits: Split[];
  agentId: string | null; // [PCODE-246 | S15 | v0.1.0]
  checks: { ready: string[]; done: string[] }; // [PCODE-254 | S15 | v0.1.0]
  triage: boolean;
  typeId: string | null; // [PCODE-257 | S15 | v0.1.0]
  custom: Record<string, unknown>;
}

const ITEM_SELECT = `
  SELECT i.id, p.key || '-' || i.sequence AS ref, i.project_id, i.sequence, i.title, i.description, i.state_id,
         i.assignee_id, i.estimate, i.parent_id, i.sprint_id, i.rank, i.version, i.created_at, i.updated_at,
         i.kind, i.priority, i.start_date::text AS start_date, i.due_date::text AS due_date, i.duration_days,
         i.percent_done, i.ready, i.carried_count, i.schedule_mode, i.agent_id, i.checks, i.triage, i.type_id, i.custom,
         i.constraint_type, i.constraint_date::text AS constraint_date, i.splits,
         coalesce((SELECT array_agg(l.label_id ORDER BY l.label_id) FROM item_labels l WHERE l.item_id = i.id), '{}') AS label_ids,
         (SELECT count(*) FROM comments c WHERE c.item_id = i.id) AS comment_count
  FROM items i JOIN projects p ON p.id = i.project_id`;

interface ItemRow {
  id: string;
  ref: string;
  project_id: string;
  sequence: number;
  title: string;
  description: string;
  state_id: string;
  assignee_id: string | null;
  estimate: number | null;
  parent_id: string | null;
  sprint_id: string | null;
  rank: number;
  version: number;
  created_at: Date;
  updated_at: Date;
  label_ids: string[];
  comment_count: string;
  // [PCODE-165 | S15 | v0.1.0]
  kind: string;
  priority: string;
  start_date: string | null;
  due_date: string | null;
  duration_days: number | null;
  percent_done: number | null;
  ready: boolean;
  carried_count: number;
  schedule_mode: string;
  constraint_type: string; // [PCODE-259 | S15 | v0.1.0]
  constraint_date: string | null;
  splits: Split[];
  agent_id: string | null; // [PCODE-246 | S15 | v0.1.0]
  checks: { ready?: string[]; done?: string[] }; // [PCODE-254 | S15 | v0.1.0]
  triage: boolean;
  type_id: string | null; // [PCODE-257 | S15 | v0.1.0]
  custom: Record<string, unknown>;
}

const itemJson = (r: ItemRow): ItemJson => ({
  id: r.id,
  ref: r.ref,
  projectId: r.project_id,
  sequence: r.sequence,
  title: r.title,
  description: r.description,
  stateId: r.state_id,
  assigneeId: r.assignee_id,
  estimate: r.estimate,
  parentId: r.parent_id,
  labelIds: r.label_ids,
  sprintId: r.sprint_id,
  rank: r.rank,
  version: r.version,
  commentCount: Number(r.comment_count),
  createdAt: r.created_at.toISOString(),
  updatedAt: r.updated_at.toISOString(),
  // [PCODE-165 | S15 | v0.1.0]
  kind: r.kind,
  priority: r.priority,
  startDate: r.start_date,
  dueDate: r.due_date,
  durationDays: r.duration_days,
  percentDone: r.percent_done,
  ready: r.ready,
  carriedCount: r.carried_count,
  scheduleMode: r.schedule_mode,
  constraintType: r.constraint_type, // [PCODE-259 | S15 | v0.1.0]
  constraintDate: r.constraint_date,
  splits: r.splits,
  agentId: r.agent_id,
  checks: { ready: r.checks.ready ?? [], done: r.checks.done ?? [] },
  triage: r.triage,
  typeId: r.type_id,
  custom: r.custom,
});

// [PCODE-165 | S15 | v0.1.0] the plan fields a task can be created or changed with
// [PCODE-257 | S15 | v0.1.0] an initiative holds epics
export const ITEM_KINDS = [
  'initiative',
  'epic',
  'story',
  'task',
  'bug',
  'spike',
  'milestone',
] as const;
export const PRIORITIES = ['urgent', 'high', 'medium', 'low', 'none'] as const;
const day = s.string({ min: 10, max: 10 });
const planFields = {
  kind: s.optional(s.enum(ITEM_KINDS)),
  priority: s.optional(s.enum(PRIORITIES)),
  startDate: s.optional(s.nullable(day)),
  dueDate: s.optional(s.nullable(day)),
  durationDays: s.optional(s.nullable(s.number({ integer: true, min: 0, max: 3650 }))),
  percentDone: s.optional(s.nullable(s.number({ integer: true, min: 0, max: 100 }))),
  ready: s.optional(s.boolean()),
  scheduleMode: s.optional(s.enum(['auto', 'manual'])),
  // [PCODE-259 | S15 | v0.1.0]
  constraintType: s.optional(s.enum(CONSTRAINT_TYPES)),
  constraintDate: s.optional(s.nullable(day)),
  splits: s.optional(
    s.array(s.object({ after: s.number({ integer: true }), gap: s.number({ integer: true }) })),
  ),
};

// [PCODE-259 | S15 | v0.1.0]
/** A constraint's day is a real day, and the splits make sense. */
function checkPlanExtras(body: {
  constraintDate?: string | null | undefined;
  splits?: Split[] | undefined;
}): void {
  if (body.constraintDate && !isIsoDate(body.constraintDate))
    throw new HttpError(400, 'invalid_request', 'Dates are written YYYY-MM-DD', [
      { path: 'body.constraintDate', message: 'is not a date' },
    ]);
  const p = body.splits !== undefined ? splitsProblem(body.splits) : null;
  if (p)
    throw new HttpError(400, 'invalid_request', 'The splits do not fit', [
      { path: 'body.splits', message: p },
    ]);
}

/** Dates are real days, and a task does not end before it starts. */
function checkDates(start: string | null | undefined, due: string | null | undefined): void {
  for (const [f, v] of [
    ['startDate', start],
    ['dueDate', due],
  ] as const)
    if (v && !isIsoDate(v))
      throw new HttpError(400, 'invalid_request', 'Dates are written YYYY-MM-DD', [
        { path: 'body.' + f, message: 'is not a date' },
      ]);
  if (start && due && due < start)
    throw new HttpError(400, 'invalid_request', 'A task cannot end before it starts', [
      { path: 'body.dueDate', message: 'is before the start date' },
    ]);
}

async function loadItem(c: PoolClient, itemId: string): Promise<ItemRow | undefined> {
  return (await c.query<ItemRow>(ITEM_SELECT + ' WHERE i.id = $1', [itemId])).rows[0];
}

/** The item, if it exists and its project is visible to the caller. */
async function requireItem(
  c: PoolClient,
  a: Access,
  itemId: string,
): Promise<{ item: ItemRow; project: ProjectRow }> {
  const item = await loadItem(c, itemId);
  if (!item) throw new HttpError(404, 'not_found', 'Item not found');
  try {
    return { item, project: await requireProject(c, a, item.project_id) };
  } catch {
    throw new HttpError(404, 'not_found', 'Item not found');
  }
}

// ── the checks every create and update runs against the item's project ──
async function checkState(c: PoolClient, projectId: string, stateId: string): Promise<string> {
  const st = (
    await c.query<{ name: string }>(
      'SELECT name FROM project_states WHERE id = $1 AND project_id = $2',
      [stateId, projectId],
    )
  ).rows[0];
  if (!st)
    throw new HttpError(400, 'invalid_request', 'The state does not belong to this project', [
      { path: 'body.stateId', message: 'is not a state of this project' },
    ]);
  return st.name;
}

async function checkAssignee(c: PoolClient, projectId: string, userId: string): Promise<void> {
  const ok = await c.query(
    `SELECT 1 FROM workspace_members m WHERE m.user_id = $1
       AND (m.role <> 'guest' OR guest_sees_project($2, $1))`,
    [userId, projectId],
  );
  if (!ok.rowCount)
    throw new HttpError(
      400,
      'invalid_request',
      'Only someone who can see the project can be assigned',
      [{ path: 'body.assigneeId', message: 'cannot see this project' }],
    );
}

/** [PCODE-246 | S15 | v0.1.0] An agent of the workspace that is switched on can take a task. */
async function checkAgent(c: PoolClient, agentId: string): Promise<string> {
  const row = (
    await c.query<{ name: string; enabled: boolean }>(
      'SELECT name, enabled FROM agents WHERE id = $1',
      [agentId],
    )
  ).rows[0];
  if (!row || !row.enabled)
    throw new HttpError(
      400,
      'invalid_request',
      'Only an agent that is switched on can take a task',
      [
        {
          path: 'body.agentId',
          message: row ? 'is switched off' : 'is not an agent of this workspace',
        },
      ],
    );
  return row.name;
}

async function checkParent(
  c: PoolClient,
  projectId: string,
  itemId: string | null,
  parentId: string,
): Promise<void> {
  const parent = (
    await c.query<{ project_id: string }>('SELECT project_id FROM items WHERE id = $1', [parentId])
  ).rows[0];
  if (!parent || parent.project_id !== projectId) {
    throw new HttpError(400, 'invalid_request', 'The parent must be an item of the same project', [
      { path: 'body.parentId', message: 'is not an item of this project' },
    ]);
  }
  if (!itemId) return;
  // walk up from the new parent: meeting the item itself would close a loop
  const loop = await c.query(
    `WITH RECURSIVE up(id, parent_id) AS (
       SELECT id, parent_id FROM items WHERE id = $1
       UNION ALL SELECT i.id, i.parent_id FROM items i JOIN up ON i.id = up.parent_id)
     SELECT 1 FROM up WHERE id = $2`,
    [parentId, itemId],
  );
  if (loop.rowCount)
    throw new HttpError(400, 'invalid_request', 'An item cannot be inside itself', [
      { path: 'body.parentId', message: 'would make a loop' },
    ]);
}

/** A sprint of the same project that is not finished yet; returns its name for the history. */
async function checkSprint(c: PoolClient, projectId: string, sprintId: string): Promise<string> {
  const sp = (
    await c.query<{ name: string; status: string }>(
      'SELECT name, status FROM sprints WHERE id = $1 AND project_id = $2',
      [sprintId, projectId],
    )
  ).rows[0];
  if (!sp)
    throw new HttpError(400, 'invalid_request', 'The sprint does not belong to this project', [
      { path: 'body.sprintId', message: 'is not a sprint of this project' },
    ]);
  if (sp.status === 'completed')
    throw new HttpError(400, 'invalid_request', 'The sprint is completed', [
      { path: 'body.sprintId', message: 'is completed' },
    ]);
  return sp.name;
}

async function checkLabels(c: PoolClient, projectId: string, labelIds: string[]): Promise<void> {
  if (labelIds.length === 0) return;
  const n = (
    await c.query<{ n: string }>(
      'SELECT count(*) AS n FROM labels WHERE project_id = $1 AND id = ANY($2::uuid[])',
      [projectId, labelIds],
    )
  ).rows[0]?.n;
  if (Number(n) !== new Set(labelIds).size)
    throw new HttpError(400, 'invalid_request', 'Every label must belong to this project', [
      { path: 'body.labelIds', message: 'contains a label of another project' },
    ]);
}

const itemRef = (r: ItemRow): { type: 'item'; id: string; label: string } => ({
  type: 'item',
  id: r.id,
  label: r.ref + ' ' + r.title,
});

export function itemRoutes(pool: Pool): Route[] {
  const list = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/projects/:projectId/items',
    summary: 'The items of a project, by number',
    tags: ['items'],
    params: projectParams,
    // [PCODE-100 | S15 | v0.1.0] filters: text, state, assignee (me, none), label, sprint (backlog)
    query: s.object({
      q: s.optional(s.string({ max: 200 })),
      stateId: s.optional(uuid),
      assigneeId: s.optional(s.string({ pattern: /^(me|none|[0-9a-f-]{36})$/ })),
      labelId: s.optional(uuid),
      sprintId: s.optional(s.string({ pattern: /^(backlog|[0-9a-f-]{36})$/ })),
      // [PCODE-257 | S15 | v0.1.0] a field of the project: "customer:Northwind"
      field: s.optional(s.string({ pattern: /^[a-z][a-z0-9_]{0,39}:.{1,200}$/ })),
      typeId: s.optional(uuid),
    }),
    response: s.array(itemOut),
    handler: ({ params, query, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        const p = await requireProject(c, a, params.projectId);
        const where = ['i.project_id = $1'];
        const args: unknown[] = [p.id];
        const arg = (v: unknown): string => {
          args.push(v);
          return '$' + String(args.length);
        };
        if (query.stateId) where.push('i.state_id = ' + arg(query.stateId));
        if (query.assigneeId === 'none') where.push('i.assignee_id IS NULL');
        else if (query.assigneeId)
          where.push(
            'i.assignee_id = ' + arg(query.assigneeId === 'me' ? a.user.id : query.assigneeId),
          );
        if (query.labelId)
          where.push(
            'EXISTS (SELECT 1 FROM item_labels l WHERE l.item_id = i.id AND l.label_id = ' +
              arg(query.labelId) +
              ')',
          );
        if (query.field) {
          const at = query.field.indexOf(':');
          // a field matches as text, so numbers and choices filter alike
          where.push(
            'i.custom->>' + arg(query.field.slice(0, at)) + ' = ' + arg(query.field.slice(at + 1)),
          );
        }
        if (query.typeId) where.push('i.type_id = ' + arg(query.typeId));
        if (query.sprintId === 'backlog') where.push('i.sprint_id IS NULL');
        else if (query.sprintId) where.push('i.sprint_id = ' + arg(query.sprintId));
        const ts = query.q ? searchQuery(query.q) : null;
        if (ts) where.push("i.search @@ to_tsquery('simple', " + arg(ts) + ')');
        const rows = (
          await c.query<ItemRow>(
            ITEM_SELECT + ' WHERE ' + where.join(' AND ') + ' ORDER BY i.sequence',
            args,
          )
        ).rows;
        return { body: rows.map(itemJson) };
      }),
  });

  const create = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/projects/:projectId/items',
    summary: 'Create an item; it gets the next number of its project (member)',
    tags: ['items'],
    params: projectParams,
    body: s.object({
      title: s.string({ min: 1, max: 255 }),
      description: s.optional(s.string({ max: 100_000 })),
      stateId: s.optional(uuid),
      assigneeId: s.optional(s.nullable(uuid)),
      estimate: s.optional(s.nullable(s.number({ integer: true, min: 0, max: 1000 }))),
      parentId: s.optional(s.nullable(uuid)),
      labelIds: s.optional(s.array(uuid, { max: 50 })),
      sprintId: s.optional(s.nullable(uuid)),
      rank: s.optional(s.number({ min: -1e12, max: 1e12 })),
      ...planFields,
      agentId: s.optional(s.nullable(uuid)), // [PCODE-246 | S15 | v0.1.0]
      triage: s.optional(s.boolean()), // [PCODE-254 | S15 | v0.1.0] from an outside tool: wait in triage
      typeId: s.optional(s.nullable(uuid)), // [PCODE-257 | S15 | v0.1.0]
      custom: s.optional(s.anyObject()),
    }),
    response: itemOut,
    status: 201,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const p = await requireProject(c, a, params.projectId);
        // [PCODE-181 | S15 | v0.1.0] a token pasted into a new task is revoked at once
        await revokeLeaks(pool, a.workspaceId, [body.title, body.description], {
          foundIn: 'task',
          location: p.key + ': ' + body.title.slice(0, 200),
        });
        if (p.archived_at)
          throw new HttpError(409, 'conflict', 'The project is archived; restore it first');
        const stateId =
          body.stateId ??
          (
            await c.query<{ id: string }>(
              'SELECT id FROM project_states WHERE project_id = $1 ORDER BY position LIMIT 1',
              [p.id],
            )
          ).rows[0]?.id;
        if (!stateId) throw new HttpError(409, 'conflict', 'The project has no states');
        await checkState(c, p.id, stateId);
        if (body.assigneeId) await checkAssignee(c, p.id, body.assigneeId);
        if (body.agentId) await checkAgent(c, body.agentId); // [PCODE-246 | S15 | v0.1.0]
        if (body.parentId) await checkParent(c, p.id, null, body.parentId);
        const labelIds = [...new Set(body.labelIds ?? [])];
        await checkLabels(c, p.id, labelIds);
        if (body.sprintId) await checkSprint(c, p.id, body.sprintId);
        if (body.sprintId) await sprintPolicy(c, p.id, null); // [PCODE-352 | S15 | v0.1.0]
        checkDates(body.startDate, body.dueDate);
        checkPlanExtras(body); // [PCODE-259 | S15 | v0.1.0]
        // the project row is locked until commit: concurrent creates get 1, 2, 3 … without gaps or twins
        const seq = (
          await c.query<{ seq: number }>(
            'UPDATE projects SET next_item_seq = next_item_seq + 1 WHERE id = $1 RETURNING next_item_seq - 1 AS seq',
            [p.id],
          )
        ).rows[0]?.seq;
        const id = (
          await c.query<{ id: string }>(
            // a new item goes to the end of its project's order unless a rank is given
            `INSERT INTO items (workspace_id, project_id, sequence, title, description, state_id, assignee_id, estimate, parent_id, created_by, sprint_id, rank,
                                kind, priority, start_date, due_date, duration_days, percent_done, ready, schedule_mode)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
                     coalesce($12, (SELECT coalesce(max(rank), 0) + 1 FROM items WHERE project_id = $2)),
                     $13, $14, $15, $16, $17, $18, $19, $20) RETURNING id`,
            [
              a.workspaceId,
              p.id,
              seq,
              body.title.trim(),
              body.description ?? '',
              stateId,
              body.assigneeId ?? null,
              body.estimate ?? null,
              body.parentId ?? null,
              a.user.id,
              body.sprintId ?? null,
              body.rank ?? null,
              // [PCODE-165 | S15 | v0.1.0]
              body.kind ?? 'task',
              body.priority ?? 'none',
              body.startDate ?? null,
              body.dueDate ?? null,
              body.kind === 'milestone' ? 0 : (body.durationDays ?? null),
              body.percentDone ?? null,
              body.ready ?? false,
              body.scheduleMode ?? 'auto',
            ],
          )
        ).rows[0]?.id;
        if (!id) throw new Error('item insert returned nothing');
        if (body.agentId)
          await c.query('UPDATE items SET agent_id = $2 WHERE id = $1', [id, body.agentId]);
        if (body.triage) await c.query('UPDATE items SET triage = true WHERE id = $1', [id]); // [PCODE-254 | S15 | v0.1.0]
        // [PCODE-259 | S15 | v0.1.0] the constraint and the pauses
        if (body.constraintType || body.constraintDate || body.splits?.length)
          await c.query(
            'UPDATE items SET constraint_type = $2, constraint_date = $3, splits = $4 WHERE id = $1',
            [
              id,
              body.constraintType ?? 'asap',
              body.constraintDate ?? null,
              JSON.stringify(body.splits ?? []),
            ],
          );
        // [PCODE-257 | S15 | v0.1.0] a type sets the kind to its base kind; fields are checked
        if (body.typeId) {
          const ty = await typeOf(c, p.id, body.typeId);
          await c.query('UPDATE items SET type_id = $2, kind = $3 WHERE id = $1', [
            id,
            body.typeId,
            ty.base_kind,
          ]);
        }
        if (body.custom && Object.keys(body.custom).length) {
          const next = await nextCustom(c, p.id, {}, body.custom);
          await c.query('UPDATE items SET custom = $2 WHERE id = $1', [
            id,
            JSON.stringify(next.custom),
          ]);
        }
        for (const l of labelIds)
          await c.query(
            'INSERT INTO item_labels (workspace_id, item_id, label_id) VALUES ($1, $2, $3)',
            [a.workspaceId, id, l],
          );
        const item = await loadItem(c, id);
        if (!item) throw new Error('item vanished');
        await recordEvent(
          c,
          a.workspaceId,
          {
            actor: actorOf(a),
            verb: 'created',
            object: itemRef(item),
            parent: { type: 'project', id: p.id, label: p.key },
            // [PCODE-246 | S15 | v0.1.0] an agent and labels from the start can start agents, as a later change would
            ...(body.agentId || labelIds.length
              ? {
                  changes: {
                    ...(body.agentId ? { agentId: { from: null, to: body.agentId } } : {}),
                    ...(labelIds.length ? { labelIds: { from: [], to: labelIds } } : {}),
                  },
                }
              : {}),
          },
          { projectId: item.project_id },
        );
        return { status: 201, body: itemJson(item) };
      }),
  });

  const get = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/items/:itemId',
    summary: 'One item',
    tags: ['items'],
    params: itemParams,
    response: itemOut,
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => ({
        body: itemJson((await requireItem(c, a, params.itemId)).item),
      })),
  });

  const update = route({
    method: 'PATCH',
    path: '/api/workspaces/:workspaceId/items/:itemId',
    summary: 'Change an item; only the fields sent change (member)',
    tags: ['items'],
    params: itemParams,
    body: s.object({
      title: s.optional(s.string({ min: 1, max: 255 })),
      description: s.optional(s.string({ max: 100_000 })),
      stateId: s.optional(uuid),
      assigneeId: s.optional(s.nullable(uuid)),
      estimate: s.optional(s.nullable(s.number({ integer: true, min: 0, max: 1000 }))),
      parentId: s.optional(s.nullable(uuid)),
      labelIds: s.optional(s.array(uuid, { max: 50 })),
      sprintId: s.optional(s.nullable(uuid)),
      rank: s.optional(s.number({ min: -1e12, max: 1e12 })),
      ...planFields,
      agentId: s.optional(s.nullable(uuid)), // [PCODE-246 | S15 | v0.1.0]
      // [PCODE-250 | S15 | v0.1.0] the version the edit was made on; If-Match: "3" says the same
      version: s.optional(s.number({ integer: true, min: 1 })),
      // [PCODE-254 | S15 | v0.1.0] why the task is done with entries of the definition of done open
      doneReason: s.optional(s.string({ min: 1, max: 1000 })),
      typeId: s.optional(s.nullable(uuid)), // [PCODE-257 | S15 | v0.1.0]
      custom: s.optional(s.anyObject()),
    }),
    response: itemOut,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const { item, project } = await requireItem(c, a, params.itemId);
        // [PCODE-181 | S15 | v0.1.0] a token pasted into a task is revoked at once
        await revokeLeaks(pool, a.workspaceId, [body.title, body.description], {
          foundIn: 'task',
          location: project.key + '-' + String(item.sequence),
        });
        // lock the row: two writers on one item queue, so every version number is used once
        await c.query('SELECT 1 FROM items WHERE id = $1 FOR UPDATE', [item.id]);
        const current = (await loadItem(c, item.id)) ?? item;
        // [PCODE-250 | S15 | v0.1.0] an edit made on an older version is refused, so nobody overwrites what they never saw
        const ifMatch = /^(?:W\/)?"?(\d+)"?$/.exec((req.headers['if-match'] ?? '').trim());
        const based = body.version ?? (ifMatch ? Number(ifMatch[1]) : undefined);
        if (based !== undefined && based !== current.version) {
          const by = (
            await c.query<{ name: string | null }>(
              "SELECT envelope->'data'->'actor'->>'name' AS name FROM activity_events WHERE object_id = $1 ORDER BY sequence DESC LIMIT 1",
              [current.id],
            )
          ).rows[0]?.name;
          throw new HttpError(
            409,
            'conflict',
            current.ref +
              ' changed since you opened it' +
              (by ? ' (by ' + by + ')' : '') +
              '; it is at version ' +
              String(current.version) +
              ' now. Reload it and make your change again.',
            [{ path: 'body.version', message: String(current.version) }],
          );
        }
        const changes: Record<string, { from: unknown; to: unknown }> = {};
        const set: Record<string, unknown> = {};
        const change = (field: string, column: string, from: unknown, to: unknown): void => {
          if (to !== undefined && to !== from) {
            changes[field] = { from, to };
            set[column] = to;
          }
        };
        change('title', 'title', current.title, body.title?.trim());
        change('description', 'description', current.description, body.description);
        if (body.stateId !== undefined && body.stateId !== current.state_id) {
          const [fromName, toName] = [
            await checkState(c, project.id, current.state_id),
            await checkState(c, project.id, body.stateId),
          ];
          changes['state'] = { from: fromName, to: toName };
          set['state_id'] = body.stateId;
          // [PCODE-254 | S15 | v0.1.0] done with open entries of the definition: only with a reason, which is kept as a comment
          const grp = (
            await c.query<{ grp: string }>('SELECT grp FROM project_states WHERE id = $1', [
              body.stateId,
            ])
          ).rows[0]?.grp;
          if (grp === 'completed') {
            const open = await doneGate(c, project.id, current.checks.done ?? []);
            if (open.length && !body.doneReason?.trim())
              throw new HttpError(
                409,
                'conflict',
                'Not done by the definition yet: ' +
                  open.join(', ') +
                  '. Tick them off, or say why it is done anyway.',
                [{ path: 'body.doneReason', message: 'is needed with open entries' }],
              );
            if (open.length)
              await c.query(
                'INSERT INTO comments (workspace_id, item_id, author_id, body) VALUES ($1, $2, $3, $4)',
                [
                  a.workspaceId,
                  current.id,
                  a.user.id,
                  'Done with ' + open.join(', ') + ' open: ' + (body.doneReason?.trim() ?? ''),
                ],
              );
          }
        }
        if (body.assigneeId !== undefined && body.assigneeId !== current.assignee_id) {
          if (body.assigneeId) await checkAssignee(c, project.id, body.assigneeId);
          change('assigneeId', 'assignee_id', current.assignee_id, body.assigneeId);
        }
        // [PCODE-246 | S15 | v0.1.0] assigning a task to an agent can start it
        if (body.agentId !== undefined && body.agentId !== current.agent_id) {
          if (body.agentId) await checkAgent(c, body.agentId);
          change('agentId', 'agent_id', current.agent_id, body.agentId);
        }
        change('estimate', 'estimate', current.estimate, body.estimate);
        // [PCODE-99 | S15 | v0.1.0] planning: which sprint, and where in the order
        if (body.sprintId !== undefined && body.sprintId !== current.sprint_id) {
          const name = body.sprintId ? await checkSprint(c, project.id, body.sprintId) : null;
          if (body.sprintId) await sprintPolicy(c, project.id, [current.id]); // [PCODE-352 | S15 | v0.1.0]
          const fromName = current.sprint_id
            ? ((
                await c.query<{ name: string }>('SELECT name FROM sprints WHERE id = $1', [
                  current.sprint_id,
                ])
              ).rows[0]?.name ?? 'a removed sprint')
            : 'Backlog';
          changes['sprint'] = { from: fromName, to: name ?? 'Backlog' };
          set['sprint_id'] = body.sprintId;
        }
        change('rank', 'rank', current.rank, body.rank);
        // [PCODE-165 | S15 | v0.1.0] the plan fields
        checkDates(
          body.startDate !== undefined ? body.startDate : current.start_date,
          body.dueDate !== undefined ? body.dueDate : current.due_date,
        );
        change('kind', 'kind', current.kind, body.kind);
        // [PCODE-257 | S15 | v0.1.0] a type brings its base kind; fields are checked against the project's
        if (body.typeId !== undefined && body.typeId !== current.type_id) {
          if (body.typeId) {
            const ty = await typeOf(c, project.id, body.typeId);
            change('kind', 'kind', current.kind, ty.base_kind);
            changes['type'] = { from: current.type_id, to: ty.name };
          } else changes['type'] = { from: current.type_id, to: null };
          set['type_id'] = body.typeId;
        }
        if (body.custom) {
          const next = await nextCustom(c, project.id, current.custom, body.custom);
          if (next.changed.length) {
            set['custom'] = JSON.stringify(next.custom);
            for (const k of next.changed)
              changes['field.' + k] = {
                from: current.custom[k] ?? null,
                to: next.custom[k] ?? null,
              };
          }
        }
        change('priority', 'priority', current.priority, body.priority);
        change('startDate', 'start_date', current.start_date, body.startDate);
        change('dueDate', 'due_date', current.due_date, body.dueDate);
        change(
          'durationDays',
          'duration_days',
          current.duration_days,
          (body.kind ?? current.kind) === 'milestone' ? 0 : body.durationDays,
        );
        change('percentDone', 'percent_done', current.percent_done, body.percentDone);
        change('ready', 'ready', current.ready, body.ready);
        change('scheduleMode', 'schedule_mode', current.schedule_mode, body.scheduleMode);
        // [PCODE-259 | S15 | v0.1.0] the constraint and the pauses
        checkPlanExtras(body);
        change('constraintType', 'constraint_type', current.constraint_type, body.constraintType);
        change('constraintDate', 'constraint_date', current.constraint_date, body.constraintDate);
        if (
          body.splits !== undefined &&
          JSON.stringify(body.splits) !== JSON.stringify(current.splits)
        ) {
          changes['splits'] = { from: current.splits, to: body.splits };
          set['splits'] = JSON.stringify(body.splits);
        }
        if (body.parentId !== undefined && body.parentId !== current.parent_id) {
          if (body.parentId) await checkParent(c, project.id, current.id, body.parentId);
          change('parentId', 'parent_id', current.parent_id, body.parentId);
        }
        if (body.labelIds !== undefined) {
          const next = [...new Set(body.labelIds)].sort();
          if (next.join() !== [...current.label_ids].sort().join()) {
            await checkLabels(c, project.id, next);
            await c.query('DELETE FROM item_labels WHERE item_id = $1', [current.id]);
            for (const l of next)
              await c.query(
                'INSERT INTO item_labels (workspace_id, item_id, label_id) VALUES ($1, $2, $3)',
                [a.workspaceId, current.id, l],
              );
            changes['labelIds'] = { from: current.label_ids, to: next };
          }
        }
        if (Object.keys(changes).length === 0) return { body: itemJson(current) };
        const columns = Object.keys(set);
        await c.query(
          'UPDATE items SET ' +
            [
              ...columns.map((col, i) => col + ' = $' + String(i + 2)),
              'version = version + 1',
              'updated_at = now()',
            ].join(', ') +
            ' WHERE id = $1',
          [current.id, ...columns.map((col) => set[col])],
        );
        const after = await loadItem(c, current.id);
        if (!after) throw new Error('item vanished');
        // a state change is a move on the board; anything else is an update
        const verb: Verb =
          Object.keys(changes).length === 1 && changes['state'] ? 'moved' : 'updated';
        const data: ActivityData = {
          actor: actorOf(a),
          verb,
          object: itemRef(after),
          parent: { type: 'project', id: project.id, label: project.key },
          changes,
        };
        await recordEvent(c, a.workspaceId, data, { projectId: project.id });
        return { body: itemJson(after) };
      }),
  });

  const remove = route({
    method: 'DELETE',
    path: '/api/workspaces/:workspaceId/items/:itemId',
    summary: 'Delete an item and its comments (member); its history stays',
    tags: ['items'],
    params: itemParams,
    response: s.object({ ok: s.literal(true) }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const { item, project } = await requireItem(c, a, params.itemId);
        await c.query('DELETE FROM items WHERE id = $1', [item.id]);
        await recordEvent(
          c,
          a.workspaceId,
          {
            actor: actorOf(a),
            verb: 'deleted',
            object: itemRef(item),
            parent: { type: 'project', id: project.id, label: project.key },
          },
          { projectId: item.project_id },
        );
        return { body: { ok: true as const } };
      }),
  });

  const history = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/items/:itemId/history',
    summary: 'Everything that happened to an item and its comments, oldest first',
    tags: ['items'],
    params: itemParams,
    response: s.array(s.anyObject()),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        const { item } = await requireItem(c, a, params.itemId);
        const rows = (
          await c.query<{ envelope: Record<string, unknown> }>(
            `SELECT envelope FROM activity_events
             WHERE (object_type = 'item' AND object_id = $1) OR (parent_type = 'item' AND parent_id = $1)
             ORDER BY sequence`,
            [item.id],
          )
        ).rows;
        // [PCODE-107 | S15 | v0.1.0] what happened before Orqiva, from an import, in the same shape and
        // before Orqiva's own events (it is older); source names where it came from, sequence 0
        const imported = (
          await c.query<{
            id: string;
            source: string;
            at: Date;
            actor: string;
            verb: string;
            field: string | null;
            old_value: string | null;
            new_value: string | null;
            note: string | null;
          }>(
            'SELECT id, source, at, actor, verb, field, old_value, new_value, note FROM item_history WHERE item_id = $1 ORDER BY at, id',
            [item.id],
          )
        ).rows.map((h) => ({
          specversion: '1.0',
          id: h.id,
          source: '/import/' + h.source,
          type: 'orqiva.item.' + (h.verb === 'created' ? 'created' : 'updated'),
          time: h.at.toISOString(),
          subject: item.id,
          datacontenttype: 'application/json',
          workspaceid: a.workspaceId,
          sequence: 0,
          projectid: item.project_id,
          data: {
            actor: { kind: 'integration', id: h.source, name: h.actor || h.source },
            verb: h.verb === 'created' ? 'created' : 'updated',
            object: { type: 'item', id: item.id },
            ...(h.field ? { changes: { [h.field]: { from: h.old_value, to: h.new_value } } } : {}),
            ...(h.note ? { note: h.note } : {}),
          },
        }));
        return { body: [...imported, ...rows.map((r) => r.envelope)] };
      }),
  });

  // ── comments: guests may take part in the conversation on projects they see ──
  const commentOut = s.object({
    id: s.string(),
    itemId: s.string(),
    authorId: s.nullable(s.string()),
    authorName: s.nullable(s.string()),
    body: s.string(),
    createdAt: s.string(),
    editedAt: s.nullable(s.string()),
    // [PCODE-163 | S15 | v0.1.0] team only, or written for the client too
    visibility: s.string(),
  });
  interface CommentRow {
    id: string;
    item_id: string;
    author_id: string | null;
    author_name: string | null;
    body: string;
    created_at: Date;
    edited_at: Date | null;
    visibility: string;
  }
  const COMMENT_SELECT =
    // [PCODE-107 | S15 | v0.1.0] an imported comment's author without an account here keeps their name
    'SELECT c.id, c.item_id, c.author_id, coalesce(u.name, c.author_label) AS author_name, c.body, c.created_at, c.edited_at, c.visibility FROM comments c LEFT JOIN users u ON u.id = c.author_id';
  const commentJson = (
    r: CommentRow,
  ): {
    id: string;
    itemId: string;
    authorId: string | null;
    authorName: string | null;
    body: string;
    createdAt: string;
    editedAt: string | null;
    visibility: string;
  } => ({
    id: r.id,
    itemId: r.item_id,
    authorId: r.author_id,
    authorName: r.author_name,
    body: r.body,
    createdAt: r.created_at.toISOString(),
    editedAt: r.edited_at ? r.edited_at.toISOString() : null,
    visibility: r.visibility,
  });

  const comments = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/items/:itemId/comments',
    summary: 'The comments on an item, oldest first',
    tags: ['comments'],
    params: itemParams,
    response: s.array(commentOut),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        const { item } = await requireItem(c, a, params.itemId);
        return {
          body: (
            await c.query<CommentRow>(
              COMMENT_SELECT + ' WHERE c.item_id = $1 ORDER BY c.created_at, c.id',
              [item.id],
            )
          ).rows.map(commentJson),
        };
      }),
  });

  const addComment = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/items/:itemId/comments',
    summary: 'Comment on an item (guests too, on projects they see)',
    tags: ['comments'],
    params: itemParams,
    body: s.object({
      body: s.string({ min: 1, max: 20_000 }),
      // [PCODE-163 | S15 | v0.1.0] 'team' by default; a client contact's comment is always for the client
      visibility: s.optional(s.enum(['team', 'client'])),
    }),
    response: commentOut,
    status: 201,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        const { item } = await requireItem(c, a, params.itemId);
        // [PCODE-181 | S15 | v0.1.0] a token pasted into a comment is revoked at once
        await revokeLeaks(pool, a.workspaceId, [body.body], {
          foundIn: 'comment',
          location: 'comment on ' + item.title.slice(0, 200),
        });
        const id = (
          await c.query<{ id: string }>(
            'INSERT INTO comments (workspace_id, item_id, author_id, body, visibility) VALUES ($1, $2, $3, $4, $5) RETURNING id',
            [
              a.workspaceId,
              item.id,
              a.user.id,
              body.body,
              a.clientId ? 'client' : (body.visibility ?? 'team'),
            ],
          )
        ).rows[0]?.id;
        const row = (await c.query<CommentRow>(COMMENT_SELECT + ' WHERE c.id = $1', [id])).rows[0];
        if (!row) throw new Error('comment insert returned nothing');
        await recordEvent(
          c,
          a.workspaceId,
          {
            actor: actorOf(a),
            verb: 'commented',
            object: { type: 'comment', id: row.id },
            parent: itemRef(item),
          },
          { projectId: item.project_id },
        );
        return { status: 201, body: commentJson(row) };
      }),
  });

  const editComment = route({
    method: 'PATCH',
    path: '/api/workspaces/:workspaceId/comments/:commentId',
    summary: 'Edit your own comment',
    tags: ['comments'],
    params: commentParams,
    body: s.object({ body: s.string({ min: 1, max: 20_000 }) }),
    response: commentOut,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        const row = (
          await c.query<CommentRow>(COMMENT_SELECT + ' WHERE c.id = $1', [params.commentId])
        ).rows[0];
        if (!row) throw new HttpError(404, 'not_found', 'Comment not found');
        const { item } = await requireItem(c, a, row.item_id);
        if (row.author_id !== a.user.id)
          throw new HttpError(403, 'forbidden', 'Only its author edits a comment');
        await c.query('UPDATE comments SET body = $2, edited_at = now() WHERE id = $1', [
          row.id,
          body.body,
        ]);
        const after = (await c.query<CommentRow>(COMMENT_SELECT + ' WHERE c.id = $1', [row.id]))
          .rows[0];
        if (!after) throw new Error('comment vanished');
        await recordEvent(
          c,
          a.workspaceId,
          {
            actor: actorOf(a),
            verb: 'updated',
            object: { type: 'comment', id: row.id },
            parent: itemRef(item),
            changes: { body: { from: row.body, to: body.body } },
          },
          { projectId: item.project_id },
        );
        return { body: commentJson(after) };
      }),
  });

  const deleteComment = route({
    method: 'DELETE',
    path: '/api/workspaces/:workspaceId/comments/:commentId',
    summary: 'Delete a comment (its author, or an admin)',
    tags: ['comments'],
    params: commentParams,
    response: s.object({ ok: s.literal(true) }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        const row = (
          await c.query<CommentRow>(COMMENT_SELECT + ' WHERE c.id = $1', [params.commentId])
        ).rows[0];
        if (!row) throw new HttpError(404, 'not_found', 'Comment not found');
        const { item } = await requireItem(c, a, row.item_id);
        if (row.author_id !== a.user.id && !atLeast(a.role, 'admin'))
          throw new HttpError(403, 'forbidden', 'Only its author or an admin deletes a comment');
        await c.query('DELETE FROM comments WHERE id = $1', [row.id]);
        await recordEvent(
          c,
          a.workspaceId,
          {
            actor: actorOf(a),
            verb: 'deleted',
            object: { type: 'comment', id: row.id },
            parent: itemRef(item),
          },
          { projectId: item.project_id },
        );
        return { body: { ok: true as const } };
      }),
  });

  // ── labels: per project ──
  const labelOut = s.object({ id: s.string(), name: s.string(), color: s.string() });
  const labels = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/projects/:projectId/labels',
    summary: 'The labels of a project',
    tags: ['labels'],
    params: projectParams,
    response: s.array(labelOut),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        const p = await requireProject(c, a, params.projectId);
        return {
          body: (
            await c.query<{ id: string; name: string; color: string }>(
              'SELECT id, name, color FROM labels WHERE project_id = $1 ORDER BY lower(name)',
              [p.id],
            )
          ).rows,
        };
      }),
  });

  const addLabel = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/projects/:projectId/labels',
    summary: 'Create a label (member)',
    tags: ['labels'],
    params: projectParams,
    body: s.object({
      name: s.string({ min: 1, max: 60 }),
      color: s.string({ pattern: /^#[0-9a-f]{6}$/ }),
    }),
    response: labelOut,
    status: 201,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const p = await requireProject(c, a, params.projectId);
        try {
          const row = (
            await c.query<{ id: string; name: string; color: string }>(
              'INSERT INTO labels (workspace_id, project_id, name, color) VALUES ($1, $2, $3, $4) RETURNING id, name, color',
              [a.workspaceId, p.id, body.name.trim(), body.color],
            )
          ).rows[0];
          if (!row) throw new Error('label insert returned nothing');
          return { status: 201, body: row };
        } catch (err) {
          if (isUniqueViolation(err))
            throw new HttpError(
              409,
              'conflict',
              'This project already has a label named ' + body.name.trim(),
            );
          throw err;
        }
      }),
  });

  return [
    list,
    create,
    get,
    update,
    remove,
    history,
    comments,
    addComment,
    editComment,
    deleteComment,
    labels,
    addLabel,
  ];
}
