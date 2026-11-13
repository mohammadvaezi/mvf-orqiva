// ── [PCODE-323 | S15 | v0.1.0] T32.7b VEX statements and the security posture per version ──
//    Why:  a version's open vulnerabilities read as words, and every OpenVEX status and reason has its text.
import { VEX_JUSTIFICATIONS, VEX_STATUSES } from '@orqiva/shared';
import { describe, expect, it } from 'vitest';
import { JUSTIFICATION_TEXT, STATUS_TEXT, openText } from '../src/v2/securityversions.js';

describe('security per version', () => {
  it('says what is open', () => {
    expect(openText({ critical: 1, high: 2, medium: 0, low: 0 })).toBe('1 critical, 2 high');
    expect(openText({ critical: 0, high: 0, medium: 0, low: 0 })).toBe('none open');
  });

  it('has words for every status and reason', () => {
    for (const s of VEX_STATUSES) expect(STATUS_TEXT[s]).toBeTruthy();
    for (const j of VEX_JUSTIFICATIONS) expect(JUSTIFICATION_TEXT[j]).toBeTruthy();
  });
});
