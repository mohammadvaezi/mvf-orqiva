// ── [PCODE-285 | S15 | v0.1.0] T29.7 Documents import (Markdown, Notion, Confluence) and export (Markdown, HTML, PDF, ZIP) ──
//    Why:  a Confluence page reads back as Markdown (headings, emphasis, links, images, nested lists,
//          tables, code, info boxes as callouts) with page furniture left out; a page exports as HTML with
//          its blocks, math and diagrams, and nothing from the page can become markup.
import { describe, expect, it } from 'vitest';
import { htmlToMarkdown, parseHtml, findNode } from '../src/htmlmd.js';
import { htmlDocument, markdownToHtml } from '../src/mdhtml.js';

describe('HTML to Markdown', () => {
  it('reads a Confluence page body', () => {
    const md = htmlToMarkdown(
      `<html><head><title>Ops : Runbook</title><style>x{}</style></head><body>
      <div id="main-content" class="wiki-content">
        <h1>Restart</h1>
        <p>Run <code>make restart</code> on <strong>both</strong> nodes, see <a href="Deploy_12.html">Deploy</a>.</p>
        <div class="confluence-information-macro confluence-information-macro-warning"><p>Back up first.</p></div>
        <ul><li>One<ul><li>One a</li></ul></li><li>Two</li></ul>
        <table><tbody><tr><th>Step</th><th>Who</th></tr><tr><td>1</td><td>Ops | on call</td></tr></tbody></table>
        <pre class="syntaxhighlighter-pre" data-syntaxhighlighter-params="brush: bash">systemctl restart api</pre>
        <p><img src="attachments/12/shot.png" alt="Shot"></p>
        <script>evil()</script>
      </div></body></html>`,
      {
        url: (h, kind) =>
          kind === 'image' ? '/files/' + (h.split('/').pop() ?? '') : h.replace('.html', ''),
      },
    );
    expect(md).toBe(
      [
        '# Restart',
        '',
        'Run `make restart` on **both** nodes, see [Deploy](Deploy_12).',
        '',
        '> [!WARNING]',
        '> Back up first.',
        '',
        '- One',
        '  - One a',
        '- Two',
        '',
        '| Step | Who |',
        '| --- | --- |',
        '| 1 | Ops \\| on call |',
        '',
        '```bash',
        'systemctl restart api',
        '```',
        '',
        '![Shot](/files/shot.png)',
        '',
      ].join('\n'),
    );
  });

  it('forgives unclosed paragraphs and items', () => {
    const tree = parseHtml('<ul><li>a<li>b</ul><p>one<p>two');
    expect(findNode(tree, (n) => n.tag === 'ul')?.children.length).toBe(2);
    expect(htmlToMarkdown('<p>one<p>two')).toBe('one\n\ntwo\n');
  });
});

describe('Markdown to HTML', () => {
  it('writes blocks, callouts, math and diagrams, and escapes the page', () => {
    const html = markdownToHtml(
      [
        '# Plan <script>',
        '',
        '> [!TIP] Fast',
        '> Use $x^2$.',
        '',
        '- [x] done',
        '- [ ] open',
        '',
        '| a | b |',
        '| --- | --- |',
        '| 1 | <b> |',
        '',
        '```mermaid',
        'graph LR',
        'A --> B',
        '```',
        '',
        '![shot](/api/x)',
        '[evil](javascript:alert(1))',
      ].join('\n'),
      { url: (h, kind) => (kind === 'image' ? 'data:image/png;base64,AAAA' : h) },
    );
    expect(html).toContain('<h1>Plan &lt;script&gt;</h1>');
    expect(html).toContain('<aside class="callout tip"><strong>Fast</strong>');
    expect(html).toContain('<msup><mi>x</mi><mn>2</mn></msup>');
    expect(html).toContain('<li class="task"><input type="checkbox" disabled checked> done</li>');
    expect(html).toContain('<td>&lt;b&gt;</td>');
    expect(html).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
    expect(html).toContain('<img src="data:image/png;base64,AAAA" alt="shot">');
    expect(html).not.toContain('javascript:');
    expect(htmlDocument('A & B', '<p>x</p>', 'Version 2')).toContain('<title>A &amp; B</title>');
  });
});
