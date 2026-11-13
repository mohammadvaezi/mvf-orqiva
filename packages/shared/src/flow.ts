// ── [PCODE-254 | S15 | v0.1.0] T26.3 Flow and backlog: links, WIP limits, warnings, definition of done, triage, templates, recurring tasks ──
//    Why:  the rules of flow shared by the server and the web app: how a link reads from either side, when a
//          repeating template is next due, and which entries of a definition are still open.

export const LINK_KINDS = ['relates', 'duplicates', 'blocks'] as const;
export type LinkKind = (typeof LINK_KINDS)[number];

/** A link as it reads from the task on either side of it. */
export function linkText(kind: LinkKind, outgoing: boolean): string {
  if (kind === 'relates') return 'relates to';
  if (kind === 'duplicates') return outgoing ? 'duplicates' : 'is duplicated by';
  return outgoing ? 'blocks' : 'is blocked by';
}

export const REPEATS = ['none', 'daily', 'weekly', 'monthly'] as const;
export type Repeat = (typeof REPEATS)[number];

const day = (d: Date): string => d.toISOString().slice(0, 10);

/**
 * The first day after `after` (YYYY-MM-DD) a repeating template makes its next task: every day, every week on
 * an ISO weekday (1 Monday … 7 Sunday), every month on a day (1 … 28). Null when it does not repeat.
 */
export function nextRepeat(repeat: Repeat, on: number | null, after: string): string | null {
  const d = new Date(after + 'T00:00:00Z');
  if (repeat === 'none') return null;
  if (repeat === 'daily') {
    d.setUTCDate(d.getUTCDate() + 1);
    return day(d);
  }
  if (repeat === 'weekly') {
    const want = (on ?? 1) % 7; // ISO 7 is Sunday, getUTCDay 0
    do d.setUTCDate(d.getUTCDate() + 1);
    while (d.getUTCDay() !== want);
    return day(d);
  }
  const dom = Math.min(28, Math.max(1, on ?? 1));
  const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), dom));
  if (next.getTime() <= d.getTime()) next.setUTCMonth(next.getUTCMonth() + 1);
  return day(next);
}

/** The entries of a definition not ticked off yet, in its order. */
export const openEntries = (definition: readonly string[], ticked: readonly string[]): string[] =>
  definition.filter((e) => !ticked.includes(e));
