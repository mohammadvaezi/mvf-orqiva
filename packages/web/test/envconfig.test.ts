// ── [PCODE-307 | S15 | v0.1.0] T31.7 Environment config diff: variables, secrets, settings, flags and versions side by side ──
//    Why:  a missing key names the environment it is missing from; an expected difference says so.
import { describe, expect, it } from 'vitest';
import { stateText } from '../src/v2/envconfig.js';

describe('environment config diff', () => {
  it('says where a key is missing, and what is expected', () => {
    expect(stateText({ state: 'only_a', expected: false }, 'Staging', 'Production')).toBe(
      'missing in Production',
    );
    expect(stateText({ state: 'only_b', expected: false }, 'Staging', 'Production')).toBe(
      'missing in Staging',
    );
    expect(stateText({ state: 'different', expected: true }, 'S', 'P')).toBe(
      'different (expected)',
    );
    expect(stateText({ state: 'same', expected: true }, 'S', 'P')).toBe('same');
  });
});
