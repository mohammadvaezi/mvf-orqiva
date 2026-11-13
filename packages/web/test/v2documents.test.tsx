// ── [PCODE-171 | S15 | v0.1.0] B3.4 Documents live in the web app: page tree, Markdown pages with editor, versions and diff, comments, templates, knowledge, health ──
//    Why:  pages render from Markdown without ever turning text into HTML: headings, lists, tasks, tables,
//          code and links render; script, javascript: addresses and raw HTML stay text. The tree keeps
//          folders first and finds the path above a page.
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { pathOf, treeOf, type DocNode } from '../src/v2/documents.js';
import { Markdown, parseBlocks, type MdLinks } from '../src/v2/markdown.js';
import { ProjectTabsV2 } from '../src/v2/projecttabs.js';

const ID = '0b1f6a52-3c1e-4d7a-9a51-2f0f6c1d2e3a';
const links: MdLinks = {
  page: (t) => (t.id === ID || t.title === 'Glossary' ? '#doc-' + ID : null),
  go: () => undefined,
};
const md = (text: string): string =>
  renderToString(<Markdown text={text} links={links} />).replace(/<!-- -->/g, '');

describe('markdown', () => {
  it('reads the blocks the templates use', () => {
    const b = parseBlocks(
      '# Title\n\nSome *text* here\nand more.\n\n- [ ] open\n- [x] done\n\n1. one\n2. two\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n```mermaid\ngraph TD\n```\n\n> quoted\n\n---',
    );
    expect(b.map((x) => x.t)).toEqual(['h', 'p', 'list', 'list', 'table', 'code', 'quote', 'hr']);
    expect(b[1]).toEqual({ t: 'p', text: 'Some *text* here and more.' });
    expect(b[2]).toMatchObject({
      ordered: false,
      items: [
        { text: 'open', done: false },
        { text: 'done', done: true },
      ],
    });
  });

  it('renders formatting, tables, task lists and code', () => {
    const html = md(
      '## Steps\n\n**Bold** and *it* and `code`.\n\n- [x] Drained\n\n| Time | What |\n| --- | --- |\n| 10:00 | Alert |\n\n```sh\nrm -rf /tmp/x\n```',
    );
    expect(html).toContain('<h3>Steps</h3>');
    expect(html).toContain('<strong>Bold</strong>');
    expect(html).toContain('<em>it</em>');
    expect(html).toContain('<code>code</code>');
    expect(html).toContain('checked=""');
    expect(html).toContain('<td>Alert</td>');
    expect(html).toContain('rm -rf /tmp/x');
  });

  it('links pages by id and title, and the web; marks unknown pages', () => {
    const html = md(
      '[runbook](/docs/' + ID + ') [[Glossary]] [[Missing page]] https://example.com/a.',
    );
    expect(html.match(/href="#doc-/g)).toHaveLength(2);
    expect(html).toContain('No page with this title yet');
    expect(html).toContain(
      'href="https://example.com/a" target="_blank" rel="noreferrer noopener"',
    );
  });

  it('never turns text into HTML or script', () => {
    const html = md(
      '<script>alert(1)</script> [x](javascript:alert(1)) <img src=x onerror=alert(1)>',
    );
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('href="javascript');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('tree', () => {
  const node = (
    id: string,
    parentId: string | null,
    kind = 'page',
    rank = 1,
    title = id,
  ): DocNode => ({ id, parentId, kind, title, rank, tags: [] }) as unknown as DocNode;
  const nodes = [
    node('a', null, 'page', 1),
    node('f', null, 'folder', 2, 'Ops'),
    node('x', 'f'),
    node('y', 'x'),
    node('orphan', 'gone'),
  ];

  it('puts folders first and keeps orphans at the top', () => {
    const t = treeOf(nodes);
    expect(t.get(null)?.map((n) => n.id)).toEqual(['f', 'a', 'orphan']);
    expect(t.get('x')?.map((n) => n.id)).toEqual(['y']);
  });

  it('finds the path above a page', () => {
    expect(pathOf(nodes, 'y').map((n) => n.id)).toEqual(['f', 'x']);
  });

  it('has a Documents tab for the team', () => {
    expect(
      renderToString(
        <ProjectTabsV2
          projectId={ID}
          view="documents"
          portal={false}
          role="member"
          go={() => undefined}
        />,
      ),
    ).toMatch(/aria-current="page"[^>]*>.*?Documents<\/a>/);
  });
});
