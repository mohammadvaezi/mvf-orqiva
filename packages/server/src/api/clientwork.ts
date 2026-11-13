// ── [PCODE-338 | S15 | v0.1.0] T34.1c Meeting notes and actions into tasks; the team's client overview with health, revenue, activity and people ──
//    Why:  what came of a client meeting: its notes (shared with the client or not) and the action items
//          in them, each a task with one click; and the team's overview of a client: how its projects
//          stand, what it paid and owes, what happened lately, and who works for it.
import { describe, type ActivityEvent } from '@orqiva/shared';
import type { Pool, PoolClient } from 'pg';
import { recordEvent } from '../events/outbox.js';
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s } from '../http/schema.js';
import { actorOf, asMember, requireProject, type Access } from './access.js';
import { portalScope } from './portal.js';
import { clientHealth } from './portalhome.js';
import { createItem } from './testlab.js';

const uuid = s.string({ format: 'uuid' });

/** Action items in notes: "- [ ] Send the spec" and "Action: Send the spec", without what is ticked. */
export function actionsIn(notes: string): string[] {
  const out: string[] = [];
  for (const line of notes.split(/\r?\n/)) {
    const m = /^\s*(?:[-*]\s*\[ \]\s+|(?:action|todo|to do)\s*:\s*)(.+)$/i.exec(line);
    const text = m?.[1]?.trim();
    if (text && !out.includes(text)) out.push(text.slice(0, 500));
  }
  return out;
}

const actionOut = s.object({
  id: s.string(),
  text: s.string(),
  assignee: s.nullable(s.object({ id: s.string(), name: s.string() })),
  dueOn: s.nullable(s.string()),
  item: s.nullable(
    s.object({ id: s.string(), ref: s.string(), state: s.string(), done: s.boolean() }),
  ),
});
const meetingOut = s.object({
  id: s.string(),
  title: s.string(),
  kind: s.string(),
  startsAt: s.string(),
  minutes: s.number({ integer: true }),
  attendees: s.array(s.string()),
  agenda: s.string(),
  notes: s.string(),
  notesShared: s.boolean(),
  notesAt: s.nullable(s.string()),
  actions: s.array(actionOut),
});
interface MeetingRow {
  id: string;
  client_id: string;
  title: string;
  kind: string;
  starts_at: Date;
  minutes: number;
  attendees: string[] | null;
  agenda: string;
  notes: string;
  notes_shared: boolean;
  notes_at: Date | null;
}
const SELECT = `SELECT m.id, m.client_id, m.title, m.kind, m.starts_at, m.minutes, m.agenda, m.notes, m.notes_shared, m.notes_at,
    (SELECT array_agg(u.name ORDER BY u.name) FROM users u WHERE u.id = ANY(m.attendee_ids)) AS attendees
  FROM meetings m`;

async function actionsOf(c: PoolClient, meetingIds: string[]) {
  const rows = (
    await c.query<{
      id: string;
      meeting_id: string;
      text: string;
      assignee_id: string | null;
      assignee: string | null;
      due_on: string | null;
      item_id: string | null;
      ref: string | null;
      state: string | null;
      grp: string | null;
    }>(
      `SELECT a.id, a.meeting_id, a.text, a.assignee_id, u.name AS assignee, a.due_on::text, a.item_id,
              p.key || '-' || i.sequence AS ref, st.name AS state, st.grp
         FROM meeting_actions a LEFT JOIN users u ON u.id = a.assignee_id
         LEFT JOIN items i ON i.id = a.item_id LEFT JOIN projects p ON p.id = i.project_id
         LEFT JOIN project_states st ON st.id = i.state_id
        WHERE a.meeting_id = ANY($1::uuid[]) ORDER BY a.created_at`,
      [meetingIds],
    )
  ).rows;
  const by = new Map<string, Array<ReturnType<typeof one>>>();
  const one = (r: (typeof rows)[number]) => ({
    id: r.id,
    text: r.text,
    assignee: r.assignee_id && r.assignee ? { id: r.assignee_id, name: r.assignee } : null,
    dueOn: r.due_on,
    item:
      r.item_id && r.ref
        ? { id: r.item_id, ref: r.ref, state: r.state ?? '', done: r.grp === 'completed' }
        : null,
  });
  for (const r of rows) by.set(r.meeting_id, [...(by.get(r.meeting_id) ?? []), one(r)]);
  return by;
}

async function meetingsJson(c: PoolClient, rows: MeetingRow[]) {
  const acts = await actionsOf(
    c,
    rows.map((m) => m.id),
  );
  return rows.map((m) => ({
    id: m.id,
    title: m.title,
    kind: m.kind,
    startsAt: m.starts_at.toISOString(),
    minutes: m.minutes,
    attendees: m.attendees ?? [],
    agenda: m.agenda,
    notes: m.notes,
    notesShared: m.notes_shared,
    notesAt: m.notes_at?.toISOString() ?? null,
    actions: acts.get(m.id) ?? [],
  }));
}

