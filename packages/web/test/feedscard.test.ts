// ── [PCODE-322 | S15 | v0.1.0] T32.7a EPSS and known-exploited feeds, CVE alerts against shipped versions ──
//    Why:  the feeds' state reads as one sentence, and says why they are off until an admin decides.
import { describe, expect, it } from 'vitest';
import { feedsText } from '../src/v2/feedscard.js';

describe('the feeds card', () => {
  it('says what the feeds know', () => {
    expect(feedsText({ on: false, lastAt: null, cves: 3, known: 0, exploited: 0 })).toContain(
      'EPSS is sent the CVE ids',
    );
    expect(
      feedsText({ on: true, lastAt: '2026-10-14T06:00:00Z', cves: 3, known: 2, exploited: 1 }),
    ).toBe('2 of 3 CVEs scored, 1 known to be exploited; read 2026-10-14.');
    expect(feedsText({ on: true, lastAt: null, cves: 1, known: 0, exploited: 0 })).toBe(
      '0 of 1 CVE scored; not read yet.',
    );
  });
});
