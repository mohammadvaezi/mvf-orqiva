// ── [PCODE-295 | S15 | v0.1.0] T30.8b Visual regression: baselines, pixel diff, orq visual check, the Visual tab ──
//    Why:  states read as words and shares as percents.
import { describe, expect, it } from 'vitest';
import { percent, statusText, STATUS_TONE, when } from '../src/v2/visual.js';

describe('visual checks', () => {
  it('names states and shares', () => {
    expect(statusText('fail')).toBe('changed');
    expect(statusText('new')).toBe('waits for a baseline');
    expect(STATUS_TONE['fail']).toBe('danger');
    expect(percent(0.001)).toBe('0.10 %');
    const d = new Date(2026, 9, 12, 21, 7);
    expect(when(d.toISOString())).toBe('2026-10-12 21:07'); // the viewer's own time, not UTC
  });
});
