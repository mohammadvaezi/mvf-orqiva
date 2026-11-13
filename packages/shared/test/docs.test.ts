// ── [PCODE-169 | S15 | v0.1.0] B3.2 Documents and UI kit on the server: page tree, versions, comments, backlinks, templates, knowledge, tokens, components, mockups, assets ──
//    Why:  links found in pages, the line diff, WCAG contrast and the four token formats.
import { describe, expect, it } from 'vitest';
import {
  contrastGrade,
  contrastRatio,
  DOC_TEMPLATES,
  lineDiff,
  pageLinks,
  tokensToCss,
  tokensToTailwind,
  tokensToTs,
  tokensToW3c,
  type DesignToken,
} from '../src/docs.js';

const ID = '0b1f6a52-3c1e-4d7a-9a51-2f0f6c1d2e3a';

describe('documents', () => {
  it('finds links to pages by id and title, and to the web', () => {
    const l = pageLinks(
      'See [the runbook](/docs/' +
        ID +
        ') and [[Glossary]]. Also https://example.com/a, and [spec](https://w3.org/x).',
    );
    expect(l.pageIds).toEqual([ID]);
    expect(l.titles).toEqual(['Glossary']);
    expect(l.urls.sort()).toEqual(['https://example.com/a', 'https://w3.org/x']);
  });

  it('diffs two versions line by line', () => {
    expect(lineDiff('a\nb\nc', 'a\nc\nd')).toEqual([
      { op: 'same', text: 'a' },
      { op: 'del', text: 'b' },
      { op: 'same', text: 'c' },
      { op: 'add', text: 'd' },
    ]);
  });

  it('offers the six page templates', () => {
    expect(DOC_TEMPLATES.map((t) => t.key)).toEqual([
      'adr',
      'rfc',
      'runbook',
      'postmortem',
      'meeting',
      'api',
    ]);
  });
});

describe('ui kit', () => {
  it('measures contrast as WCAG does', () => {
    expect(contrastRatio('#000', '#ffffff')).toBe(21);
    expect(contrastRatio('#777777', '#fff')).toBe(4.48);
    expect(contrastGrade(4.48)).toBe('AA large');
    expect(contrastGrade(7.1)).toBe('AAA');
    expect(contrastRatio('red', '#fff')).toBeNull();
  });

  const tokens: DesignToken[] = [
    {
      name: 'color.primary',
      type: 'color',
      valueLight: '#4f46e5',
      valueDark: '#818cf8',
      description: 'Actions',
    },
    {
      name: 'color.text.muted',
      type: 'color',
      valueLight: '#6b7280',
      valueDark: '',
      description: '',
    },
    { name: 'space.4', type: 'dimension', valueLight: '16px', valueDark: '', description: '' },
  ];

  it('writes CSS variables with a dark mode', () => {
    const css = tokensToCss(tokens);
    expect(css).toContain('--color-primary: #4f46e5;');
    expect(css).toContain(":root[data-theme='dark'] {\n  --color-primary: #818cf8;\n}");
    expect(css).toContain('@media (prefers-color-scheme: dark)');
  });

  it('writes Tailwind, TypeScript and W3C tokens', () => {
    expect(tokensToTailwind(tokens)).toContain('"muted": "var(--color-text-muted)"');
    expect(tokensToTailwind(tokens)).toContain('"spacing": {\n        "4": "var(--space-4)"');
    expect(tokensToTs(tokens)).toContain(
      '"primary": {\n      "light": "#4f46e5",\n      "dark": "#818cf8"',
    );
    const w3c = JSON.parse(tokensToW3c(tokens)) as { color: { primary: Record<string, unknown> } };
    expect(w3c.color.primary).toMatchObject({
      $value: '#4f46e5',
      $type: 'color',
      $description: 'Actions',
    });
  });
});
