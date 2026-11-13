// ── [PCODE-196 | S15 | v0.1.0] B8.4 VS Code: ideation interview, and presence per file and block (workspace switch, off by default) ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-101 | S15 | v0.1.0] Add presence: heartbeats, avatars on cards, who-is-where ──
//    Why:  who is where right now, across every server node. Presence is minutes old at most, so it lives in
//          memory, never in a table. A node applies its own connections' reports at once and tells the other
//          nodes through PostgreSQL NOTIFY; a node that starts asks the others to repeat what they know. An
//          entry without a heartbeat for 45 s expires; a closed connection removes its entry at once.
//          Watchers (the gateway's connections) get a snapshot of their workspace on every change,
//          debounced, and filter it by what their person may see.
import { randomUUID } from 'node:crypto';
import { PRESENCE_EXPIRY_MS, type PresenceEntry } from '@orqiva/shared';
import pg from 'pg';

export const PRESENCE_CHANNEL = 'orqiva_presence';

interface Held {
  entry: PresenceEntry;
  expiresAt: number;
  /** the node that owns the connection */
  node: string;
}

type Wire =
  | { node: string; op: 'set'; ws: string; key: string; entry: PresenceEntry }
  | { node: string; op: 'leave'; ws: string; key: string }
  | { node: string; op: 'hello' };

export type PresenceWatcher = (people: PresenceEntry[]) => void;

export interface PresenceOptions {
  connectionString: string;
  now?: () => number;
  /** how long changes gather before watchers hear of them */
  debounceMs?: number;
  log?: (msg: string, fields?: Record<string, unknown>) => void;
}

export class PresenceHub {
  readonly node = randomUUID();
  /** workspace → connection key → entry */
  private readonly spaces = new Map<string, Map<string, Held>>();
  private readonly watchers = new Map<string, Set<PresenceWatcher>>();
  private readonly pending = new Map<string, NodeJS.Timeout>();
  private client: pg.Client | null = null;
  private sweep: NodeJS.Timeout | null = null;
  private readonly now: () => number;

  constructor(private readonly opts: PresenceOptions) {
    this.now = opts.now ?? Date.now;
  }

  async start(): Promise<void> {
    const client = new pg.Client({
      connectionString: this.opts.connectionString,
      application_name: 'orqiva-presence',
    });
    client.on('notification', (msg) => {
      if (msg.channel !== PRESENCE_CHANNEL || !msg.payload) return;
      try {
        this.receive(JSON.parse(msg.payload) as Wire);
      } catch {
        // a malformed message from another node is ignored
      }
    });
    client.on('error', (err) => {
      this.opts.log?.('presence connection lost', { error: err.message });
    });
    await client.connect();
    await client.query('LISTEN ' + PRESENCE_CHANNEL);
    this.client = client;
    this.sweep = setInterval(() => {
      this.expire();
    }, 5000);
    this.sweep.unref();
    await this.publish({ node: this.node, op: 'hello' });
  }

  async stop(): Promise<void> {
    if (this.sweep) clearInterval(this.sweep);
    for (const t of this.pending.values()) clearTimeout(t);
    const c = this.client;
    this.client = null;
    await c?.end().catch(() => undefined);
  }

  private async publish(message: Wire): Promise<void> {
    await this.client
      ?.query('SELECT pg_notify($1, $2)', [PRESENCE_CHANNEL, JSON.stringify(message)])
      .catch((err: unknown) => {
        this.opts.log?.('presence publish failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      });
  }

  /** A connection on this node reports its place. */
  set(workspaceId: string, key: string, entry: PresenceEntry): void {
    this.apply(workspaceId, key, entry, this.node);
    void this.publish({ node: this.node, op: 'set', ws: workspaceId, key, entry });
  }

  /** A connection on this node left the workspace (or closed). */
  leave(workspaceId: string, key: string): void {
    if (this.remove(workspaceId, key))
      void this.publish({ node: this.node, op: 'leave', ws: workspaceId, key });
  }

  /** Everyone present in a workspace now, one entry per person (their latest place). */
  people(workspaceId: string): PresenceEntry[] {
    const latest = new Map<string, PresenceEntry>();
    for (const held of this.spaces.get(workspaceId)?.values() ?? []) {
      const have = latest.get(held.entry.userId);
      if (!have || held.entry.since > have.since) latest.set(held.entry.userId, held.entry);
    }
    return [...latest.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  watch(workspaceId: string, watcher: PresenceWatcher): () => void {
    let set = this.watchers.get(workspaceId);
    if (!set) {
      set = new Set();
      this.watchers.set(workspaceId, set);
    }
    set.add(watcher);
    watcher(this.people(workspaceId));
    return () => {
      set.delete(watcher);
    };
  }

  private apply(workspaceId: string, key: string, entry: PresenceEntry, node: string): void {
    let space = this.spaces.get(workspaceId);
    if (!space) {
      space = new Map();
      this.spaces.set(workspaceId, space);
    }
    const before = space.get(key)?.entry;
    space.set(key, { entry, expiresAt: this.now() + PRESENCE_EXPIRY_MS, node });
    // a heartbeat that changes nothing does not wake anyone
    if (
      !before ||
      before.projectId !== entry.projectId ||
      before.itemId !== entry.itemId ||
      before.state !== entry.state ||
      before.name !== entry.name ||
      (before.file ?? null) !== (entry.file ?? null) // [PCODE-196 | S15 | v0.1.0] another file
    ) {
      this.changed(workspaceId);
    }
  }

  private remove(workspaceId: string, key: string): boolean {
    const gone = this.spaces.get(workspaceId)?.delete(key) ?? false;
    if (gone) this.changed(workspaceId);
    return gone;
  }

  private receive(m: Wire): void {
    if (m.node === this.node) return;
    if (m.op === 'hello') {
      // a node just started: repeat what this node's own connections are doing
      for (const [ws, space] of this.spaces) {
        for (const [key, held] of space)
          if (held.node === this.node)
            void this.publish({ node: this.node, op: 'set', ws, key, entry: held.entry });
      }
      return;
    }
    if (m.op === 'set') this.apply(m.ws, m.key, m.entry, m.node);
    else this.remove(m.ws, m.key);
  }

  /** Drops entries whose heartbeat stopped. */
  expire(): void {
    const now = this.now();
    for (const [ws, space] of this.spaces) {
      let dropped = false;
      for (const [key, held] of space) {
        if (held.expiresAt < now) {
          space.delete(key);
          dropped = true;
        }
      }
      if (dropped) this.changed(ws);
    }
  }

  private changed(workspaceId: string): void {
    if (this.pending.has(workspaceId)) return;
    const t = setTimeout(() => {
      this.pending.delete(workspaceId);
      const people = this.people(workspaceId);
      for (const w of this.watchers.get(workspaceId) ?? []) w(people);
    }, this.opts.debounceMs ?? 50);
    t.unref();
    this.pending.set(workspaceId, t);
  }
}
