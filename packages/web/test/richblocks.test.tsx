// ── [PCODE-279 | S15 | v0.1.0] T29.1 Document blocks: callouts, math and Mermaid diagrams rendered by our own code ──
//    Why:  the page Markdown reads callouts, display and inline math and Mermaid blocks, draws them as
//          elements, and shows the source when something cannot be read; a price is not mistaken for math.
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Markdown, parseBlocks } from '../src/v2/markdown.js';

describe('rich document blocks', () => {
  it('reads callouts and display math as blocks', () => {
    expect(
      parseBlocks(
        '> [!WARNING] Before you deploy\n> Back up first.\n\n$$\n\\frac{a}{b}\n$$\n\n> plain',
      ),
    ).toEqual([
      { t: 'callout', kind: 'warning', title: 'Before you deploy', text: 'Back up first.' },
      { t: 'math', tex: '\\frac{a}{b}' },
      { t: 'quote', text: 'plain' },
    ]);
    expect(parseBlocks('$$E = mc^2$$')).toEqual([{ t: 'math', tex: 'E = mc^2' }]);
  });

  it('draws callouts, MathML, inline math and an SVG diagram', () => {
    const html = renderToString(
      <Markdown
        text={[
          '> [!TIP]',
          '> Use $x^2$ here.',
          '',
          'It costs $5 and $10 today, and $a+b$ is math.',
          '',
          '```mermaid',
          'graph LR',
          'A[Start] --> B[End]',
          '```',
        ].join('\n')}
      />,
    );
    expect(html).toContain('class="v2-callout v2-callout--tip"');
    expect(html).toContain('<msup><mi>x</mi><mn>2</mn></msup>');
    expect(html).toContain('It costs $5 and $10 today');
    expect(html).toContain('<mi>a</mi><mo>+</mo><mi>b</mi>');
    expect(html).toContain('<svg class="v2-dia"');
    expect(html).toContain('>Start</text>');
  });

  it('shows the source with the reason when it cannot draw', () => {
    const html = renderToString(
      <Markdown text={'```mermaid\npie\n "a": 1\n```\n\n$$\\begin{x}$$'} />,
    );
    expect(html).toContain('pie diagrams are not drawn yet');
    expect(html).toContain('class="v2-math-error"');
  });
});
