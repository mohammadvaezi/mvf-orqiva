// ── [PCODE-330 | S15 | v0.1.0] T33.3a Run quality: annotations, judge scores, outcomes ──
//    Why:  the judge's answer is read even when wrapped in words, a score outside 1–5 is no score, and a
//          revert outweighs a merge, a merge a done task.
import { describe, expect, it } from 'vitest';
import { outcomeOf, parseJudge } from '../src/runquality.js';

describe('the judge', () => {
  it('reads the JSON inside an answer', () => {
    expect(
      parseJudge('Here it is:\n```json\n{"score": 4, "reason": " Mostly done. "}\n```'),
    ).toEqual({
      score: 4,
      reason: 'Mostly done.',
    });
    expect(parseJudge('{"score": 4.6}')).toEqual({ score: 5, reason: '' });
  });

  it('gives no score for a missing or impossible one', () => {
    expect(parseJudge('I think it was fine.')).toBeNull();
    expect(parseJudge('{"score": 9, "reason": "x"}')).toBeNull();
    expect(parseJudge('{"score": "4"}')).toBeNull();
    expect(parseJudge('{score: 4}')).toBeNull();
  });
});

describe('outcomes', () => {
  const f = { hasTask: true, reverted: false, merged: false, done: false };
  it('takes the strongest sign', () => {
    expect(outcomeOf({ ...f, hasTask: false, merged: true })).toBe('none');
    expect(outcomeOf(f)).toBe('open');
    expect(outcomeOf({ ...f, done: true })).toBe('done');
    expect(outcomeOf({ ...f, done: true, merged: true })).toBe('merged');
    expect(outcomeOf({ ...f, done: true, merged: true, reverted: true })).toBe('reverted');
  });
});
