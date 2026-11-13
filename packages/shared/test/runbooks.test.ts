// ── [PCODE-342 | S15 | v0.1.0] T34.2c AI postmortems and runbooks matched to incidents ──
//    Why:  trigger words match regardless of case; a drafted postmortem's Actions list becomes actions.
import { describe, expect, it } from 'vitest';
import { postmortemActions, runbookMatches, triggerWords } from '../src/runbooks.js';

describe('runbooks', () => {
  it('splits trigger words and matches them in any text', () => {
    expect(triggerWords('Disk full, no space left\nDisk full, x')).toEqual([
      'disk full',
      'no space left',
    ]);
    expect(runbookMatches('disk full, no space left', ['Alert: No space left on device'])).toBe(
      true,
    );
    expect(runbookMatches('disk full', ['Booking slow', 'p95 above 3 s'])).toBe(false);
    expect(runbookMatches(' , ', ['anything'])).toBe(false);
  });
  it('takes the actions from the Actions section only', () => {
    const md =
      '### Why\n\n- not an action\n\n### Actions\n\n- Add an alert\n* [ ] Write a runbook\n2. Check deploys\n\n### Notes\n- no';
    expect(postmortemActions(md)).toEqual(['Add an alert', 'Write a runbook', 'Check deploys']);
    expect(postmortemActions('no sections')).toEqual([]);
  });
});
