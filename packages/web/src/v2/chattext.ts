// ── [PCODE-235 | S15 | v0.1.0] T23.2 Messages in the web app ──
//    Why:  how a message reads on screen, kept apart from React so it is tested on its own: links that
//          open, mentions that stand out (yours more), task references that open the task, `code` and
//          **bold**. Plus how a conversation is laid out: a line for each day, and messages from the same
//          person within five minutes under one name.
import type { MessageJson } from '@orqiva/shared';

export type Token =
  | { kind: 'text'; value: string }
  | { kind: 'url'; value: string }
  | { kind: 'mention'; value: string; me: boolean }
  | { kind: 'ref'; value: string }
  | { kind: 'code'; value: string }
  | { kind: 'bold'; value: string };

const PATTERN =
  /(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])|(?<![\w@])@([\w][\w.-]*[\w])|(?<![\w-])([A-Z][A-Z0-9]{1,9}-\d{1,6})(?![\w-])|`([^`\n]+)`|\*\*([^*\n]+)\*\*/g;

/** A message's text as pieces to draw; `handles` are the people one can mention, `mine` the reader's. */
export function tokens(text: string, handles: ReadonlySet<string>, mine: string): Token[] {
  const out: Token[] = [];
  let at = 0;
  const push = (t: Token): void => {
    const last = out[out.length - 1];
    if (t.kind === 'text' && last?.kind === 'text') last.value += t.value;
    else out.push(t);
  };
  for (const m of text.matchAll(PATTERN)) {
    const i = m.index;
    if (i > at) push({ kind: 'text', value: text.slice(at, i) });
    if (m[1]) push({ kind: 'url', value: m[1] });
    else if (m[2]) {
      const h = m[2].toLowerCase();
      if (handles.has(h)) push({ kind: 'mention', value: '@' + m[2], me: h === mine });
      else push({ kind: 'text', value: m[0] });
    } else if (m[3]) push({ kind: 'ref', value: m[3] });
    else if (m[4]) push({ kind: 'code', value: m[4] });
    else if (m[5]) push({ kind: 'bold', value: m[5] });
    at = i + m[0].length;
  }
  if (at < text.length) push({ kind: 'text', value: text.slice(at) });
  return out;
}

/** The word being typed after an "@" right before the caret, or null. */
export function mentionAt(beforeCaret: string): string | null {
  const m = /(?:^|\s)@([\w.-]*)$/.exec(beforeCaret);
  return m ? (m[1] ?? '') : null;
}

export type Line =
  | { kind: 'day'; key: string; label: string }
  | { kind: 'message'; key: string; message: MessageJson; compact: boolean };

const sameDay = (a: Date, b: Date): boolean => a.toDateString() === b.toDateString();

export function dayLabel(d: Date, now: Date): string {
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(d, now)) return 'Today';
  if (sameDay(d, yesterday)) return 'Yesterday';
  return d.toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    ...(d.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  });
}

/** The conversation as lines: a heading per day, and a name only where the speaker changes. */
export function layout(messages: readonly MessageJson[], now: Date): Line[] {
  const lines: Line[] = [];
  let prev: MessageJson | null = null;
  for (const m of messages) {
    const d = new Date(m.createdAt);
    if (!prev || !sameDay(new Date(prev.createdAt), d))
      lines.push({ kind: 'day', key: 'day-' + d.toDateString(), label: dayLabel(d, now) });
    const compact =
      prev !== null &&
      sameDay(new Date(prev.createdAt), d) &&
      prev.author?.id === m.author?.id &&
      !prev.deleted &&
      d.getTime() - new Date(prev.createdAt).getTime() < 5 * 60_000;
    lines.push({ kind: 'message', key: m.id, message: m, compact });
    prev = m;
  }
  return lines;
}

/** "14:05" */
export const clock = (iso: string): string =>
  new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

/** Messages merged by id: a live one that arrives twice shows once, a changed one replaces the old. */
export function mergeMessages(
  list: readonly MessageJson[],
  more: readonly MessageJson[],
): MessageJson[] {
  const byId = new Map(list.map((m) => [m.id, m]));
  for (const m of more) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
