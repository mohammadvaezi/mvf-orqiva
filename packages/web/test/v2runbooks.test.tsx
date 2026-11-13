// ── [PCODE-342 | S15 | v0.1.0] T34.2c AI postmortems and runbooks matched to incidents ──
//    Why:  a runbook is kept only with a title, a trigger word and its steps.
import { describe, expect, it } from 'vitest';
import { canSave } from '../src/v2/runbooks.js';

describe('runbooks', () => {
  it('needs a title, a trigger word and steps', () => {
    expect(canSave({ title: 'Disk full', pattern: 'disk full', body: '1. Clean up' })).toBe(true);
    expect(canSave({ title: 'Disk full', pattern: ' , ', body: '1. Clean up' })).toBe(false);
    expect(canSave({ title: ' ', pattern: 'disk', body: 'x' })).toBe(false);
    expect(canSave({ title: 'Disk', pattern: 'disk', body: '' })).toBe(false);
  });
});
