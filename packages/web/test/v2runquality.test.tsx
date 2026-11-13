// ── [PCODE-330 | S15 | v0.1.0] T33.3a Run quality: annotations, judge scores, outcomes ──
//    Why:  the verdicts and the outcomes read back in a few words.
import { describe, expect, it } from 'vitest';
import { outcomeLine } from '../src/v2/agentspage.js';
import { verdictText } from '../src/v2/runquality.js';

describe('run quality in words', () => {
  it('counts what people said', () => {
    expect(verdictText([])).toBe('nobody said yet');
    const a = { userId: 'u', name: 'Ada', tags: [], note: '', at: '' };
    expect(
      verdictText([
        { ...a, verdict: 'good' },
        { ...a, verdict: 'good' },
        { ...a, verdict: 'bad' },
      ]),
    ).toBe('2 good, 1 bad');
  });

  it('lists outcomes with something in them', () => {
    expect(outcomeLine(undefined)).toBe('—');
    expect(outcomeLine({ done: 0, merged: 0, reverted: 0, open: 0 })).toBe('—');
    expect(outcomeLine({ done: 1, merged: 4, reverted: 1, open: 2 })).toBe(
      '4 merged · 1 done · 1 reverted · 2 open',
    );
  });
});
