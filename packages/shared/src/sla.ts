// ── [PCODE-255 | S15 | v0.1.0] T26.4 Planning details: keys, bulk edit, undo, shared views, item history, Git moves, bug SLAs ──
//    Why:  how long a bug may stay open by its priority, and how much of that time is left, the same on the
//          server that alerts and in the web app that shows the clock.

export const DEFAULT_BUG_SLA_HOURS: Record<string, number> = {
  urgent: 8,
  high: 24,
  medium: 72,
  low: 168,
};

/** When a bug of this priority must be fixed, or null when its priority has no fix time. */
export function slaDue(
  createdAt: string,
  priority: string,
  hours: Record<string, unknown> = DEFAULT_BUG_SLA_HOURS,
): string | null {
  const h = hours[priority];
  if (typeof h !== 'number' || h <= 0) return null;
  return new Date(Date.parse(createdAt) + h * 3_600_000).toISOString();
}

/** "3 h left", "2 d left", "5 h over". */
export function slaLeftText(due: string, now: Date = new Date()): string {
  const ms = Date.parse(due) - now.getTime();
  const h = Math.abs(ms) / 3_600_000;
  const amount =
    h >= 48 ? String(Math.round(h / 24)) + ' d' : String(Math.max(1, Math.round(h))) + ' h';
  return amount + (ms >= 0 ? ' left' : ' over');
}

/** The moves a Git host's news makes, by state name; an empty name moves nothing. */
export interface GitMoves {
  branch: string;
  opened: string;
  merged: string;
}
