// ── [PCODE-184 | S15 | v0.1.0] B6.2 Insights live: cycle time, throughput, escaped bugs, AI cost per point, agents vs people for admins, flow, per project, team load ──
//    Why:  the small rules behind Insights, shared by server and web: a median that ignores nothing, the
//          weeks of a range (Monday to Sunday, in UTC), workdays two spans share, and how full a person
//          or a team is against their capacity.

/** The middle value; null for no values. */
export function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? (s[m] ?? null) : ((s[m - 1] ?? 0) + (s[m] ?? 0)) / 2;
}

/** The Monday of a date's week, as YYYY-MM-DD (UTC). */
export function mondayOf(d: Date): string {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = (x.getUTCDay() + 6) % 7;
  x.setUTCDate(x.getUTCDate() - day);
  return x.toISOString().slice(0, 10);
}

/** The Mondays of the last `n` weeks, the current one last. */
export function weekStarts(n: number, now = new Date()): string[] {
  const last = new Date(mondayOf(now) + 'T00:00:00Z');
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(last);
    d.setUTCDate(d.getUTCDate() - (n - 1 - i) * 7);
    return d.toISOString().slice(0, 10);
  });
}

/** Workdays (Monday to Friday) that [aStart, aEnd] and [bStart, bEnd) share; dates as YYYY-MM-DD. */
export function sharedWorkdays(aStart: string, aEnd: string, bStart: string, bEnd: string): number {
  const from = aStart > bStart ? aStart : bStart;
  const lastA = aEnd;
  const endB = new Date(bEnd + 'T00:00:00Z');
  endB.setUTCDate(endB.getUTCDate() - 1);
  const lastB = endB.toISOString().slice(0, 10);
  const to = lastA < lastB ? lastA : lastB;
  if (from > to) return 0;
  let n = 0;
  for (
    const d = new Date(from + 'T00:00:00Z');
    d.toISOString().slice(0, 10) <= to;
    d.setUTCDate(d.getUTCDate() + 1)
  ) {
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) n += 1;
  }
  return n;
}

/** Booked against available, in percent: 100 is full, above is over-booked. */
export const loadPercent = (booked: number, capacity: number): number =>
  capacity > 0 ? Math.round((booked / capacity) * 100) : booked > 0 ? 999 : 0;
