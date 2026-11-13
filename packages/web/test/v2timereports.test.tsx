// ── [PCODE-343 | S15 | v0.1.0] T34.3a Hour budgets with alerts, time reports by person, sprint and task, DATEV export ──
//    Why:  the breakdown's quick ranges: whole weeks from Monday and whole months, across year ends.
import { describe, expect, it } from 'vitest';
import { rangeOf } from '../src/v2/timereports.js';

describe('time breakdown ranges', () => {
  it('names whole months and weeks', () => {
    expect(rangeOf('this-month', '2026-10-15')).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(rangeOf('last-month', '2026-01-10')).toEqual({ from: '2025-12-01', to: '2025-12-31' });
    expect(rangeOf('this-week', '2026-10-15')).toEqual({ from: '2026-10-12', to: '2026-10-18' });
    expect(rangeOf('this-week', '2026-10-18')).toEqual({ from: '2026-10-12', to: '2026-10-18' });
    expect(rangeOf('last-week', '2026-10-12')).toEqual({ from: '2026-10-05', to: '2026-10-11' });
  });
});
