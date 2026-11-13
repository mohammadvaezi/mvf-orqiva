// ── [PCODE-287 | S15 | v0.1.0] T30.1 Design tokens: themes and modes, aliases, W3C import, iOS and Android export ──
//    Why:  tokens leave for the platforms the apps are written in, and come in from the format design
//          tools write. Colours in any CSS form become channels a native file can hold; iOS gets one Swift
//          file whose colours follow light and dark (and a chosen theme), Android gets resource XML for
//          values and values-night; W3C files are read with their groups, inherited types, aliases,
//          object values and mode extensions, and what cannot become a token is named with the reason.
import { aliasOf, tokenResolver, type DesignToken, type TokenTheme } from './docs.js';

// ── colours ──
export type Rgba = [number, number, number, number];

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
const channel = (s: string): number =>
  s.endsWith('%') ? (parseFloat(s) / 100) * 255 : parseFloat(s);
const alphaOf = (s: string | undefined): number =>
  s === undefined ? 1 : clamp(s.endsWith('%') ? parseFloat(s) / 100 : parseFloat(s), 0, 1);
const argsOf = (body: string): string[] =>
  body
    .replace(/\//g, ' ')
    .split(/[\s,]+/)
    .filter(Boolean);

const hslToRgb = (h: number, s: number, l: number): [number, number, number] => {
  const k = (n: number): number => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number): number => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
};

const oklchToRgb = (l: number, c: number, hDeg: number): [number, number, number] => {
  const h = (hDeg * Math.PI) / 180;
  const a = c * Math.cos(h);
  const b = c * Math.sin(h);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ];
  const gamma = (x: number): number =>
    x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
  return lin.map((x) => clamp(gamma(x), 0, 1) * 255) as [number, number, number];
};

/** A CSS colour (#hex with or without alpha, rgb(), hsl(), oklch()) as 0–255 channels and alpha 0–1. */
export function parseColor(value: string): Rgba | null {
  const v = value.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(v)?.[1];
  if (hex) {
    const h = hex.length <= 4 ? hex.replace(/./g, (c) => c + c) : hex;
    const n = (i: number): number => parseInt(h.slice(i, i + 2), 16);
    return [n(0), n(2), n(4), h.length === 8 ? Math.round((n(6) / 255) * 1000) / 1000 : 1];
  }
  const fn = /^(rgba?|hsla?|oklch)\(([^)]*)\)$/.exec(v);
  if (!fn) return null;
  const args = argsOf(fn[2] ?? '');
  const [p0, p1, p2, p3] = args;
  if (p0 === undefined || p1 === undefined || p2 === undefined || args.length > 4) return null;
  let rgb: [number, number, number];
  if (fn[1]?.startsWith('rgb')) rgb = [channel(p0), channel(p1), channel(p2)];
  else if (fn[1]?.startsWith('hsl'))
    rgb = hslToRgb(parseFloat(p0), parseFloat(p1) / 100, parseFloat(p2) / 100);
  else {
    const l = p0.endsWith('%') ? parseFloat(p0) / 100 : parseFloat(p0);
    const c = p1.endsWith('%') ? (parseFloat(p1) / 100) * 0.4 : parseFloat(p1);
    rgb = oklchToRgb(l, c, parseFloat(p2));
  }
  if (rgb.some((x) => !Number.isFinite(x))) return null;
  const alpha = alphaOf(p3);
  if (!Number.isFinite(alpha)) return null;
  return [...(rgb.map((x) => Math.round(clamp(x, 0, 255))) as [number, number, number]), alpha];
}

const hex2 = (n: number): string => n.toString(16).padStart(2, '0').toUpperCase();

/** A dimension in px: px, rem and em at 16, pt, dp and a bare number taken as px. */
export function parsePx(value: string): number | null {
  const m = /^(-?\d*\.?\d+)\s*(px|rem|em|pt|dp|sp)?$/i.exec(value.trim());
  if (!m) return null;
  const n = parseFloat(m[1] ?? '');
  const unit = (m[2] ?? 'px').toLowerCase();
  return unit === 'rem' || unit === 'em' ? n * 16 : n;
}

