// ── [PCODE-300 | S15 | v0.1.0] T31.2a Git history from the webhooks: commits, branches, tags; close on merge; revert detection ──
//    Why:  closing words in all their forms and lists, never a mere mention; git's revert message read.
import { describe, expect, it } from 'vitest';
import { branchName, closingNumbers, revertOf } from '../src/index.js';

describe('what commits and pull requests say', () => {
  it('reads closing words and their lists', () => {
    expect(closingNumbers('SHOP', 'Closes SHOP-12')).toEqual([12]);
    expect(closingNumbers('SHOP', 'This fixes shop-4 and resolves SHOP-5')).toEqual([4, 5]);
    expect(closingNumbers('SHOP', 'Fixed: SHOP-1, SHOP-2 and SHOP-3')).toEqual([1, 2, 3]);
    expect(closingNumbers('SHOP', 'SHOP-7 cart; see SHOP-8')).toEqual([]); // named, not closed
    expect(closingNumbers('SHOP', 'prefixes SHOP-9')).toEqual([]); // not the word fixes
    expect(closingNumbers('SHOP', 'Closes MYSHOP-3 and SHOP-30x')).toEqual([]);
  });

  it('reads reverts and branch names', () => {
    expect(
      revertOf(
        'Revert "SHOP-1 Cart keeps items"\n\nThis reverts commit C5FEABDE2D8CD023215AF4D2CEEB7A64839FC428.',
      ),
    ).toEqual({
      sha: 'c5feabde2d8cd023215af4d2ceeb7a64839fc428',
      subject: 'SHOP-1 Cart keeps items',
    });
    expect(revertOf('Revert "Bump version"')).toEqual({ sha: null, subject: 'Bump version' });
    expect(revertOf('Reverting the theme, see notes')).toBeNull();
    expect(branchName('refs/heads/release/2.0')).toBe('release/2.0');
  });
});
