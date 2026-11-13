// ── [PCODE-462 | S15 | v0.1.0] Tasks run in plan order, finish by themselves, and show the same state in VS Code and the portal ──
//    Why:  a plan is an order: MARK-3 builds on MARK-2. A task waits for the tasks it depends on (finish to
//          start) until they are finished - in Review, Test, Done or Cancelled, because "finished" is when
//          the developer (or Claude) hands it on. Starting the first task of a sprint that is still planned
//          starts that sprint, and the sprint before it is completed when everything in it is finished, so
//          the portal's sprint follows the work instead of waiting for someone to press Start.
import type { PoolClient } from 'pg';
import { recordEvent } from '../events/outbox.js';
import { actorOf, type Access } from './access.js';

/** A task's state counts as finished: handed on for checking, done or dropped. */
export const FINISHED_SQL = `(ps.grp IN ('completed', 'cancelled') OR lower(ps.name) IN ('review', 'test'))`;

export interface Waiting {
  ref: string;
  title: string;
}

/** The unfinished tasks this one waits for, in their order. */
export async function waitingFor(c: PoolClient, itemId: string): Promise<Waiting[]> {
  return (
    await c.query<Waiting>(
      `SELECT p.key || '-' || pi.sequence AS ref, pi.title
         FROM item_dependencies d
         JOIN items pi ON pi.id = d.predecessor_id
         JOIN projects p ON p.id = pi.project_id
         JOIN project_states ps ON ps.id = pi.state_id
        WHERE d.successor_id = $1 AND d.kind = 'FS' AND NOT ${FINISHED_SQL}
        ORDER BY pi.sequence`,
      [itemId],
    )
  ).rows;
}

export function waitMessage(ref: string, w: Waiting[]): string {
  const first = w[0];
  if (!first) return '';
  return (
    ref +
    ' waits for ' +
    w.map((x) => x.ref).join(', ') +
    ' (' +
    first.title +
    (w.length > 1 ? ', …' : '') +
    '). Finish ' +
    (w.length > 1 ? 'those' : first.ref) +
    ' first.'
  );
}

interface SprintRow {
  id: string;
  name: string;
  status: string;
  project_id: string;
  project_key: string;
}

async function sprintEvent(
  c: PoolClient,
  a: Access,
  s: SprintRow,
  verb: 'started' | 'completed',
): Promise<void> {
  await recordEvent(
    c,
    a.workspaceId,
    {
      actor: actorOf(a),
      verb,
      object: { type: 'sprint', id: s.id, label: s.name },
      parent: { type: 'project', id: s.project_id, label: s.project_key },
    },
    { projectId: s.project_id },
  );
}

// ── [PCODE-462 | S15 | v0.1.0] the sprint follows the work: started with its first task ──
export async function startSprintWithTask(
  c: PoolClient,
  a: Access,
  sprintId: string | null,
): Promise<void> {
  if (!sprintId) return;
  const sp = (
    await c.query<SprintRow>(
      `SELECT s.id, s.name, s.status, s.project_id, p.key AS project_key
         FROM sprints s JOIN projects p ON p.id = s.project_id WHERE s.id = $1`,
      [sprintId],
    )
  ).rows[0];
  if (!sp || sp.status !== 'planned') return;
  const active = (
    await c.query<SprintRow & { open: number }>(
      `SELECT s.id, s.name, s.status, s.project_id, p.key AS project_key,
              (SELECT count(*)::int FROM items i JOIN project_states ps ON ps.id = i.state_id
                WHERE i.sprint_id = s.id AND NOT ${FINISHED_SQL}) AS open
         FROM sprints s JOIN projects p ON p.id = s.project_id
        WHERE s.project_id = $1 AND s.status = 'active'`,
      [sp.project_id],
    )
  ).rows[0];
  if (active) {
    // the sprint before still has work: this task runs early, the sprints stay as they are
    if (active.open > 0) return;
    await c.query(
      "UPDATE sprints SET status = 'completed', completed_at = now(), end_date = coalesce(end_date, current_date), goal_met = true WHERE id = $1",
      [active.id],
    );
    await sprintEvent(c, a, active, 'completed');
  }
  await c.query(
    `UPDATE sprints SET status = 'active', started_at = now(), start_date = coalesce(start_date, current_date),
            scope_snapshot = (SELECT coalesce(jsonb_agg(jsonb_build_object('itemId', i.id::text, 'estimate', i.estimate)), '[]'::jsonb)
                                FROM items i WHERE i.sprint_id = $1)
      WHERE id = $1`,
    [sp.id],
  );
  await sprintEvent(c, a, sp, 'started');
}
