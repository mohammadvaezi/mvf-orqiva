// ── [PCODE-331 | S15 | v0.1.0] T33.3b Evals: saved cases with checks, eval runs per model or prompt version, pass rates over time ──
//    Why:  phrases typed with commas become a clean list, and a set's last two eval runs compare in words.
import { describe, expect, it } from 'vitest';
import { phraseList, trendText } from '../src/v2/evals.js';

describe('evals in words', () => {
  it('splits phrases at commas', () => {
    expect(phraseList(' header row, utf-8 ,, ')).toEqual(['header row', 'utf-8']);
    expect(phraseList('')).toEqual([]);
  });

  it('compares the latest eval run with the one before', () => {
    expect(trendText([])).toBe('');
    expect(trendText([{ passRate: 0.9 }])).toBe('');
    expect(trendText([{ passRate: 0.9 }, { passRate: 0.7 }])).toBe('+20 points');
    expect(trendText([{ passRate: 0.5 }, { passRate: 0.6 }])).toBe('−10 points');
    expect(trendText([{ passRate: 0.5 }, { passRate: 0.5 }])).toBe('same as before');
    expect(trendText([{ passRate: null }, { passRate: 0.5 }])).toBe('');
  });
});
