// ── [PCODE-306 | S15 | v0.1.0] T31.6 Versions from commits: conventional commits, tags and components per path ──
//    Why:  the step from the last version to the next reads the same everywhere.
import { describe, expect, it } from 'vitest';
import { stepText } from '../src/v2/versionplan.js';

describe('version plans', () => {
  it('says the step', () => {
    expect(stepText({ lastVersion: '1.2.0', next: '2.0.0' })).toBe('1.2.0 → 2.0.0');
    expect(stepText({ lastVersion: null, next: '0.1.0' })).toBe('first version 0.1.0');
    expect(stepText({ lastVersion: '1.2.0', next: null })).toBe('stays at 1.2.0');
    expect(stepText({ lastVersion: null, next: null })).toBe('no version yet');
  });
});
