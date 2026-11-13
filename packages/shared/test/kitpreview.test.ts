// ── [PCODE-291 | S15 | v0.1.0] T30.5 Live component preview with the project's tokens and themes ──
//    Why:  whatever a component's example holds, the preview page keeps its look and nothing that runs,
//          loads or sends; the theme lands on the root so the token variables follow it.
import { describe, expect, it } from 'vitest';
import { previewDocument, sanitizePreviewCss, sanitizePreviewHtml } from '../src/index.js';

describe('the preview page', () => {
  it('keeps markup and drops what can run, load or send', () => {
    const html = sanitizePreviewHtml(
      [
        '<button class="btn" onclick="steal()" type="button">Save</button>',
        '<script>alert(1)</script><SCRIPT src="x.js"></SCRIPT>',
        '<a href="javascript:alert(1)">x</a><a href="#top">top</a>',
        '<img src="https://evil.test/p.gif" alt="t"><img src="data:image/png;base64,AAAA" alt="ok">',
        '<iframe src="/"></iframe><form action="/x"><input name="a"></form>',
        '<div style="color: var(--color-primary)" ONMOUSEOVER=x>ok</div><!-- <script> -->',
      ].join(''),
    );
    expect(html).toBe(
      '<button class="btn" type="button">Save</button><a>x</a><a href="#top">top</a><img alt="t"><img src="data:image/png;base64,AAAA" alt="ok"><div style="color: var(--color-primary)">ok</div>',
    );
  });

  it('keeps CSS on the page', () => {
    expect(
      sanitizePreviewCss(
        "@import url('https://x.test/a.css'); .a{background:url(https://x.test/p.png);color:var(--c)}</style><script>x</script>",
      ),
    ).toBe('.a{background:none;color:var(--c)}x');
  });

  it('puts the theme on the root and the tokens before the component', () => {
    const doc = previewDocument({
      title: 'Button <b>',
      tokensCss: ':root { --color-primary: #4f46e5; }',
      css: '.btn{background:var(--color-primary)}',
      html: '<button class="btn">Go</button>',
      theme: 'high-contrast',
    });
    expect(doc).toContain('<html lang="en" data-theme="high-contrast">');
    expect(doc).toContain('<title>Button &lt;b&gt;</title>');
    expect(doc.indexOf('--color-primary: #4f46e5')).toBeLessThan(doc.indexOf('.btn{'));
    expect(
      previewDocument({ title: '', tokensCss: '', css: '', html: '', theme: '"><x' }),
    ).toContain('data-theme="light"');
  });
});
