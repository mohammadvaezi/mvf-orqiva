// ── [PCODE-234 | S15 | v0.1.0] T23.1 Messaging core on the server: channels, direct messages, threads, mentions, live delivery ──
// ── [PCODE-230 | S15 | v0.1.0] T22.3 Presence from and on the phone ──
// ── [PCODE-196 | S15 | v0.1.0] B8.4 VS Code: ideation interview, and presence per file and block (workspace switch, off by default) ──
// ── [PCODE-95 | S15 | v0.1.0] Build our own WebSocket gateway (RFC 6455) with typed protocol and SSE fallback ──
//    Why:  the messages between the server and every live client (web, VS Code, mobile), typed once. A
//          client subscribes to a workspace (optionally one project) with the last sequence it has; the
//          server replays the gap, says "subscribed", then streams events. JSON text frames only.
import type { ActivityEvent } from './events.js';
import type { ChatEvent } from './messages.js';

export const LIVE_PATH = '/live';

// ── [PCODE-101 | S15 | v0.1.0] Add presence: heartbeats, avatars on cards, who-is-where ──
/** Where someone is right now: task level only, never files, keystrokes or screen time. */
export type PresenceState = 'viewing' | 'editing';

export interface PresenceEntry {
  userId: string;
  name: string;
  kind: 'user' | 'agent';
  projectId: string | null;
  itemId: string | null;
  state: PresenceState;
  /** when they arrived where they are now (ISO) */
  since: string;
  /** [PCODE-196 | S15 | v0.1.0] the repo file they have open, only where the workspace shares files */
  file?: string | null;
  /** [PCODE-230 | S15 | v0.1.0] where they are from, when it is the phone app */
  device?: 'phone';
}

/** Clients report their place on every move and every PRESENCE_HEARTBEAT_MS; silent entries expire. */
export const PRESENCE_HEARTBEAT_MS = 15_000;
export const PRESENCE_EXPIRY_MS = 45_000;

export type ClientMessage =
  | { type: 'subscribe'; workspaceId: string; after?: number; projectId?: string }
  | { type: 'unsubscribe'; workspaceId: string }
  | { type: 'ping'; id?: string }
  | {
      type: 'presence';
      workspaceId: string;
      projectId: string | null;
      itemId: string | null;
      state: PresenceState;
      /** [PCODE-196 | S15 | v0.1.0] the repo path open in the editor; dropped unless the workspace shares files */
      file?: string | null;
      /** [PCODE-230 | S15 | v0.1.0] sent by the phone app */
      device?: 'phone';
    };

export type ServerMessage =
  | { type: 'welcome'; protocol: number; userId: string }
  | { type: 'subscribed'; workspaceId: string; sequence: number }
  | { type: 'event'; event: ActivityEvent }
  | { type: 'resync'; workspaceId: string; sequence: number; reason: string }
  | { type: 'pong'; id?: string }
  | { type: 'error'; code: string; message: string; workspaceId?: string }
  | { type: 'presence'; workspaceId: string; people: PresenceEntry[] }
  // [PCODE-234 | S15 | v0.1.0] a conversation the reader may see changed
  | { type: 'chat'; workspaceId: string; chat: ChatEvent };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── [PCODE-196 | S15 | v0.1.0] a repo-relative path: forward slashes, no way out of the repository ──
export function isRepoPath(v: unknown): v is string {
  return (
    typeof v === 'string' &&
    v.length > 0 &&
    v.length <= 400 &&
    !v.startsWith('/') &&
    !/^[a-z]:/i.test(v) &&
    // no backslash and no control character
    !Array.from({ length: v.length }, (_, i) => v.charCodeAt(i)).some((c) => c === 92 || c < 32) &&
    !v.split('/').some((p) => p === '..' || p === '')
  );
}

/** Parses a client frame's text; null when it is not a message we know. */
export function parseClientMessage(text: string): ClientMessage | null {
  let m: unknown;
  try {
    m = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof m !== 'object' || m === null) return null;
  const o = m as Record<string, unknown>;
  if (o['type'] === 'ping')
    return typeof o['id'] === 'string' ? { type: 'ping', id: o['id'] } : { type: 'ping' };
  const ws = o['workspaceId'];
  if (typeof ws !== 'string' || !UUID.test(ws)) return null;
  if (o['type'] === 'unsubscribe') return { type: 'unsubscribe', workspaceId: ws };
  if (o['type'] === 'presence') {
    const pid = o['projectId'] ?? null;
    const iid = o['itemId'] ?? null;
    const state = o['state'];
    if (pid !== null && (typeof pid !== 'string' || !UUID.test(pid))) return null;
    if (iid !== null && (typeof iid !== 'string' || !UUID.test(iid))) return null;
    if (state !== 'viewing' && state !== 'editing') return null;
    // [PCODE-196 | S15 | v0.1.0] a file is a plain repo path; anything else is not presence
    const file = o['file'] ?? null;
    if (file !== null && !isRepoPath(file)) return null;
    // [PCODE-230 | S15 | v0.1.0] the phone says so; any other device value is not presence
    const device = o['device'];
    if (device !== undefined && device !== 'phone') return null;
    return {
      type: 'presence',
      workspaceId: ws,
      projectId: pid,
      itemId: iid,
      state,
      ...(file ? { file } : {}),
      ...(device ? { device } : {}),
    };
  }
  if (o['type'] !== 'subscribe') return null;
  const after = o['after'];
  const projectId = o['projectId'];
  if (after !== undefined && (typeof after !== 'number' || !Number.isInteger(after) || after < 0))
    return null;
  if (projectId !== undefined && (typeof projectId !== 'string' || !UUID.test(projectId)))
    return null;
  return {
    type: 'subscribe',
    workspaceId: ws,
    ...(after !== undefined ? { after } : {}),
    ...(projectId !== undefined ? { projectId } : {}),
  };
}
