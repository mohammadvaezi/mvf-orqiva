// ── [PCODE-344 | S15 | v0.1.0] T34.3b Timer idle detection, time reminders, correction reasons for locked weeks ──
//    Why:  ten minutes without input count as away; reminders come after 17:00 on workdays and from Friday 15:00.
import { describe, expect, it } from 'vitest';
import { awayMinutes, isoWeekday, reminderDue } from '../src/timeidle.js';

describe('idle time and reminders', () => {
  it('counts whole minutes away from ten on', () => {
    const t0 = Date.UTC(2026, 9, 15, 12, 0);
    expect(awayMinutes(t0, t0 + 9 * 60_000 + 59_000)).toBe(0);
    expect(awayMinutes(t0, t0 + 10 * 60_000)).toBe(10);
    expect(awayMinutes(t0, t0 + 47 * 60_000 + 30_000)).toBe(47);
  });
  it('knows when reminders are due', () => {
    expect(isoWeekday('2026-10-15')).toBe(4);
    expect(isoWeekday('2026-10-18')).toBe(7);
    expect(reminderDue('day', '2026-10-15', 16)).toBe(false);
    expect(reminderDue('day', '2026-10-15', 17)).toBe(true);
    expect(reminderDue('day', '2026-10-17', 18)).toBe(false);
    expect(reminderDue('week', '2026-10-15', 18)).toBe(false);
    expect(reminderDue('week', '2026-10-16', 15)).toBe(true);
  });
});
