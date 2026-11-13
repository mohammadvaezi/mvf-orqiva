// ── [PCODE-184 | S15 | v0.1.0] B6.2 Insights live: cycle time, throughput, escaped bugs, AI cost per point, agents vs people for admins, flow, per project, team load ──
import { describe, expect, it } from 'vitest';
import { loadPercent, median, mondayOf, sharedWorkdays, weekStarts } from '../src/insights.js';

describe('insights rules', () => {
  it('takes medians, Mondays and weeks', () => {
    expect([median([]), median([3, 1, 2]), median([4, 1, 2, 3])]).toEqual([null, 2, 2.5]);
    expect(mondayOf(new Date('2026-10-05T12:00:00Z'))).toBe('2026-10-05');
    expect(mondayOf(new Date('2026-10-11T23:00:00Z'))).toBe('2026-10-05');
    expect(weekStarts(3, new Date('2026-10-07T00:00:00Z'))).toEqual([
      '2026-09-21',
      '2026-09-28',
      '2026-10-05',
    ]);
  });

  it('counts shared workdays and load', () => {
    // Mon 5 Oct to Fri 16 Oct against the two weeks from Wed 7 Oct
    expect(sharedWorkdays('2026-10-05', '2026-10-16', '2026-10-07', '2026-10-21')).toBe(8);
    expect(sharedWorkdays('2026-10-01', '2026-10-02', '2026-10-07', '2026-10-21')).toBe(0);
    expect([loadPercent(12, 10), loadPercent(0, 0), loadPercent(3, 0)]).toEqual([120, 0, 999]);
  });
});
