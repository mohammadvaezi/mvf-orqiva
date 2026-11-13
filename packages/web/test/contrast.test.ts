// ── [PCODE-358 | S15 | v0.1.0] T35.6 Accessibility to WCAG 2.2 AA ──
//    Why:  the theme's colour pairs keep WCAG 2.2 AA in light and dark: text 4.5 : 1, field borders and
//          icons on coloured tiles 3 : 1, and the system dark theme matches the chosen one.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../src/theme.css', import.meta.url), 'utf8');

function block(start: string): Record<string, string> {
  const i = css.indexOf(start);
  const body = css.slice(i, css.indexOf('}', i));
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/--pe-([a-z0-9-]+):\s*(#[0-9a-f]{6})/gi))
    out[m[1] ?? ''] = m[2] ?? '';
  return out;
}

const light = block(':root {');
const darkOnly = block(":root[data-theme='dark'] {");
const dark = { ...light, ...darkOnly };
const system = block(":root:not([data-theme='light']) {");

function luminance(hex: string): number {
  const [r = 0, g = 0, b = 0] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

const SURFACES = ['bg', 'surface', 'surface-2', 'surface-3', 'nav-bg'];
const TEXT: [string, string[]][] = [
  ['text', SURFACES],
  ['text-2', SURFACES],
  ['link', ['bg', 'surface', 'surface-2']],
  ['error', ['bg', 'surface', 'error-bg']],
  ['success', ['bg', 'surface', 'surface-2']],
  ['ok-text', SURFACES],
  ['warn-text', SURFACES],
  ['bad-text', SURFACES],
  ['info-text', SURFACES],
  ['agent-text', SURFACES],
  ['primary-text', ['primary', 'primary-hover']],
  ['on-primary-container', ['primary-container']],
  ['secondary-text', ['secondary', 'secondary-hover']],
  ['on-error', ['error']],
  ['avatar-text', ['avatar-1', 'avatar-2', 'avatar-3', 'avatar-4', 'avatar-5', 'avatar-6']],
  ['on-band', ['band-a', 'band-b', 'band-c']],
  ['help-text', ['help-a', 'help-b']],
];
const SHAPES: [string, string[]][] = [
  ['focus', ['bg', 'surface', 'surface-2']],
  ['input-border', ['bg', 'surface', 'input-bg']],
  // the tiles that carry an icon or a short word
  ['on-tone', ['tone-indigo', 'tone-violet', 'tone-pink', 'tone-blue']],
  ['on-tone-light', ['tone-amber', 'tone-teal', 'tone-coral', 'tone-cyan', 'tone-mint']],
];

function failures(
  theme: Record<string, string>,
  pairs: [string, string[]][],
  min: number,
): string[] {
  const out: string[] = [];
  for (const [fg, bgs] of pairs)
    for (const bg of bgs) {
      const a = theme[fg];
      const b = theme[bg];
      if (!a || !b) out.push(fg + ' on ' + bg + ': no colour');
      else if (contrast(a, b) < min) out.push(fg + ' on ' + bg + ': ' + contrast(a, b).toFixed(2));
    }
  return out;
}

describe('the theme colours', () => {
  it('measure contrast as WCAG does', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrast('#767676', '#ffffff')).toBeCloseTo(4.54, 2);
  });
  for (const [name, theme] of [
    ['light', light],
    ['dark', dark],
  ] as const) {
    it('keep text at 4.5 : 1 in ' + name, () => {
      expect(failures(theme, TEXT, 4.5)).toEqual([]);
    });
    it('keep borders, focus and icons at 3 : 1 in ' + name, () => {
      expect(failures(theme, SHAPES, 3)).toEqual([]);
    });
  }
  it('give the system dark theme the colours of the chosen one', () => {
    expect(system).toEqual(darkOnly);
  });
});
