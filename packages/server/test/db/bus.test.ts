// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-94 | S15 | v0.1.0] Build our own event bus: outbox relay, LISTEN/NOTIFY wake-up, 24 h replay ──
import type { ActivityData, ActivityEvent } from '@orqiva/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inSystem, inWorkspace } from '../../src/db/pool.js';
import { EventBus, type Subscriber } from '../../src/events/bus.js';
import { recordEvent } from '../../src/events/outbox.js';
import { createTestDb, hasDatabase, type TestDb } from './testdb.js';

const data = (label: string): ActivityData => ({
  actor: { kind: 'system', id: 'test' },
  verb: 'created',
  object: { type: 'item', id: label, label },
});

/** Collects what a subscriber receives. */
function collector(): Subscriber & { events: ActivityEvent[]; resyncs: string[] } {
  const events: ActivityEvent[] = [];
  const resyncs: string[] = [];
  return {
    events,
    resyncs,
    onEvent: (e) => events.push(e),
    onResync: (_s, reason) => resyncs.push(reason),
  };
}

async function until(cond: () => boolean, ms = 5000): Promise<void> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe.skipIf(!hasDatabase)('event bus (PostgreSQL)', () => {
  let db: TestDb;
  let ws = '';
  const buses: EventBus[] = [];
  const newBus = async (opts: { pollMs?: number; now?: () => number } = {}): Promise<EventBus> => {
    const bus = new EventBus(db.pool, {
      connectionString: db.url,
      pollMs: opts.pollMs ?? 60_000,
      ...(opts.now ? { now: opts.now } : {}),
    });
    await bus.start();
    buses.push(bus);
    return bus;
  };
  const emit = (label: string): Promise<ActivityEvent> =>
    inWorkspace(db.pool, ws, (c) => recordEvent(c, ws, data(label)));

  beforeAll(async () => {
    db = await createTestDb();
    ws = await inSystem(
      db.pool,
      async (c) =>
        (
          await c.query<{ id: string }>(
            "INSERT INTO workspaces (slug, name) VALUES ('bus', 'Bus') RETURNING id",
          )
        ).rows[0]?.id ?? '',
    );
  }, 60_000);

  afterAll(async () => {
    await Promise.all(buses.map((b) => b.stop()));
    await db.drop();
  });

  it('delivers committed events in sequence order, and never a rolled-back one', async () => {
    const bus = await newBus();
    const got = collector();
    await bus.subscribe(ws, got);
    await emit('one');
    await expect(
      inWorkspace(db.pool, ws, async (c) => {
        await recordEvent(c, ws, data('rolled back'));
        throw new Error('abort');
      }),
    ).rejects.toThrow('abort');
    await Promise.all([emit('two'), emit('three'), emit('four')]);
    await until(() => got.events.length === 4);
    expect(got.events.map((e) => e.sequence)).toEqual([1, 2, 3, 4]);
    expect(got.events.map((e) => e.data.object.label)).not.toContain('rolled back');
  });

  it('delivers every event on two server nodes at once', async () => {
    const [n1, n2] = [await newBus(), await newBus()];
    const [a, b] = [collector(), collector()];
    await n1.subscribe(ws, a);
    await n2.subscribe(ws, b);
    for (let i = 0; i < 10; i++) await emit('burst ' + String(i));
    await until(() => a.events.length === 10 && b.events.length === 10);
    expect(a.events.map((e) => e.sequence)).toEqual(b.events.map((e) => e.sequence));
  });

  it('replays the gap to a subscriber that comes back with its last sequence, then goes live', async () => {
    const bus = await newBus();
    const got = collector();
    await bus.subscribe(ws, got, 10);
    expect(got.events[0]?.sequence).toBe(11);
    const last = got.events.at(-1)?.sequence ?? 0;
    await emit('after the replay');
    await until(() => got.events.at(-1)?.sequence === last + 1);
    const seqs = got.events.map((e) => e.sequence);
    expect(seqs).toEqual(seqs.map((_s, i) => 11 + i));
  });

  it('asks for a resync instead of replaying events older than 24 hours', async () => {
    const bus = await newBus({ now: () => Date.now() + 25 * 3600 * 1000 });
    const got = collector();
    await bus.subscribe(ws, got, 0);
    expect(got.events).toEqual([]);
    expect(got.resyncs).toEqual(['the missed events are older than 24 hours']);
  });

  it('catches up through the poll when a notification never arrives', async () => {
    const bus = await newBus({ pollMs: 50 });
    const got = collector();
    await bus.subscribe(ws, got);
    // written straight into the outbox, without NOTIFY: only the poll can find it
    await inSystem(db.pool, async (c) => {
      const seq = Number(
        (
          await c.query<{ s: string }>(
            'UPDATE workspace_event_counters SET last_sequence = last_sequence + 1 WHERE workspace_id = $1 RETURNING last_sequence AS s',
            [ws],
          )
        ).rows[0]?.s,
      );
      const event = {
        specversion: '1.0',
        id: crypto.randomUUID(),
        source: '/workspaces/' + ws,
        type: 'orqiva.item.created',
        time: new Date().toISOString(),
        subject: 'silent',
        datacontenttype: 'application/json',
        workspaceid: ws,
        sequence: seq,
        data: data('silent'),
      };
      await c.query(
        "INSERT INTO activity_events (workspace_id, sequence, id, type, time, actor_kind, actor_id, object_type, object_id, envelope) VALUES ($1, $2, $3, $4, now(), 'system', 'test', 'item', 'silent', $5)",
        [ws, seq, event.id, event.type, JSON.stringify(event)],
      );
    });
    await until(() => got.events.some((e) => e.data.object.label === 'silent'));
  });

  it('stops delivering after unsubscribe', async () => {
    const bus = await newBus();
    const got = collector();
    const off = await bus.subscribe(ws, got);
    off();
    await emit('nobody listens');
    await new Promise((r) => setTimeout(r, 300));
    expect(got.events).toEqual([]);
  });
});
