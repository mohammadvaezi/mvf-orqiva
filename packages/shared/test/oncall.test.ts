// ── [PCODE-188 | S15 | v0.1.0] B7.4 Incidents and on-call live: alerts, incidents with timeline and roles, suspect deploys and rollback, status updates, rotations and escalation, postmortems, SLOs ──
import { describe, expect, it } from 'vitest';
import { durationText, errorBudgetLeft, onCallAt, severityText } from '../src/oncall.js';

const rot = {
  memberIds: ['jonas', 'ole', 'lea'],
  rotationDays: 7,
  handoffTime: '09:00',
  timezone: 'Europe/Berlin',
  startsOn: '2026-09-28',
};

describe('on-call', () => {
  it('hands over at 09:00 local time, in turn', () => {
    // Monday 28 Sep, 08:59 Berlin (06:59 UTC): before the first turn, the last one still holds
    expect(onCallAt(rot, new Date('2026-09-28T06:59:00Z')).primary).toBe('lea');
    expect(onCallAt(rot, new Date('2026-09-28T07:00:00Z'))).toEqual({
      primary: 'jonas',
      backup: 'ole',
      swapped: false,
    });
    expect(onCallAt(rot, new Date('2026-10-05T07:00:00Z')).primary).toBe('ole');
    expect(onCallAt({ ...rot, rotationDays: 1 }, new Date('2026-09-30T12:00:00Z')).primary).toBe(
      'lea',
    );
    expect(onCallAt({ ...rot, memberIds: [] }, new Date()).primary).toBeNull();
  });

  it('skips people on leave and honours a swap', () => {
    const at = new Date('2026-09-29T12:00:00Z');
    expect(
      onCallAt(rot, at, { away: (id, day) => id === 'jonas' && day === '2026-09-29' }),
    ).toEqual({
      primary: 'ole',
      backup: 'lea',
      swapped: false,
    });
    const swaps = [
      {
        userId: 'lea',
        startsAt: new Date('2026-09-29T00:00:00Z'),
        endsAt: new Date('2026-09-30T00:00:00Z'),
      },
    ];
    expect(onCallAt(rot, at, { swaps })).toEqual({
      primary: 'lea',
      backup: 'jonas',
      swapped: true,
    });
  });

  it('reads severity, budget and durations', () => {
    expect(severityText('sev2')).toBe('SEV-2');
    expect(errorBudgetLeft(99.5, 0.996)).toBe(20);
    expect(errorBudgetLeft(99.9, 0.99)).toBe(0);
    expect(errorBudgetLeft(99.9, 1)).toBe(100);
    expect(durationText(38)).toBe('38 min');
    expect(durationText(125)).toBe('2 h 5 min');
    expect(durationText(4320)).toBe('3 days');
  });
});
