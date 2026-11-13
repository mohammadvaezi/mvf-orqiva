// ── [PCODE-188 | S15 | v0.1.0] B7.4 Incidents and on-call live: alerts, incidents with timeline and roles, suspect deploys and rollback, status updates, rotations and escalation, postmortems, SLOs ──
//    Why:  the rules of on-call and reliability, shared by server, web and IDE: who is primary and backup
//          at a moment (turns from the handoff time in the rotation's time zone, a swap taking over, a
//          person on approved leave skipped), how severe an incident reads, and how much of an objective's
//          error budget is left.
import { offsetMinutes } from './time.js';

export interface Rotation {
  memberIds: readonly string[];
  rotationDays: number;
  /** "09:00" */
  handoffTime: string;
  timezone: string;
  /** YYYY-MM-DD: the first turn starts on this day at the handoff time */
  startsOn: string;
}

export interface Swap {
  userId: string;
  startsAt: Date;
  endsAt: Date;
}

/** The local wall-clock minutes since 1970 of an instant in a time zone. */
const localMinutes = (at: Date, tz: string): number =>
  Math.floor(at.getTime() / 60_000) + offsetMinutes(at, tz);

/** Primary and backup at an instant; null when the rotation is empty. */
export function onCallAt(
  r: Rotation,
  at: Date,
  opts: { swaps?: readonly Swap[]; away?: (userId: string, day: string) => boolean } = {},
): { primary: string | null; backup: string | null; swapped: boolean } {
  const n = r.memberIds.length;
  if (!n) return { primary: null, backup: null, swapped: false };
  const [hh, mm] = r.handoffTime.split(':').map(Number);
  const start = Date.parse(r.startsOn + 'T00:00:00Z') / 60_000 + (hh ?? 9) * 60 + (mm ?? 0);
  const local = localMinutes(at, r.timezone);
  const turn = Math.floor((local - start) / (r.rotationDays * 1440));
  const day = new Date(local * 60_000).toISOString().slice(0, 10);
  const away = opts.away ?? (() => false);
  const order: string[] = [];
  for (let k = 0; k < n; k++) {
    const id = r.memberIds[(((turn + k) % n) + n) % n];
    if (id && !order.includes(id)) order.push(id);
  }
  const present = order.filter((id) => !away(id, day));
  const scheduled = present[0] ?? null;
  const swap = (opts.swaps ?? []).find((s) => s.startsAt <= at && s.endsAt > at);
  if (swap) {
    const backup = scheduled !== swap.userId ? scheduled : (present[1] ?? null);
    return { primary: swap.userId, backup, swapped: true };
  }
  return { primary: scheduled, backup: present[1] ?? null, swapped: false };
}

export const INCIDENT_SEVERITIES = ['sev1', 'sev2', 'sev3', 'sev4'] as const;
export type IncidentSeverity = (typeof INCIDENT_SEVERITIES)[number];

/** SEV-2, as people say it. */
export const severityText = (s: string): string => 'SEV-' + s.replace('sev', '');

/** Whether an alert of this severity opens an incident by itself. */
export const pagesBySeverity = (s: IncidentSeverity): boolean => s === 'sev1' || s === 'sev2';

/**
 * How much of the error budget is left, in percent: an objective of 99.5 % allows 0.5 % bad; having
 * used 0.4 % leaves 20 %. Never below 0.
 */
export function errorBudgetLeft(objectivePct: number, goodRatio: number): number {
  const allowed = 1 - objectivePct / 100;
  if (allowed <= 0) return 0;
  const used = 1 - goodRatio;
  return Math.max(0, Math.round((1 - used / allowed) * 1000) / 10);
}

/** Minutes as a short duration: 38 min, 2 h 5 min, 3 days. */
export function durationText(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return String(m) + ' min';
  if (m < 48 * 60) {
    const h = Math.floor(m / 60);
    const r = m % 60;
    return String(h) + ' h' + (r ? ' ' + String(r) + ' min' : '');
  }
  return String(Math.round(m / 1440)) + ' days';
}
