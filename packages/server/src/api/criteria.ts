// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-127 | S15 | v0.1.0] Show measured progress on every card from acceptance criteria and subtasks ──
//    Why:  acceptance criteria as a checklist on a task, and the progress every card shows, counted from
//          what can be checked: criteria ticked and subtasks finished (cancelled subtasks do not count).
//          Every change is an item event carrying the new progress, so open boards move their bars at once.
import type { Progress } from '@orqiva/shared';
import type { Pool, PoolClient } from 'pg';
import { recordEvent } from '../events/outbox.js';
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s, type Infer } from '../http/schema.js';
import { actorOf, asMember, requireProject, type Access } from './access.js';

const uuid = s.string({ format: 'uuid' });

const criterionOut = s.object({
  id: s.string(),
  text: s.string(),
  done: s.boolean(),
  doneBy: s.nullable(s.string()),
  doneAt: s.nullable(s.string()),
});
const countOut = s.object({
  done: s.number({ integer: true }),
  total: s.number({ integer: true }),
});
const progressOut = s.object({ itemId: s.string(), criteria: countOut, subtasks: countOut });

interface CriterionRow {
  id: string;
  item_id: string;
  text: string;
  done: boolean;
  done_by_name: string | null;
  done_at: Date | null;
}

const criterionJson = (r: CriterionRow): Infer<typeof criterionOut> => ({
  id: r.id,
  text: r.text,
  done: r.done,
  doneBy: r.done_by_name,
  doneAt: r.done_at?.toISOString() ?? null,
});

interface ItemHead {
  id: string;
  project_id: string;
  label: string;
}

/** The item, if the caller may see its project. */
async function visibleItem(c: PoolClient, a: Access, itemId: string): Promise<ItemHead> {
  const it = (
    await c.query<ItemHead>(
      `SELECT i.id, i.project_id, p.key || '-' || i.sequence || ' ' || i.title AS label
         FROM items i JOIN projects p ON p.id = i.project_id WHERE i.id = $1`,
      [itemId],
    )
  ).rows[0];
  if (!it) throw new HttpError(404, 'not_found', 'Item not found');
  try {
    await requireProject(c, a, it.project_id);
  } catch {
    throw new HttpError(404, 'not_found', 'Item not found');
  }
  return it;
}

const listOf = async (c: PoolClient, itemId: string): Promise<CriterionRow[]> =>
  (
    await c.query<CriterionRow>(
      `SELECT k.id, k.item_id, k.text, k.done, u.name AS done_by_name, k.done_at
         FROM item_criteria k LEFT JOIN users u ON u.id = k.done_by
        WHERE k.item_id = $1 ORDER BY k.position, k.created_at`,
      [itemId],
    )
  ).rows;

/** Criteria and subtasks counted: the one rule for every card and every event. */
export function combined(p: {
  criteria: { done: number; total: number };
  subtasks: { done: number; total: number };
}): Progress {
  const total = p.criteria.total + p.subtasks.total;
  const done = p.criteria.done + p.subtasks.done;
  // subtasks count like criteria: each is one thing that is checkably done
  return { done, total, unit: p.criteria.total ? 'criteria' : 'subtasks' };
}

const PROGRESS_SQL = `
  SELECT i.id AS item_id,
         (SELECT count(*) FILTER (WHERE k.done) FROM item_criteria k WHERE k.item_id = i.id) AS c_done,
         (SELECT count(*) FROM item_criteria k WHERE k.item_id = i.id) AS c_total,
         (SELECT count(*) FILTER (WHERE st.grp = 'completed') FROM items ch JOIN project_states st ON st.id = ch.state_id
           WHERE ch.parent_id = i.id AND st.grp <> 'cancelled') AS s_done,
         (SELECT count(*) FROM items ch JOIN project_states st ON st.id = ch.state_id
           WHERE ch.parent_id = i.id AND st.grp <> 'cancelled') AS s_total
    FROM items i`;

interface ProgressRow {
  item_id: string;
  c_done: string;
  c_total: string;
  s_done: string;
  s_total: string;
}
const progressJson = (r: ProgressRow): Infer<typeof progressOut> => ({
  itemId: r.item_id,
  criteria: { done: Number(r.c_done), total: Number(r.c_total) },
  subtasks: { done: Number(r.s_done), total: Number(r.s_total) },
});

/** Records that the item's criteria changed, with its progress now. */
async function changed(
  c: PoolClient,
  a: Access,
  it: ItemHead,
  change: { from: unknown; to: unknown },
): Promise<void> {
  const row = (await c.query<ProgressRow>(PROGRESS_SQL + ' WHERE i.id = $1', [it.id])).rows[0];
  if (!row) return;
  await recordEvent(
    c,
    a.workspaceId,
    {
      actor: actorOf(a),
      verb: 'progressed',
      object: { type: 'item', id: it.id, label: it.label },
      progress: combined(progressJson(row)),
      changes: { criteria: change },
    },
    { projectId: it.project_id },
  );
}

