// ── [PCODE-255 | S15 | v0.1.0] T26.4 Planning details: keys, bulk edit, undo, shared views, item history, Git moves, bug SLAs ──
//    Why:  the small things that save the most time. One request changes many tasks at once and answers with
//          what each was before, so the screen can undo it. Bugs carry a fix time by priority; the ones past it
//          alert once. A branch, a pull request and a merge move their tasks forward to the states the project
//          names, never backwards.
import { slaDue, type Actor, type GitMoves } from '@orqiva/shared';
import type { Pool, PoolClient } from 'pg';
import { inSystem } from '../db/pool.js';
import { recordEvent } from '../events/outbox.js';
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s } from '../http/schema.js';
import { actorOf, asMember, requireProject } from './access.js';
import { doneGate } from './flow.js';
import { settingFor } from './settingvalue.js';

const uuid = s.string({ format: 'uuid' });
const projectParams = s.object({ workspaceId: uuid, projectId: uuid });

/**
 * Moves a task forward to the state named for this Git news (branch, opened, merged); a task already further
 * on, or cancelled, stays. Answers the state's name when it moved.
 */
export async function gitMove(
  c: PoolClient,
  workspaceId: string,
  projectId: string,
  itemId: string,
  news: keyof GitMoves,
  actor: Actor,
): Promise<string | null> {
  const moves = (await settingFor(
    c,
    'git.moves',
    projectId,
    workspaceId,
  )) as Partial<GitMoves> | null;
  const want = (moves?.[news] ?? '').trim();
  if (!want) return null;
  const target = (
    await c.query<{ id: string; name: string; position: number }>(
      'SELECT id, name, position FROM project_states WHERE project_id = $1 AND lower(name) = lower($2)',
      [projectId, want],
    )
  ).rows[0];
  const now = (
    await c.query<{ grp: string; name: string; position: number; ref: string; title: string }>(
      `SELECT st.grp, st.name, st.position, p.key || '-' || i.sequence AS ref, i.title FROM items i
         JOIN project_states st ON st.id = i.state_id JOIN projects p ON p.id = i.project_id WHERE i.id = $1`,
      [itemId],
    )
  ).rows[0];
  // only forward along the board, and never out of done or cancelled
  if (!target || !now || now.grp === 'completed' || now.grp === 'cancelled') return null;
  if (target.position <= now.position) return null;
  await c.query(
    'UPDATE items SET state_id = $2, version = version + 1, updated_at = now() WHERE id = $1',
    [itemId, target.id],
  );
  await recordEvent(
    c,
    workspaceId,
    {
      actor,
      verb: 'moved',
      object: { type: 'item', id: itemId, label: now.ref + ' ' + now.title },
      parent: { type: 'project', id: projectId, label: now.ref.split('-')[0] ?? '' },
      changes: { state: { from: now.name, to: target.name } },
    },
    { projectId },
  );
  return target.name;
}

interface SlaRow {
  id: string;
  ref: string;
  title: string;
  priority: string;
  created_at: Date;
  assignee_id: string | null;
  assignee: string | null;
  project_id: string;
}

/** Open bugs of a project with their fix time. */
async function bugsWithSla(c: PoolClient, projectId: string, workspaceId: string | null = null) {
  const hours = (await settingFor(c, 'planning.bug_sla_hours', projectId, workspaceId)) as Record<
    string,
    unknown
  >;
  const rows = (
    await c.query<SlaRow>(
      `SELECT i.id, p.key || '-' || i.sequence AS ref, i.title, i.priority, i.created_at, i.assignee_id,
              u.name AS assignee, i.project_id
         FROM items i JOIN projects p ON p.id = i.project_id JOIN project_states st ON st.id = i.state_id
         LEFT JOIN users u ON u.id = i.assignee_id
        WHERE i.project_id = $1 AND i.kind = 'bug' AND st.grp NOT IN ('completed', 'cancelled')
        ORDER BY i.created_at`,
      [projectId],
    )
  ).rows;
  return rows
    .map((r) => ({ ...r, due: slaDue(r.created_at.toISOString(), r.priority, hours) }))
    .filter((r): r is SlaRow & { due: string } => r.due !== null);
}

/** Bugs past their fix time alert their assignee (else the admins) once; answers the alerts to send. */
export async function slaBreaches(
  c: PoolClient,
  workspaceId: string,
  now: Date,
): Promise<
  { userIds: string[]; title: string; body: string; itemId: string; projectId: string }[]
