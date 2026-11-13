// ── [PCODE-348 | S15 | v0.1.0] T35.2a Integrations hub; email-in for replies to messages and ideas by email ──
// ── [PCODE-234 | S15 | v0.1.0] T23.1 Messaging core on the server: channels, direct messages, threads, mentions, live delivery ──
//    Why:  the team's conversations inside Orqiva (owner decision, 11 Oct 2026: no reliance on Slack or
//          Teams). Channels for the workspace, a project or a client, private channels, direct and group
//          messages; threads, edits, deletes, reactions, mentions, files; read state and unread counts;
//          search; a message becomes a task. Who sees a channel is one SQL function (sees_channel, migration
//          0069), used by every query here and by the live gateway. A change is announced on the chat
//          channel of PostgreSQL NOTIFY inside the same transaction, so the gateway on every node tells the
//          people who may see it once it is committed. Mentions and direct messages reach the inbox and the
//          phone without passing through the activity feed.
import type { IncomingMessage } from 'node:http';
import type { Pool, PoolClient } from 'pg';
import {
  channelName,
  dmKey,
  mentionsIn,
  messagePreview,
  REACTIONS,
  type ChannelJson,
  type MessageJson,
} from '@orqiva/shared';
import { recordEvent } from '../events/outbox.js';
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s } from '../http/schema.js';
import { noticeNow, PUSH_SUBJECT, type PushDeps } from '../push/dispatch.js';
import { actorOf, asMember, atLeast, isUniqueViolation, type Access } from './access.js';

/** The NOTIFY channel the gateway listens on. */
export const CHAT_CHANNEL = 'orqiva_chat';

/** What a node hears: enough to load the change and decide who may see it. */
export interface ChatWire {
  ws: string;
  op: 'message' | 'updated' | 'channel';
  channelId: string;
  messageId?: string;
}

const uuid = s.string({ format: 'uuid' });
const wsParams = s.object({ workspaceId: uuid });
const channelParams = s.object({ workspaceId: uuid, channelId: uuid });
const messageParams = s.object({ workspaceId: uuid, messageId: uuid });
const PAGE = 50;

export interface ChannelRow {
  id: string;
  kind: 'channel' | 'direct';
  name: string | null;
  topic: string;
  project_id: string | null;
  client_id: string | null;
  private: boolean;
  created_by: string | null;
  last_message_at: Date | null;
  archived_at: Date | null;
}

/** A message as stored, with its author's name and who reacted how. */
export interface MessageRow {
  id: string;
  channel_id: string;
  parent_id: string | null;
  author_id: string | null;
  author_name: string | null;
  body: string;
  file_ids: string[];
  files: { id: string; name: string; mime: string; sizeBytes: number }[];
  item_id: string | null;
  reply_count: number;
  last_reply_at: Date | null;
  created_at: Date;
  edited_at: Date | null;
  deleted_at: Date | null;
  reactions: { emoji: string; userIds: string[] }[];
}

const MESSAGE_SELECT = `SELECT m.id, m.channel_id, m.parent_id, m.author_id, u.name AS author_name, m.body, m.file_ids,
       m.item_id, m.reply_count, m.last_reply_at, m.created_at, m.edited_at, m.deleted_at,
       -- [PCODE-235 | S15 | v0.1.0] the attached files, to show them
       coalesce((SELECT json_agg(json_build_object('id', f.id, 'name', f.name, 'mime', f.mime, 'sizeBytes', f.size_bytes)
                                 ORDER BY array_position(m.file_ids, f.id))
                   FROM files f WHERE f.id = ANY (m.file_ids)), '[]'::json) AS files,
       coalesce((SELECT json_agg(json_build_object('emoji', r.emoji, 'userIds', r.users) ORDER BY r.first)
                   FROM (SELECT emoji, array_agg(user_id::text ORDER BY created_at) AS users, min(created_at) AS first
                           FROM message_reactions WHERE message_id = m.id GROUP BY emoji) r), '[]'::json) AS reactions
  FROM messages m LEFT JOIN users u ON u.id = m.author_id`;

/** A message for one reader: their own reactions marked, a deleted message's content gone. */
export function messageJson(r: MessageRow, readerId: string): MessageJson {
  const deleted = r.deleted_at !== null;
  return {
    id: r.id,
    channelId: r.channel_id,
    parentId: r.parent_id,
    author: r.author_id ? { id: r.author_id, name: r.author_name ?? 'Someone' } : null,
    body: deleted ? '' : r.body,
    fileIds: deleted ? [] : r.file_ids,
    files: deleted ? [] : r.files,
    itemId: r.item_id,
    replyCount: r.reply_count,
    lastReplyAt: r.last_reply_at?.toISOString() ?? null,
    reactions: deleted
      ? []
      : r.reactions.map((x) => ({
          emoji: x.emoji,
          count: x.userIds.length,
          mine: x.userIds.includes(readerId),
        })),
    createdAt: r.created_at.toISOString(),
    editedAt: r.edited_at?.toISOString() ?? null,
    deleted,
  };
}

export async function loadMessage(c: PoolClient, id: string): Promise<MessageRow | undefined> {
  return (await c.query<MessageRow>(MESSAGE_SELECT + ' WHERE m.id = $1', [id])).rows[0];
}

