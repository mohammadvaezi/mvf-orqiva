// ── [PCODE-290 | S15 | v0.1.0] T30.4 UI kit in the code: component usage, a lint for non-token values, the agent rule ──
//    Why:  the last scan is said in one sentence, also when there is none or nothing was found.
import { describe, expect, it } from 'vitest';
import { scanSummary } from '../src/v2/kitchecks.js';

describe('the kit scan summary', () => {
  it('says what the last scan found', () => {
    expect(scanSummary({ scan: null, withToken: 0, files: [] })).toBe(
      'The code has not been scanned yet.',
    );
    const at = '2026-10-12T10:00:00Z';
    const day = new Date(at).toLocaleDateString();
    expect(
      scanSummary({ scan: { files: 40, findings: 3, by: 'Ada', at }, withToken: 1, files: [] }),
    ).toBe(
      '40 UI files scanned ' +
        day +
        ' by Ada: 3 colours and sizes written by hand, 1 of them with a token of the same value.',
    );
    expect(
      scanSummary({ scan: { files: 2, findings: 0, by: null, at }, withToken: 0, files: [] }),
    ).toBe('2 UI files scanned ' + day + ': no colours or sizes written by hand.');
  });
});
