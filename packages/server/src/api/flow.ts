// ── [PCODE-257 | S15 | v0.1.0] T26.6 Hierarchy: initiatives, custom item types, custom fields ──
// ── [PCODE-254 | S15 | v0.1.0] T26.3 Flow and backlog: links, WIP limits, warnings, definition of done, triage, templates, recurring tasks ──
//    Why:  what keeps work flowing between the backlog and done. Links say how tasks hang together beyond
//          scheduling; a duplicate is closed into its original. A WIP limit per state, and the warnings of a
//          sprint: a task blocked by an open one, due after the sprint ends, waiting on a task outside the
//          sprint, a column over its limit. Each task ticks off the definitions of ready and done. Work from
//          agents and clients waits in triage. Templates make tasks alike; a template can repeat.
import {
  LINK_KINDS,
  linkText,
  nextRepeat,
  openEntries,
  REPEATS,
  type LinkKind,
  type Repeat,
} from '@orqiva/shared';
import type { Pool, PoolClient } from 'pg';
import { inSystem } from '../db/pool.js';
import { recordEvent } from '../events/outbox.js';
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s } from '../http/schema.js';
import { actorOf, asMember, requireProject, type Access } from './access.js';
import { createTask } from './newitem.js';
import { settingFor } from './settingvalue.js';

const uuid = s.string({ format: 'uuid' });
const itemParams = s.object({ workspaceId: uuid, itemId: uuid });
const projectParams = s.object({ workspaceId: uuid, projectId: uuid });

interface ItemRow {
  id: string;
  project_id: string;
  project_key: string;
  ref: string;
  title: string;
  state_grp: string;
  checks: { ready?: string[]; done?: string[] };
  triage: boolean;
}

export async function itemOf(c: PoolClient, a: Access, id: string): Promise<ItemRow> {
  const it = (
    await c.query<ItemRow>(
      `SELECT i.id, i.project_id, p.key AS project_key, p.key || '-' || i.sequence AS ref, i.title,
              st.grp AS state_grp, i.checks, i.triage
         FROM items i JOIN projects p ON p.id = i.project_id JOIN project_states st ON st.id = i.state_id
        WHERE i.id = $1`,
      [id],
    )
  ).rows[0];
  if (!it) throw new HttpError(404, 'not_found', 'Task not found');
  try {
    await requireProject(c, a, it.project_id);
  } catch {
    throw new HttpError(404, 'not_found', 'Task not found');
  }
  return it;
}

const itemEvent = (
  c: PoolClient,
  a: Access,
  it: ItemRow,
  changes: Record<string, { from: unknown; to: unknown }>,
  verb: 'updated' | 'moved' = 'updated',
) =>
  recordEvent(
    c,
    a.workspaceId,
    {
      actor: actorOf(a),
      verb,
      object: { type: 'item', id: it.id, label: it.ref + ' ' + it.title },
      parent: { type: 'project', id: it.project_id, label: it.project_key },
      changes,
    },
    { projectId: it.project_id },
  );

async function comment(c: PoolClient, a: Access, itemId: string, body: string): Promise<void> {
  await c.query(
    'INSERT INTO comments (workspace_id, item_id, author_id, body) VALUES ($1, $2, $3, $4)',
    [a.workspaceId, itemId, a.user.id, body],
  );
}

/** Closes a task: the project's first cancelled state, a new version. */
async function cancel(c: PoolClient, it: ItemRow): Promise<string> {
  const st = (
    await c.query<{ id: string; name: string }>(
      "SELECT id, name FROM project_states WHERE project_id = $1 AND grp = 'cancelled' ORDER BY position LIMIT 1",
      [it.project_id],
    )
  ).rows[0];
  if (!st) throw new HttpError(409, 'conflict', 'The project has no cancelled state');
  await c.query(
    'UPDATE items SET state_id = $2, triage = false, version = version + 1, updated_at = now() WHERE id = $1',
    [it.id, st.id],
  );
  return st.name;
}

