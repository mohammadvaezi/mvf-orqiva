// ── [PCODE-302 | S15 | v0.1.0] T31.3 PR review queue (riskiest first) and side-by-side diff with fingerprints and viewed files ──
//    Why:  the queue says how far the reader got, and risk and checks get the tones the server's words mean.
import { describe, expect, it } from 'vitest';
import { checksTone, progressText, riskTone } from '../src/v2/prreview.js';

describe('the review queue', () => {
  it('says how far the reader got', () => {
    expect(progressText(null, 0)).toBe('files not read yet');
    expect(progressText(0, 0)).toBe('no files');
    expect(progressText(1, 0)).toBe('0 of 1 file viewed');
    expect(progressText(5, 2)).toBe('2 of 5 files viewed');
    expect(progressText(5, 5)).toBe('all 5 files viewed');
  });

  it('colours risk and checks by what the server says', () => {
    expect([riskTone('high'), riskTone('medium'), riskTone('low')]).toEqual([
      'danger',
      'warning',
      'success',
    ]);
    expect(['passing', 'failing', 'pending', 'none'].map(checksTone)).toEqual([
      'success',
      'danger',
      'info',
      'neutral',
    ]);
  });
});