const announce = (c: PoolClient, wire: ChatWire): Promise<unknown> =>
  c.query('SELECT pg_notify($1, $2)', [CHAT_CHANNEL, JSON.stringify(wire)]);

/** A channel the caller may see, or 404 (a channel they may not see does not exist for them). */
async function visibleChannel(c: PoolClient, a: Access, id: string): Promise<ChannelRow> {
  const ch = (
    await c.query<ChannelRow>(
      'SELECT c.* FROM channels c WHERE c.id = $1 AND sees_channel(c, $2, $3)',
      [id, a.user.id, a.role],
    )
  ).rows[0];
  if (!ch) throw new HttpError(404, 'not_found', 'Conversation not found');
  return ch;
}

async function joined(c: PoolClient, channelId: string, userId: string): Promise<boolean> {
  return (
    (
      await c.query('SELECT 1 FROM channel_members WHERE channel_id = $1 AND user_id = $2', [
        channelId,
        userId,
      ])
    ).rowCount === 1
  );
}

async function join(c: PoolClient, a: Access, channelId: string, userId: string): Promise<void> {
  await c.query(
    `INSERT INTO channel_members (channel_id, workspace_id, user_id) VALUES ($1, $2, $3)
     ON CONFLICT (channel_id, user_id) DO NOTHING`,
    [channelId, a.workspaceId, userId],
  );
}

/** The channels a person sees, with their state for that person; one channel when `id` is given. */
async function channelList(
  c: PoolClient,
  a: Access,
  opts: { id?: string; archived?: boolean } = {},
): Promise<ChannelJson[]> {
  const rows = (
    await c.query<
      ChannelRow & {
        joined: boolean;
        muted: boolean;
        unread: string;
        mentioned: boolean;
        members: { id: string; name: string }[] | null;
      }
    >(
      `SELECT c.*, cm.user_id IS NOT NULL AS joined, coalesce(cm.muted, false) AS muted,
              (SELECT count(*) FROM messages m
                WHERE m.channel_id = c.id AND m.deleted_at IS NULL AND m.parent_id IS NULL
                  AND m.author_id IS DISTINCT FROM $1 AND m.created_at > cm.last_read_at) AS unread,
              EXISTS (SELECT 1 FROM message_mentions mm JOIN messages m ON m.id = mm.message_id
                       WHERE mm.user_id = $1 AND m.channel_id = c.id AND m.deleted_at IS NULL
                         AND m.created_at > cm.last_read_at) AS mentioned,
              CASE WHEN c.private OR c.kind = 'direct' THEN
                (SELECT json_agg(json_build_object('id', u.id, 'name', u.name) ORDER BY u.name)
                   FROM channel_members x JOIN users u ON u.id = x.user_id WHERE x.channel_id = c.id)
              END AS members
         FROM channels c
         LEFT JOIN channel_members cm ON cm.channel_id = c.id AND cm.user_id = $1
        WHERE sees_channel(c, $1, $2)
          AND ($3::uuid IS NULL OR c.id = $3)
          AND ($4 OR c.archived_at IS NULL OR c.id = $3)
        ORDER BY c.kind, c.name, c.last_message_at DESC NULLS LAST`,
      [a.user.id, a.role, opts.id ?? null, opts.archived ?? false],
    )
  ).rows;
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    name: r.name,
    topic: r.topic,
    projectId: r.project_id,
    clientId: r.client_id,
    private: r.private,
    members: r.members ?? [],
    joined: r.joined,
    muted: r.muted,
    unread: Number(r.unread),
    mentioned: r.mentioned,
    lastMessageAt: r.last_message_at?.toISOString() ?? null,
    archived: r.archived_at !== null,
  }));
}

async function oneChannel(c: PoolClient, a: Access, id: string): Promise<ChannelJson> {
  const ch = (await channelList(c, a, { id, archived: true }))[0];
  if (!ch) throw new HttpError(404, 'not_found', 'Conversation not found');
  return ch;
}

/** People of the workspace who could be added to or mentioned in a channel (not client contacts' DMs). */
async function workspacePeople(
  c: PoolClient,
): Promise<{ id: string; name: string; email: string; role: string }[]> {
  return (
    await c.query<{ id: string; name: string; email: string; role: string }>(
      `SELECT u.id, u.name, u.email, m.role FROM workspace_members m JOIN users u ON u.id = m.user_id
        WHERE m.suspended_at IS NULL`,
    )
  ).rows;
}

const person = s.object({ id: s.string(), name: s.string() });
const channelOut = s.object({
  id: s.string(),
  kind: s.enum(['channel', 'direct']),
  name: s.nullable(s.string()),
  topic: s.string(),
  projectId: s.nullable(s.string()),
  clientId: s.nullable(s.string()),
  private: s.boolean(),
  members: s.array(person),
  joined: s.boolean(),
  muted: s.boolean(),
  unread: s.number({ integer: true }),
  mentioned: s.boolean(),
  lastMessageAt: s.nullable(s.string()),
  archived: s.boolean(),
});
const messageOut = s.object({
  id: s.string(),
  channelId: s.string(),
  parentId: s.nullable(s.string()),
  author: s.nullable(person),
  body: s.string(),
  fileIds: s.array(s.string()),
  files: s.array(
    s.object({
      id: s.string(),
      name: s.string(),
      mime: s.string(),
      sizeBytes: s.number({ integer: true }),
    }),
  ),
  itemId: s.nullable(s.string()),
  replyCount: s.number({ integer: true }),
  lastReplyAt: s.nullable(s.string()),
  reactions: s.array(
    s.object({ emoji: s.string(), count: s.number({ integer: true }), mine: s.boolean() }),
  ),
  createdAt: s.string(),
  editedAt: s.nullable(s.string()),
  deleted: s.boolean(),
});