async function definition(c: PoolClient, which: 'ready' | 'done', projectId: string) {
  const v = await settingFor(c, 'planning.definition_of_' + which, projectId);
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

/** [PCODE-254 | S15 | v0.1.0] What the task route asks before a task is done: the open entries of the definition. */
export async function doneGate(
  c: PoolClient,
  projectId: string,
  ticked: readonly string[],
): Promise<string[]> {
  if ((await settingFor(c, 'planning.enforce_definition_of_done', projectId)) !== true) return [];
  return openEntries(await definition(c, 'done', projectId), ticked);
}

const linkOut = s.object({
  id: s.string(),
  kind: s.string(),
  outgoing: s.boolean(),
  text: s.string(),
  item: s.object({
    id: s.string(),
    ref: s.string(),
    title: s.string(),
    state: s.string(),
    open: s.boolean(),
  }),
});

async function linksOf(c: PoolClient, itemId: string) {
  const rows = (
    await c.query<{
      id: string;
      kind: LinkKind;
      outgoing: boolean;
      other: string;
      ref: string;
      title: string;
      state: string;
      grp: string;
    }>(
      `SELECT l.id, l.kind, l.from_id = $1 AS outgoing, o.id AS other, p.key || '-' || o.sequence AS ref, o.title,
              st.name AS state, st.grp
         FROM item_links l
         JOIN items o ON o.id = CASE WHEN l.from_id = $1 THEN l.to_id ELSE l.from_id END
         JOIN projects p ON p.id = o.project_id JOIN project_states st ON st.id = o.state_id
        WHERE l.from_id = $1 OR l.to_id = $1
        ORDER BY l.created_at`,
      [itemId],
    )
  ).rows;
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    outgoing: r.outgoing,
    text: linkText(r.kind, r.outgoing),
    item: {
      id: r.other,
      ref: r.ref,
      title: r.title,
      state: r.state,
      open: !['completed', 'cancelled'].includes(r.grp),
    },
  }));
}

/** A task by its id or its reference (HEL-12), in the workspace. */
async function findTask(c: PoolClient, a: Access, ref: string): Promise<ItemRow> {
  const m = /^([A-Za-z][A-Za-z0-9]{1,9})-(\d+)$/.exec(ref.trim());
  const id = m
    ? (
        await c.query<{ id: string }>(
          'SELECT i.id FROM items i JOIN projects p ON p.id = i.project_id WHERE p.key = upper($1) AND i.sequence = $2',
          [m[1], Number(m[2])],
        )
      ).rows[0]?.id
    : /^[0-9a-f-]{36}$/i.test(ref)
      ? ref
      : undefined;
  if (!id) throw new HttpError(404, 'not_found', 'No task ' + ref);
  return itemOf(c, a, id);
}

const templateOut = s.object({
  id: s.string(),
  name: s.string(),
  title: s.string(),
  description: s.string(),
  kind: s.string(),
  priority: s.string(),
  estimate: s.nullable(s.number({ integer: true })),
  labelIds: s.array(s.string()),
  assigneeId: s.nullable(s.string()),
  repeat: s.string(),
  repeatOn: s.nullable(s.number({ integer: true })),
  nextOn: s.nullable(s.string()),
});

interface TemplateRow {
  id: string;
  project_id: string;
  name: string;
  title: string;
  description: string;
  kind: string;
  priority: string;
  estimate: number | null;
  label_ids: string[];
  assignee_id: string | null;
  repeat: Repeat;
  repeat_on: number | null;
  next_on: string | null;
  created_by: string | null;
}
const TEMPLATE_SELECT =
  'SELECT id, project_id, name, title, description, kind, priority, estimate, label_ids, assignee_id, repeat, repeat_on, next_on::text, created_by FROM item_templates';
const templateJson = (t: TemplateRow) => ({
  id: t.id,
  name: t.name,
  title: t.title,
  description: t.description,
  kind: t.kind,
  priority: t.priority,
  estimate: t.estimate,
  labelIds: t.label_ids,
  assigneeId: t.assignee_id,
  repeat: t.repeat,
  repeatOn: t.repeat_on,
  nextOn: t.next_on,
});

const today = (): string => new Date().toISOString().slice(0, 10);

