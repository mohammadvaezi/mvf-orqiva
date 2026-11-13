// ── [PCODE-331 | S15 | v0.1.0] T33.3b Evals: saved cases with checks, eval runs per model or prompt version, pass rates over time ──
//    Why:  checks ignore case and spacing; a case passes only when its run succeeded, every check holds and
//          a needed judge score is high enough; a missing score waits; the pass rate counts decided cases.
import { describe, expect, it } from 'vitest';
import { caseResult, evalChecks, passRate } from '../src/evals.js';

describe('eval checks', () => {
  it('looks for phrases regardless of case and spacing', () => {
    expect(
      evalChecks('The export needs a  Header\nRow.', {
        mustContain: ['header row', ' '],
        mustNotContain: ['looks fine'],
        minJudge: null,
      }),
    ).toEqual([
      { check: 'says “header row”', ok: true },
      { check: 'does not say “looks fine”', ok: true },
    ]);
    expect(
      evalChecks('Looks FINE to me', {
        mustContain: [],
        mustNotContain: ['looks fine'],
        minJudge: null,
      }),
    ).toEqual([{ check: 'does not say “looks fine”', ok: false }]);
  });
});

describe('case results', () => {
  const ok = [{ check: 'x', ok: true }];
  it('passes, fails, runs or waits for the judge', () => {
    expect(caseResult('running', ok, null, null)).toBe('running');
    expect(caseResult('failed', ok, 5, null)).toBe('fail');
    expect(caseResult('succeeded', [{ check: 'x', ok: false }], 5, null)).toBe('fail');
    expect(caseResult('succeeded', ok, null, null)).toBe('pass');
    expect(caseResult('succeeded', ok, null, 4)).toBe('needs judge');
    expect(caseResult('succeeded', ok, 3, 4)).toBe('fail');
    expect(caseResult('succeeded', ok, 4, 4)).toBe('pass');
  });

  it('rates only decided cases', () => {
    expect(passRate(['running', 'needs judge'])).toBeNull();
    expect(passRate(['pass', 'fail', 'pass', 'running'])).toBe(0.67);
  });
});