async function teamMeeting(c: PoolClient, a: Access, id: string): Promise<MeetingRow> {
  if (a.clientId) throw new HttpError(403, 'forbidden', 'This is the team’s view');
  const m = (await c.query<MeetingRow>(SELECT + " WHERE m.id = $1 AND m.state = 'booked'", [id]))
    .rows[0];
  if (!m) throw new HttpError(404, 'not_found', 'Meeting not found');
  return m;
}

export function clientWorkRoutes(pool: Pool): Route[] {
  const list = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/clients/:clientId/meetings',
    summary:
      'A client’s meetings of the last 90 days and ahead, with notes and action items (member)',
    tags: ['clients'],
    params: s.object({ workspaceId: uuid, clientId: uuid }),
    response: s.array(meetingOut),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        if (a.clientId) throw new HttpError(403, 'forbidden', 'This is the team’s view');
        const rows = (
          await c.query<MeetingRow>(
            SELECT +
              " WHERE m.client_id = $1 AND m.state = 'booked' AND m.starts_at > now() - interval '90 days' ORDER BY m.starts_at DESC",
            [params.clientId],
          )
        ).rows;
        return { body: await meetingsJson(c, rows) };
      }),
  });

  const meetingParams = s.object({ workspaceId: uuid, meetingId: uuid });
  const notes = route({
    method: 'PUT',
    path: '/api/workspaces/:workspaceId/meetings/:meetingId/notes',
    summary:
      'Keep a meeting’s notes; action items in them ("- [ ] …", "Action: …") are added to the meeting (member)',
    tags: ['clients'],
    params: meetingParams,
    body: s.object({ notes: s.string({ max: 50_000 }), shared: s.optional(s.boolean()) }),
    response: meetingOut,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const m = await teamMeeting(c, a, params.meetingId);
        await c.query(
          'UPDATE meetings SET notes = $2, notes_shared = coalesce($3, notes_shared), notes_at = now(), notes_by = $4 WHERE id = $1',
          [m.id, body.notes, body.shared ?? null, a.user.id],
        );
        const have = new Set(
          (
            await c.query<{ text: string }>(
              'SELECT text FROM meeting_actions WHERE meeting_id = $1',
              [m.id],
            )
          ).rows.map((r) => r.text),
        );
        for (const text of actionsIn(body.notes).filter((x) => !have.has(x)))
          await c.query(
            'INSERT INTO meeting_actions (workspace_id, meeting_id, client_id, text, created_by) VALUES ($1, $2, $3, $4, $5)',
            [a.workspaceId, m.id, m.client_id, text, a.user.id],
          );
        const row = (await c.query<MeetingRow>(SELECT + ' WHERE m.id = $1', [m.id])).rows[0];
        if (!row) throw new Error('meeting vanished');
        const [json] = await meetingsJson(c, [row]);
        if (!json) throw new Error('meeting vanished');
        return { body: json };
      }),
  });

  const addAction = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/meetings/:meetingId/actions',
    summary: 'Add an action item to a meeting, with a person and a date (member)',
    tags: ['clients'],
    params: meetingParams,
    body: s.object({
      text: s.string({ min: 1, max: 500 }),
      assigneeId: s.optional(uuid),
      dueOn: s.optional(s.string({ pattern: /^\d{4}-\d{2}-\d{2}$/ })),
    }),
    response: actionOut,
    status: 201,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const m = await teamMeeting(c, a, params.meetingId);
        const id = (
          await c.query<{ id: string }>(
            `INSERT INTO meeting_actions (workspace_id, meeting_id, client_id, text, assignee_id, due_on, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
            [
              a.workspaceId,
              m.id,
              m.client_id,
              body.text.trim(),
              body.assigneeId ?? null,
              body.dueOn ?? null,
              a.user.id,
            ],
          )
        ).rows[0]?.id;
        const act = (await actionsOf(c, [m.id])).get(m.id)?.find((x) => x.id === id);
        if (!act) throw new Error('action vanished');
        return { status: 201, body: act };
      }),
  });

  const actionParams = s.object({ workspaceId: uuid, meetingId: uuid, actionId: uuid });
  const removeAction = route({
    method: 'DELETE',
    path: '/api/workspaces/:workspaceId/meetings/:meetingId/actions/:actionId',
    summary: 'Take an action item off a meeting; a task made from it stays (member)',
    tags: ['clients'],
    params: actionParams,
    response: s.object({ removed: s.boolean() }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const m = await teamMeeting(c, a, params.meetingId);
        const gone = await c.query(
          'DELETE FROM meeting_actions WHERE id = $1 AND meeting_id = $2',
          [params.actionId, m.id],
        );
        return { body: { removed: Boolean(gone.rowCount) } };
      }),
  });

  const toTask = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/meetings/:meetingId/actions/:actionId/task',
    summary:
      'Make an action item a task in one of the client’s projects, with its person and date (member)',
    tags: ['clients'],
    params: actionParams,
    body: s.object({ projectId: uuid }),
    response: actionOut,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const m = await teamMeeting(c, a, params.meetingId);
        const act = (
          await c.query<{
            id: string;
            text: string;
            assignee_id: string | null;
            due_on: string | null;
            item_id: string | null;
          }>(
            'SELECT id, text, assignee_id, due_on::text, item_id FROM meeting_actions WHERE id = $1 AND meeting_id = $2',
            [params.actionId, m.id],
          )
        ).rows[0];
        if (!act) throw new HttpError(404, 'not_found', 'Action item not found');
        if (act.item_id) throw new HttpError(409, 'conflict', 'It is a task already');
        const p = await requireProject(c, a, body.projectId);
        const owner = (
          await c.query<{ client_id: string | null }>(
            'SELECT client_id FROM projects WHERE id = $1',
            [p.id],
          )
        ).rows[0]?.client_id;
        if (owner !== m.client_id)
          throw new HttpError(400, 'invalid_request', 'Choose one of the client’s projects', [
            { path: 'body.projectId', message: 'belongs to another client' },
          ]);
        const item = await createItem(
          c,
          a,
          p.id,
          act.text,
          'From the meeting “' + m.title + '” on ' + m.starts_at.toISOString().slice(0, 10) + '.',
          'task',
          'medium',
        );
        await c.query('UPDATE items SET assignee_id = $2, due_date = $3 WHERE id = $1', [
          item.id,
          act.assignee_id,
          act.due_on,
        ]);
        await c.query('UPDATE meeting_actions SET item_id = $2 WHERE id = $1', [act.id, item.id]);
        await recordEvent(c, a.workspaceId, {
          actor: actorOf(a),
          verb: 'updated',
          object: { type: 'item', id: item.id, label: item.ref + ' ' + act.text },
          changes: { fromMeeting: { from: null, to: m.title } },
        });
        const json = (await actionsOf(c, [m.id])).get(m.id)?.find((x) => x.id === act.id);
        if (!json) throw new Error('action vanished');
        return { body: json };
      }),
  });

  const portalNotes = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/portal/meeting-notes',
    summary:
      'Past meetings with the notes the team shared and what came of the action items (contact)',
    tags: ['portal'],
    params: s.object({ workspaceId: uuid }),
    query: s.object({ clientId: s.optional(uuid) }),
    response: s.array(meetingOut),
    handler: ({ params, query, req }) =>
      portalScope(pool, req, params.workspaceId, query.clientId, async (c, ctx) => {
        const rows = (
          await c.query<MeetingRow>(
            SELECT +
              " WHERE m.client_id = $1 AND m.state = 'booked' AND m.notes_shared AND m.notes <> '' ORDER BY m.starts_at DESC LIMIT 20",
            [ctx.clientId],
          )
        ).rows;
        return { body: await meetingsJson(c, rows) };
      }),
  });

  // ── the team's overview of a client ──
  const overviewOut = s.object({
    health: s.enum(['on-track', 'at-risk', 'critical']),
    projects: s.array(
      s.object({
        id: s.string(),
        key: s.string(),
        health: s.string(),
        reasons: s.array(s.string()),
      }),
    ),
    revenue: s.nullable(
      s.object({
        paid12mCents: s.number({ integer: true }),
        openCents: s.number({ integer: true }),
        overdueCents: s.number({ integer: true }),
      }),
    ),
    activity: s.array(s.object({ at: s.string(), text: s.string() })),
    people: s.array(s.object({ id: s.string(), name: s.string(), hours: s.number() })),
    agents: s.array(s.object({ name: s.string(), runs: s.number({ integer: true }) })),
  });
  const worst = (hs: string[]): 'on-track' | 'at-risk' | 'critical' =>
    hs.includes('critical') ? 'critical' : hs.includes('at-risk') ? 'at-risk' : 'on-track';
  const mayReadMoney = (a: Access): boolean =>
    ['owner', 'admin', 'billing', 'auditor'].includes(a.role);
  const revenueOf = async (c: PoolClient, clientIds: string[]) =>
    new Map(
      (
        await c.query<{ client_id: string; paid: string; open: string; overdue: string }>(
          `SELECT client_id,
                  coalesce(sum(gross_cents) FILTER (WHERE state = 'paid' AND paid_on > current_date - 365), 0) AS paid,
                  coalesce(sum(gross_cents) FILTER (WHERE state = 'sent'), 0) AS open,
                  coalesce(sum(gross_cents) FILTER (WHERE state = 'sent' AND due_on < current_date), 0) AS overdue
             FROM client_invoices WHERE client_id = ANY($1::uuid[]) GROUP BY client_id`,
          [clientIds],
        )
      ).rows.map((r) => [
        r.client_id,
        {
          paid12mCents: Number(r.paid),
          openCents: Number(r.open),
          overdueCents: Number(r.overdue),
        },
      ]),
    );

  const overview = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/clients/:clientId/overview',
    summary:
      'A client at a glance: health of its projects, revenue (billing roles), recent activity, the people and agents working for it (member)',
    tags: ['clients'],
    params: s.object({ workspaceId: uuid, clientId: uuid }),
    response: overviewOut,
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        if (a.clientId) throw new HttpError(403, 'forbidden', 'This is the team’s view');
        const projects = (
          await c.query<{ id: string; key: string }>(
            'SELECT id, key FROM projects WHERE client_id = $1 AND archived_at IS NULL ORDER BY key',
            [params.clientId],
          )
        ).rows;
        const ids = projects.map((p) => p.id);
        const health = await clientHealth(c, ids);
        const events = (
          await c.query<{ envelope: ActivityEvent; time: Date }>(
            `SELECT envelope, time FROM activity_events
              WHERE project_id = ANY($1::text[])
                 OR (object_type = 'client_request' AND object_id IN (SELECT id::text FROM client_requests WHERE client_id = $2))
              ORDER BY time DESC LIMIT 15`,
            [ids, params.clientId],
          )
        ).rows;
        const people = (
          await c.query<{ id: string; name: string; minutes: string }>(
            `SELECT u.id, u.name, sum(e.minutes) AS minutes FROM time_entries e JOIN users u ON u.id = e.user_id
              WHERE e.project_id = ANY($1::uuid[]) AND e.day > current_date - 30
              GROUP BY u.id, u.name ORDER BY sum(e.minutes) DESC LIMIT 20`,
            [ids],
          )
        ).rows;
        const agents = (
          await c.query<{ name: string; runs: string }>(
            `SELECT g.name, count(*) AS runs FROM agent_runs r JOIN agents g ON g.id = r.agent_id
              WHERE r.project_id = ANY($1::uuid[]) AND r.created_at > now() - interval '30 days' AND NOT r.playground
              GROUP BY g.name ORDER BY count(*) DESC`,
            [ids],
          )
        ).rows;
        return {
          body: {
            health: worst([...health.values()].map((h) => h.health)),
            projects: projects.map((p) => ({
              id: p.id,
              key: p.key,
              ...(health.get(p.id) ?? { health: 'on-track', reasons: [] }),
            })),
            revenue: mayReadMoney(a)
              ? ((await revenueOf(c, [params.clientId])).get(params.clientId) ?? {
                  paid12mCents: 0,
                  openCents: 0,
                  overdueCents: 0,
                })
              : null,
            activity: events.map((e) => ({ at: e.time.toISOString(), text: describe(e.envelope) })),
            people: people.map((p) => ({
              id: p.id,
              name: p.name,
              hours: Math.round((Number(p.minutes) / 60) * 10) / 10,
            })),
            agents: agents.map((x) => ({ name: x.name, runs: Number(x.runs) })),
          },
        };
      }),
  });

  const overviews = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/clients-overview',
    summary: 'Each client’s health, and its revenue for the billing roles (member)',
    tags: ['clients'],
    params: s.object({ workspaceId: uuid }),
    response: s.array(
      s.object({
        clientId: s.string(),
        health: s.enum(['on-track', 'at-risk', 'critical']),
        paid12mCents: s.nullable(s.number({ integer: true })),
        openCents: s.nullable(s.number({ integer: true })),
      }),
    ),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        if (a.clientId) throw new HttpError(403, 'forbidden', 'This is the team’s view');
        const rows = (
          await c.query<{ client_id: string; id: string }>(
            'SELECT client_id, id FROM projects WHERE client_id IS NOT NULL AND archived_at IS NULL',
          )
        ).rows;
        const clients = (
          await c.query<{ id: string }>('SELECT id FROM clients WHERE archived_at IS NULL')
        ).rows.map((r) => r.id);
        const health = await clientHealth(
          c,
          rows.map((r) => r.id),
        );
        const money = mayReadMoney(a) ? await revenueOf(c, clients) : null;
        return {
          body: clients.map((id) => ({
            clientId: id,
            health: worst(
              rows
                .filter((r) => r.client_id === id)
                .map((r) => health.get(r.id)?.health ?? 'on-track'),
            ),
            paid12mCents: money ? (money.get(id)?.paid12mCents ?? 0) : null,
            openCents: money ? (money.get(id)?.openCents ?? 0) : null,
          })),
        };
      }),
  });

  return [list, notes, addAction, removeAction, toTask, portalNotes, overview, overviews];
}
