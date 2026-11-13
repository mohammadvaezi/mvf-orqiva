// ── [PCODE-349 | S15 | v0.1.0] T35.2b Slack and Teams bridges, personal calendar feed, CI pipeline runs ──
//    Why:  each round, every active bridge posts what is new since its cursors: the events of the topics it
//          was given and the messages of the channel it mirrors, each once, oldest first. A failure keeps the
//          cursor where it was, so the next round tries again; ten in a row switch the bridge off.
import {
  bridgeBody,
  bridgeLine,
  bridgeTopic,
  type ActivityEvent,
  type BridgeKind,
} from '@orqiva/shared';
import type { Pool } from 'pg';
import { open } from '../agents/secrets.js';
import { isPublicUrl } from '../api/documents.js';
import { inSystem } from '../db/pool.js';

const MAX_FAILURES = 10;

export interface BridgeOptions {
  fetchImpl?: typeof fetch;
  /** tests post to their own server on localhost */
  allowPrivate?: boolean;
  publicUrl?: string;
}

interface BridgeRow {
  id: string;
  workspace_id: string;
  kind: BridgeKind;
  url_ciphertext: string;
  topics: string[];
  channel_id: string | null;
  channel_name: string | null;
  cursor: string;
  /** as Postgres text: a JavaScript date would lose the microseconds and post a message twice */
  message_cursor: string;
}

/** Posts one message to a bridge's webhook; throws with a short reason when it does not take it. */
export async function postToBridge(
  kind: BridgeKind,
  url: string,
  m: { title: string; text: string; url?: string },
  opts: BridgeOptions = {},
): Promise<void> {
  if (!opts.allowPrivate && !(await isPublicUrl(url))) throw new Error('the address is not public');
  const res = await (opts.fetchImpl ?? fetch)(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(bridgeBody(kind, m)),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error('the chat answered ' + String(res.status));
}

/** One round over every active bridge; answers how many posts went out. */
export async function bridgeRound(pool: Pool, opts: BridgeOptions = {}): Promise<number> {
  const bridges = await inSystem(
    pool,
    async (c) =>
      (
        await c.query<BridgeRow>(
          `SELECT b.id, b.workspace_id, b.kind, b.url_ciphertext, b.topics, b.channel_id, ch.name AS channel_name,
                b.cursor, b.message_cursor::text AS message_cursor
           FROM chat_bridges b LEFT JOIN channels ch ON ch.id = b.channel_id WHERE b.active`,
        )
      ).rows,
  );
  const base = (opts.publicUrl ?? '').replace(/\/$/, '');
  let sent = 0;
  for (const b of bridges) {
    const posts: { title: string; text: string; url?: string; seq?: number; at?: string }[] = [];
    await inSystem(pool, async (c) => {
      if (b.topics.length) {
        const rows = (
          await c.query<{ sequence: string; envelope: ActivityEvent }>(
            `SELECT sequence, envelope FROM activity_events WHERE workspace_id = $1 AND sequence > $2
              ORDER BY sequence LIMIT 50`,
            [b.workspace_id, b.cursor],
          )
        ).rows;
        for (const r of rows) {
          const topic = bridgeTopic(r.envelope);
          posts.push(
            topic && b.topics.includes(topic)
              ? { title: bridgeLine(r.envelope), text: '', seq: Number(r.sequence) }
              : { title: '', text: '', seq: Number(r.sequence) },
          );
        }
      }
      if (b.channel_id) {
        const msgs = (
          await c.query<{ body: string; author: string | null; created_at: string }>(
            `SELECT m.body, u.name AS author, m.created_at::text AS created_at FROM messages m LEFT JOIN users u ON u.id = m.author_id
              WHERE m.channel_id = $1 AND m.created_at > $2::timestamptz AND m.deleted_at IS NULL
              ORDER BY m.created_at LIMIT 50`,
            [b.channel_id, b.message_cursor],
          )
        ).rows;
        for (const m of msgs)
          posts.push({
            title: (m.author ?? 'Someone') + ' in #' + (b.channel_name ?? 'channel'),
            text: m.body.slice(0, 3000),
            ...(base ? { url: base + '/messages/' + b.channel_id } : {}),
            at: m.created_at,
          });
      }
    });
    if (!posts.length) continue;
    let url = '';
    try {
      url = open(b.url_ciphertext);
    } catch {
      await inSystem(pool, (c) =>
        c.query(
          "UPDATE chat_bridges SET active = false, last_error = 'The address cannot be read' WHERE id = $1",
          [b.id],
        ),
      );
      continue;
    }
    let cursor = Number(b.cursor);
    let messageCursor = b.message_cursor;
    let error = '';
    let n = 0;
    for (const p of posts) {
      if (p.title) {
        try {
          await postToBridge(b.kind, url, p, opts);
          n++;
        } catch (e) {
          error = e instanceof Error ? e.message : String(e);
          break;
        }
      }
      if (p.seq !== undefined) cursor = p.seq;
      if (p.at) messageCursor = p.at;
    }
    sent += n;
    await inSystem(pool, (c) =>
      c.query(
        `UPDATE chat_bridges SET cursor = $2, message_cursor = $3::timestamptz, sent = sent + $4, last_at = CASE WHEN $4 > 0 THEN now() ELSE last_at END,
                last_error = $5, failures = CASE WHEN $5 = '' THEN 0 ELSE failures + 1 END,
                active = CASE WHEN $5 <> '' AND failures + 1 >= $6 THEN false ELSE active END
          WHERE id = $1`,
        [b.id, cursor, messageCursor, n, error.slice(0, 300), MAX_FAILURES],
      ),
    );
  }
  return sent;
}
