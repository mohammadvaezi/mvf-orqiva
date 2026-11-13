// ── [PCODE-253 | S15 | v0.1.0] T26.2 Capacity from profiles, absences, holidays and agents; Planner proposes assignees and new stories ──
//    Why:  how much a person can take in a sprint, from facts instead of a guess: the working days of the
//          sprint without the workspace's holidays and the person's approved absences, their hours a week
//          spread over the working days, times their focus factor (the part that goes to planned work), in
//          hours or turned into points.
import type { EstimateUnit } from './estimate.js';

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

export interface CapacityInput {
  /** the sprint's first and last day, YYYY-MM-DD */
  from: string;
  to: string;
  workingDays: readonly string[];
  holidays: readonly string[];
  hoursPerWeek: number;
  focusFactor: number;
  absences: readonly { startsOn: string; endsOn: string; halfDay: boolean }[];
  hoursPerPoint: number;
  unit: EstimateUnit;
}

export interface CapacityOut {
  /** working days in the sprint, holidays left out */
  days: number;
  absentDays: number;
  /** hours for planned work */
  hours: number;
  /** in the unit of the project: hours for hours, else points */
  value: number;
}

/** Every day from `from` to `to`, both included. */
export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  const end = Date.parse(to + 'T00:00:00Z');
  for (let t = Date.parse(from + 'T00:00:00Z'); t <= end && out.length < 400; t += 86_400_000)
    out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

export function personCapacity(i: CapacityInput): CapacityOut {
  const work = new Set(i.workingDays);
  const off = new Set(i.holidays);
  const days = daysBetween(i.from, i.to).filter(
    (d) => work.has(WEEKDAYS[new Date(d + 'T00:00:00Z').getUTCDay()] ?? '') && !off.has(d),
  );
  let absent = 0;
  for (const d of days) {
    const a = i.absences.find((x) => x.startsOn <= d && d <= x.endsOn);
    if (a) absent += a.halfDay ? 0.5 : 1;
  }
  const perDay = work.size ? i.hoursPerWeek / work.size : 0;
  const hours = Math.round((days.length - absent) * perDay * i.focusFactor * 10) / 10;
  return {
    days: days.length,
    absentDays: absent,
    hours,
    value:
      i.unit === 'hours' ? Math.round(hours) : Math.round(hours / Math.max(1, i.hoursPerPoint)),
  };
}
