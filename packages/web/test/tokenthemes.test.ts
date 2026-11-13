// ── [PCODE-287 | S15 | v0.1.0] T30.1 Design tokens: themes and modes, aliases, W3C import, iOS and Android export ──
//    Why:  an import preview says what a file would change before anything does.
import { describe, expect, it } from 'vitest';
import { importSummary } from '../src/v2/tokenthemes.js';

describe('token import', () => {
  it('says what a file would change, and what it did', () => {
    const r = {
      added: ['a', 'b'],
      changed: ['c'],
      unchanged: 4,
      themesAdded: ['midnight'],
      skipped: [],
    };
    expect(importSummary(r, false)).toBe(
      'The file has 2 new tokens, 1 changed token, 4 unchanged, 1 new theme.',
    );
    expect(importSummary({ ...r, themesAdded: [] }, true)).toBe(
      'Imported: 2 new tokens, 1 changed token, 4 unchanged.',
    );
  });
});
