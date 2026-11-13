// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-94 | S15 | v0.1.0] Build our own event bus: outbox relay, LISTEN/NOTIFY wake-up, 24 h replay ──
//    Why:  the bus replaces a message broker. Every event's transaction also sends NOTIFY, which PostgreSQL
//          delivers only on commit; each server node LISTENs, and on a wake-up reads the workspace's new
//          events in sequence order and hands them to its subscribers. Because the sequence is commit order,
//          reading "everything after the last one I saw" never skips or reorders. A slow poll catches what a
//          dropped LISTEN connection missed. A subscriber that reconnects with its last sequence gets the gap
//          replayed, unless the gap reaches back more than 24 hours: then it must resync from scratch.
import type { ActivityEvent } from '@orqiva/shared';
import pg from 'pg';
import type { Pool } from 'pg';
import { inSystem } from '../db/pool.js';

export const EVENTS_CHANNEL = 'orqiva_events';
export const REPLAY_WINDOW_MS = 24 * 3600 * 1000;
/** a reconnect that missed more than this many events resyncs instead of replaying */
export const REPLAY_MAX_EVENTS = 5000;

export interface Subscriber {
  /** every event after the cursor, in order */
  onEvent(event: ActivityEvent): void;
  /** the gap cannot be replayed: reload the data, then subscribe again from `sequence` */
  onResync(sequence: number, reason: string): void;
}

interface Sub {
  cursor: number;
  sink: Subscriber;
}

interface Channel {
  /** highest sequence read from the database */
  head: number;
  subs: Set<Sub>;
  /** one read at a time per workspace, so delivery stays in order */
  chain: Promise<void>;
}

export interface BusOptions {
  /** the connection string for the dedicated LISTEN connection */
  connectionString: string;
  pollMs?: number;
  now?: () => number;
  log?: (msg: string, fields?: Record<string, unknown>) => void;
}

const BATCH = 500;

export class EventBus {
  private readonly channels = new Map<string, Channel>();
  private listener: pg.Client | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private stopped = false;
  private readonly now: () => number;
  private readonly log: (msg: string, fields?: Record<string, unknown>) => void;

  constructor(
    private readonly pool: Pool,
    private readonly opts: BusOptions,
  ) {
    this.now = opts.now ?? Date.now;
    this.log = opts.log ?? (() => undefined);
  }

  async start(): Promise<void> {
    this.stopped = false;
    await this.connect();
    this.pollTimer = setInterval(() => {
      for (const ws of this.channels.keys()) this.wake(ws);
    }, this.opts.pollMs ?? 5000);
    this.pollTimer.unref();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    const l = this.listener;
    this.listener = null;
    await l?.end().catch(() => undefined);
    await Promise.all([...this.channels.values()].map((ch) => ch.chain));
  }

