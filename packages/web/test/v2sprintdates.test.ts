// ── [PCODE-271 | S15 | v0.1.0] Project tabs fixes from the deep UX check: handover double page, service accounts, lifecycle name, extraction duplicates, AI cases picker, webhook events, overdue sprint, tab overflow ──
// ── [PCODE-268 | S15 | v0.1.0] Planning fixes from the UX check: sprint dates in the screen, link hint, bulk bar under the top bar ──
//    Why:  a new sprint starts on the next Monday unless chosen.
import { describe, expect, it } from 'vitest';
import { nextMonday, overdueDays } from '../src/v2/planning.js';

describe('a new sprint', () => {
  it('starts on the next Monday, or today when it is one', () => {
    expect(nextMonday(new Date('2030-01-09T10:00:00Z'))).toBe('2030-01-14');
    expect(nextMonday(new Date('2030-01-14T10:00:00Z'))).toBe('2030-01-14');
    expect(nextMonday(new Date('2030-01-13T10:00:00Z'))).toBe('2030-01-14');
  });
});

// [PCODE-271 | S15 | v0.1.0]
describe('a sprint past its end', () => {
  it('counts the days since its end date', () => {
    const now = new Date('2030-01-12T10:00:00Z');
    expect(overdueDays('2030-01-09', now)).toBe(3);
    expect(overdueDays('2030-01-12', now)).toBe(0);
    expect(overdueDays('2030-01-20', now)).toBeLessThan(0);
    expect(overdueDays(null, now)).toBe(0);
  });
});
