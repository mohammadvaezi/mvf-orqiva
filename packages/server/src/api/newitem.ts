// ── [PCODE-254 | S15 | v0.1.0] T26.3 Flow and backlog: links, WIP limits, warnings, definition of done, triage, templates, recurring tasks ──
//    Why:  one way to make a task outside the task route (from a template, a repeating template, the
//          Planner's proposal): the next number of the project, its first open state, the end of its order,
//          its labels, and the event that says who made it.
import type { Actor } from '@orqiva/shared';
import type { PoolClient } from 'pg';
import { recordEvent } from '../events/outbox.js';
import { HttpError } from '../http/errors.js';

export interface NewTask {
  projectId: string;
  title: string;
  description?: string;
  kind?: string;
  priority?: string;
  estimate?: number | null;
  assigneeId?: string | null;
  sprintId?: string | null;
  labelIds?: readonly string[];
  triage?: boolean;
  createdBy: string | null;
}

export async function createTask(
  c: PoolClient,
  workspaceId: string,
  actor: Actor,
  t: NewTask,
  changes: Record<string, { from: unknown; to: unknown }> = {},
): Promise<{ id: string; ref: string }> {
  const p = (
    await c.query<{ key: string; seq: number }>(
      'UPDATE projects SET next_item_seq = next_item_seq + 1 WHERE id = $1 RETURNING key, next_item_seq - 1 AS seq',
      [t.projectId],
    )
  ).rows[0];
  const state = (
    await c.query<{ id: string }>(
      "SELECT id FROM project_states WHERE project_id = $1 AND grp IN ('unstarted', 'backlog') ORDER BY (grp = 'unstarted') = ($2::uuid IS NOT NULL) DESC, position LIMIT 1",
      [t.projectId, t.sprintId ?? null],
    )
  ).rows[0]?.id;
  if (!p || !state) throw new HttpError(409, 'conflict', 'The project has no open state');
  const id = (
    await c.query<{ id: string }>(
      `INSERT INTO items (workspace_id, project_id, sequence, title, description, state_id, assignee_id, estimate,
                          created_by, sprint_id, rank, kind, priority, triage)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
               (SELECT coalesce(max(rank), 0) + 1 FROM items WHERE project_id = $2), $11, $12, $13)
       RETURNING id`,
      [
        workspaceId,
        t.projectId,
        p.seq,
        t.title.slice(0, 255),
        t.description ?? '',
        state,
        t.assigneeId ?? null,
        t.estimate ?? null,
        t.createdBy,
        t.sprintId ?? null,
        t.kind ?? 'task',
        t.priority ?? 'none',
        t.triage ?? false,
      ],
    )
  ).rows[0]?.id;
  if (!id) throw new Error('task insert returned nothing');
  for (const l of t.labelIds ?? [])
    await c.query(
      'INSERT INTO item_labels (workspace_id, item_id, label_id) SELECT $1, $2, id FROM labels WHERE id = $3 AND project_id = $4',
      [workspaceId, id, l, t.projectId],
    );
  const ref = p.key + '-' + String(p.seq);
  await recordEvent(
    c,
    workspaceId,
    {
      actor,
      verb: 'created',
      object: { type: 'item', id, label: ref + ' ' + t.title },
      parent: { type: 'project', id: t.projectId, label: p.key },
      ...(Object.keys(changes).length ? { changes } : {}),
    },
    { projectId: t.projectId },
  );
  return { id, ref };
}
