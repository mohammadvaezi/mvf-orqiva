// ── [PCODE-282 | S15 | v0.1.0] T29.4 Live co-editing of documents with our own three-way merge ──
//    Why:  an answer that crosses new typing is merged with it, so neither the others' change nor the
//          typing is lost; an answer without crossing typing is taken as it is.
import { describe, expect, it } from 'vitest';
import { rebase } from '../src/v2/livedoc.js';

describe('live editing in the browser', () => {
  const sent = { title: 'Plan', body: 'one\ntwo\nthree' };
  it('takes the answer when nothing was typed meanwhile', () => {
    expect(rebase(sent, sent, { title: 'Plan', body: 'one\n2\nthree' })).toEqual({
      title: 'Plan',
      body: 'one\n2\nthree',
      conflicts: 0,
    });
  });

  it('merges the answer with what was typed while it was on its way', () => {
    const typed = { title: 'Plan B', body: 'one\ntwo\nthree\nfour' };
    expect(rebase(sent, typed, { title: 'Plan', body: 'ONE\ntwo\nthree' })).toEqual({
      title: 'Plan B',
      body: 'ONE\ntwo\nthree\nfour',
      conflicts: 0,
    });
  });
});
