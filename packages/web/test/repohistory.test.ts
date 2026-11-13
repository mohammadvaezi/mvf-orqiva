// ── [PCODE-301 | S15 | v0.1.0] T31.2b Git history backfill through the hosts' APIs; branches and tags in the Repositories screen ──
//    Why:  what a read of the past brought, said in one line.
import { describe, expect, it } from 'vitest';
import { backfillText } from '../src/v2/repohistory.js';

describe('reading the history', () => {
  it('says what came in', () => {
    expect(
      backfillText({ commits: 500, branches: 12, tags: 4, pullRequests: 200, linked: 61 }),
    ).toBe('500 commits, 12 branches, 4 tags and 200 pull requests read; 61 links to tasks.');
  });
});
