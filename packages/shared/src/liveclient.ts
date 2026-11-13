// ── [PCODE-234 | S15 | v0.1.0] T23.1 Messaging core on the server: channels, direct messages, threads, mentions, live delivery ──
// ── [PCODE-230 | S15 | v0.1.0] T22.3 Presence from and on the phone ──
// ── [PCODE-225 | S15 | v0.1.0] T21.2 Live feed core and offline cache for the phone, in shared ──
// ── [PCODE-196 | S15 | v0.1.0] B8.4 VS Code: ideation interview, and presence per file and block (workspace switch, off by default) ──
// ── [PCODE-96 | S15 | v0.1.0] Build our own local-first sync for items: client cache, optimistic writes, reconnect ──
// ── [PCODE-101 | S15 | v0.1.0] Add presence: heartbeats, avatars on cards, who-is-where ──
// ── [PCODE-105 | S15 | v0.1.0] Move the VS Code extension to the new API over WebSocket and remove polling ──
//    Why:  a client's end of the live connection, the same for the web app and the VS Code extension (which
//          differ only in how they open a socket). It subscribes with the last sequence it has seen, so a
//          reconnect replays exactly what was missed; it reconnects by itself (1 s, doubling to 30 s); and it
//          reports whether the network is there, which is when queued edits go out.
import {
  PRESENCE_HEARTBEAT_MS,
  LIVE_PATH,
  type PresenceEntry,
  type PresenceState,
  type ServerMessage,
} from './live.js';
import type { ActivityEvent } from './events.js';
import type { ChatEvent } from './messages.js';

/** Where this person is: a project, an item in it, and whether they are editing. */
export interface Place {
  projectId: string | null;
  itemId: string | null;
  state: PresenceState;
  /** [PCODE-196 | S15 | v0.1.0] the repo file open in the editor (VS Code) */
  file?: string | null;
  /** [PCODE-230 | S15 | v0.1.0] the phone app says it is a phone */
  device?: 'phone';
}

/** The part of the browser's WebSocket this client uses; tests pass a fake. */
export interface SocketLike {
  onopen: (() => void) | null;
  onclose: (() => void) | null;
  onmessage: ((e: { data: unknown }) => void) | null;
  send(text: string): void;
  close(): void;
}

export interface LiveClientOptions {
  workspaceId: string;
  /** opens a socket to the given URL path: the browser's WebSocket, or our own client in Node */
  open: (path: string) => SocketLike;
  onEvent: (event: ActivityEvent) => void;
  /** the gap was too large to replay: reload, the cursor is already moved on */
  onResync: () => void;
  onStatus?: (online: boolean) => void;
  /** the cursor to start from, e.g. kept from an earlier page */
  after?: number;
  /** [PCODE-101 | S15 | v0.1.0] who is where in the workspace, on every change */
  onPresence?: (people: PresenceEntry[]) => void;
  /** [PCODE-234 | S15 | v0.1.0] a conversation the person may see changed */
  onChat?: (chat: ChatEvent) => void;
}

export class LiveClient {
  private socket: SocketLike | null = null;
  private cursor: number | undefined;
  private delay = 1000;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private ready = false;
  private place: Place | null = null;
  private beat: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly opts: LiveClientOptions) {
    this.cursor = opts.after;
  }

  /** the last sequence received: hand it to the next page to resume from */
  get lastSequence(): number | undefined {
    return this.cursor;
  }

  start(): void {
    this.stopped = false;
    this.connect();
  }

  /** [PCODE-101 | S15 | v0.1.0] Reports where this person is now; repeated as a heartbeat. */
  setPresence(place: Place): void {
    this.place = place;
    this.sendPresence();
  }

  private sendPresence(): void {
    if (!this.ready || !this.place || !this.socket) return;
    this.socket.send(
      JSON.stringify({ type: 'presence', workspaceId: this.opts.workspaceId, ...this.place }),
    );
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.beat) clearInterval(this.beat);
    this.socket?.close();
    this.socket = null;
  }

  /** [PCODE-225 | S15 | v0.1.0] Connects now instead of at the next try (a phone back in front, the network back). */
  reconnectNow(): void {
    if (this.stopped || this.socket) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.delay = 1000;
    this.connect();
  }

  private connect(): void {
    const s = this.opts.open(LIVE_PATH);
    this.socket = s;
    s.onopen = () => {
      this.delay = 1000;
      s.send(
        JSON.stringify({
          type: 'subscribe',
          workspaceId: this.opts.workspaceId,
          ...(this.cursor !== undefined ? { after: this.cursor } : {}),
        }),
      );
    };
    s.onmessage = (e) => {
      if (typeof e.data !== 'string') return;
      let msg: ServerMessage;
      try {
        msg = JSON.parse(e.data) as ServerMessage;
      } catch {
        return;
      }
      if (msg.type === 'event') {
        if (this.cursor === undefined || msg.event.sequence > this.cursor) {
          this.cursor = msg.event.sequence;
          this.opts.onEvent(msg.event);
        }
      } else if (msg.type === 'subscribed') {
        this.cursor ??= msg.sequence;
        this.opts.onStatus?.(true);
        // report where we are as soon as the server can take it, then every heartbeat
        this.ready = true;
        this.sendPresence();
        if (this.beat) clearInterval(this.beat);
        this.beat = setInterval(() => {
          this.sendPresence();
        }, PRESENCE_HEARTBEAT_MS);
      } else if (msg.type === 'presence') {
        this.opts.onPresence?.(msg.people);
      } else if (msg.type === 'chat') {
        this.opts.onChat?.(msg.chat);
      } else if (msg.type === 'resync') {
        this.cursor = msg.sequence;
        this.opts.onResync();
      }
    };
    s.onclose = () => {
      this.socket = null;
      this.ready = false;
      if (this.beat) clearInterval(this.beat);
      this.opts.onPresence?.([]);
      this.opts.onStatus?.(false);
      if (this.stopped) return;
      this.timer = setTimeout(() => {
        this.connect();
      }, this.delay);
      this.delay = Math.min(this.delay * 2, 30_000);
    };
  }
}
