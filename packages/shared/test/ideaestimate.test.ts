// ── [PCODE-276 | S15 | v0.1.0] T28.5 Idea estimates: size, confidence range from estimate vs actual, basis from similar past tasks ──
//    Why:  the size of an idea, a range from history or the standard cone, how confident it is, and when a
//          task's estimate is far from what its look-alikes took.
import { describe, expect, it } from 'vitest';
import { estimateRange, ideaSize, offFromBasis, quantile, rangeText } from '../src/ideaestimate.js';

describe('idea estimates', () => {
  it('sizes an idea by its points', () => {
    expect([1, 3, 4, 8, 20, 21, 40, 80, 81].map(ideaSize)).toEqual([
      'XS',
      'XS',
      'S',
      'S',
      'M',
      'L',
      'L',
      'XL',
      'XXL',
    ]);
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
  });

  it('uses the standard cone without history, and says so', () => {
    const r = estimateRange(20, [1.2, 0.9]);
    expect(r).toMatchObject({
      size: 'M',
      low: 15,
      likely: 20,
      high: 32,
      lowDays: 3,
      likelyDays: 4,
      highDays: 7,
      confidence: 'low',
      basis: 'standard',
      history: 2,
    });
    expect(rangeText(r)).toBe(
      'M · likely 4 days (3–7), low confidence (standard spread: fewer than 5 finished tasks with logged time)',
    );
  });

  it('takes the range from history, leaving out logging mistakes', () => {
    const ratios = [1, 1.1, 1.2, 1.3, 1.4, 50, 0.01];
    const r = estimateRange(10, ratios);
    expect(r).toMatchObject({ basis: 'history', history: 5, likely: 12, confidence: 'medium' });
    expect(r.low).toBeCloseTo(10.8);
    expect(r.high).toBeCloseTo(13.2);
    const steady = estimateRange(
      10,
      Array.from({ length: 24 }, (_, i) => 1 + (i % 4) * 0.1),
    );
    expect(steady.confidence).toBe('high');
    expect(rangeText(steady)).toContain('high confidence from 24 finished tasks');
  });

  it('marks a task far from its look-alikes', () => {
    expect(offFromBasis(2, 5)).toBe(true);
    expect(offFromBasis(8, 3)).toBe(true);
    expect(offFromBasis(3, 5)).toBe(false);
    expect(offFromBasis(3, null)).toBe(false);
  });
});