/** Repeating templates whose day has come make their task; answers how many were made. */
export async function recurRound(pool: Pool, now: Date = new Date()): Promise<number> {
  const day = now.toISOString().slice(0, 10);
  return inSystem(pool, async (c) => {
    const due = (
      await c.query<TemplateRow & { workspace_id: string }>(
        TEMPLATE_SELECT.replace('SELECT id,', 'SELECT workspace_id, id,') +
          " WHERE repeat <> 'none' AND next_on <= $1 ORDER BY next_on FOR UPDATE SKIP LOCKED",
        [day],
      )
    ).rows;
    for (const t of due) {
      const made = await createTask(
        c,
        t.workspace_id,
        { kind: 'system', id: 'repeat', name: 'Repeating task' },
        {
          projectId: t.project_id,
          title: t.title,
          description: t.description,
          kind: t.kind,
          priority: t.priority,
          estimate: t.estimate,
          assigneeId: t.assignee_id,
          labelIds: t.label_ids,
          createdBy: t.created_by,
        },
        { template: { from: null, to: t.name } },
      );
      await c.query('UPDATE item_templates SET next_on = $2, last_item_id = $3 WHERE id = $1', [
        t.id,
        nextRepeat(t.repeat, t.repeat_on, day),
        made.id,
      ]);
    }
    return due.length;
  });
}

