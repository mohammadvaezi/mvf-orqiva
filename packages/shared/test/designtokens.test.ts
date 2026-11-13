// ── [PCODE-287 | S15 | v0.1.0] T30.1 Design tokens: themes and modes, aliases, W3C import, iOS and Android export ──
//    Why:  themes fall back to their base, aliases follow the mode they are read in and name what they
//          miss; every CSS colour form reaches native files as channels; Swift and Android files hold
//          light, dark and theme values; a W3C file from another tool comes in with its groups, types,
//          aliases, objects and modes, and what cannot be kept says why.
import { describe, expect, it } from 'vitest';
import {
  aliasProblems,
  parseColor,
  parsePx,
  tokenResolver,
  tokensToAndroid,
  tokensToCss,
  tokensToSwift,
  tokensToTs,
  tokensToW3c,
  w3cToTokens,
  type DesignToken,
  type TokenTheme,
} from '../src/index.js';

const tok = (
  name: string,
  type: string,
  valueLight: string,
  valueDark = '',
  themes?: Record<string, string>,
): DesignToken => ({
  name,
  type,
  valueLight,
  valueDark,
  description: '',
  ...(themes ? { themes } : {}),
});

const themes: TokenTheme[] = [
  { name: 'high-contrast', base: 'light' },
  { name: 'midnight', base: 'dark' },
];
const tokens = [
  tok('color.blue.500', 'color', '#2563eb', '#60a5fa', { 'high-contrast': '#0000ff' }),
  tok('color.primary', 'color', '{color.blue.500}'),
  tok('color.text', 'color', '#111111', '#eeeeee', { midnight: '#ffffff' }),
  tok('space.4', 'dimension', '1rem'),
  tok('font.weight.bold', 'fontWeight', '700'),
  tok('motion.fast', 'duration', '150ms'),
];

describe('themes and aliases', () => {
  it('reads values per mode, following aliases and theme bases', () => {
    const read = tokenResolver(tokens, themes);
    expect(read('color.primary', 'light')).toBe('#2563eb');
    expect(read('color.primary', 'dark')).toBe('#60a5fa');
    expect(read('color.primary', 'high-contrast')).toBe('#0000ff');
    expect(read('color.primary', 'midnight')).toBe('#60a5fa');
    expect(read('color.text', 'midnight')).toBe('#ffffff');
    expect(read('color.text', 'high-contrast')).toBe('#111111');
    const broken = [
      tok('a', 'color', '{b}'),
      tok('b', 'color', '{a}'),
      tok('c', 'color', '{gone}'),
    ];
    expect(aliasProblems(broken)).toEqual([
      { name: 'a', mode: 'light', target: 'b', problem: 'loop' },
      { name: 'b', mode: 'light', target: 'a', problem: 'loop' },
      { name: 'c', mode: 'light', target: 'gone', problem: 'missing' },
    ]);
  });

  it('writes themes to CSS, TypeScript and W3C', () => {
    const css = tokensToCss(tokens, themes);
    expect(css).toContain('  --color-primary: var(--color-blue-500);');
    expect(css).toContain(
      ":root[data-theme='high-contrast'] {\n  color-scheme: light;\n  --color-blue-500: #0000ff;",
    );
    expect(css).toContain(
      ":root[data-theme='midnight'] {\n  color-scheme: dark;\n  --color-blue-500: #60a5fa;",
    );
    const ts = tokensToTs(tokens, themes);
    expect(ts).toContain(
      '"primary": {\n      "light": "#2563eb",\n      "dark": "#60a5fa",\n      "high-contrast": "#0000ff"\n    }',
    );
    const back = w3cToTokens(JSON.parse(tokensToW3c(tokens, themes)));
    expect(back.themes).toEqual(themes);
    expect(back.skipped).toEqual([]);
    const byName = (a: DesignToken, b: DesignToken): number => a.name.localeCompare(b.name);
    expect(back.tokens.sort(byName)).toEqual([...tokens].sort(byName));
  });
});

