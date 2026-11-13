// ── [PCODE-283 | S15 | v0.1.0] T29.5 Documents: named versions in the screen, visual diff, mentions in comments, page search and Cmd-K ──
//    Why:  a rendered diff finds added, removed and changed blocks; search passages mark their matches;
//          Cmd-K lists pages after tasks and opens them by their address.
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { commandRows } from '../src/commandbar.js';
import { blockDiff, RenderedDiff } from '../src/v2/docdiff.js';
import { snippetParts } from '../src/v2/documents.js';

describe('the visual diff and search', () => {
  it('compares versions block by block', () => {
    const from = '# Plan\n\nShip on Monday.\n\nOld part.\n';
    const to = '# Plan\n\nShip on Tuesday.\n\nNew part.\n\nMore.\n';
    expect(blockDiff(from, to)).toEqual([
      { op: 'same', text: '# Plan' },
      { op: 'change', from: 'Ship on Monday.', to: 'Ship on Tuesday.' },
      { op: 'change', from: 'Old part.', to: 'New part.' },
      { op: 'add', text: 'More.' },
    ]);
    const html = renderToString(<RenderedDiff from={from} to={to} links={null} />);
    expect(html).toContain('<del>Monday.</del><ins>Tuesday.</ins>');
    expect(html).toContain('class="v2-rdiff-add"');
    expect(renderToString(<RenderedDiff from="a" to="a" links={null} />)).toContain(
      'The texts are the same.',
    );
  });

  it('marks what a search passage matched', () => {
    expect(renderToString(<p>{snippetParts('roll «back» a failed «deploy»')}</p>)).toBe(
      '<p>roll <mark>back</mark> a failed <mark>deploy</mark></p>',
    );
  });

  it('lists pages in Cmd-K and opens them by address', () => {
    const went: string[] = [];
    const rows = commandRows(
      'roll',
      [],
      {
        items: [],
        projects: [],
        docs: [{ id: 'd1', title: 'Rollback runbook', projectId: 'p1', projectKey: 'APP' }],
      },
      (p) => {
        went.push(p);
      },
    );
    expect(rows.map((r) => [r.label, r.hint])).toEqual([['Rollback runbook', 'Page in APP']]);
    rows[0]?.run();
    expect(went).toEqual(['/projects/p1/documents?page=d1']);
  });
});