export function criteriaRoutes(pool: Pool): Route[] {
  const list = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/items/:itemId/criteria',
    summary: 'The task’s acceptance criteria, in order',
    tags: ['items'],
    params: s.object({ workspaceId: uuid, itemId: uuid }),
    response: s.array(criterionOut),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        const it = await visibleItem(c, a, params.itemId);
        return { body: (await listOf(c, it.id)).map(criterionJson) };
      }),
  });

  const add = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/items/:itemId/criteria',
    summary: 'Add an acceptance criterion at the end (member)',
    tags: ['items'],
    params: s.object({ workspaceId: uuid, itemId: uuid }),
    body: s.object({ text: s.string({ min: 1, max: 500 }) }),
    response: s.array(criterionOut),
    status: 201,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const it = await visibleItem(c, a, params.itemId);
        if (!body.text.trim())
          throw new HttpError(400, 'invalid_request', 'Write the criterion', [
            { path: 'body.text', message: 'is empty' },
          ]);
        await c.query(
          `INSERT INTO item_criteria (workspace_id, item_id, position, text)
           VALUES ($1, $2, (SELECT coalesce(max(position), 0) + 1 FROM item_criteria WHERE item_id = $2), $3)`,
          [a.workspaceId, it.id, body.text.trim()],
        );
        await changed(c, a, it, { from: null, to: 'added' });
        return { status: 201, body: (await listOf(c, it.id)).map(criterionJson) };
      }),
  });

  const update = route({
    method: 'PATCH',
    path: '/api/workspaces/:workspaceId/criteria/:criterionId',
    summary: 'Tick, untick or reword a criterion (member)',
    tags: ['items'],
    params: s.object({ workspaceId: uuid, criterionId: uuid }),
    body: s.object({
      text: s.optional(s.string({ min: 1, max: 500 })),
      done: s.optional(s.boolean()),
    }),
    response: s.array(criterionOut),
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const row = (
          await c.query<{ item_id: string; done: boolean }>(
            'SELECT item_id, done FROM item_criteria WHERE id = $1',
            [params.criterionId],
          )
        ).rows[0];
        if (!row) throw new HttpError(404, 'not_found', 'Criterion not found');
        const it = await visibleItem(c, a, row.item_id);
        await c.query(
          `UPDATE item_criteria SET text = coalesce($2, text),
                  done = coalesce($3, done),
                  done_by = CASE WHEN $3 IS NULL THEN done_by WHEN $3 THEN $4::uuid ELSE NULL END,
                  done_at = CASE WHEN $3 IS NULL THEN done_at WHEN $3 THEN coalesce(CASE WHEN done THEN done_at END, now()) ELSE NULL END
            WHERE id = $1`,
          [params.criterionId, body.text?.trim() || null, body.done ?? null, a.user.id],
        );
        if (body.done !== undefined && body.done !== row.done)
          await changed(c, a, it, {
            from: row.done ? 'done' : 'open',
            to: body.done ? 'done' : 'open',
          });
        return { body: (await listOf(c, it.id)).map(criterionJson) };
      }),
  });

  const remove = route({
    method: 'DELETE',
    path: '/api/workspaces/:workspaceId/criteria/:criterionId',
    summary: 'Remove a criterion (member)',
    tags: ['items'],
    params: s.object({ workspaceId: uuid, criterionId: uuid }),
    response: s.array(criterionOut),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const row = (
          await c.query<{ item_id: string }>('SELECT item_id FROM item_criteria WHERE id = $1', [
            params.criterionId,
          ])
        ).rows[0];
        if (!row) throw new HttpError(404, 'not_found', 'Criterion not found');
        const it = await visibleItem(c, a, row.item_id);
        await c.query('DELETE FROM item_criteria WHERE id = $1', [params.criterionId]);
        await changed(c, a, it, { from: 'present', to: 'removed' });
        return { body: (await listOf(c, it.id)).map(criterionJson) };
      }),
  });

  const progress = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/projects/:projectId/progress',
    summary:
      'Measured progress of the project’s tasks that have any: criteria ticked, subtasks finished',
    tags: ['items'],
    params: s.object({ workspaceId: uuid, projectId: uuid }),
    response: s.array(progressOut),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        const p = await requireProject(c, a, params.projectId);
        const rows = (
          await c.query<ProgressRow>(
            `SELECT * FROM (${PROGRESS_SQL} WHERE i.project_id = $1) x WHERE x.c_total > 0 OR x.s_total > 0`,
            [p.id],
          )
        ).rows;
        return { body: rows.map(progressJson) };
      }),
  });

  return [list, add, update, remove, progress];
}
