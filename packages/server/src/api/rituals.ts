// ── [PCODE-165 | S15 | v0.1.0] B2.1 Planning and Canvas on the server: plan fields, dependencies, schedule, baselines, scenarios, drafts, retro, workload ──
//    Why:  the sprint's rituals on real data. The review report compares the scope at the start with what
//          was added and what got done, lists the carried tasks and the demo list. The retro board collects
//          what went well, what to improve and the actions, with one vote per person; an action becomes a
//          task of the next planned sprint (or the backlog), linked back to its note. Retro notes stay
//          with the team; clients never see them.
import type { Pool, PoolClient } from 'pg';
import { recordEvent } from '../events/outbox.js';
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s } from '../http/schema.js';
import {
  actorOf,
  asMember,
  atLeast,
  requireProject,
  type Access,
  type ProjectRow,
} from './access.js';

const uuid = s.string({ format: 'uuid' });
const sprintParams = s.object({ workspaceId: uuid, sprintId: uuid });

interface SprintRow {
  id: string;
  project_id: string;
  name: string;
  goal: string;
  goal_met: boolean | null;
  status: string;
  start_date: string | null;
  end_date: string | null;
  scope_snapshot: { itemId: string; estimate: number | null }[] | null;
}

async function sprintOf(
  c: PoolClient,
  a: Access,
  id: string,
): Promise<SprintRow & { project: ProjectRow }> {
  const sp = (
    await c.query<SprintRow>(
      `SELECT id, project_id, name, goal, goal_met, status, start_date::text AS start_date, end_date::text AS end_date, scope_snapshot
         FROM sprints WHERE id = $1`,
      [id],
    )
  ).rows[0];
  if (!sp) throw new HttpError(404, 'not_found', 'Sprint not found');
  try {
    return { ...sp, project: await requireProject(c, a, sp.project_id) };
  } catch {
    throw new HttpError(404, 'not_found', 'Sprint not found');
  }
}

const lineOut = s.object({
  id: s.string(),
  ref: s.string(),
  title: s.string(),
  estimate: s.nullable(s.number({ integer: true })),
  carriedCount: s.number({ integer: true }),
});

interface NoteRow {
  id: string;
  kind: string;
  body: string;
  author_id: string | null;
  author_name: string | null;
  voters: string[];
  item_id: string | null;
  item_ref: string | null;
  created_at: Date;
}
const noteOut = s.object({
  id: s.string(),
  kind: s.string(),
  body: s.string(),
  authorId: s.nullable(s.string()),
  authorName: s.nullable(s.string()),
  votes: s.number({ integer: true }),
  votedByMe: s.boolean(),
  itemId: s.nullable(s.string()),
  itemRef: s.nullable(s.string()),
  createdAt: s.string(),
});
const NOTE_SELECT = `SELECT n.id, n.kind, n.body, n.author_id, u.name AS author_name, n.voters, n.item_id,
       p.key || '-' || i.sequence AS item_ref, n.created_at
  FROM retro_notes n LEFT JOIN users u ON u.id = n.author_id
  LEFT JOIN items i ON i.id = n.item_id LEFT JOIN projects p ON p.id = i.project_id`;
const noteJson = (r: NoteRow, me: string) => ({
  id: r.id,
  kind: r.kind,
  body: r.body,
  authorId: r.author_id,
  authorName: r.author_name,
  votes: r.voters.length,
  votedByMe: r.voters.includes(me),
  itemId: r.item_id,
  itemRef: r.item_ref,
  createdAt: r.created_at.toISOString(),
});

async function noteOf(
  c: PoolClient,
  a: Access,
  id: string,
): Promise<NoteRow & { sprint_id: string; project: ProjectRow }> {
  const n = (
    await c.query<NoteRow & { sprint_id: string; project_id: string }>(
      NOTE_SELECT.replace('SELECT ', 'SELECT n.sprint_id, n.project_id, ') + ' WHERE n.id = $1',
      [id],
    )
  ).rows[0];
  if (!n) throw new HttpError(404, 'not_found', 'Note not found');
  try {
    return { ...n, project: await requireProject(c, a, n.project_id) };
  } catch {
    throw new HttpError(404, 'not_found', 'Note not found');
  }
}

