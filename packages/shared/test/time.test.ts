// ── [PCODE-187 | S15 | v0.1.0] B7.3 Time live: timer from the active task, weekly timesheets with approval and lock, rates, absences, reports per client ──
import { describe, expect, it } from 'vitest';
import {
  absenceWorkdays,
  autoStopAt,
  daysOf,
  hoursText,
  isoWeek,
  localDay,
  parseHours,
  pickRate,
  weekOf,
  type RateRow,
} from '../src/time.js';

const rate = (
  scopeType: RateRow['scopeType'],
  scopeKey: string,
  cents: number,
  validFrom = '2026-01-01',
  kind: RateRow['kind'] = 'billable',
): RateRow => ({ scopeType, scopeKey, kind, centsPerHour: cents, validFrom });

describe('time', () => {
  it('takes the most specific rate valid on the day', () => {
    const rates = [
      rate('workspace', '', 9000),
      rate('role', 'member', 10000),
      rate('client', 'c1', 11000),
      rate('client', 'c1', 11500, '2026-10-01'),
      rate('person', 'u2', 13000),
      rate('workspace', '', 5000, '2026-01-01', 'cost'),
    ];
    const who = { userId: 'u1', role: 'member', clientId: 'c1', projectId: 'p1' };
    expect(pickRate(rates, who, 'billable', '2026-09-30')).toBe(11000);
    expect(pickRate(rates, who, 'billable', '2026-10-02')).toBe(11500);
    expect(pickRate(rates, { ...who, userId: 'u2' }, 'billable', '2026-10-02')).toBe(13000);
    expect(pickRate(rates, { ...who, clientId: null }, 'billable', '2026-10-02')).toBe(10000);
    expect(pickRate(rates, who, 'cost', '2026-10-02')).toBe(5000);
    expect(pickRate([], who, 'cost', '2026-10-02')).toBeNull();
  });

  it('knows the week, its days and its number', () => {
    expect(weekOf('2026-10-03')).toBe('2026-09-28');
    expect(daysOf('2026-09-28')[4]).toBe('2026-10-02');
    expect(isoWeek('2026-09-28')).toBe(40);
    expect(isoWeek('2027-01-01')).toBe(53);
  });

  it('writes and reads hours the way people do', () => {
    expect(hoursText(345)).toBe('5,75');
    expect(parseHours('5,75')).toBe(345);
    expect(parseHours('1:30')).toBe(90);
    expect(parseHours('')).toBe(0);
    expect(parseHours('25')).toBeNull();
    expect(parseHours('abc')).toBeNull();
  });

  it('stops a forgotten timer at 19:00 Berlin time', () => {
    expect(autoStopAt(new Date('2026-10-05T05:45:00Z')).toISOString()).toBe(
      '2026-10-05T17:00:00.000Z',
    );
    expect(autoStopAt(new Date('2026-01-12T07:00:00Z')).toISOString()).toBe(
      '2026-01-12T18:00:00.000Z',
    );
    expect(autoStopAt(new Date('2026-10-05T18:30:00Z')).toISOString()).toBe(
      '2026-10-05T22:00:00.000Z',
    );
    expect(localDay(new Date('2026-10-05T22:30:00Z'))).toBe('2026-10-06');
  });

  it('counts the workdays an absence takes', () => {
    const week = daysOf('2026-10-05');
    expect(
      absenceWorkdays({ startsOn: '2026-10-02', endsOn: '2026-10-06', halfDay: false }, week),
    ).toBe(2);
    expect(
      absenceWorkdays({ startsOn: '2026-10-09', endsOn: '2026-10-09', halfDay: true }, week),
    ).toBe(0.5);
    expect(
      absenceWorkdays({ startsOn: '2026-10-10', endsOn: '2026-10-12', halfDay: false }, week),
    ).toBe(0);
  });
});