> {
  const projects = (
    await c.query<{ id: string }>(
      `SELECT DISTINCT i.project_id AS id FROM items i JOIN project_states st ON st.id = i.state_id
        WHERE i.workspace_id = $1 AND i.kind = 'bug' AND i.sla_alerted_at IS NULL AND st.grp NOT IN ('completed', 'cancelled')`,
      [workspaceId],
    )
  ).rows;
  const admins = (
    await c.query<{ user_id: string }>(
      "SELECT user_id FROM workspace_members WHERE workspace_id = $1 AND role IN ('owner', 'admin') AND suspended_at IS NULL",
      [workspaceId],
    )
  ).rows.map((r) => r.user_id);
  const out: {
    userIds: string[];
    title: string;
    body: string;
    itemId: string;
    projectId: string;
  }[] = [];
  for (const p of projects)
    for (const b of await bugsWithSla(c, p.id, workspaceId)) {
      if (Date.parse(b.due) > now.getTime()) continue;
      const marked = await c.query(
        'UPDATE items SET sla_alerted_at = now() WHERE id = $1 AND sla_alerted_at IS NULL',
        [b.id],
      );
      if (!marked.rowCount) continue;
      out.push({
        userIds: b.assignee_id ? [b.assignee_id] : admins,
        title: 'Bug ' + b.ref + ' is past its fix time',
        body:
          b.title +
          ' (' +
          b.priority +
          ') was due ' +
          b.due.slice(0, 16).replace('T', ' ') +
          ' UTC.',
        itemId: b.id,
        projectId: b.project_id,
      });
    }
  return out;
}

