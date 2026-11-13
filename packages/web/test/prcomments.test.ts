// ── [PCODE-303 | S15 | v0.1.0] T31.4 Line comments from people and the AI, posted to the host with approve or request changes ──
//    Why:  the review form says what will be posted and what stays; a comment's line has one key per side.
import { describe, expect, it } from 'vitest';
import { DECISION_TEXT, draftsText, lineKey, type LineComment } from '../src/v2/prcomments.js';

const draft = (outdated: boolean): LineComment => ({
  id: 'c',
  path: 'src/a.ts',
  line: 3,
  side: 'new',
  body: 'x',
  source: 'person',
  state: 'draft',
  severity: null,
  author: 'Ada',
  mine: true,
  outdated,
  createdAt: '2026-10-14T09:00:00Z',
  postedAt: null,
});

describe('line comments', () => {
  it('says what the review will post', () => {
    expect(draftsText([])).toBe('No comments on lines waiting to be posted.');
    expect(draftsText([draft(false)])).toBe('1 comment on lines will be posted.');
    expect(draftsText([draft(false), draft(false), draft(true)])).toBe(
      '2 comments on lines will be posted; 1 on a file that changed since stay here.',
    );
  });

  it('tells the old and the new side of a line apart', () => {
    expect(lineKey({ path: 'a.ts', side: 'new', line: 4 })).not.toBe(
      lineKey({ path: 'a.ts', side: 'old', line: 4 }),
    );
  });

  it('words each decision', () => {
    expect(DECISION_TEXT.request_changes).toBe('asked for changes');
  });
});
