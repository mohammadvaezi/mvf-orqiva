// ── [PCODE-285 | S15 | v0.1.0] T29.7 Documents import (Markdown, Notion, Confluence) and export (Markdown, HTML, PDF, ZIP) ──
//    Why:  an import says what came in and what was left out; the wiki and a folder download from the
//          project's export address.
import { describe, expect, it } from 'vitest';
import { importText, zipHref } from '../src/v2/docio.js';

describe('import and export', () => {
  it('says what an import did', () => {
    const base = { firstPageId: null, skipped: [] as string[] };
    expect(importText({ ...base, kind: 'markdown', pages: 2, folders: 1, files: 1 })).toBe(
      'Imported Markdown: 2 pages, 1 folder, 1 file.',
    );
    expect(
      importText({
        ...base,
        kind: 'confluence',
        pages: 1,
        folders: 0,
        files: 0,
        skipped: ['a.css', 'b.js', 'c', 'd', 'e', 'f'],
      }),
    ).toBe('Imported Confluence export: 1 page. Not read: a.css, b.js, c, d, e …');
  });

  it('points at the wiki and folder ZIPs', () => {
    expect(zipHref('w', 'p')).toBe('/api/workspaces/w/projects/p/docs/export');
    expect(zipHref('w', 'p', 'f')).toBe('/api/workspaces/w/projects/p/docs/export?folder=f');
  });
});