/** [PCODE-348 | S15 | v0.1.0] Writes a message as `a`: in a conversation, or a reply in a thread, with its mentions. */
export async function writeMessage(
  c: PoolClient,
  a: Access,
  channelId: string,
  text: string,
  parentId?: string,
  fileIds?: string[],
): Promise<{ a: Access; ch: ChannelRow; row: MessageRow; mentioned: string[]; others: string[] }> {
  const ch = await visibleChannel(c, a, channelId);
  if (ch.archived_at)
    throw new HttpError(409, 'conflict', 'This channel is archived; restore it to write');
  let root: MessageRow | undefined;
  if (parentId) {
    root = await loadMessage(c, parentId);
    if (!root || root.channel_id !== ch.id || root.parent_id)
      throw new HttpError(400, 'invalid_request', 'Reply to a message of this conversation');
  }
  const files = [...new Set(fileIds ?? [])];
  if (
    files.length &&
    (await c.query('SELECT 1 FROM files WHERE id = ANY($1::uuid[])', [files])).rowCount !==
      files.length
  )
    throw new HttpError(400, 'invalid_request', 'A file was not found');
  // writing in a public channel joins it
  await join(c, a, ch.id, a.user.id);
  const id = (
    await c.query<{ id: string }>(
      `INSERT INTO messages (workspace_id, channel_id, parent_id, author_id, body, file_ids)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [a.workspaceId, ch.id, root?.id ?? null, a.user.id, text, files],
    )
  ).rows[0]?.id;
  if (!id) throw new Error('message insert returned nothing');
  if (root)
    await c.query(
      'UPDATE messages SET reply_count = reply_count + 1, last_reply_at = now() WHERE id = $1',
      [root.id],
    );
  await c.query('UPDATE channels SET last_message_at = now() WHERE id = $1', [ch.id]);
  await c.query(
    'UPDATE channel_members SET last_read_at = now() WHERE channel_id = $1 AND user_id = $2',
    [ch.id, a.user.id],
  );
  // who is told: the people mentioned who may see this, the members of a direct conversation, and
  // the people already in a thread
  const people = await workspacePeople(c);
  const mentioned = (
    await c.query<{ id: string }>(
      `SELECT u.id FROM unnest($1::uuid[], $2::text[]) AS u(id, role), channels c
          WHERE c.id = $3 AND sees_channel(c, u.id, u.role)`,
      [
        mentionsIn(text, people).map((p) => p.id),
        mentionsIn(text, people).map((p) => p.role),
        ch.id,
      ],
    )
  ).rows
    .map((r) => r.id)
    .filter((u) => u !== a.user.id);
  for (const u of mentioned)
    await c.query(
      'INSERT INTO message_mentions (message_id, workspace_id, user_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
      [id, a.workspaceId, u],
    );
  const unmuted = (
    await c.query<{ user_id: string }>(
      'SELECT user_id FROM channel_members WHERE channel_id = $1 AND NOT muted AND user_id <> $2',
      [ch.id, a.user.id],
    )
  ).rows.map((r) => r.user_id);
  const inThread = root
    ? (
        await c.query<{ id: string }>(
          `SELECT DISTINCT author_id AS id FROM messages
              WHERE (id = $1 OR parent_id = $1) AND author_id IS NOT NULL AND author_id <> $2`,
          [root.id, a.user.id],
        )
      ).rows.map((r) => r.id)
    : [];
  const told = new Set(mentioned);
  const others =
    ch.kind === 'direct'
      ? unmuted.filter((u) => !told.has(u))
      : inThread.filter((u) => !told.has(u) && unmuted.includes(u));
  await announce(c, { ws: a.workspaceId, op: 'message', channelId: ch.id, messageId: id });
  const row = await loadMessage(c, id);
  if (!row) throw new Error('message vanished');
  return { a, ch, row, mentioned, others };
}

/** [PCODE-348 | S15 | v0.1.0] Who is told about a written message, and how. */
export function messageNotices(
  out: Awaited<ReturnType<typeof writeMessage>>,
  text: string,
): Parameters<typeof noticeNow>[2][] {
  const list: Parameters<typeof noticeNow>[2][] = [];
  const where = out.ch.kind === 'direct' ? 'a direct message' : '#' + (out.ch.name ?? 'channel');
  const base = {
    body: messagePreview(text),
    url: '/messages/' + out.ch.id + (out.row.parent_id ? '?thread=' + out.row.parent_id : ''),
    tag: 'chat-' + out.ch.id,
    object: { type: 'channel', id: out.ch.id },
    priority: 'normal' as const,
    projectId: out.ch.project_id,
  };
  if (out.mentioned.length)
    list.push({
      ...base,
      userIds: out.mentioned,
      inboxKind: 'mention',
      title: out.a.user.name + ' mentioned you in ' + where,
    });
  if (out.others.length)
    list.push({
      ...base,
      userIds: out.others,
      inboxKind: 'message',
      title:
        out.ch.kind === 'direct'
          ? out.a.user.name + ' wrote to you'
          : out.a.user.name + ' replied in a thread in ' + where,
    });
  return list;
}

export function messageRoutes(
  pool: Pool,
  deps: { push?: PushDeps & { subject?: string } } = {},
): Route[] {
  const push = { ...deps.push, subject: deps.push?.subject ?? PUSH_SUBJECT };
  /** sends after the response: a slow push service never holds up a message */
  const notify = (ws: string, n: Parameters<typeof noticeNow>[2]): void => {
    void noticeNow(pool, ws, n, push).catch(() => undefined);
  };
  const member = <T>(
    req: IncomingMessage,
    ws: string,
    min: 'guest' | 'member',
    fn: (c: PoolClient, a: Access) => Promise<T>,
  ): Promise<T> => asMember(pool, req, ws, min, fn);

  const list = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/channels',
    summary:
      'The conversations you can see: channels and your direct messages, with unread counts (guest)',
    tags: ['messages'],
    params: wsParams,
    query: s.object({ archived: s.optional(s.enum(['1'])) }),
    response: s.array(channelOut),
    handler: ({ params, query, req }) =>
      member(req, params.workspaceId, 'guest', async (c, a) => {
        // every workspace starts with #general, which every member is in
        if (!a.clientId && a.role !== 'guest') {
          await c.query(
            `INSERT INTO channels (workspace_id, kind, name, topic, created_by)
             VALUES ($1, 'channel', 'general', 'Everyone in the workspace', $2)
             ON CONFLICT (workspace_id, name) WHERE kind = 'channel' DO NOTHING`,
            [a.workspaceId, a.user.id],
          );
          await c.query(
            `INSERT INTO channel_members (channel_id, workspace_id, user_id)
             SELECT id, workspace_id, $2 FROM channels WHERE workspace_id = $1 AND kind = 'channel' AND name = 'general'
             ON CONFLICT DO NOTHING`,
            [a.workspaceId, a.user.id],
          );
        }
        // [PCODE-236 | S15 | v0.1.0] a client contact is in every channel of their client
        if (a.clientId)
          await c.query(
            `INSERT INTO channel_members (channel_id, workspace_id, user_id)
             SELECT id, workspace_id, $2 FROM channels WHERE client_id = $1 AND archived_at IS NULL
             ON CONFLICT DO NOTHING`,
            [a.clientId, a.user.id],
          );
        return { body: await channelList(c, a, { archived: query.archived === '1' }) };
      }),
  });

  const create = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/channels',
    summary:
      'Open a channel for the workspace, a project or a client, public or private, with its first members (member)',
    tags: ['messages'],
    params: wsParams,
    body: s.object({
      name: s.string({ min: 1, max: 80 }),
      topic: s.optional(s.string({ max: 500 })),
      projectId: s.optional(uuid),
      clientId: s.optional(uuid),
      private: s.optional(s.boolean()),
      memberIds: s.optional(s.array(uuid, { max: 200 })),
    }),
    response: channelOut,
    status: 201,
    handler: ({ params, body, req }) =>
      member(req, params.workspaceId, 'member', async (c, a) => {
        const name = channelName(body.name);
        if (!name)
          throw new HttpError(400, 'invalid_request', 'A name needs letters or digits', [
            { path: 'body.name', message: 'has no letters or digits' },
          ]);
        if (body.projectId && body.clientId)
          throw new HttpError(400, 'invalid_request', 'A channel is for a project or a client');
        if (
          body.projectId &&
          !(await c.query('SELECT 1 FROM projects WHERE id = $1', [body.projectId])).rowCount
        )
          throw new HttpError(404, 'not_found', 'Project not found');
        if (
          body.clientId &&
          !(await c.query('SELECT 1 FROM clients WHERE id = $1', [body.clientId])).rowCount
        )
          throw new HttpError(404, 'not_found', 'Client not found');
        const people = new Set((await workspacePeople(c)).map((p) => p.id));
        const add = [...new Set([a.user.id, ...(body.memberIds ?? [])])];
        if (add.some((u) => !people.has(u)))
          throw new HttpError(400, 'invalid_request', 'Only people of the workspace can join');
        let id: string | undefined;
        try {
          id = (
            await c.query<{ id: string }>(
              `INSERT INTO channels (workspace_id, kind, name, topic, project_id, client_id, private, created_by)
               VALUES ($1, 'channel', $2, $3, $4, $5, $6, $7) RETURNING id`,
              [
                a.workspaceId,
                name,
                body.topic?.trim() ?? '',
                body.projectId ?? null,
                body.clientId ?? null,
                body.private ?? false,
                a.user.id,
              ],
            )
          ).rows[0]?.id;
        } catch (err) {
          if (isUniqueViolation(err))
            throw new HttpError(409, 'conflict', '#' + name + ' exists already');
          throw err;
        }
        if (!id) throw new Error('channel insert returned nothing');
        for (const u of add) await join(c, a, id, u);
        await announce(c, { ws: a.workspaceId, op: 'channel', channelId: id });
        return { status: 201, body: await oneChannel(c, a, id) };
      }),
  });

  const update = route({
    method: 'PATCH',
    path: '/api/workspaces/:workspaceId/channels/:channelId',
    summary: 'Rename a channel, change its topic, archive or restore it (its creator or an admin)',
    tags: ['messages'],
    params: channelParams,
    body: s.object({
      name: s.optional(s.string({ min: 1, max: 80 })),
      topic: s.optional(s.string({ max: 500 })),
      archived: s.optional(s.boolean()),
    }),
    response: channelOut,
    handler: ({ params, body, req }) =>
      member(req, params.workspaceId, 'member', async (c, a) => {
        const ch = await visibleChannel(c, a, params.channelId);
        if (ch.kind === 'direct')
          throw new HttpError(409, 'conflict', 'A direct conversation has no name or topic');
        if (ch.created_by !== a.user.id && !atLeast(a.role, 'admin'))
          throw new HttpError(
            403,
            'forbidden',
            'Only who opened the channel or an admin changes it',
          );
        if (ch.name === 'general' && (body.archived || body.name))
          throw new HttpError(409, 'conflict', '#general stays');
        const name = body.name === undefined ? undefined : channelName(body.name);
        if (name === null)
          throw new HttpError(400, 'invalid_request', 'A name needs letters or digits');
        try {
          await c.query(
            `UPDATE channels SET name = coalesce($2, name), topic = coalesce($3, topic),
                    archived_at = CASE WHEN $4::boolean IS NULL THEN archived_at WHEN $4 THEN coalesce(archived_at, now()) ELSE NULL END
              WHERE id = $1`,
            [ch.id, name ?? null, body.topic?.trim() ?? null, body.archived ?? null],
          );
        } catch (err) {
          if (isUniqueViolation(err)) throw new HttpError(409, 'conflict', 'That name is taken');
          throw err;
        }
        await announce(c, { ws: a.workspaceId, op: 'channel', channelId: ch.id });
        return { body: await oneChannel(c, a, ch.id) };
      }),
  });

  const joinRoute = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/channels/:channelId/join',
    summary: 'Join a channel you can see (guest)',
    tags: ['messages'],
    params: channelParams,
    response: channelOut,
    handler: ({ params, req }) =>
      member(req, params.workspaceId, 'guest', async (c, a) => {
        const ch = await visibleChannel(c, a, params.channelId);
        await join(c, a, ch.id, a.user.id);
        return { body: await oneChannel(c, a, ch.id) };
      }),
  });

  const leave = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/channels/:channelId/leave',
    summary: 'Leave a channel; a private one then disappears for you (guest)',
    tags: ['messages'],
    params: channelParams,
    response: s.object({ ok: s.boolean() }),
    handler: ({ params, req }) =>
      member(req, params.workspaceId, 'guest', async (c, a) => {
        const ch = await visibleChannel(c, a, params.channelId);
        if (ch.kind === 'direct')
          throw new HttpError(409, 'conflict', 'A direct conversation cannot be left; mute it');
        await c.query('DELETE FROM channel_members WHERE channel_id = $1 AND user_id = $2', [
          ch.id,
          a.user.id,
        ]);
        await announce(c, { ws: a.workspaceId, op: 'channel', channelId: ch.id });
        return { body: { ok: true } };
      }),
  });

  const addMembers = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/channels/:channelId/members',
    summary: 'Add people to a channel; to a private one only its members or an admin (member)',
    tags: ['messages'],
    params: channelParams,
    body: s.object({ userIds: s.array(uuid, { min: 1, max: 200 }) }),
    response: channelOut,
    handler: ({ params, body, req }) =>
      member(req, params.workspaceId, 'member', async (c, a) => {
        const ch = await visibleChannel(c, a, params.channelId);
        if (ch.kind === 'direct')
          throw new HttpError(409, 'conflict', 'Start a new group conversation instead');
        if (ch.private && !(await joined(c, ch.id, a.user.id)) && !atLeast(a.role, 'admin'))
          throw new HttpError(403, 'forbidden', 'Only its members add people to a private channel');
        const people = new Map((await workspacePeople(c)).map((p) => [p.id, p]));
        for (const u of body.userIds) {
          const p = people.get(u);
          if (!p)
            throw new HttpError(400, 'invalid_request', 'Only people of the workspace can join');
          // a guest may only be added where a guest can be: their project's or client's channel, or a private one
          if (p.role === 'guest' && !ch.private && !ch.project_id && !ch.client_id)
            throw new HttpError(
              400,
              'invalid_request',
              p.name + ' is a guest and cannot join this channel',
            );
          await join(c, a, ch.id, u);
        }
        await announce(c, { ws: a.workspaceId, op: 'channel', channelId: ch.id });
        return { body: await oneChannel(c, a, ch.id) };
      }),
  });

  const direct = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/direct',
    summary: 'Open (or find) the direct conversation with one or more people (member)',
    tags: ['messages'],
    params: wsParams,
    body: s.object({ userIds: s.array(uuid, { min: 1, max: 8 }) }),
    response: channelOut,
    handler: ({ params, body, req }) =>
      member(req, params.workspaceId, 'member', async (c, a) => {
        const people = new Map((await workspacePeople(c)).map((p) => [p.id, p]));
        const ids = [...new Set([a.user.id, ...body.userIds])];
        if (ids.length < 2) throw new HttpError(400, 'invalid_request', 'Name someone else');
        for (const u of ids) {
          const p = people.get(u);
          if (!p) throw new HttpError(400, 'invalid_request', 'Only people of the workspace');
          if (p.role === 'guest')
            throw new HttpError(
              400,
              'invalid_request',
              p.name + ' is a guest; talk in their project’s or client’s channel',
            );
        }
        const key = dmKey(ids);
        let id = (
          await c.query<{ id: string }>(
            "SELECT id FROM channels WHERE kind = 'direct' AND dm_key = $1",
            [key],
          )
        ).rows[0]?.id;
        if (!id) {
          id = (
            await c.query<{ id: string }>(
              `INSERT INTO channels (workspace_id, kind, private, dm_key, created_by)
               VALUES ($1, 'direct', true, $2, $3)
               ON CONFLICT (workspace_id, dm_key) WHERE kind = 'direct' DO UPDATE SET dm_key = EXCLUDED.dm_key
               RETURNING id`,
              [a.workspaceId, key, a.user.id],
            )
          ).rows[0]?.id;
          if (!id) throw new Error('direct insert returned nothing');
          for (const u of ids) await join(c, a, id, u);
          await announce(c, { ws: a.workspaceId, op: 'channel', channelId: id });
        }
        return { body: await oneChannel(c, a, id) };
      }),
  });

  const read = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/channels/:channelId/read',
    summary: 'Mark a conversation read up to now (guest)',
    tags: ['messages'],
    params: channelParams,
    response: s.object({ ok: s.boolean() }),
    handler: ({ params, req }) =>
      member(req, params.workspaceId, 'guest', async (c, a) => {
        const ch = await visibleChannel(c, a, params.channelId);
        await c.query(
          'UPDATE channel_members SET last_read_at = now() WHERE channel_id = $1 AND user_id = $2',
          [ch.id, a.user.id],
        );
        // what was waiting in the inbox about this conversation is done too
        await c.query(
          `UPDATE inbox_items SET state = 'done', done_at = now()
            WHERE user_id = $1 AND object_type = 'channel' AND object_id = $2 AND state <> 'done'`,
          [a.user.id, ch.id],
        );
        return { body: { ok: true } };
      }),
  });

  const mute = route({
    method: 'PUT',
    path: '/api/workspaces/:workspaceId/channels/:channelId/mute',
    summary: 'Mute or unmute a conversation: no notifications except mentions (guest)',
    tags: ['messages'],
    params: channelParams,
    body: s.object({ muted: s.boolean() }),
    response: channelOut,
    handler: ({ params, body, req }) =>
      member(req, params.workspaceId, 'guest', async (c, a) => {
        const ch = await visibleChannel(c, a, params.channelId);
        await join(c, a, ch.id, a.user.id);
        await c.query(
          'UPDATE channel_members SET muted = $3 WHERE channel_id = $1 AND user_id = $2',
          [ch.id, a.user.id, body.muted],
        );
        return { body: await oneChannel(c, a, ch.id) };
      }),
  });

  const history = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/channels/:channelId/messages',
    summary: 'A page of a conversation, oldest first, before a point in time (guest)',
    tags: ['messages'],
    params: channelParams,
    query: s.object({
      before: s.optional(s.string({ format: 'date-time' })),
      limit: s.optional(s.string({ pattern: /^\d{1,3}$/ })),
    }),
    response: s.object({ messages: s.array(messageOut), more: s.boolean() }),
    handler: ({ params, query, req }) =>
      member(req, params.workspaceId, 'guest', async (c, a) => {
        const ch = await visibleChannel(c, a, params.channelId);
        const limit = Math.min(100, Math.max(1, Number(query.limit ?? PAGE)));
        const rows = (
          await c.query<MessageRow>(
            MESSAGE_SELECT +
              ` WHERE m.channel_id = $1 AND m.parent_id IS NULL AND ($2::timestamptz IS NULL OR m.created_at < $2)
                ORDER BY m.created_at DESC LIMIT $3`,
            [ch.id, query.before ?? null, limit + 1],
          )
        ).rows;
        const more = rows.length > limit;
        return {
          body: {
            messages: rows
              .slice(0, limit)
              .reverse()
              .map((r) => messageJson(r, a.user.id)),
            more,
          },
        };
      }),
  });

  const thread = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/messages/:messageId/thread',
    summary: 'A message and the replies in its thread, oldest first (guest)',
    tags: ['messages'],
    params: messageParams,
    response: s.object({ root: messageOut, replies: s.array(messageOut) }),
    handler: ({ params, req }) =>
      member(req, params.workspaceId, 'guest', async (c, a) => {
        const root = await loadMessage(c, params.messageId);
        if (!root || root.parent_id) throw new HttpError(404, 'not_found', 'Message not found');
        await visibleChannel(c, a, root.channel_id);
        const replies = (
          await c.query<MessageRow>(
            MESSAGE_SELECT + ' WHERE m.parent_id = $1 ORDER BY m.created_at',
            [root.id],
          )
        ).rows;
        return {
          body: {
            root: messageJson(root, a.user.id),
            replies: replies.map((r) => messageJson(r, a.user.id)),
          },
        };
      }),
  });

  const post = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/channels/:channelId/messages',
    summary:
      'Write in a conversation, or reply in a thread; mentions and direct messages notify (guest)',
    tags: ['messages'],
    params: channelParams,
    body: s.object({
      body: s.string({ min: 1, max: 20_000 }),
      parentId: s.optional(uuid),
      fileIds: s.optional(s.array(uuid, { max: 20 })),
    }),
    response: messageOut,
    status: 201,
    handler: async ({ params, body, req }) => {
      const text = body.body.trim();
      if (!text) throw new HttpError(400, 'invalid_request', 'Write something');
      const out = await member(req, params.workspaceId, 'guest', (c, a) =>
        writeMessage(c, a, params.channelId, text, body.parentId, body.fileIds),
      ); // [PCODE-348 | S15 | v0.1.0]
      for (const n of messageNotices(out, text)) notify(out.a.workspaceId, n);
      return { status: 201, body: messageJson(out.row, out.a.user.id) };
    },
  });

  const edit = route({
    method: 'PATCH',
    path: '/api/workspaces/:workspaceId/messages/:messageId',
    summary: 'Change your own message (guest)',
    tags: ['messages'],
    params: messageParams,
    body: s.object({ body: s.string({ min: 1, max: 20_000 }) }),
    response: messageOut,
    handler: ({ params, body, req }) =>
      member(req, params.workspaceId, 'guest', async (c, a) => {
        const m = await loadMessage(c, params.messageId);
        if (!m) throw new HttpError(404, 'not_found', 'Message not found');
        await visibleChannel(c, a, m.channel_id);
        if (m.author_id !== a.user.id)
          throw new HttpError(403, 'forbidden', 'Only its author changes a message');
        if (m.deleted_at) throw new HttpError(409, 'conflict', 'The message was deleted');
        const text = body.body.trim();
        if (!text) throw new HttpError(400, 'invalid_request', 'Write something');
        await c.query('UPDATE messages SET body = $2, edited_at = now() WHERE id = $1', [
          m.id,
          text,
        ]);
        await announce(c, {
          ws: a.workspaceId,
          op: 'updated',
          channelId: m.channel_id,
          messageId: m.id,
        });
        const row = await loadMessage(c, m.id);
        if (!row) throw new Error('message vanished');
        return { body: messageJson(row, a.user.id) };
      }),
  });

  const remove = route({
    method: 'DELETE',
    path: '/api/workspaces/:workspaceId/messages/:messageId',
    summary:
      'Delete a message: its text and files are gone, a thread under it stays (its author or an admin)',
    tags: ['messages'],
    params: messageParams,
    response: messageOut,
    handler: ({ params, req }) =>
      member(req, params.workspaceId, 'guest', async (c, a) => {
        const m = await loadMessage(c, params.messageId);
        if (!m) throw new HttpError(404, 'not_found', 'Message not found');
        await visibleChannel(c, a, m.channel_id);
        if (m.author_id !== a.user.id && !atLeast(a.role, 'admin'))
          throw new HttpError(403, 'forbidden', 'Only its author or an admin deletes a message');
        await c.query(
          "UPDATE messages SET body = '·', file_ids = '{}', deleted_at = coalesce(deleted_at, now()) WHERE id = $1",
          [m.id],
        );
        await c.query('DELETE FROM message_reactions WHERE message_id = $1', [m.id]);
        await c.query('DELETE FROM message_mentions WHERE message_id = $1', [m.id]);
        await announce(c, {
          ws: a.workspaceId,
          op: 'updated',
          channelId: m.channel_id,
          messageId: m.id,
        });
        const row = await loadMessage(c, m.id);
        if (!row) throw new Error('message vanished');
        return { body: messageJson(row, a.user.id) };
      }),
  });

  const reactionParams = s.object({
    workspaceId: uuid,
    messageId: uuid,
    emoji: s.string({ min: 1, max: 32 }),
  });
  const react = (method: 'PUT' | 'DELETE'): Route =>
    route({
      method,
      path: '/api/workspaces/:workspaceId/messages/:messageId/reactions/:emoji',
      summary: method === 'PUT' ? 'Add a reaction (guest)' : 'Take your reaction back (guest)',
      tags: ['messages'],
      params: reactionParams,
      response: messageOut,
      handler: ({ params, req }) =>
        member(req, params.workspaceId, 'guest', async (c, a) => {
          if (!(REACTIONS as readonly string[]).includes(params.emoji))
            throw new HttpError(400, 'invalid_request', 'Not one of the reactions');
          const m = await loadMessage(c, params.messageId);
          if (!m || m.deleted_at) throw new HttpError(404, 'not_found', 'Message not found');
          await visibleChannel(c, a, m.channel_id);
          if (method === 'PUT')
            await c.query(
              `INSERT INTO message_reactions (message_id, workspace_id, user_id, emoji) VALUES ($1, $2, $3, $4)
               ON CONFLICT DO NOTHING`,
              [m.id, a.workspaceId, a.user.id, params.emoji],
            );
          else
            await c.query(
              'DELETE FROM message_reactions WHERE message_id = $1 AND user_id = $2 AND emoji = $3',
              [m.id, a.user.id, params.emoji],
            );
          await announce(c, {
            ws: a.workspaceId,
            op: 'updated',
            channelId: m.channel_id,
            messageId: m.id,
          });
          const row = await loadMessage(c, m.id);
          if (!row) throw new Error('message vanished');
          return { body: messageJson(row, a.user.id) };
        }),
    });

  const search = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/messages/search',
    summary: 'Find messages in the conversations you can see, newest first (guest)',
    tags: ['messages'],
    params: wsParams,
    query: s.object({ q: s.string({ min: 1, max: 200 }), channelId: s.optional(uuid) }),
    response: s.array(messageOut),
    handler: ({ params, query, req }) =>
      member(req, params.workspaceId, 'guest', async (c, a) => {
        const rows = (
          await c.query<MessageRow & { channel_name: string | null }>(
            MESSAGE_SELECT.replace(
              'FROM messages m',
              'FROM messages m JOIN channels ch ON ch.id = m.channel_id',
            ) +
              ` WHERE m.deleted_at IS NULL AND sees_channel(ch, $1, $2)
                  AND ($4::uuid IS NULL OR m.channel_id = $4)
                  AND m.search @@ plainto_tsquery('simple', $3)
                ORDER BY m.created_at DESC LIMIT 50`,
            [a.user.id, a.role, query.q, query.channelId ?? null],
          )
        ).rows;
        return { body: rows.map((r) => messageJson(r, a.user.id)) };
      }),
  });

  const toTask = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/messages/:messageId/task',
    summary: 'Turn a message into a task of a project, linked both ways (member)',
    tags: ['messages'],
    params: messageParams,
    body: s.object({
      projectId: uuid,
      title: s.optional(s.string({ min: 1, max: 255 })),
    }),
    response: s.object({ itemId: s.string(), ref: s.string(), message: messageOut }),
    status: 201,
    handler: ({ params, body, req }) =>
      member(req, params.workspaceId, 'member', async (c, a) => {
        const m = await loadMessage(c, params.messageId);
        if (!m || m.deleted_at) throw new HttpError(404, 'not_found', 'Message not found');
        const ch = await visibleChannel(c, a, m.channel_id);
        if (m.item_id) throw new HttpError(409, 'conflict', 'This message is a task already');
        const p = (
          await c.query<{ id: string; key: string; archived_at: Date | null }>(
            'SELECT id, key, archived_at FROM projects WHERE id = $1',
            [body.projectId],
          )
        ).rows[0];
        if (!p) throw new HttpError(404, 'not_found', 'Project not found');
        if (p.archived_at) throw new HttpError(409, 'conflict', 'The project is archived');
        const stateId = (
          await c.query<{ id: string }>(
            'SELECT id FROM project_states WHERE project_id = $1 ORDER BY position LIMIT 1',
            [p.id],
          )
        ).rows[0]?.id;
        if (!stateId) throw new HttpError(409, 'conflict', 'The project has no states');
        const seq = (
          await c.query<{ seq: number }>(
            'UPDATE projects SET next_item_seq = next_item_seq + 1 WHERE id = $1 RETURNING next_item_seq - 1 AS seq',
            [p.id],
          )
        ).rows[0]?.seq;
        const title = (body.title?.trim() || messagePreview(m.body, 120)).slice(0, 255);
        const where = ch.kind === 'direct' ? 'a direct conversation' : '#' + (ch.name ?? '');
        const description = [
          m.body,
          '',
          'From ' + (m.author_name ?? 'someone') + '’s message in ' + where + '.',
        ].join('\n');
        const itemId = (
          await c.query<{ id: string }>(
            `INSERT INTO items (workspace_id, project_id, sequence, title, description, state_id, created_by, rank)
             VALUES ($1, $2, $3, $4, $5, $6, $7, (SELECT coalesce(max(rank), 0) + 1 FROM items WHERE project_id = $2))
             RETURNING id`,
            [a.workspaceId, p.id, seq, title, description, stateId, a.user.id],
          )
        ).rows[0]?.id;
        if (!itemId) throw new Error('item insert returned nothing');
        await c.query('UPDATE messages SET item_id = $2 WHERE id = $1', [m.id, itemId]);
        const ref = p.key + '-' + String(seq);
        await recordEvent(
          c,
          a.workspaceId,
          {
            actor: actorOf(a),
            verb: 'created',
            object: { type: 'item', id: itemId, label: ref + ' ' + title },
            parent: { type: 'project', id: p.id, label: p.key },
          },
          { projectId: p.id },
        );
        await announce(c, { ws: a.workspaceId, op: 'updated', channelId: ch.id, messageId: m.id });
        const row = await loadMessage(c, m.id);
        if (!row) throw new Error('message vanished');
        return { status: 201, body: { itemId, ref, message: messageJson(row, a.user.id) } };
      }),
  });

  return [
    list,
    create,
    update,
    joinRoute,
    leave,
    addMembers,
    direct,
    read,
    mute,
    history,
    thread,
    post,
    edit,
    remove,
    react('PUT'),
    react('DELETE'),
    search,
    toTask,
  ];
}
