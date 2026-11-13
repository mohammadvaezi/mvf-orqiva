// ── [PCODE-234 | S15 | v0.1.0] T23.1 Messaging core on the server: channels, direct messages, threads, mentions, live delivery ──
//    Why:  conversations arrive live on every server node. The routes announce each change on PostgreSQL
//          NOTIFY inside their transaction, so it is heard once committed; each node loads the message
//          once and hands it to its gateway connections in that workspace, which pass it on only to people
//          who may see the conversation (sees_channel). A conversation's membership change makes those
//          connections look again at what they may see.
import type { Pool } from 'pg';
import pg from 'pg';
import { CHAT_CHANNEL, loadMessage, type ChatWire, type MessageRow } from '../api/messages.js';
import { inSystem } from '../db/pool.js';

export interface ChatChange {
  op: ChatWire['op'];
  channelId: string;
  /** the message as stored, for a new or changed message */
  row?: MessageRow;
}

export type ChatWatcher = (change: ChatChange) => void;

export class ChatHub {
  private client: pg.Client | null = null;
  private readonly watchers = new Map<string, Set<ChatWatcher>>();

  constructor(
    private readonly opts: {
      pool: Pool;
      connectionString: string;
      log?: (msg: string, fields?: Record<string, unknown>) => void;
    },
  ) {}

  async start(): Promise<void> {
    const client = new pg.Client({
      connectionString: this.opts.connectionString,
      application_name: 'orqiva-chat',
    });
    client.on('notification', (msg) => {
      if (msg.channel !== CHAT_CHANNEL || !msg.payload) return;
      let wire: ChatWire;
      try {
        wire = JSON.parse(msg.payload) as ChatWire;
      } catch {
        return;
      }
      void this.receive(wire);
    });
    client.on('error', (err) => {
      this.opts.log?.('chat connection lost', { error: err.message });
    });
    await client.connect();
    await client.query('LISTEN ' + CHAT_CHANNEL);
    this.client = client;
  }

  async stop(): Promise<void> {
    const c = this.client;
    this.client = null;
    await c?.end().catch(() => undefined);
  }

  /** Changes in a workspace, for one gateway connection; returns the way to stop. */
  watch(workspaceId: string, watcher: ChatWatcher): () => void {
    let set = this.watchers.get(workspaceId);
    if (!set) {
      set = new Set();
      this.watchers.set(workspaceId, set);
    }
    set.add(watcher);
    return () => {
      set.delete(watcher);
      if (!set.size) this.watchers.delete(workspaceId);
    };
  }

  private async receive(wire: ChatWire): Promise<void> {
    const set = this.watchers.get(wire.ws);
    if (!set?.size) return;
    let row: MessageRow | undefined;
    if (wire.messageId) {
      const id = wire.messageId;
      row = await inSystem(this.opts.pool, (c) => loadMessage(c, id)).catch(() => undefined);
      if (!row) return;
    }
    const change: ChatChange = { op: wire.op, channelId: wire.channelId, ...(row ? { row } : {}) };
    for (const w of set) w(change);
  }
}
