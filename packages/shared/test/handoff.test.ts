// ── [PCODE-292 | S15 | v0.1.0] T30.6 Handoff specs per mockup: tokens, components, states, breakpoints, measures, export areas ──
//    Why:  measures and export areas turn into image pixels, a distance finds its spacing token, export
//          areas their file names, and the Markdown hands all of it over.
import { describe, expect, it } from 'vitest';
import {
  areaPx,
  emptyHandoff,
  exportFileNames,
  handoffMarkdown,
  handoffProblems,
  measurePx,
  tokenForDistance,
  type DesignToken,
} from '../src/index.js';

const tok = (name: string, type: string, valueLight: string, valueDark = ''): DesignToken => ({
  name,
  type,
  valueLight,
  valueDark,
  description: '',
});
const TOKENS = [
  tok('color.primary', 'color', '#4f46e5', '#818cf8'),
  tok('space.4', 'dimension', '16px'),
  tok('space.6', 'dimension', '1.5rem'),
  tok('radius.md', 'radius', '24px'),
  tok('font.size.body', 'dimension', '15px'),
];

describe('handoff specs', () => {
  it('measures in image pixels and finds the spacing token within a pixel', () => {
    expect(measurePx({ x1: 0.1, y1: 0.5, x2: 0.4, y2: 0.9 }, 1000, 500)).toEqual({
      dx: 300,
      dy: 200,
      length: 361,
    });
    expect(areaPx({ x: 0.25, y: 0.5, w: 0.5, h: 0.1 }, 800, 600)).toEqual({
      x: 200,
      y: 300,
      w: 400,
      h: 60,
    });
    expect(tokenForDistance(24, TOKENS)).toBe('space.6'); // rem counted, the radius is not spacing
    expect(tokenForDistance(17, TOKENS)).toBe('space.4');
    expect(tokenForDistance(20, TOKENS)).toBeNull();
    expect(tokenForDistance(15, TOKENS)).toBe('space.4'); // a font size is no spacing; 16 is within a pixel
  });

  it('names the exported files and lists what left the kit', () => {
    expect(
      exportFileNames({ name: 'Hero art', formats: ['png', 'svg'], scales: [1, 2, 3] }),
    ).toEqual(['Hero-art.png', 'Hero-art@2x.png', 'Hero-art@3x.png', 'Hero-art.svg']);
    const spec = {
      ...emptyHandoff(),
      tokens: ['color.primary', 'color.gone'],
      components: ['a', 'b', 'c'],
    };
    expect(handoffProblems(spec, TOKENS, [{ id: 'a' }])).toEqual([
      'Token color.gone no longer exists',
      '2 components were removed',
    ]);
  });

  it('hands the spec over as Markdown', () => {
    const md = handoffMarkdown({
      title: 'Sign in',
      version: 3,
      status: 'changes_requested',
      imageUrl: '/img',
      spec: {
        ...emptyHandoff(),
        imageWidth: 1000,
        imageHeight: 1000,
        tokens: ['color.primary', 'color.gone'],
        components: ['c1'],
        states: [{ name: 'Error', note: 'Red border | message below' }],
        breakpoints: [
          { name: 'Desktop', width: 1200, note: '' },
          { name: 'Phone', width: 0, note: 'one column' },
        ],
        measures: [{ x1: 0.5, y1: 0.1, x2: 0.5, y2: 0.116, label: '' }],
        exports: [{ name: 'logo', x: 0, y: 0, w: 0.1, h: 0.05, formats: ['svg'], scales: [1, 2] }],
      },
      tokens: TOKENS,
      themes: [{ name: 'midnight', base: 'dark' }],
      components: [{ id: 'c1', name: 'Text field', codePath: 'src/Field.tsx', status: 'stable' }],
    });
    expect(md).toContain('Review status: changes requested.');
    expect(md).toContain('| Token | light | dark | midnight |');
    expect(md).toContain('| `color.primary` | #4f46e5 | #818cf8 | #818cf8 |');
    expect(md).toContain('| `color.gone` | missing | missing | missing |');
    expect(md).toContain('- Text field (`src/Field.tsx`), stable');
    expect(md).toContain('**Error**: Red border | message below');
    expect(md.indexOf('**Phone** from 0 px')).toBeLessThan(md.indexOf('**Desktop**'));
    expect(md).toContain('| Measure 1 | 0 px | 16 px | 16 px | space.4 |');
    expect(md).toContain('- **logo** at 0, 0, 100 × 50 px: logo.svg');
  });
});