export function ritualRoutes(pool: Pool): Route[] {
  const report = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/sprints/:sprintId/report',
    summary:
      'The sprint review: scope at the start, added and removed work, what got done, carried tasks, the demo list',
    tags: ['sprints'],
    params: sprintParams,
    response: s.object({
      sprint: s.object({
        id: s.string(),
        name: s.string(),
        goal: s.string(),
        goalMet: s.nullable(s.boolean()),
        status: s.string(),
        startDate: s.nullable(s.string()),
        endDate: s.nullable(s.string()),
      }),
      committed: s.object({
        items: s.number({ integer: true }),
        points: s.number({ integer: true }),
      }),
      completed: s.object({
        items: s.number({ integer: true }),
        points: s.number({ integer: true }),
      }),
      added: s.array(lineOut),
      removed: s.array(s.object({ id: s.string(), ref: s.string(), title: s.string() })),
      notDone: s.array(lineOut),
      carried: s.array(lineOut),
      demo: s.array(lineOut),
    }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        const sp = await sprintOf(c, a, params.sprintId);
        const rows = (
          await c.query<{
            id: string;
            ref: string;
            title: string;
            estimate: number | null;
            carried_count: number;
            grp: string;
          }>(
            `SELECT i.id, p.key || '-' || i.sequence AS ref, i.title, i.estimate, i.carried_count, st.grp
               FROM items i JOIN projects p ON p.id = i.project_id JOIN project_states st ON st.id = i.state_id
              WHERE i.sprint_id = $1 ORDER BY i.rank, i.sequence`,
            [sp.id],
          )
        ).rows;
        const snap = sp.scope_snapshot;
        const atStart = new Set((snap ?? []).map((x) => x.itemId));
        const line = (r: (typeof rows)[number]) => ({
          id: r.id,
          ref: r.ref,
          title: r.title,
          estimate: r.estimate,
          carriedCount: r.carried_count,
        });
        const done = rows.filter((r) => r.grp === 'completed');
        const gone = (snap ?? [])
          .map((x) => x.itemId)
          .filter((id) => !rows.some((r) => r.id === id));
        const removed = gone.length
          ? (
              await c.query<{ id: string; ref: string; title: string }>(
                "SELECT i.id, p.key || '-' || i.sequence AS ref, i.title FROM items i JOIN projects p ON p.id = i.project_id WHERE i.id = ANY($1::uuid[])",
                [gone],
              )
            ).rows
          : [];
        return {
          body: {
            sprint: {
              id: sp.id,
              name: sp.name,
              goal: sp.goal,
              goalMet: sp.goal_met,
              status: sp.status,
              startDate: sp.start_date,
              endDate: sp.end_date,
            },
            committed: snap
              ? { items: snap.length, points: snap.reduce((n, x) => n + (x.estimate ?? 0), 0) }
              : { items: rows.length, points: rows.reduce((n, r) => n + (r.estimate ?? 0), 0) },
            completed: {
              items: done.length,
              points: done.reduce((n, r) => n + (r.estimate ?? 0), 0),
            },
            added: snap ? rows.filter((r) => !atStart.has(r.id)).map(line) : [],
            removed,
            notDone: rows.filter((r) => r.grp !== 'completed' && r.grp !== 'cancelled').map(line),
            carried: rows.filter((r) => r.carried_count > 0).map(line),
            demo: done.map(line),
          },
        };
      }),
  });

  const retro = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/sprints/:sprintId/retro',
    summary: 'The retro board of the sprint, most votes first in each column',
    tags: ['sprints'],
    params: sprintParams,
    response: s.array(noteOut),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const sp = await sprintOf(c, a, params.sprintId);
        const rows = (
          await c.query<NoteRow>(
            NOTE_SELECT +
              ' WHERE n.sprint_id = $1 ORDER BY n.kind, cardinality(n.voters) DESC, n.created_at',
            [sp.id],
          )
        ).rows;
        return { body: rows.map((r) => noteJson(r, a.user.id)) };
      }),
  });

  const addNote = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/sprints/:sprintId/retro',
    summary: 'Add a note to the retro board: went well, to improve, or an action (member)',
    tags: ['sprints'],
    params: sprintParams,
    body: s.object({
      kind: s.enum(['well', 'improve', 'action']),
      body: s.string({ min: 1, max: 2000 }),
    }),
    response: noteOut,
    status: 201,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const sp = await sprintOf(c, a, params.sprintId);
        const id = (
          await c.query<{ id: string }>(
            'INSERT INTO retro_notes (workspace_id, project_id, sprint_id, kind, body, author_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
            [a.workspaceId, sp.project_id, sp.id, body.kind, body.body.trim(), a.user.id],
          )
        ).rows[0]?.id;
        const row = (await c.query<NoteRow>(NOTE_SELECT + ' WHERE n.id = $1', [id])).rows[0];
        if (!row) throw new Error('note vanished');
        return { status: 201, body: noteJson(row, a.user.id) };
      }),
  });

  const noteParams = s.object({ workspaceId: uuid, noteId: uuid });
  const vote = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/retro-notes/:noteId/vote',
    summary: 'Vote for a note, or take the vote back (member)',
    tags: ['sprints'],
    params: noteParams,
    response: noteOut,
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const n = await noteOf(c, a, params.noteId);
        await c.query(
          `UPDATE retro_notes SET voters = CASE WHEN $2 = ANY(voters) THEN array_remove(voters, $2) ELSE array_append(voters, $2) END WHERE id = $1`,
          [n.id, a.user.id],
        );
        const row = (await c.query<NoteRow>(NOTE_SELECT + ' WHERE n.id = $1', [n.id])).rows[0];
        if (!row) throw new Error('note vanished');
        return { body: noteJson(row, a.user.id) };
      }),
  });

  const removeNote = route({
    method: 'DELETE',
    path: '/api/workspaces/:workspaceId/retro-notes/:noteId',
    summary: 'Remove a note: its author or an admin',
    tags: ['sprints'],
    params: noteParams,
    response: s.object({ removed: s.boolean() }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const n = await noteOf(c, a, params.noteId);
        if (n.author_id !== a.user.id && !atLeast(a.role, 'admin'))
          throw new HttpError(403, 'forbidden', 'Only its author or an admin removes a note');
        await c.query('DELETE FROM retro_notes WHERE id = $1', [n.id]);
        return { body: { removed: true } };
      }),
  });

  const toTask = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/retro-notes/:noteId/task',
    summary:
      'Make an action a task of the next planned sprint, or of the backlog when none is planned (member)',
    tags: ['sprints'],
    params: noteParams,
    response: noteOut,
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const n = await noteOf(c, a, params.noteId);
        if (n.kind !== 'action')
          throw new HttpError(409, 'conflict', 'Only an action becomes a task');
        if (n.item_id)
          throw new HttpError(
            409,
            'conflict',
            'This action is already ' + (n.item_ref ?? 'a task'),
          );
        if (n.project.archived_at)
          throw new HttpError(409, 'conflict', 'The project is archived; restore it first');
        const next = (
          await c.query<{ id: string; name: string }>(
            "SELECT id, name FROM sprints WHERE project_id = $1 AND status = 'planned' ORDER BY number NULLS LAST, created_at LIMIT 1",
            [n.project.id],
          )
        ).rows[0];
        const state = (
          await c.query<{ id: string }>(
            `SELECT id FROM project_states WHERE project_id = $1 ORDER BY CASE grp WHEN 'unstarted' THEN 0 WHEN 'backlog' THEN 1 ELSE 2 END, position LIMIT 1`,
            [n.project.id],
          )
        ).rows[0];
        if (!state) throw new HttpError(409, 'conflict', 'The project has no states');
        const seq = (
          await c.query<{ seq: number }>(
            'UPDATE projects SET next_item_seq = next_item_seq + 1 WHERE id = $1 RETURNING next_item_seq - 1 AS seq',
            [n.project.id],
          )
        ).rows[0]?.seq;
        const title = n.body.split('\n')[0]?.slice(0, 255) ?? n.body.slice(0, 255);
        const itemId = (
          await c.query<{ id: string }>(
            `INSERT INTO items (workspace_id, project_id, sequence, title, description, state_id, created_by, sprint_id, rank)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, (SELECT coalesce(max(rank), 0) + 1 FROM items WHERE project_id = $2)) RETURNING id`,
            [
              a.workspaceId,
              n.project.id,
              seq,
              title,
              'From the retro of the sprint.\n\n' + n.body,
              state.id,
              a.user.id,
              next?.id ?? null,
            ],
          )
        ).rows[0]?.id;
        if (!itemId) throw new Error('item insert returned nothing');
        await c.query('UPDATE retro_notes SET item_id = $2 WHERE id = $1', [n.id, itemId]);
        await recordEvent(
          c,
          a.workspaceId,
          {
            actor: actorOf(a),
            verb: 'created',
            object: {
              type: 'item',
              id: itemId,
              label: n.project.key + '-' + String(seq) + ' ' + title,
            },
            parent: { type: 'project', id: n.project.id, label: n.project.key },
            changes: { sprint: { from: null, to: next?.name ?? 'Backlog' } },
          },
          { projectId: n.project.id },
        );
        const row = (await c.query<NoteRow>(NOTE_SELECT + ' WHERE n.id = $1', [n.id])).rows[0];
        if (!row) throw new Error('note vanished');
        return { body: noteJson(row, a.user.id) };
      }),
  });

  return [report, retro, addNote, vote, removeNote, toTask];
}