describe('colours and sizes', () => {
  it('reads every CSS colour form', () => {
    expect(parseColor('#abc')).toEqual([170, 187, 204, 1]);
    expect(parseColor('#2563eb80')).toEqual([37, 99, 235, 0.502]);
    expect(parseColor('rgb(10 20 30 / 50%)')).toEqual([10, 20, 30, 0.5]);
    expect(parseColor('rgba(10, 20, 30, 0.25)')).toEqual([10, 20, 30, 0.25]);
    expect(parseColor('hsl(0 100% 50%)')).toEqual([255, 0, 0, 1]);
    expect(parseColor('oklch(0.628 0.2577 29.23)')).toEqual([255, 0, 0, 1]);
    expect(parseColor('var(--x)')).toBeNull();
    expect(parsePx('1.5rem')).toBe(24);
    expect(parsePx('12pt')).toBe(12);
  });
});

describe('iOS and Android', () => {
  it('writes one Swift file with dynamic colours', () => {
    const swift = tokensToSwift(tokens, themes);
    expect(swift).toContain('public enum Color {');
    expect(swift).toContain(
      'public static var primary: UIColor { dynamic(light: UIColor(red: 0.145, green: 0.388, blue: 0.922, alpha: 1.000), dark: UIColor(red: 0.376, green: 0.647, blue: 0.980, alpha: 1.000), themes: ["high-contrast": UIColor(red: 0.000, green: 0.000, blue: 1.000, alpha: 1.000), "midnight": UIColor(red: 0.376, green: 0.647, blue: 0.980, alpha: 1.000)]) }',
    );
    expect(swift).toContain('public static let space4: CGFloat = 16');
    expect(swift).toContain('public static let weightBold: UIFont.Weight = .bold');
    expect(swift).toContain('public static let fast: TimeInterval = 0.15');
  });

  it('writes Android resources for values, night and themes', () => {
    const files = tokensToAndroid(tokens, themes);
    expect(files.map((f) => f.path)).toEqual([
      'res/values/tokens.xml',
      'res/values-night/tokens.xml',
      'res/values/tokens_high_contrast.xml',
      'res/values/tokens_midnight.xml',
    ]);
    expect(files[0]?.text).toContain('<color name="color_primary">#FF2563EB</color>');
    expect(files[0]?.text).toContain('<dimen name="space_4">16dp</dimen>');
    expect(files[1]?.text).toContain('<color name="color_text">#FFEEEEEE</color>');
    expect(files[2]?.text).toContain('<color name="color_primary_high_contrast">#FF0000FF</color>');
  });
});

describe('W3C import', () => {
  it('reads groups, inherited types, aliases, objects and modes from other tools', () => {
    const r = w3cToTokens({
      Brand: {
        $type: 'color',
        'Blue 500': { $value: { colorSpace: 'srgb', components: [0, 0.5, 1], alpha: 0.5 } },
        Primary: { $value: '{Brand.Blue 500}', $description: 'Buttons' },
        Ink: {
          $value: '#111',
          $extensions: { mode: { Light: '#111', Dark: '#eee', 'Sepia Light': '#332211' } },
        },
      },
      space: { md: { $type: 'dimension', $value: { value: 1.5, unit: 'rem' } } },
      font: {
        body: { $type: 'fontFamily', $value: ['Inter', 'Helvetica Neue', 'sans-serif'] },
        strong: { $type: 'fontWeight', $value: 'semi-bold' },
      },
      elevation: {
        card: {
          $type: 'shadow',
          $value: {
            color: '#00000033',
            offsetX: { value: 0, unit: 'px' },
            offsetY: '1px',
            blur: 4,
            spread: 0,
          },
        },
      },
      ease: { $type: 'cubicBezier', $value: [0, 0, 1, 1] },
      bad: { $type: 'color', $value: 'url(x)' },
    });
    expect(r.tokens).toEqual([
      tok('brand.blue-500', 'color', 'rgb(0 128 255 / 0.5)'),
      { ...tok('brand.primary', 'color', '{brand.blue-500}'), description: 'Buttons' },
      tok('brand.ink', 'color', '#111', '#eee', { 'sepia-light': '#332211' }),
      tok('space.md', 'dimension', '1.5rem'),
      tok('font.body', 'fontFamily', "Inter, 'Helvetica Neue', sans-serif"),
      tok('font.strong', 'fontWeight', '600'),
      tok('elevation.card', 'shadow', '0px 1px 4px 0px #00000033'),
    ]);
    expect(r.themes).toEqual([{ name: 'sepia-light', base: 'light' }]);
    expect(r.skipped).toEqual([
      { name: 'ease', reason: 'type cubicBezier is not kept' },
      { name: 'bad', reason: 'not a colour we can write: url(x)' },
    ]);
  });
});