export function detailRoutes(pool: Pool): Route[] {
  const bulk = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/projects/:projectId/items/bulk',
    summary:
      'Change or delete many tasks at once; answers what each was before, to undo it (member)',
    tags: ['items'],
    params: projectParams,
    body: s.object({
      itemIds: s.array(uuid, { min: 1, max: 200 }),
      set: s.optional(
        s.object({
          stateId: s.optional(uuid),
          assigneeId: s.optional(s.nullable(uuid)),
          sprintId: s.optional(s.nullable(uuid)),
          priority: s.optional(s.enum(['urgent', 'high', 'medium', 'low', 'none'])),
          addLabelIds: s.optional(s.array(uuid, { max: 20 })),
          removeLabelIds: s.optional(s.array(uuid, { max: 20 })),
        }),
      ),
      delete: s.optional(s.boolean()),
      doneReason: s.optional(s.string({ min: 1, max: 1000 })),
    }),
    response: s.object({
      updated: s.number({ integer: true }),
      deleted: s.number({ integer: true }),
      before: s.array(s.object({ id: s.string(), fields: s.anyObject() })),
      refused: s.array(s.object({ ref: s.string(), why: s.string() })),
    }),
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const p = await requireProject(c, a, params.projectId);
        const set = body.set ?? {};
        if (!body.delete && !Object.keys(set).length)
          throw new HttpError(400, 'invalid_request', 'Say what to change, or delete');
        const check = async (sql: string, v: unknown, what: string): Promise<void> => {
          if (v && !(await c.query(sql, [v, p.id])).rowCount)
            throw new HttpError(400, 'invalid_request', what + ' is not of this project');
        };
        await check(
          'SELECT 1 FROM project_states WHERE id = $1 AND project_id = $2',
          set.stateId,
          'The state',
        );
        await check(
          'SELECT 1 FROM sprints WHERE id = $1 AND project_id = $2',
          set.sprintId,
          'The sprint',
        );
        for (const l of [...(set.addLabelIds ?? []), ...(set.removeLabelIds ?? [])])
          await check('SELECT 1 FROM labels WHERE id = $1 AND project_id = $2', l, 'A label');
        if (
          set.assigneeId &&
          !(
            await c.query(
              "SELECT 1 FROM workspace_members WHERE user_id = $1 AND (role <> 'guest' OR guest_sees_project($2, $1))",
              [set.assigneeId, p.id],
            )
          ).rowCount
        )
          throw new HttpError(
            400,
            'invalid_request',
            'Only someone who can see the project can be assigned',
          );
        const target = set.stateId
          ? (
              await c.query<{ name: string; grp: string }>(
                'SELECT name, grp FROM project_states WHERE id = $1',
                [set.stateId],
              )
            ).rows[0]
          : undefined;
        const rows = (
          await c.query<{
            id: string;
            ref: string;
            title: string;
            state_id: string;
            state: string;
            assignee_id: string | null;
            sprint_id: string | null;
            priority: string;
            label_ids: string[];
            checks: { done?: string[] };
          }>(
            `SELECT i.id, $2::text || '-' || i.sequence AS ref, i.title, i.state_id, st.name AS state, i.assignee_id,
                    i.sprint_id, i.priority, i.checks,
                    coalesce((SELECT array_agg(l.label_id) FROM item_labels l WHERE l.item_id = i.id), '{}') AS label_ids
               FROM items i JOIN project_states st ON st.id = i.state_id
              WHERE i.id = ANY($1::uuid[]) AND i.project_id = $3 FOR UPDATE OF i`,
            [body.itemIds, p.key, p.id],
          )
        ).rows;
        if (rows.length !== new Set(body.itemIds).size)
          throw new HttpError(400, 'invalid_request', 'Some tasks are not in this project');
        const before: { id: string; fields: Record<string, unknown> }[] = [];
        const refused: { ref: string; why: string }[] = [];
        let updated = 0;
        let deleted = 0;
        for (const r of rows) {
          const label = { type: 'item' as const, id: r.id, label: r.ref + ' ' + r.title };
          if (body.delete) {
            await c.query('DELETE FROM items WHERE id = $1', [r.id]);
            await recordEvent(
              c,
              a.workspaceId,
              {
                actor: actorOf(a),
                verb: 'deleted',
                object: label,
                parent: { type: 'project', id: p.id, label: p.key },
              },
              { projectId: p.id },
            );
            deleted++;
            continue;
          }
          const was: Record<string, unknown> = {};
          const changes: Record<string, { from: unknown; to: unknown }> = {};
          const cols: Record<string, unknown> = {};
          if (set.stateId && set.stateId !== r.state_id && target) {
            if (target.grp === 'completed') {
              const open = await doneGate(c, p.id, r.checks.done ?? []);
              if (open.length && !body.doneReason) {
                refused.push({ ref: r.ref, why: 'not done by the definition: ' + open.join(', ') });
                continue;
              }
            }
            was['stateId'] = r.state_id;
            cols['state_id'] = set.stateId;
            changes['state'] = { from: r.state, to: target.name };
          }
          if (set.assigneeId !== undefined && set.assigneeId !== r.assignee_id) {
            was['assigneeId'] = r.assignee_id;
            cols['assignee_id'] = set.assigneeId;
            changes['assigneeId'] = { from: r.assignee_id, to: set.assigneeId };
          }
          if (set.sprintId !== undefined && set.sprintId !== r.sprint_id) {
            was['sprintId'] = r.sprint_id;
            cols['sprint_id'] = set.sprintId;
            changes['sprintId'] = { from: r.sprint_id, to: set.sprintId };
          }
          if (set.priority && set.priority !== r.priority) {
            was['priority'] = r.priority;
            cols['priority'] = set.priority;
            changes['priority'] = { from: r.priority, to: set.priority };
          }
          const labels = [
            ...new Set(
              [...r.label_ids, ...(set.addLabelIds ?? [])].filter(
                (l) => !(set.removeLabelIds ?? []).includes(l),
              ),
            ),
          ].sort();
          if (labels.join() !== [...r.label_ids].sort().join()) {
            was['labelIds'] = r.label_ids;
            await c.query('DELETE FROM item_labels WHERE item_id = $1', [r.id]);
            for (const l of labels)
              await c.query(
                'INSERT INTO item_labels (workspace_id, item_id, label_id) VALUES ($1, $2, $3)',
                [a.workspaceId, r.id, l],
              );
            changes['labelIds'] = { from: r.label_ids, to: labels };
          }
          if (!Object.keys(changes).length) continue;
          const names = Object.keys(cols);
          await c.query(
            'UPDATE items SET ' +
              [
                ...names.map((n, i) => n + ' = $' + String(i + 2)),
                'version = version + 1',
                'updated_at = now()',
              ].join(', ') +
              ' WHERE id = $1',
            [r.id, ...names.map((n) => cols[n])],
          );
          await recordEvent(
            c,
            a.workspaceId,
            {
              actor: actorOf(a),
              verb: Object.keys(changes).length === 1 && changes['state'] ? 'moved' : 'updated',
              object: label,
              parent: { type: 'project', id: p.id, label: p.key },
              changes: { ...changes, bulk: { from: null, to: rows.length } },
            },
            { projectId: p.id },
          );
          before.push({ id: r.id, fields: was });
          updated++;
        }
        return { body: { updated, deleted, before, refused } };
      }),
  });

  const slas = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/projects/:projectId/bug-slas',
    summary: 'Open bugs with the time left to fix them by their priority (guest)',
    tags: ['planning'],
    params: projectParams,
    response: s.array(
      s.object({
        itemId: s.string(),
        ref: s.string(),
        title: s.string(),
        priority: s.string(),
        dueAt: s.string(),
        overdue: s.boolean(),
        assignee: s.nullable(s.string()),
      }),
    ),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        const p = await requireProject(c, a, params.projectId);
        const now = Date.now();
        return {
          body: (await bugsWithSla(c, p.id)).map((b) => ({
            itemId: b.id,
            ref: b.ref,
            title: b.title,
            priority: b.priority,
            dueAt: b.due,
            overdue: Date.parse(b.due) < now,
            assignee: b.assignee,
          })),
        };
      }),
  });

  return [bulk, slas];
}

/** For the alert round: every workspace's bugs past their fix time. */
export async function slaRound(
  pool: Pool,
  now: Date = new Date(),
): Promise<{ workspaceId: string; alerts: Awaited<ReturnType<typeof slaBreaches>> }[]> {
  return inSystem(pool, async (c) => {
    const spaces = (await c.query<{ id: string }>('SELECT id FROM workspaces')).rows;
    const out: { workspaceId: string; alerts: Awaited<ReturnType<typeof slaBreaches>> }[] = [];
    for (const w of spaces) {
      const alerts = await slaBreaches(c, w.id, now);
      if (alerts.length) out.push({ workspaceId: w.id, alerts });
    }
    return out;
  });
}