export function flowRoutes(pool: Pool): Route[] {
  // ── links ──
  const links = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/items/:itemId/links',
    summary: "The task's links: relates to, duplicates, blocks, from either side (guest)",
    tags: ['items'],
    params: itemParams,
    response: s.array(linkOut),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        await itemOf(c, a, params.itemId);
        return { body: await linksOf(c, params.itemId) };
      }),
  });

  const link = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/items/:itemId/links',
    summary: 'Link the task to another: relates to, duplicates or blocks (member)',
    tags: ['items'],
    params: itemParams,
    body: s.object({ to: s.string({ min: 1, max: 60 }), kind: s.enum(LINK_KINDS) }),
    response: s.array(linkOut),
    status: 201,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const from = await itemOf(c, a, params.itemId);
        const to = await findTask(c, a, body.to);
        if (to.id === from.id)
          throw new HttpError(400, 'invalid_request', 'A task does not link to itself');
        if (
          body.kind === 'blocks' &&
          (
            await c.query(
              "SELECT 1 FROM item_links WHERE kind = 'blocks' AND from_id = $1 AND to_id = $2",
              [to.id, from.id],
            )
          ).rowCount
        )
          throw new HttpError(409, 'conflict', to.ref + ' blocks ' + from.ref + ' already');
        await c.query(
          'INSERT INTO item_links (workspace_id, from_id, to_id, kind, created_by) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING',
          [a.workspaceId, from.id, to.id, body.kind, a.user.id],
        );
        await itemEvent(c, a, from, {
          link: { from: null, to: linkText(body.kind, true) + ' ' + to.ref },
        });
        return { status: 201, body: await linksOf(c, from.id) };
      }),
  });

  const unlink = route({
    method: 'DELETE',
    path: '/api/workspaces/:workspaceId/item-links/:linkId',
    summary: 'Remove a link between two tasks (member)',
    tags: ['items'],
    params: s.object({ workspaceId: uuid, linkId: uuid }),
    response: s.object({ ok: s.literal(true) }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const l = (
          await c.query<{ from_id: string; to_id: string; kind: LinkKind }>(
            'SELECT from_id, to_id, kind FROM item_links WHERE id = $1',
            [params.linkId],
          )
        ).rows[0];
        if (!l) throw new HttpError(404, 'not_found', 'Link not found');
        const from = await itemOf(c, a, l.from_id);
        const to = await itemOf(c, a, l.to_id);
        await c.query('DELETE FROM item_links WHERE id = $1', [params.linkId]);
        await itemEvent(c, a, from, {
          link: { from: linkText(l.kind, true) + ' ' + to.ref, to: null },
        });
        return { body: { ok: true as const } };
      }),
  });

  const duplicate = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/items/:itemId/duplicate-of',
    summary: 'Close the task as a duplicate of another; the link stays (member)',
    tags: ['items'],
    params: itemParams,
    body: s.object({ of: s.string({ min: 1, max: 60 }) }),
    response: s.array(linkOut),
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const it = await itemOf(c, a, params.itemId);
        const orig = await findTask(c, a, body.of);
        if (orig.id === it.id)
          throw new HttpError(400, 'invalid_request', 'A task is not its own duplicate');
        await c.query(
          "INSERT INTO item_links (workspace_id, from_id, to_id, kind, created_by) VALUES ($1, $2, $3, 'duplicates', $4) ON CONFLICT DO NOTHING",
          [a.workspaceId, it.id, orig.id, a.user.id],
        );
        const state = await cancel(c, it);
        await comment(c, a, it.id, 'Closed as a duplicate of ' + orig.ref + '.');
        await itemEvent(
          c,
          a,
          it,
          { state: { from: null, to: state }, link: { from: null, to: 'duplicates ' + orig.ref } },
          'moved',
        );
        return { body: await linksOf(c, it.id) };
      }),
  });

  // ── WIP limits and warnings ──
  const wip = route({
    method: 'PUT',
    path: '/api/workspaces/:workspaceId/projects/:projectId/states/:stateId/wip',
    summary: 'Set or clear the most tasks a state may hold (member)',
    tags: ['projects'],
    params: s.object({ workspaceId: uuid, projectId: uuid, stateId: uuid }),
    body: s.object({ limit: s.nullable(s.number({ integer: true, min: 1, max: 999 })) }),
    response: s.object({ stateId: s.string(), wipLimit: s.nullable(s.number({ integer: true })) }),
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const p = await requireProject(c, a, params.projectId);
        const st = (
          await c.query<{ name: string; wip_limit: number | null }>(
            'UPDATE project_states SET wip_limit = $3 WHERE id = $1 AND project_id = $2 RETURNING name, wip_limit',
            [params.stateId, p.id, body.limit],
          )
        ).rows[0];
        if (!st) throw new HttpError(404, 'not_found', 'State not found');
        await recordEvent(
          c,
          a.workspaceId,
          {
            actor: actorOf(a),
            verb: 'updated',
            object: { type: 'project', id: p.id, label: p.key },
            changes: {
              wipLimit: { from: null, to: st.name + ': ' + String(body.limit ?? 'none') },
            },
          },
          { projectId: p.id },
        );
        return { body: { stateId: params.stateId, wipLimit: st.wip_limit } };
      }),
  });

  const warnings = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/projects/:projectId/warnings',
    summary:
      'What holds the flow up: blocked tasks, tasks due after the sprint, waiting on tasks outside it, columns over their WIP limit (guest)',
    tags: ['planning'],
    params: projectParams,
    query: s.object({ sprintId: s.optional(uuid) }),
    response: s.array(
      s.object({
        kind: s.string(),
        itemId: s.nullable(s.string()),
        ref: s.nullable(s.string()),
        stateId: s.nullable(s.string()),
        text: s.string(),
      }),
    ),
    handler: ({ params, query, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        const p = await requireProject(c, a, params.projectId);
        const inScope = query.sprintId ? 'i.sprint_id = $2' : '$2::uuid IS NULL';
        const out: {
          kind: string;
          itemId: string | null;
          ref: string | null;
          stateId: string | null;
          text: string;
        }[] = [];
        const blocked = (
          await c.query<{ id: string; ref: string; by: string }>(
            `SELECT i.id, $3::text || '-' || i.sequence AS ref, string_agg(bp.key || '-' || b.sequence, ', ' ORDER BY b.sequence) AS by
               FROM items i JOIN project_states st ON st.id = i.state_id
               JOIN item_links l ON l.to_id = i.id AND l.kind = 'blocks'
               JOIN items b ON b.id = l.from_id JOIN projects bp ON bp.id = b.project_id
               JOIN project_states bs ON bs.id = b.state_id
              WHERE i.project_id = $1 AND ${inScope} AND st.grp NOT IN ('completed', 'cancelled')
                AND bs.grp NOT IN ('completed', 'cancelled')
              GROUP BY i.id, i.sequence ORDER BY i.sequence`,
            [p.id, query.sprintId ?? null, p.key],
          )
        ).rows;
        for (const b of blocked)
          out.push({
            kind: 'blocked',
            itemId: b.id,
            ref: b.ref,
            stateId: null,
            text: b.ref + ' is blocked by ' + b.by,
          });
        if (query.sprintId) {
          const late = (
            await c.query<{ id: string; ref: string; due: string; ends: string }>(
              `SELECT i.id, $3::text || '-' || i.sequence AS ref, i.due_date::text AS due, s.end_date::text AS ends
                 FROM items i JOIN sprints s ON s.id = i.sprint_id JOIN project_states st ON st.id = i.state_id
                WHERE i.project_id = $1 AND i.sprint_id = $2 AND i.due_date > s.end_date
                  AND st.grp NOT IN ('completed', 'cancelled') ORDER BY i.sequence`,
              [p.id, query.sprintId, p.key],
            )
          ).rows;
          for (const l of late)
            out.push({
              kind: 'due_after_sprint',
              itemId: l.id,
              ref: l.ref,
              stateId: null,
              text: l.ref + ' is due ' + l.due + ', after the sprint ends on ' + l.ends,
            });
          const outside = (
            await c.query<{ id: string; ref: string; on: string }>(
              `SELECT i.id, $3::text || '-' || i.sequence AS ref,
                      string_agg($3::text || '-' || pi.sequence, ', ' ORDER BY pi.sequence) AS on
                 FROM items i JOIN item_dependencies d ON d.successor_id = i.id
                 JOIN items pi ON pi.id = d.predecessor_id JOIN project_states ps ON ps.id = pi.state_id
                WHERE i.project_id = $1 AND i.sprint_id = $2 AND pi.sprint_id IS DISTINCT FROM $2
                  AND ps.grp NOT IN ('completed', 'cancelled')
                GROUP BY i.id, i.sequence ORDER BY i.sequence`,
              [p.id, query.sprintId, p.key],
            )
          ).rows;
          for (const o of outside)
            out.push({
              kind: 'depends_outside',
              itemId: o.id,
              ref: o.ref,
              stateId: null,
              text: o.ref + ' waits for ' + o.on + ', which is not in the sprint',
            });
        }
        const full = (
          await c.query<{ id: string; name: string; n: string; wip_limit: number }>(
            `SELECT st.id, st.name, st.wip_limit, count(i.id) AS n
               FROM project_states st LEFT JOIN items i ON i.state_id = st.id AND ${inScope}
              WHERE st.project_id = $1 AND st.wip_limit IS NOT NULL
              GROUP BY st.id HAVING count(i.id) > st.wip_limit ORDER BY st.position`,
            [p.id, query.sprintId ?? null],
          )
        ).rows;
        for (const f of full)
          out.push({
            kind: 'over_wip',
            itemId: null,
            ref: null,
            stateId: f.id,
            text: f.name + ' holds ' + f.n + ' tasks; its limit is ' + String(f.wip_limit),
          });
        return { body: out };
      }),
  });

  // ── definitions of ready and done ──
  const checks = route({
    method: 'PUT',
    path: '/api/workspaces/:workspaceId/items/:itemId/checks',
    summary:
      'Tick entries of the definition of ready or done on the task; all of ready makes it ready (member)',
    tags: ['items'],
    params: itemParams,
    body: s.object({
      list: s.enum(['ready', 'done']),
      ticked: s.array(s.string({ min: 1, max: 200 }), { max: 50 }),
    }),
    response: s.object({
      ready: s.array(s.string()),
      done: s.array(s.string()),
      definitionOfReady: s.array(s.string()),
      definitionOfDone: s.array(s.string()),
      isReady: s.boolean(),
    }),
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const it = await itemOf(c, a, params.itemId);
        const dor = await definition(c, 'ready', it.project_id);
        const dod = await definition(c, 'done', it.project_id);
        const def = body.list === 'ready' ? dor : dod;
        const unknown = body.ticked.filter((x) => !def.includes(x));
        if (unknown.length)
          throw new HttpError(
            400,
            'invalid_request',
            'Not in the definition: ' + unknown.join(', '),
            [{ path: 'body.ticked', message: 'are entries of the project’s definition' }],
          );
        const next = { ready: it.checks.ready ?? [], done: it.checks.done ?? [] };
        next[body.list] = def.filter((x) => body.ticked.includes(x));
        const isReady = dor.length > 0 && openEntries(dor, next.ready).length === 0;
        await c.query(
          'UPDATE items SET checks = $2, ready = CASE WHEN $3 THEN $4 ELSE ready END, version = version + 1, updated_at = now() WHERE id = $1',
          [it.id, JSON.stringify(next), body.list === 'ready', isReady],
        );
        await itemEvent(c, a, it, {
          ['definitionOf' + (body.list === 'ready' ? 'Ready' : 'Done')]: {
            from: (it.checks[body.list] ?? []).length,
            to: String(next[body.list].length) + ' of ' + String(def.length),
          },
        });
        const now = (
          await c.query<{ ready: boolean }>('SELECT ready FROM items WHERE id = $1', [it.id])
        ).rows[0];
        return {
          body: {
            ...next,
            definitionOfReady: dor,
            definitionOfDone: dod,
            isReady: Boolean(now?.ready),
          },
        };
      }),
  });

  // ── triage ──
  const triageList = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/projects/:projectId/triage',
    summary:
      'Tasks from agents, clients and other tools that wait for a person to take them (guest)',
    tags: ['planning'],
    params: projectParams,
    response: s.array(
      s.object({
        id: s.string(),
        ref: s.string(),
        title: s.string(),
        kind: s.string(),
        createdAt: s.string(),
        createdBy: s.nullable(s.string()),
        source: s.string(),
      }),
    ),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        const p = await requireProject(c, a, params.projectId);
        const rows = (
          await c.query<{
            id: string;
            ref: string;
            title: string;
            kind: string;
            created_at: Date;
            by: string | null;
            source: string | null;
          }>(
            `SELECT i.id, $2::text || '-' || i.sequence AS ref, i.title, i.kind, i.created_at, u.name AS by,
                    (SELECT e.envelope->'data'->'actor'->>'name' FROM activity_events e
                      WHERE e.object_id = i.id::text AND e.type = 'orqiva.item.created' LIMIT 1) AS source
               FROM items i LEFT JOIN users u ON u.id = i.created_by
              WHERE i.project_id = $1 AND i.triage ORDER BY i.created_at`,
            [p.id, p.key],
          )
        ).rows;
        return {
          body: rows.map((r) => ({
            id: r.id,
            ref: r.ref,
            title: r.title,
            kind: r.kind,
            createdAt: r.created_at.toISOString(),
            createdBy: r.by,
            source: r.source ?? r.by ?? 'unknown',
          })),
        };
      }),
  });

  const triage = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/items/:itemId/triage',
    summary: 'Take a task out of triage into the backlog, or decline it with a reason (member)',
    tags: ['planning'],
    params: itemParams,
    body: s.object({
      action: s.enum(['accept', 'decline']),
      reason: s.optional(s.string({ max: 1000 })),
    }),
    response: s.object({ ok: s.literal(true), state: s.string() }),
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const it = await itemOf(c, a, params.itemId);
        if (!it.triage) throw new HttpError(409, 'conflict', it.ref + ' is not in triage');
        if (body.action === 'accept') {
          await c.query(
            'UPDATE items SET triage = false, version = version + 1, updated_at = now() WHERE id = $1',
            [it.id],
          );
          await itemEvent(c, a, it, { triage: { from: 'waiting', to: 'accepted' } });
          return { body: { ok: true as const, state: 'backlog' } };
        }
        const state = await cancel(c, it);
        if (body.reason?.trim())
          await comment(c, a, it.id, 'Declined in triage: ' + body.reason.trim());
        await itemEvent(
          c,
          a,
          it,
          { triage: { from: 'waiting', to: 'declined' }, state: { from: null, to: state } },
          'moved',
        );
        return { body: { ok: true as const, state } };
      }),
  });

  // ── templates ──
  const templateBody = {
    name: s.string({ min: 1, max: 80 }),
    title: s.string({ min: 1, max: 255 }),
    description: s.optional(s.string({ max: 20_000 })),
    kind: s.optional(s.enum(['initiative', 'epic', 'story', 'task', 'bug', 'spike', 'milestone'])), // [PCODE-257 | S15 | v0.1.0]
    priority: s.optional(s.enum(['urgent', 'high', 'medium', 'low', 'none'])),
    estimate: s.optional(s.nullable(s.number({ integer: true, min: 0, max: 1000 }))),
    labelIds: s.optional(s.array(uuid, { max: 20 })),
    assigneeId: s.optional(s.nullable(uuid)),
    repeat: s.optional(s.enum(REPEATS)),
    repeatOn: s.optional(s.nullable(s.number({ integer: true, min: 1, max: 28 }))),
  };
  const checkRepeat = (repeat: Repeat, on: number | null | undefined): void => {
    if (repeat === 'weekly' && (!on || on > 7))
      throw new HttpError(
        400,
        'invalid_request',
        'A weekly task names its weekday, 1 (Monday) to 7',
        [{ path: 'body.repeatOn', message: 'is a weekday from 1 to 7' }],
      );
    if (repeat === 'monthly' && !on)
      throw new HttpError(400, 'invalid_request', 'A monthly task names its day, 1 to 28', [
        { path: 'body.repeatOn', message: 'is a day from 1 to 28' },
      ]);
  };

  const templates = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/projects/:projectId/templates',
    summary: "The project's task templates, and which repeat (guest)",
    tags: ['planning'],
    params: projectParams,
    response: s.array(templateOut),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        const p = await requireProject(c, a, params.projectId);
        const rows = (
          await c.query<TemplateRow>(TEMPLATE_SELECT + ' WHERE project_id = $1 ORDER BY name', [
            p.id,
          ])
        ).rows;
        return { body: rows.map(templateJson) };
      }),
  });

  const addTemplate = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/projects/:projectId/templates',
    summary: 'A template for tasks of the project; it may repeat daily, weekly or monthly (member)',
    tags: ['planning'],
    params: projectParams,
    body: s.object(templateBody),
    response: templateOut,
    status: 201,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const p = await requireProject(c, a, params.projectId);
        const repeat = body.repeat ?? 'none';
        checkRepeat(repeat, body.repeatOn);
        let row: TemplateRow | undefined;
        try {
          row = (
            await c.query<TemplateRow>(
              `INSERT INTO item_templates (workspace_id, project_id, name, title, description, kind, priority, estimate,
                                           label_ids, assignee_id, repeat, repeat_on, next_on, created_by)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
               RETURNING id, project_id, name, title, description, kind, priority, estimate, label_ids, assignee_id,
                         repeat, repeat_on, next_on::text, created_by`,
              [
                a.workspaceId,
                p.id,
                body.name.trim(),
                body.title.trim(),
                body.description ?? '',
                body.kind ?? 'task',
                body.priority ?? 'none',
                body.estimate ?? null,
                body.labelIds ?? [],
                body.assigneeId ?? null,
                repeat,
                body.repeatOn ?? null,
                // the first task comes on the first matching day after today
                nextRepeat(repeat, body.repeatOn ?? null, today()),
                a.user.id,
              ],
            )
          ).rows[0];
        } catch (e) {
          if ((e as { code?: string }).code === '23505')
            throw new HttpError(409, 'conflict', 'A template with this name exists already');
          throw e;
        }
        if (!row) throw new Error('template insert returned nothing');
        return { status: 201, body: templateJson(row) };
      }),
  });

  const dropTemplate = route({
    method: 'DELETE',
    path: '/api/workspaces/:workspaceId/templates/:templateId',
    summary: 'Remove a template; tasks made from it stay (member)',
    tags: ['planning'],
    params: s.object({ workspaceId: uuid, templateId: uuid }),
    response: s.object({ ok: s.literal(true) }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const t = (
          await c.query<TemplateRow>(TEMPLATE_SELECT + ' WHERE id = $1', [params.templateId])
        ).rows[0];
        if (!t) throw new HttpError(404, 'not_found', 'Template not found');
        await requireProject(c, a, t.project_id);
        await c.query('DELETE FROM item_templates WHERE id = $1', [t.id]);
        return { body: { ok: true as const } };
      }),
  });

  const useTemplate = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/templates/:templateId/use',
    summary: 'Make a task from the template, into the backlog or a sprint (member)',
    tags: ['planning'],
    params: s.object({ workspaceId: uuid, templateId: uuid }),
    body: s.optional(
      s.object({ sprintId: s.optional(uuid), title: s.optional(s.string({ min: 1, max: 255 })) }),
    ),
    response: s.object({ id: s.string(), ref: s.string() }),
    status: 201,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const t = (
          await c.query<TemplateRow>(TEMPLATE_SELECT + ' WHERE id = $1', [params.templateId])
        ).rows[0];
        if (!t) throw new HttpError(404, 'not_found', 'Template not found');
        await requireProject(c, a, t.project_id);
        if (
          body?.sprintId &&
          !(
            await c.query('SELECT 1 FROM sprints WHERE id = $1 AND project_id = $2', [
              body.sprintId,
              t.project_id,
            ])
          ).rowCount
        )
          throw new HttpError(400, 'invalid_request', 'The sprint is not in this project');
        const made = await createTask(
          c,
          a.workspaceId,
          actorOf(a),
          {
            projectId: t.project_id,
            title: body?.title?.trim() ?? t.title,
            description: t.description,
            kind: t.kind,
            priority: t.priority,
            estimate: t.estimate,
            assigneeId: t.assignee_id,
            labelIds: t.label_ids,
            sprintId: body?.sprintId ?? null,
            createdBy: a.user.id,
          },
          { template: { from: null, to: t.name } },
        );
        return { status: 201, body: made };
      }),
  });

  return [
    links,
    link,
    unlink,
    duplicate,
    wip,
    warnings,
    checks,
    triageList,
    triage,
    templates,
    addTemplate,
    dropTemplate,
    useTemplate,
  ];
}