  private async connect(): Promise<void> {
    const client = new pg.Client({
      connectionString: this.opts.connectionString,
      application_name: 'orqiva-bus',
    });
    client.on('notification', (msg) => {
      if (msg.channel === EVENTS_CHANNEL && msg.payload) this.wake(msg.payload);
    });
    client.on('error', (err) => {
      this.log('event bus connection lost', { error: err.message });
      this.scheduleReconnect();
    });
    await client.connect();
    await client.query('LISTEN ' + EVENTS_CHANNEL);
    this.listener = client;
    // anything committed while we were not listening
    for (const ws of this.channels.keys()) this.wake(ws);
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    const old = this.listener;
    this.listener = null;
    void old?.end().catch(() => undefined);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch((err: unknown) => {
        this.log('event bus reconnect failed', {
          error: err instanceof Error ? err.message : String(err),
        });
        this.scheduleReconnect();
      });
    }, 1000);
    this.reconnectTimer.unref();
  }

  /** Subscribes to a workspace. `after`: the last sequence the subscriber has; omitted = from now on. */
  async subscribe(workspaceId: string, sink: Subscriber, after?: number): Promise<() => void> {
    let ch = this.channels.get(workspaceId);
    if (!ch) {
      const head = await this.maxSequence(workspaceId);
      ch = this.channels.get(workspaceId) ?? { head, subs: new Set(), chain: Promise.resolve() };
      this.channels.set(workspaceId, ch);
    }
    const channel = ch;
    const sub: Sub = { cursor: after ?? channel.head, sink };
    // join inside the workspace's chain: the replay finishes before live delivery reaches this subscriber
    await this.enqueue(workspaceId, channel, async () => {
      if (sub.cursor < channel.head) await this.replay(workspaceId, channel, sub);
      channel.subs.add(sub);
    });
    return () => {
      channel.subs.delete(sub);
      if (channel.subs.size === 0) this.channels.delete(workspaceId);
    };
  }

  /** Something may have been committed in this workspace: read and deliver it. */
  wake(workspaceId: string): void {
    const ch = this.channels.get(workspaceId);
    if (!ch) return;
    void this.enqueue(workspaceId, ch, () => this.pull(workspaceId, ch));
  }

  private enqueue(workspaceId: string, ch: Channel, task: () => Promise<void>): Promise<void> {
    const next = ch.chain.then(task).catch((err: unknown) => {
      this.log('event delivery failed', {
        workspaceId,
        error: err instanceof Error ? err.message : String(err),
      });
    });
    ch.chain = next;
    return next;
  }

  private async maxSequence(workspaceId: string): Promise<number> {
    return inSystem(this.pool, async (c) =>
      Number(
        (
          await c.query<{ n: string | null }>(
            'SELECT max(sequence) AS n FROM activity_events WHERE workspace_id = $1',
            [workspaceId],
          )
        ).rows[0]?.n ?? 0,
      ),
    );
  }

  private read(workspaceId: string, after: number, limit: number): Promise<ActivityEvent[]> {
    return inSystem(this.pool, async (c) =>
      (
        await c.query<{ envelope: ActivityEvent }>(
          'SELECT envelope FROM activity_events WHERE workspace_id = $1 AND sequence > $2 ORDER BY sequence LIMIT $3',
          [workspaceId, after, limit],
        )
      ).rows.map((r) => r.envelope),
    );
  }

  private deliver(sub: Sub, event: ActivityEvent): void {
    if (event.sequence <= sub.cursor) return;
    sub.cursor = event.sequence;
    try {
      sub.sink.onEvent(event);
    } catch (err) {
      this.log('subscriber failed', { error: err instanceof Error ? err.message : String(err) });
    }
  }

  private async pull(workspaceId: string, ch: Channel): Promise<void> {
    for (;;) {
      const batch = await this.read(workspaceId, ch.head, BATCH);
      for (const event of batch) {
        ch.head = event.sequence;
        for (const sub of ch.subs) this.deliver(sub, event);
      }
      if (batch.length < BATCH) return;
    }
  }

  private async replay(workspaceId: string, ch: Channel, sub: Sub): Promise<void> {
    if (ch.head - sub.cursor > REPLAY_MAX_EVENTS) {
      sub.cursor = ch.head;
      sub.sink.onResync(ch.head, 'more than ' + String(REPLAY_MAX_EVENTS) + ' events were missed');
      return;
    }
    const first = (await this.read(workspaceId, sub.cursor, 1))[0];
    if (first && this.now() - Date.parse(first.time) > REPLAY_WINDOW_MS) {
      sub.cursor = ch.head;
      sub.sink.onResync(ch.head, 'the missed events are older than 24 hours');
      return;
    }
    while (sub.cursor < ch.head) {
      const before = sub.cursor;
      const batch = await this.read(workspaceId, sub.cursor, BATCH);
      for (const event of batch) if (event.sequence <= ch.head) this.deliver(sub, event);
      if (sub.cursor === before) break;
    }
  }
}
