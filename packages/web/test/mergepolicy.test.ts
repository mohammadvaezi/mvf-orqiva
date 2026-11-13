// ── [PCODE-304 | S15 | v0.1.0] T31.5a Conflicts, stacked pull requests, and merge policies the host enforces through a commit status ──
//    Why:  only conflicts and "behind" earn a chip; each verdict has its tone and its words.
import { describe, expect, it } from 'vitest';
import { mergeableChip, VERDICT_TEXT, verdictTone } from '../src/v2/mergepolicy.js';

describe('merge policy in the queue', () => {
  it('flags conflicts and a base that moved on', () => {
    expect(mergeableChip('conflicts')).toEqual({ tone: 'danger', text: 'conflicts' });
    expect(mergeableChip('behind')?.tone).toBe('warning');
    expect(mergeableChip('clean')).toBeNull();
    expect(mergeableChip('unknown')).toBeNull();
  });

  it('gives each verdict a tone and words', () => {
    expect([verdictTone('success'), verdictTone('failure'), verdictTone('pending')]).toEqual([
      'success',
      'danger',
      'warning',
    ]);
    expect(VERDICT_TEXT['failure']).toBe('policy not met');
  });
});