/** A duration in milliseconds: ms, s, or a bare number taken as ms. */
export function parseMs(value: string): number | null {
  const m = /^(\d*\.?\d+)\s*(ms|s)?$/i.exec(value.trim());
  if (!m) return null;
  const n = parseFloat(m[1] ?? '');
  return (m[2] ?? 'ms').toLowerCase() === 's' ? n * 1000 : n;
}

const WEIGHTS: Record<string, number> = {
  thin: 100,
  hairline: 100,
  'extra-light': 200,
  extralight: 200,
  'ultra-light': 200,
  light: 300,
  normal: 400,
  regular: 400,
  book: 400,
  medium: 500,
  'semi-bold': 600,
  semibold: 600,
  'demi-bold': 600,
  bold: 700,
  'extra-bold': 800,
  extrabold: 800,
  black: 900,
  heavy: 900,
};
/** A font weight as 100–900, from a number or a name. */
export const parseWeight = (value: string): number | null => {
  const v = value.trim().toLowerCase();
  const n = /^\d{3}$/.test(v) ? Number(v) : (WEIGHTS[v] ?? null);
  return n !== null && n >= 1 && n <= 1000 ? n : null;
};

const firstFamily = (value: string): string =>
  (value.split(',')[0] ?? value).trim().replace(/^['"]|['"]$/g, '');

// ── naming ──
const words = (name: string): string[] => name.split(/[.\-_]/).filter(Boolean);
/** A token's short name in its group: color.text.muted is text.muted, space.4 stays space.4. */
const shortName = (name: string): string => {
  const rest = name.split('.').slice(1).join('.');
  return rest && /^[a-z]/.test(rest) ? rest : name;
};
const SWIFT_KEYWORDS = new Set(
  'default case class enum extension func import in internal let operator private protocol public return self static struct subscript super switch true false nil var where while do repeat break continue if else guard is as try throw throws init deinit'.split(
    ' ',
  ),
);
const camel = (name: string): string => {
  const w = words(name);
  const id = w.map((x, i) => (i === 0 ? x : x.charAt(0).toUpperCase() + x.slice(1))).join('');
  const safe = /^[0-9]/.test(id) ? '_' + id : id;
  return SWIFT_KEYWORDS.has(safe) ? '`' + safe + '`' : safe;
};
const snake = (name: string): string => {
  const id = words(name).join('_');
  return /^[0-9]/.test(id) ? 't_' + id : id;
};

// ── iOS ──
const SWIFT_GROUP: Record<string, string> = {
  color: 'Color',
  dimension: 'Dimension',
  fontFamily: 'FontFamily',
  fontWeight: 'FontWeight',
  duration: 'Duration',
  shadow: 'Shadow',
  number: 'Number',
};
const swiftWeight = (n: number): string =>
  '.' +
  (['ultraLight', 'thin', 'light', 'regular', 'medium', 'semibold', 'bold', 'heavy', 'black'][
    clamp(Math.round(n / 100), 1, 9) - 1
  ] ?? 'regular');
const swiftColor = (c: Rgba): string =>
  'UIColor(red: ' +
  (c[0] / 255).toFixed(3) +
  ', green: ' +
  (c[1] / 255).toFixed(3) +
  ', blue: ' +
  (c[2] / 255).toFixed(3) +
  ', alpha: ' +
  c[3].toFixed(3) +
  ')';
const swiftString = (s: string): string =>
  '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';

/** One Swift file for UIKit: colours follow light and dark and, when Tokens.theme is set, that theme. */
export function tokensToSwift(
  tokens: readonly DesignToken[],
  themes: readonly TokenTheme[] = [],
): string {
  const read = tokenResolver(tokens, themes);
  const out: string[] = [
    '// Design tokens, generated by Orqiva. Do not edit by hand.',
    'import UIKit',
    '',
    'public enum Tokens {',
    themes.length
      ? '    /// A theme beyond light and dark (' +
        themes.map((t) => swiftString(t.name)).join(', ') +
        '); nil follows the system.'
      : '    /// Themes beyond light and dark; nil follows the system.',
    '    public static var theme: String? = nil',
  ];
  const skipped: string[] = [];
  for (const [type, group] of Object.entries(SWIFT_GROUP)) {
    const list = [...tokens]
      .filter((t) => t.type === type)
      .sort((a, b) => a.name.localeCompare(b.name));
    if (!list.length) continue;
    const lines: string[] = [];
    const used = new Set<string>();
    for (const t of list) {
      let id = camel(shortName(t.name));
      while (used.has(id)) id += '_';
      used.add(id);
      const light = read(t.name, 'light');
      if (light === null) {
        skipped.push(t.name);
        continue;
      }
      const doc = t.description ? '        /// ' + t.description.replace(/\s+/g, ' ') + '\n' : '';
      if (type === 'color') {
        const l = parseColor(light);
        const d = parseColor(read(t.name, 'dark') ?? light);
        if (!l || !d) {
          skipped.push(t.name);
          continue;
        }
        const own = themes
          .map((th) => [th.name, parseColor(read(t.name, th.name) ?? '')] as const)
          .filter((x): x is readonly [string, Rgba] => x[1] !== null);
        lines.push(
          doc +
            '        public static var ' +
            id +
            ': UIColor { dynamic(light: ' +
            swiftColor(l) +
            ', dark: ' +
            swiftColor(d) +
            (own.length
              ? ', themes: [' +
                own.map(([n, c]) => swiftString(n) + ': ' + swiftColor(c)).join(', ') +
                ']'
              : '') +
            ') }',
        );
      } else if (type === 'dimension') {
        const px = parsePx(light);
        if (px === null) skipped.push(t.name);
        else lines.push(doc + '        public static let ' + id + ': CGFloat = ' + String(px));
      } else if (type === 'fontWeight') {
        const w = parseWeight(light);
        if (w === null) skipped.push(t.name);
        else
          lines.push(
            doc + '        public static let ' + id + ': UIFont.Weight = ' + swiftWeight(w),
          );
      } else if (type === 'duration') {
        const ms = parseMs(light);
        if (ms === null) skipped.push(t.name);
        else
          lines.push(
            doc + '        public static let ' + id + ': TimeInterval = ' + String(ms / 1000),
          );
      } else if (type === 'number') {
        const n = Number(light);
        if (!Number.isFinite(n)) skipped.push(t.name);
        else lines.push(doc + '        public static let ' + id + ': Double = ' + String(n));
      } else {
        const v = type === 'fontFamily' ? firstFamily(light) : light;
        lines.push(doc + '        public static let ' + id + ' = ' + swiftString(v));
      }
    }
    if (lines.length) out.push('', '    public enum ' + group + ' {', ...lines, '    }');
  }
  out.push(
    '}',
    '',
    'private func dynamic(light: UIColor, dark: UIColor, themes: [String: UIColor] = [:]) -> UIColor {',
    '    UIColor { traits in',
    '        if let name = Tokens.theme, let colour = themes[name] { return colour }',
    '        return traits.userInterfaceStyle == .dark ? dark : light',
    '    }',
    '}',
  );
  if (skipped.length)
    out.push('', '// Not written (no value this platform can hold): ' + skipped.join(', '));
  return out.join('\n') + '\n';
}

// ── Android ──
const xmlText = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const androidColor = (c: Rgba): string =>
  '#' + hex2(Math.round(c[3] * 255)) + hex2(c[0]) + hex2(c[1]) + hex2(c[2]);
const resources = (lines: string[]): string =>
  '<?xml version="1.0" encoding="utf-8"?>\n<!-- Design tokens, generated by Orqiva. Do not edit by hand. -->\n<resources>\n' +
  lines.map((l) => '    ' + l).join('\n') +
  (lines.length ? '\n' : '') +
  '</resources>\n';

/** Android resources: values/tokens.xml, dark colours in values-night/tokens.xml, and each theme's
 *  colours as named resources (color_primary_high_contrast) in values/tokens_<theme>.xml. */
export function tokensToAndroid(
  tokens: readonly DesignToken[],
  themes: readonly TokenTheme[] = [],
): { path: string; text: string }[] {
  const read = tokenResolver(tokens, themes);
  const sorted = [...tokens].sort((a, b) => a.name.localeCompare(b.name));
  const base: string[] = [];
  const night: string[] = [];
  const skipped: string[] = [];
  for (const t of sorted) {
    const id = snake(t.name);
    const light = read(t.name, 'light');
    if (light === null) {
      skipped.push(t.name);
      continue;
    }
    if (t.type === 'color') {
      const l = parseColor(light);
      if (!l) {
        skipped.push(t.name);
        continue;
      }
      base.push('<color name="' + id + '">' + androidColor(l) + '</color>');
      const d = parseColor(read(t.name, 'dark') ?? light);
      if (d && androidColor(d) !== androidColor(l))
        night.push('<color name="' + id + '">' + androidColor(d) + '</color>');
    } else if (t.type === 'dimension') {
      const px = parsePx(light);
      const unit = /(^|\.)(font|text|type)(\.|-|$)/.test(t.name) ? 'sp' : 'dp';
      if (px === null) skipped.push(t.name);
      else base.push('<dimen name="' + id + '">' + String(px) + unit + '</dimen>');
    } else if (t.type === 'fontWeight') {
      const w = parseWeight(light);
      if (w === null) skipped.push(t.name);
      else base.push('<integer name="' + id + '">' + String(w) + '</integer>');
    } else if (t.type === 'duration') {
      const ms = parseMs(light);
      if (ms === null) skipped.push(t.name);
      else base.push('<integer name="' + id + '">' + String(Math.round(ms)) + '</integer>');
    } else if (t.type === 'number') {
      const n = Number(light);
      if (!Number.isFinite(n)) skipped.push(t.name);
      else
        base.push('<item name="' + id + '" format="float" type="dimen">' + String(n) + '</item>');
    } else {
      const v = t.type === 'fontFamily' ? firstFamily(light) : light;
      base.push('<string name="' + id + '" translatable="false">' + xmlText(v) + '</string>');
    }
  }
  if (skipped.length)
    base.push(
      '<!-- Not written (no value this platform can hold): ' + xmlText(skipped.join(', ')) + ' -->',
    );
  const files = [
    { path: 'res/values/tokens.xml', text: resources(base) },
    { path: 'res/values-night/tokens.xml', text: resources(night) },
  ];
  for (const th of themes) {
    const lines: string[] = [];
    for (const t of sorted) {
      if (t.type !== 'color') continue;
      const c = parseColor(read(t.name, th.name) ?? '');
      if (c)
        lines.push(
          '<color name="' +
            snake(t.name) +
            '_' +
            snake(th.name) +
            '">' +
            androidColor(c) +
            '</color>',
        );
    }
    files.push({ path: 'res/values/tokens_' + snake(th.name) + '.xml', text: resources(lines) });
  }
  return files;
}

// ── W3C import ──
const TOKEN_NAME = /^[a-z][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*){0,5}$/;
const TYPE_OF: Record<string, string> = {
  color: 'color',
  dimension: 'dimension',
  fontfamily: 'fontFamily',
  fontweight: 'fontWeight',
  duration: 'duration',
  shadow: 'shadow',
  boxshadow: 'shadow',
  number: 'number',
  // names other tools use
  spacing: 'dimension',
  sizing: 'dimension',
  borderradius: 'dimension',
  borderwidth: 'dimension',
  fontsize: 'dimension',
  lineheight: 'number',
  lineheights: 'number',
  fontsizes: 'dimension',
  fontfamilies: 'fontFamily',
  fontweights: 'fontWeight',
  opacity: 'number',
  letterspacing: 'dimension',
};

/** A path segment as our token names write it: Brand Blue_500 becomes brand-blue-500. */
const segment = (s: string): string =>
  s
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
export const tokenPath = (parts: readonly string[]): string =>
  parts.map(segment).filter(Boolean).join('.');

const COLOUR = /^(#[0-9a-f]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\)|oklch\([^)]*\))$/i;
const SAFE = /^[^;{}<>]*$/;

export interface ImportedTokens {
  tokens: DesignToken[];
  themes: TokenTheme[];
  skipped: { name: string; reason: string }[];
}

/** Reads a W3C design tokens file (and the shapes Tokens Studio and Figma exports write). */
export function w3cToTokens(input: unknown): ImportedTokens {
  const tokens: DesignToken[] = [];
  const skipped: { name: string; reason: string }[] = [];
  const themes = new Map<string, TokenTheme>();
  const isObj = (x: unknown): x is Record<string, unknown> =>
    typeof x === 'object' && x !== null && !Array.isArray(x);
  if (!isObj(input))
    return { tokens, themes: [], skipped: [{ name: '', reason: 'not an object' }] };

  const declared = (input['$extensions'] as Record<string, unknown> | undefined)?.[
    'com.orqiva.themes'
  ];
  if (Array.isArray(declared))
    for (const d of declared)
      if (isObj(d) && typeof d['name'] === 'string') {
        const name = segment(d['name']);
        if (name && name !== 'light' && name !== 'dark')
          themes.set(name, { name, base: d['base'] === 'dark' ? 'dark' : 'light' });
      }

  const aliasPath = (v: string): string =>
    v.replace(/\{([^{}]+)\}/g, (_m, p: string) => '{' + tokenPath(p.split('.')) + '}');
  const dim = (v: unknown, unit: string): string | null => {
    if (typeof v === 'number') return String(v) + unit;
    if (isObj(v) && typeof v['value'] === 'number')
      return String(v['value']) + (typeof v['unit'] === 'string' ? v['unit'] : unit);
    return null;
  };
  const colourOf = (v: unknown): string | null => {
    if (typeof v === 'string') return v;
    if (!isObj(v)) return null;
    if (typeof v['hex'] === 'string') {
      const a = typeof v['alpha'] === 'number' ? v['alpha'] : 1;
      return a < 1 ? v['hex'] + hex2(Math.round(a * 255)).toLowerCase() : v['hex'];
    }
    const comps = v['components'];
    if (Array.isArray(comps) && comps.length === 3 && comps.every((x) => typeof x === 'number')) {
      const a = typeof v['alpha'] === 'number' ? v['alpha'] : 1;
      const space = typeof v['colorSpace'] === 'string' ? v['colorSpace'] : 'srgb';
      const [x = '', y = '', z = ''] = comps.map(String);
      const tail = (a < 1 ? ' / ' + String(a) : '') + ')';
      if (space === 'oklch') return 'oklch(' + [x, y, z].join(' ') + tail;
      if (space === 'hsl') return 'hsl(' + [x, y + '%', z + '%'].join(' ') + tail;
      if (space === 'srgb')
        return 'rgb(' + comps.map((c: number) => Math.round(c * 255)).join(' ') + tail;
    }
    return null;
  };
  const shadowOf = (v: unknown): string | null => {
    const one = (x: unknown): string | null => {
      if (typeof x === 'string') return x;
      if (!isObj(x)) return null;
      const parts = ['offsetX', 'offsetY', 'blur', 'spread'].map(
        (k) => (typeof x[k] === 'string' ? x[k] : dim(x[k], 'px')) ?? '0',
      );
      const colour = colourOf(x['color']) ?? '';
      return (x['inset'] === true ? 'inset ' : '') + parts.join(' ') + (colour ? ' ' + colour : '');
    };
    const list = Array.isArray(v) ? v.map(one) : [one(v)];
    return list.every((x): x is string => x !== null) ? list.join(', ') : null;
  };
  const valueOf = (v: unknown, type: string): string | null => {
    if (typeof v === 'string') {
      const s = aliasPath(v.trim());
      if (type === 'fontWeight' && !aliasOf(s)) {
        const w = parseWeight(s);
        return w === null ? null : String(w);
      }
      return s;
    }
    if (type === 'color') return colourOf(v);
    if (type === 'dimension') return dim(v, 'px');
    if (type === 'duration') return dim(v, 'ms');
    if (type === 'shadow') return shadowOf(v);
    if (type === 'fontFamily' && Array.isArray(v))
      return v
        .filter((x): x is string => typeof x === 'string')
        .map((x) => (/[\s,]/.test(x) ? "'" + x + "'" : x))
        .join(', ');
    if (typeof v === 'number') return String(v);
    return null;
  };
  const check = (v: string, type: string): string | null => {
    if (v.length > 300) return 'value longer than 300 characters';
    if (aliasOf(v)) return null;
    if (!SAFE.test(v)) return 'value holds ; { } < >';
    if (type === 'color' && !COLOUR.test(v)) return 'not a colour we can write: ' + v;
    return null;
  };

  const walk = (node: Record<string, unknown>, path: string[], inherited: string | null): void => {
    const type = typeof node['$type'] === 'string' ? node['$type'] : inherited;
    if ('$value' in node) {
      const name = tokenPath(path);
      if (!TOKEN_NAME.test(name)) {
        skipped.push({ name: path.join('.'), reason: 'name deeper than six levels or not usable' });
        return;
      }
      const ours = type ? TYPE_OF[type.toLowerCase()] : undefined;
      if (!ours) {
        skipped.push({ name, reason: type ? 'type ' + type + ' is not kept' : 'no type' });
        return;
      }
      const light = valueOf(node['$value'], ours);
      const bad = light === null ? 'value not read' : check(light, ours);
      if (light === null || bad) {
        skipped.push({ name, reason: bad ?? 'value not read' });
        return;
      }
      const ext = isObj(node['$extensions']) ? node['$extensions'] : {};
      const modesRaw = isObj(ext['com.orqiva.modes'])
        ? ext['com.orqiva.modes']
        : isObj(ext['mode'])
          ? ext['mode']
          : isObj(ext['modes'])
            ? ext['modes']
            : {};
      let valueLight = light;
      let valueDark = '';
      const own: Record<string, string> = {};
      for (const [k, raw] of Object.entries(modesRaw)) {
        const mode = segment(k);
        const v = valueOf(raw, ours);
        if (!mode || v === null || check(v, ours)) continue;
        if (mode === 'light') valueLight = v;
        else if (mode === 'dark') valueDark = v === valueLight ? '' : v;
        else {
          if (!themes.has(mode))
            themes.set(mode, { name: mode, base: /dark/.test(mode) ? 'dark' : 'light' });
          own[mode] = v;
        }
      }
      tokens.push({
        name,
        type: ours,
        valueLight,
        valueDark,
        description:
          typeof node['$description'] === 'string' ? node['$description'].slice(0, 1000) : '',
        ...(Object.keys(own).length ? { themes: own } : {}),
      });
      return;
    }
    for (const [k, child] of Object.entries(node))
      if (!k.startsWith('$') && isObj(child)) walk(child, [...path, k], type);
  };
  walk(input, [], null);
  // a later token of the same name wins, as in the file
  const byName = new Map(tokens.map((t) => [t.name, t]));
  return { tokens: [...byName.values()], themes: [...themes.values()], skipped };
}
