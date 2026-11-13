// ── [PCODE-420 | S15 | v0.1.0] T37 medium: English screens use English number and date formats ──
// ── [PCODE-188 | S15 | v0.1.0] B7.4 Incidents and on-call live: alerts, incidents with timeline and roles, suspect deploys and rollback, status updates, rotations and escalation, postmortems, SLOs ──
// ── [PCODE-187 | S15 | v0.1.0] B7.3 Time live: timer from the active task, weekly timesheets with approval and lock, rates, absences, reports per client ──
//    Why:  the rules of Time, shared by server, web and IDE: which rate applies (the most specific one
//          valid on the day), the days of a week, hours in the German format the rest of the product
//          uses, when a forgotten timer stops, and how many workdays an absence takes from a week.

export interface RateRow {
  scopeType: 'workspace' | 'role' | 'person' | 'client' | 'project';
  scopeKey: string;
  kind: 'billable' | 'cost';
  centsPerHour: number;
  validFrom: string;
}

const SPECIFIC: RateRow['scopeType'][] = ['person', 'project', 'client', 'role', 'workspace'];

/** The rate for one person's hour on a day: person, then project, client, role, workspace; null if none. */
export function pickRate(
  rates: readonly RateRow[],
  who: { userId: string; role: string; clientId: string | null; projectId: string | null },
  kind: 'billable' | 'cost',
  day: string,
): number | null {
  const key: Record<RateRow['scopeType'], string | null> = {
    person: who.userId,
    project: who.projectId,
    client: who.clientId,
    role: who.role,
    workspace: '',
  };
  for (const scope of SPECIFIC) {
    const want = key[scope];
    if (want === null) continue;
    const hit = rates
      .filter(
        (r) =>
          r.kind === kind && r.scopeType === scope && r.scopeKey === want && r.validFrom <= day,
      )
      .sort((a, b) => b.validFrom.localeCompare(a.validFrom))[0];
    if (hit) return hit.centsPerHour;
  }
  return null;
}

/** The Monday of a day's week, as YYYY-MM-DD. */
export function weekOf(day: string): string {
  const d = new Date(day + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

/** The seven days of the week that starts on a Monday. */
export function daysOf(monday: string): string[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + i);
    return d.toISOString().slice(0, 10);
  });
}

/** ISO week number, for "Week 40". */
export function isoWeek(day: string): number {
  const d = new Date(day + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 3 - ((d.getUTCDay() + 6) % 7));
  const first = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  return (
    1 +
    Math.round(
      ((d.getTime() - first.getTime()) / 86_400_000 - 3 + ((first.getUTCDay() + 6) % 7)) / 7,
    )
  );
}

/** Minutes as hours with two decimals, German format unless told otherwise: 345 → "5,75". */
// [PCODE-420 | S15 | v0.1.0] the web passes the workspace's format
export const hoursText = (minutes: number, locale = 'de-DE'): string =>
  (minutes / 60).toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Hours typed by a person ("5,75", "5.5", "1:30") as minutes; null when it is not a time. */
export function parseHours(text: string): number | null {
  const t = text.trim();
  if (t === '') return 0;
  const hm = /^(\d{1,2}):([0-5]\d)$/.exec(t);
  if (hm) return Number(hm[1]) * 60 + Number(hm[2]);
  const n = Number(t.replace(',', '.'));
  if (!Number.isFinite(n) || n < 0 || n > 24) return null;
  return Math.round(n * 60);
}

/** The offset of a time zone from UTC at an instant, in minutes. */
export function offsetMinutes(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(at);
  const v = (k: string): number => Number(parts.find((p) => p.type === k)?.value ?? 0);
  const local = Date.UTC(v('year'), v('month') - 1, v('day'), v('hour'), v('minute'));
  return Math.round((local - Math.floor(at.getTime() / 60_000) * 60_000) / 60_000);
}

/** The day an instant falls on in a time zone, as YYYY-MM-DD. */
export function localDay(at: Date, timeZone = 'Europe/Berlin'): string {
  return new Date(at.getTime() + offsetMinutes(at, timeZone) * 60_000).toISOString().slice(0, 10);
}

/** When a forgotten timer stops: 19:00 on the day it started, or midnight if it started later. */
export function autoStopAt(startedAt: Date, timeZone = 'Europe/Berlin'): Date {
  const day = localDay(startedAt, timeZone);
  const seven = new Date(day + 'T19:00:00Z');
  const at = new Date(seven.getTime() - offsetMinutes(seven, timeZone) * 60_000);
  if (at > startedAt) return at;
  const midnight = new Date(day + 'T00:00:00Z');
  midnight.setUTCDate(midnight.getUTCDate() + 1);
  return new Date(midnight.getTime() - offsetMinutes(midnight, timeZone) * 60_000);
}

/** Workdays (Monday to Friday) an absence takes from the given days; half a day counts 0.5. */
export function absenceWorkdays(
  a: { startsOn: string; endsOn: string; halfDay: boolean },
  days: readonly string[],
): number {
  let n = 0;
  for (const d of days) {
    const wd = new Date(d + 'T00:00:00Z').getUTCDay();
    if (wd === 0 || wd === 6) continue;
    if (d >= a.startsOn && d <= a.endsOn) n += a.halfDay ? 0.5 : 1;
  }
  return n;
}
