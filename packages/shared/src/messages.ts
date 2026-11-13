// ── [PCODE-234 | S15 | v0.1.0] T23.1 Messaging core on the server: channels, direct messages, threads, mentions, live delivery ──
//    Why:  the shapes of Orqiva's own conversations, the same for the server, the web app, VS Code and
//          the phone: channels and direct messages, messages with threads and reactions, and the live
//          notice the gateway sends when something changes. Plus the small rules: a channel's name, the
//          key of a direct conversation, which reactions are allowed, task references in a text.

export interface ChannelJson {
  id: string;
  kind: 'channel' | 'direct';
  /** a channel's name ("general"); a direct conversation has none */
  name: string | null;
  topic: string;
  projectId: string | null;
  clientId: string | null;
  private: boolean;
  /** the people of a direct conversation or a private channel (others may be in public channels) */
  members: { id: string; name: string }[];
  joined: boolean;
  muted: boolean;
  unread: number;
  /** someone mentioned the reader in a message not read yet */
  mentioned: boolean;
  lastMessageAt: string | null;
  archived: boolean;
}

export interface ReactionJson {
  emoji: string;
  count: number;
  mine: boolean;
}

export interface MessageJson {
  id: string;
  channelId: string;
  parentId: string | null;
  author: { id: string; name: string } | null;
  body: string;
  fileIds: string[];
  /** [PCODE-235 | S15 | v0.1.0] the attached files, to show them */
  files: { id: string; name: string; mime: string; sizeBytes: number }[];
  itemId: string | null;
  replyCount: number;
  lastReplyAt: string | null;
  reactions: ReactionJson[];
  createdAt: string;
  editedAt: string | null;
  deleted: boolean;
}

/** What the live gateway sends about a conversation the reader may see. */
export type ChatEvent =
  | { op: 'message'; message: MessageJson }
  | { op: 'updated'; message: MessageJson }
  | { op: 'channel'; channelId: string };

/** "Release Planning!" → "release-planning": lower case, digits, dashes and underscores, up to 80. */
export function channelName(typed: string): string | null {
  const n = typed
    .trim()
    .toLowerCase()
    .replace(/^#/, '')
    .replace(/[\s.]+/g, '-')
    .replace(/[^a-z0-9_-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '')
    .slice(0, 80);
  return /^[a-z0-9][a-z0-9_-]{0,79}$/.test(n) ? n : null;
}

/** One direct conversation per set of people, in any order. */
export const dmKey = (userIds: readonly string[]): string => [...new Set(userIds)].sort().join(',');

/** The reactions people can add: short, recognisable, the same everywhere. */
export const REACTIONS = ['👍', '👀', '✅', '🎉', '❤️', '😄', '🙏', '🚀', '⚠️', '❓'] as const;

/** Task references in a text, e.g. "APP-12", each once, in order. */
export function taskRefsIn(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/(?<![\w-])([A-Z][A-Z0-9]{1,9}-\d{1,6})(?![\w-])/g)) {
    const ref = m[1] ?? '';
    if (ref && !out.includes(ref)) out.push(ref);
  }
  return out;
}

/** A short preview of a message for notifications and lists. */
export function messagePreview(body: string, max = 140): string {
  const flat = body.replace(/\s+/g, ' ').trim();
  return flat.length > max ? flat.slice(0, max - 1).trimEnd() + '…' : flat;
}
