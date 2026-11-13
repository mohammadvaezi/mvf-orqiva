// ── [PCODE-344 | S15 | v0.1.0] T34.3b Timer idle detection, time reminders, correction reasons for locked weeks ──
//    Why:  a timer left running while someone is away books time nobody worked: ten minutes without input
//          count as away. And the reminders come at the end of a working day and on Friday afternoon.

/** Minutes without input that count as away. */
export const IDLE_MINUTES = 10;

/** Whole minutes away between the last input and now, or 0 when the gap is shorter than the threshold. */
export function awayMinutes(lastInputMs: number, nowMs: number, threshold = IDLE_MINUTES): number {
  const m = Math.floor((nowMs - lastInputMs) / 60_000);
  return m >= threshold ? m : 0;
}

/** Monday 1 … Sunday 7 of a YYYY-MM-DD day. */
export function isoWeekday(day: string): number {
  const d = new Date(day + 'T00:00:00Z').getUTCDay();
  return d === 0 ? 7 : d;
}

/** Whether a reminder is due at this local hour: the day's after 17:00 on a workday, the week's from Friday 15:00. */
export function reminderDue(kind: 'day' | 'week', day: string, hour: number): boolean {
  const wd = isoWeekday(day);
  return kind === 'day' ? wd <= 5 && hour >= 17 : wd === 5 && hour >= 15;
}
