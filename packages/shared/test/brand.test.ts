// ── [PCODE-289 | S15 | v0.1.0] T30.3 Brand pages: colour, type, voice, logo use, do and don't ──
//    Why:  the palette and the type specimen come from the tokens as they finally are, and the brand
//          book file keeps everything the team wrote and nothing that could run.
import { describe, expect, it } from 'vitest';
import { brandBookHtml, brandPalette, typeSpecimen, type DesignToken } from '../src/index.js';

const tok = (name: string, type: string, valueLight: string, valueDark = ''): DesignToken => ({
  name,
  type,
  valueLight,
  valueDark,
  description: '',
});
const tokens = [
  tok('color.brand.violet', 'color', '#7c3aed', '#a78bfa'),
  tok('color.brand.primary', 'color', '{color.brand.violet}'),
  tok('color.text', 'color', 'rgb(17 17 17)'),
  tok('font.family.body', 'fontFamily', "'Inter', sans-serif"),
  tok('font.weight.bold', 'fontWeight', 'bold'),
  tok('font.size.lg', 'dimension', '1.25rem'),
  tok('font.size.xl', 'dimension', '32px'),
  tok('space.4', 'dimension', '16px'),
];

describe('brand book', () => {
  it('groups the palette and follows aliases', () => {
    const p = brandPalette(tokens);
    expect(p.map((g) => g.group)).toEqual(['color.brand', 'color']);
    expect(p[0]?.colours.map((c) => [c.name, c.written, c.hex, c.dark])).toEqual([
      ['color.brand.primary', '{color.brand.violet}', '#7c3aed', '#a78bfa'],
      ['color.brand.violet', '#7c3aed', '#7c3aed', '#a78bfa'],
    ]);
    expect(p[1]?.colours[0]).toMatchObject({
      hex: '#111111',
      rgb: 'rgb(17, 17, 17)',
      onWhite: 18.88,
    });
  });

  it('reads the type specimen from the tokens', () => {
    expect(typeSpecimen(tokens)).toEqual({
      families: [{ name: 'font.family.body', value: "'Inter', sans-serif", first: 'Inter' }],
      weights: [{ name: 'font.weight.bold', weight: 700 }],
      sizes: [
        { name: 'font.size.xl', value: '32px', px: 32 },
        { name: 'font.size.lg', value: '1.25rem', px: 20 },
      ],
    });
  });

  it('writes one HTML body with nothing that runs', () => {
    const html = brandBookHtml({
      project: 'APP',
      sections: { voice: 'We say **you**. <script>x()</script>' },
      palette: brandPalette(tokens),
      type: typeSpecimen(tokens),
      logos: [{ name: 'Logo "main"', src: 'data:image/png;base64,AAAA' }],
      examples: [{ kind: 'dont', caption: 'Stretch it', src: null }],
    });
    expect(html).toContain('<h2>Voice</h2><p>We say <strong>you</strong>. &lt;script&gt;');
    expect(html).toContain('background:#7c3aed');
    expect(html).toContain("font-family:'Inter', sans-serif;font-size:28px");
    expect(html).toContain('alt="Logo &quot;main&quot;"');
    expect(html).toContain('Don’t</strong> Stretch it');
    expect(html).not.toContain('<script>');
  });
});
