// ── [PCODE-349 | S15 | v0.1.0] T35.2b Slack and Teams bridges, personal calendar feed, CI pipeline runs ──
//    Why:  a bridge says in words what it posts.
import { describe, expect, it } from 'vitest';
import { bridgeSummary } from '../src/v2/bridgespanel.js';

describe('bridges in the hub', () => {
  it('says what a bridge posts', () => {
    expect(bridgeSummary({ topics: ['incidents', 'ci'], channelName: 'ops' })).toBe(
      'incidents opened and resolved, failed ci runs and test runs, the messages of #ops',
    );
    expect(bridgeSummary({ topics: [], channelName: null })).toBe('nothing yet');
  });
});
