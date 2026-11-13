// ── [PCODE-438 | S15 | v0.1.0] T37 medium: Activity text search uses its index under row-level security ──
// ── [PCODE-413 | S15 | v0.1.0] T37 high: Activity facets answer under 1 s ──
// ── [PCODE-412 | S15 | v0.1.0] T37 high: Activity takes 10 000 events per second ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-183 | S15 | v0.1.0] B6.1 Activity at scale live: search, query language, facets, histogram, saved views, export, archive, hash chain, webhooks ──
// ── [PCODE-89 | S15 | v0.1.0] Define the activity event envelope and the transactional outbox ──
// ── [PCODE-92 | S15 | v0.1.0] Add workspaces, projects, members and roles to the API ──
// ── [PCODE-94 | S15 | v0.1.0] Build our own event bus: outbox relay, LISTEN/NOTIFY wake-up, 24 h replay ──
// ── [PCODE-95 | S15 | v0.1.0] Build our own WebSocket gateway (RFC 6455) with typed protocol and SSE fallback ──
//    Why:  the one function every write path calls inside its transaction. It takes the next number of the
//          workspace's sequence (holding the counter row until commit), builds the envelope and stores it.
//          If the transaction rolls back, the event and its number vanish with the change.
import { randomUUID } from 'node:crypto';
import { eventType, type ActivityData, type ActivityEvent } from '@orqiva/shared';
import type { PoolClient } from 'pg';
import { EVENTS_CHANNEL } from './bus.js';

/** Records one activity event in the caller's transaction (opened with inWorkspace). */
export async function recordEvent(
  client: PoolClient,
  workspaceId: string,
  data: ActivityData,
  // [PCODE-95 | S15 | v0.1.0] the project the event belongs to: guests only see their projects' events
  scope: { projectId?: string; now?: Date } = {},
): Promise<ActivityEvent> {
  const now = scope.now ?? new Date();
  const event: ActivityEvent = {
    specversion: '1.0',
    id: randomUUID(),
    source: '/workspaces/' + workspaceId,
    type: eventType(data.object.type, data.verb),
    time: now.toISOString(),
    subject: data.object.id,
    datacontenttype: 'application/json',
    workspaceid: workspaceId,
    sequence: 0,
    ...(scope.projectId ? { projectid: scope.projectId } : {}),
    data,
  };
  // [PCODE-412 | S15 | v0.1.0] one statement, one round trip: the counter, the envelope with its number, the hash of
  // the one before (the audit chain, PCODE-183) and the notify that wakes every node (PCODE-94), which
  // PostgreSQL delivers only if the transaction commits
  const row = (
    await client.query<{ sequence: string }>(
      `WITH c AS (
         INSERT INTO workspace_event_counters (workspace_id, last_sequence) VALUES ($1, 1)
         ON CONFLICT (workspace_id) DO UPDATE SET last_sequence = workspace_event_counters.last_sequence + 1
         RETURNING last_sequence
       ), e AS (
         SELECT last_sequence AS seq, jsonb_set($9::jsonb, '{sequence}', to_jsonb(last_sequence)) AS env FROM c
       ), r AS (
         -- [PCODE-413 | S15 | v0.1.0] its hour's count, for the activity page's side
         INSERT INTO activity_rollup (workspace_id, hour, archived, type, actor_kind, object_type, verb, project_id, n)
         VALUES ($1, date_trunc('hour', $4::timestamptz), false, $3, $5, $7, $13, $14, 1)
         ON CONFLICT (workspace_id, archived, hour, type, actor_kind, object_type, verb, project_id)
           DO UPDATE SET n = activity_rollup.n + 1
       ), ins AS (
         INSERT INTO activity_events
           (workspace_id, sequence, id, type, time, actor_kind, actor_id, object_type, object_id, envelope, parent_type, parent_id, hash)
         SELECT $1, e.seq, $2, $3, $4, $5, $6, $7, $8, e.env, $10, $11,
           encode(sha256(convert_to(coalesce(
             (SELECT hash FROM activity_events WHERE workspace_id = $1 AND sequence = e.seq - 1),
             (SELECT hash FROM activity_archive WHERE workspace_id = $1 AND sequence = e.seq - 1), '') || e.env::text, 'UTF8')), 'hex')
           FROM e
         RETURNING workspace_id, sequence, search, pg_notify($12, $1::text)
       )
       -- [PCODE-438 | S15 | v0.1.0] its words, where a word search can use its index
       INSERT INTO activity_search (workspace_id, sequence, search)
       SELECT workspace_id, sequence, search FROM ins
       RETURNING sequence`,
      [
        workspaceId,
        event.id,
        event.type,
        event.time,
        data.actor.kind,
        data.actor.id,
        data.object.type,
        data.object.id,
        JSON.stringify(event),
        data.parent?.type ?? null,
        data.parent?.id ?? null,
        EVENTS_CHANNEL,
        data.verb, // [PCODE-413 | S15 | v0.1.0]
        scope.projectId ?? '',
      ],
    )
  ).rows[0];
  event.sequence = Number(row?.sequence);
  return event;
}

// [PCODE-412 | S15 | v0.1.0]
/** Records many events in one call (imports, agents, integrations): the counter moves once, the database
 *  builds the hash chain, and one notify wakes the nodes. Same transaction rules as recordEvent. */
export async function recordEvents(
  client: PoolClient,
  workspaceId: string,
  items: { data: ActivityData; projectId?: string; now?: Date }[],
): Promise<ActivityEvent[]> {
  if (!items.length) return [];
  const events = items.map((it): ActivityEvent => ({
    specversion: '1.0',
    id: randomUUID(),
    source: '/workspaces/' + workspaceId,
    type: eventType(it.data.object.type, it.data.verb),
    time: (it.now ?? new Date()).toISOString(),
    subject: it.data.object.id,
    datacontenttype: 'application/json',
    workspaceid: workspaceId,
    sequence: 0,
    ...(it.projectId ? { projectid: it.projectId } : {}),
    data: it.data,
  }));
  const rows = events.map((e) => ({
    id: e.id,
    type: e.type,
    time: e.time,
    actor_kind: e.data.actor.kind,
    actor_id: e.data.actor.id,
    object_type: e.data.object.type,
    object_id: e.data.object.id,
    envelope: e,
    parent_type: e.data.parent?.type ?? null,
    parent_id: e.data.parent?.id ?? null,
  }));
  const first = Number(
    (
      await client.query<{ first: string }>('SELECT record_events($1, $2::jsonb, $3) AS first', [
        workspaceId,
        JSON.stringify(rows),
        EVENTS_CHANNEL,
      ])
    ).rows[0]?.first,
  );
  events.forEach((e, i) => {
    e.sequence = first + i;
  });
  return events;
}

/** Events after `afterSequence`, oldest first: the replay a reconnecting client asks for. */
export async function eventsAfter(
  client: PoolClient,
  afterSequence: number,
  limit = 500,
): Promise<ActivityEvent[]> {
  const rows = await client.query<{ envelope: ActivityEvent }>(
    'SELECT envelope FROM activity_events WHERE sequence > $1 ORDER BY sequence LIMIT $2',
    [afterSequence, limit],
  );
  return rows.rows.map((r) => r.envelope);
}
