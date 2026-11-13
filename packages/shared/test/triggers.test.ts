// ── [PCODE-246 | S15 | v0.1.0] T25.1 Agent triggers act: assignment, label, mention, CI failure, schedule, webhook ──
import { describe, expect, it } from 'vitest';
import {
  cronMatches,
  mentionTriggered,
  parseCron,
  triggerProblem,
  wallClock,
} from '../src/index.js';

describe('agent triggers', () => {
  it('reads the five cron fields with lists, ranges, steps and names', () => {
    const c = parseCron('*/15 7-9 * * mon-fri');
    expect([...(c?.minutes ?? [])]).toEqual([0, 15, 30, 45]);
    expect([...(c?.hours ?? [])]).toEqual([7, 8, 9]);
    expect([...(c?.weekdays ?? [])]).toEqual([1, 2, 3, 4, 5]);
    expect(parseCron('0 7 * * 7')?.weekdays.has(0)).toBe(true);
    for (const bad of ['', '0 7 * *', '61 * * * *', '0 7 * * 1-9', '5-1 * * * *', 'a b c d e'])
      expect(parseCron(bad)).toBeNull();
  });

  it('matches a minute in the time zone, either day field when both are set', () => {
    const weekdays7 = parseCron('0 7 * * 1-5');
    if (!weekdays7) throw new Error('no cron');
    // 07:00 in Berlin is 05:00 UTC in summer time and 06:00 UTC in winter
    expect(cronMatches(weekdays7, new Date('2026-10-12T05:00:00Z'), 'Europe/Berlin')).toBe(true);
    expect(cronMatches(weekdays7, new Date('2026-12-14T06:00:00Z'), 'Europe/Berlin')).toBe(true);
    expect(cronMatches(weekdays7, new Date('2026-10-12T05:00:00Z'), 'UTC')).toBe(false);
    expect(cronMatches(weekdays7, new Date('2026-10-17T05:00:00Z'), 'Europe/Berlin')).toBe(false);
    const firstOrMonday = parseCron('0 9 1 * 1');
    if (!firstOrMonday) throw new Error('no cron');
    // Thursday 1 Oct 2026 and Monday 5 Oct both start it; Tuesday 6 Oct does not
    expect(cronMatches(firstOrMonday, new Date('2026-10-01T09:00:00Z'), 'UTC')).toBe(true);
    expect(cronMatches(firstOrMonday, new Date('2026-10-05T09:00:00Z'), 'UTC')).toBe(true);
    expect(cronMatches(firstOrMonday, new Date('2026-10-06T09:00:00Z'), 'UTC')).toBe(false);
    // an unknown zone reads as UTC
    expect(wallClock(new Date('2026-10-12T05:00:00Z'), 'Nowhere/Else').hour).toBe(5);
  });

  it('finds a mention only as a word of its own', () => {
    expect(mentionTriggered('Can you look? /coder', '/coder')).toBe(true);
    expect(mentionTriggered('/CODER please', '/coder')).toBe(true);
    expect(mentionTriggered('see src/coder/main.ts', '/coder')).toBe(false);
    expect(mentionTriggered('/coders are busy', '/coder')).toBe(false);
    expect(mentionTriggered('ask @dev-bot', '@dev')).toBe(false);
    expect(mentionTriggered('anything', '')).toBe(false);
  });

  it('says what is wrong with a trigger', () => {
    expect(triggerProblem({ kind: 'label', value: ' ' })).toMatch(/label/);
    expect(triggerProblem({ kind: 'mention', value: 'two words' })).toMatch(/mention/);
    expect(triggerProblem({ kind: 'schedule', value: '0 7 * * 1-5' })).toMatch(/project/);
    expect(triggerProblem({ kind: 'schedule', value: '0 7', project: 'APP' })).toMatch(/cron/);
    expect(triggerProblem({ kind: 'schedule', value: '0 7 * * 1-5', project: 'APP' })).toBeNull();
    expect(triggerProblem({ kind: 'assigned', value: '' })).toBeNull();
  });
});
