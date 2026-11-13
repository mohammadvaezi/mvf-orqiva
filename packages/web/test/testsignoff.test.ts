// ── [PCODE-316 | S15 | v0.1.0] T32.3b Named run sign-off with a frozen snapshot, and a release gate on tests ──
//    Why:  a frozen run's totals and the test rules read as sentences.
import { describe, expect, it } from 'vitest';
import { ruleText } from '../src/v2/security.js';
import { totalsText } from '../src/v2/testsignoff.js';

describe('sign-off and the test rules', () => {
  it('says what a signed run held and what a test rule asks', () => {
    expect(
      totalsText({ planned: 5, passed: 3, failed: 1, blocked: 0, skipped: 0, untested: 1 }),
    ).toBe('3 passed, 1 failed, 1 not run');
    expect(ruleText({ testsPass: true, testsSigned: true })).toBe(
      'every test passes, a test run is signed off',
    );
  });
});
