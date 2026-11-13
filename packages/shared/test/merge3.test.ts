// ── [PCODE-282 | S15 | v0.1.0] T29.4 Live co-editing of documents with our own three-way merge ──
//    Why:  edits in different places merge cleanly, edits to one line merge word by word, the same words
//          changed differently keep both and are counted, deletions and insertions survive.
import { describe, expect, it } from 'vitest';
import { merge3 } from '../src/merge3.js';

const base = ['# Plan', '', 'We ship on Monday.', '', 'Tests run nightly.', '', 'Owner: Ada'].join(
  '\n',
);

describe('three-way merge', () => {
  it('takes one side when the other did not change', () => {
    expect(merge3(base, base, base + '\nmore')).toEqual({ text: base + '\nmore', conflicts: 0 });
    expect(merge3(base, 'x', base)).toEqual({ text: 'x', conflicts: 0 });
  });

  it('merges edits of different lines', () => {
    const mine = base.replace('Monday', 'Tuesday');
    const theirs = base.replace('nightly', 'hourly') + '\n\nNew part.';
    expect(merge3(base, mine, theirs)).toEqual({
      text: base.replace('Monday', 'Tuesday').replace('nightly', 'hourly') + '\n\nNew part.',
      conflicts: 0,
    });
  });

  it('merges two edits of one line word by word', () => {
    const mine = base.replace('We ship on Monday.', 'We ship on Tuesday.');
    const theirs = base.replace('We ship on Monday.', 'We always ship on Monday.');
    expect(merge3(base, mine, theirs).text).toContain('We always ship on Tuesday.');
    expect(merge3(base, mine, theirs).conflicts).toBe(0);
  });

  it('keeps both when the same words changed differently', () => {
    const mine = base.replace('Monday', 'Tuesday');
    const theirs = base.replace('Monday', 'Friday');
    const r = merge3(base, mine, theirs);
    expect(r.conflicts).toBe(1);
    expect(r.text).toContain('We ship on Friday.\nWe ship on Tuesday.');
  });

  it('keeps an insertion and a deletion made at once', () => {
    const mine = base.replace('Tests run nightly.\n\n', '');
    const theirs = base.replace('# Plan', '# Plan\n\nIntro.');
    expect(merge3(base, mine, theirs)).toEqual({
      text: ['# Plan', '', 'Intro.', '', 'We ship on Monday.', '', 'Owner: Ada'].join('\n'),
      conflicts: 0,
    });
  });

  it('adds both when both appended at the end', () => {
    const r = merge3('a\nb', 'a\nb\nmine', 'a\nb\ntheirs');
    expect(r).toEqual({ text: 'a\nb\ntheirs\nmine', conflicts: 1 });
  });
});

describe('neighbouring lines', () => {
  it('merges changes to two neighbouring lines without a clash', () => {
    const base = '# Live\n\nLine A.\n\nLine B.\n';
    const theirs = base.replace('Line B.', 'Line B, changed.');
    const mine = base + 'Typed here.';
    expect(merge3(base, mine, theirs)).toEqual({
      text: '# Live\n\nLine A.\n\nLine B, changed.\nTyped here.',
      conflicts: 0,
    });
  });
});
