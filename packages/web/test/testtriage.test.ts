// ── [PCODE-317 | S15 | v0.1.0] T32.4a AI triage of test failures and impacted tests first ──
//    Why:  a run's triage reads as one sentence, the most frequent kind first.
import { describe, expect, it } from 'vitest';
import { triageSummary } from '../src/v2/testtriage.js';

describe('triage in the web app', () => {
  it('says what the triage found', () => {
    expect(triageSummary({ test_bug: 1, product_bug: 2 })).toBe(
      'Triaged: 2 product bugs, 1 test bug.',
    );
    expect(triageSummary({})).toBe('Nothing left to triage.');
  });
});
