// ── [PCODE-289 | S15 | v0.1.0] T30.3 Brand pages: colour, type, voice, logo use, do and don't ──
//    Why:  a brand book that cannot drift from the code: its colours and type come from the project's
//          tokens (aliases followed, light and dark), the team writes what the numbers cannot say, and
//          the whole book leaves as one HTML file anyone can open.
import { contrastRatio, tokenResolver, type DesignToken, type TokenTheme } from './docs.js';
import { parseColor, parsePx, parseWeight } from './designtokens.js';
import { markdownToHtml } from './mdhtml.js';

export const BRAND_SECTIONS = [
  {
    key: 'overview',
    title: 'Overview',
    hint: 'Who the brand speaks to, what it stands for, and the one thing to remember.',
  },
  {
    key: 'colour',
    title: 'Colour',
    hint: 'Which colours lead, which support, and where each one belongs.',
  },
  {
    key: 'type',
    title: 'Type',
    hint: 'Which typeface for headings and for text, and how sizes step.',
  },
  {
    key: 'voice',
    title: 'Voice',
    hint: 'How the brand sounds: tone, words we use, words we avoid, with examples.',
  },
  {
    key: 'logo',
    title: 'Logo use',
    hint: 'Clear space, the smallest size, backgrounds it may sit on, and what never to do with it.',
  },
] as const;
export type BrandSectionKey = (typeof BRAND_SECTIONS)[number]['key'];
export const isBrandSection = (k: string): k is BrandSectionKey =>
  BRAND_SECTIONS.some((s) => s.key === k);

export interface PaletteColour {
  name: string;
  /** the value as written, which may be an alias */
  written: string;
  light: string;
  dark: string | null;
  hex: string;
  rgb: string;
  onWhite: number | null;
  onBlack: number | null;
  description: string;
}

const hexOf = (v: string): string | null => {
  const c = parseColor(v);
  if (!c) return null;
  const h = (n: number): string => n.toString(16).padStart(2, '0');
  return '#' + h(c[0]) + h(c[1]) + h(c[2]) + (c[3] < 1 ? h(Math.round(c[3] * 255)) : '');
};

/** The colour tokens as a palette, grouped by their first two name parts (color.brand, color.text). */
export function brandPalette(
  tokens: readonly DesignToken[],
  themes: readonly TokenTheme[] = [],
): { group: string; colours: PaletteColour[] }[] {
  const read = tokenResolver(tokens, themes);
  const groups = new Map<string, PaletteColour[]>();
  for (const t of [...tokens].sort((a, b) => a.name.localeCompare(b.name))) {
    if (t.type !== 'color') continue;
    const light = read(t.name, 'light');
    const hex = light === null ? null : hexOf(light);
    if (light === null || !hex) continue;
    const darkRaw = read(t.name, 'dark');
    const dark = darkRaw !== null && darkRaw !== light ? darkRaw : null;
    const c = parseColor(light);
    const parts = t.name.split('.');
    const group = parts.length > 2 ? parts.slice(0, 2).join('.') : (parts[0] ?? t.name);
    const solid = hex.slice(0, 7);
    const list = groups.get(group) ?? [];
    list.push({
      name: t.name,
      written: t.valueLight,
      light,
      dark: dark && hexOf(dark) ? (hexOf(dark) ?? dark) : null,
      hex,
      rgb: c ? 'rgb(' + [c[0], c[1], c[2]].join(', ') + ')' : '',
      onWhite: contrastRatio(solid, '#ffffff'),
      onBlack: contrastRatio(solid, '#000000'),
      description: t.description,
    });
    groups.set(group, list);
  }
  return [...groups.entries()].map(([group, colours]) => ({ group, colours }));
}

export interface TypeSpecimen {
  families: { name: string; value: string; first: string }[];
  weights: { name: string; weight: number }[];
  sizes: { name: string; value: string; px: number }[];
}

/** Font families, weights and the type scale (sizes named font, text or type), largest first. */
export function typeSpecimen(tokens: readonly DesignToken[]): TypeSpecimen {
  const read = tokenResolver(tokens);
  const out: TypeSpecimen = { families: [], weights: [], sizes: [] };
  for (const t of [...tokens].sort((a, b) => a.name.localeCompare(b.name))) {
    const v = read(t.name, 'light');
    if (v === null) continue;
    if (t.type === 'fontFamily')
      out.families.push({
        name: t.name,
        value: v,
        first: (v.split(',')[0] ?? v).trim().replace(/^['"]|['"]$/g, ''),
      });
    else if (t.type === 'fontWeight') {
      const w = parseWeight(v);
      if (w !== null) out.weights.push({ name: t.name, weight: w });
    } else if (t.type === 'dimension' && /(^|\.)(font|text|type|heading)(\.|-|$)/.test(t.name)) {
      const px = parsePx(v);
      if (px !== null && px > 0 && px <= 200) out.sizes.push({ name: t.name, value: v, px });
    }
  }
  out.weights.sort((a, b) => a.weight - b.weight);
  out.sizes.sort((a, b) => b.px - a.px);
  return out;
}

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** Only a colour our parser read may reach a style attribute. */
const safeColour = (v: string): string => (/^#[0-9a-f]{3,8}$/i.test(v) ? v : '#cccccc');
const safeFamily = (v: string): string => v.replace(/[^A-Za-z0-9 ,'-]/g, '');

export interface BrandBook {
  project: string;
  sections: Partial<Record<BrandSectionKey, string>>;
  palette: { group: string; colours: PaletteColour[] }[];
  type: TypeSpecimen;
  /** pictures already as data: addresses (or null when they could not be read) */
  logos: { name: string; src: string | null }[];
  examples: { kind: 'do' | 'dont'; caption: string; src: string | null }[];
}

/** The brand book as the body of one HTML file (styles inline, since the file stands alone). */
export function brandBookHtml(b: BrandBook): string {
  const md = (text: string | undefined): string =>
    text ? markdownToHtml(text, { url: (h) => (/^https?:\/\//.test(h) ? h : null) }) : '';
  const out: string[] = [];
  const section = (key: BrandSectionKey): string => md(b.sections[key]);
  out.push(section('overview'));
  out.push('<h2>Colour</h2>' + section('colour'));
  for (const g of b.palette) {
    out.push('<h3>' + esc(g.group) + '</h3><div style="display:flex;flex-wrap:wrap;gap:12px">');
    for (const c of g.colours)
      out.push(
        '<div style="width:170px;border:1px solid #dcdce6;border-radius:8px;overflow:hidden">' +
          '<div style="height:64px;background:' +
          safeColour(c.hex) +
          '"></div>' +
          (c.dark
            ? '<div style="height:18px;background:' +
              safeColour(c.dark) +
              ';color:#fff;font-size:11px;padding:0 6px">dark</div>'
            : '') +
          '<div style="padding:6px 8px;font-size:12px"><strong>' +
          esc(c.name) +
          '</strong><br>' +
          esc(c.hex) +
          ' · ' +
          esc(c.rgb) +
          (c.onWhite !== null
            ? '<br>on white ' + String(c.onWhite) + ' · on black ' + String(c.onBlack ?? '')
            : '') +
          (c.description ? '<br>' + esc(c.description) : '') +
          '</div></div>',
      );
    out.push('</div>');
  }
  out.push('<h2>Type</h2>' + section('type'));
  for (const f of b.type.families)
    out.push(
      '<p style="font-family:' +
        safeFamily(f.value) +
        ';font-size:28px;margin:8px 0">' +
        esc(f.first) +
        ': The quick brown fox jumps over the lazy dog</p><p class="meta">' +
        esc(f.name) +
        ' · ' +
        esc(f.value) +
        '</p>',
    );
  const body = safeFamily(b.type.families[0]?.value ?? 'system-ui');
  for (const s of b.type.sizes)
    out.push(
      '<p style="font-family:' +
        body +
        ';font-size:' +
        String(s.px) +
        'px;line-height:1.2;margin:6px 0">' +
        esc(s.name) +
        ' · ' +
        esc(s.value) +
        '</p>',
    );
  if (b.type.weights.length)
    out.push(
      '<p>' +
        b.type.weights
          .map(
            (w) =>
              '<span style="font-family:' +
              body +
              ';font-weight:' +
              String(w.weight) +
              ';margin-right:16px">' +
              esc(w.name) +
              ' ' +
              String(w.weight) +
              '</span>',
          )
          .join('') +
        '</p>',
    );
  out.push('<h2>Voice</h2>' + section('voice'));
  out.push('<h2>Logo use</h2>' + section('logo'));
  if (b.logos.length)
    out.push(
      '<div style="display:flex;flex-wrap:wrap;gap:16px">' +
        b.logos
          .map(
            (l) =>
              '<figure style="margin:0;padding:16px;border:1px solid #dcdce6;border-radius:8px">' +
              (l.src
                ? '<img src="' + esc(l.src) + '" alt="' + esc(l.name) + '" style="max-height:80px">'
                : '') +
              '<figcaption class="meta">' +
              esc(l.name) +
              '</figcaption></figure>',
          )
          .join('') +
        '</div>',
    );
  if (b.examples.length) {
    out.push('<h2>Do and don’t</h2><div style="display:flex;flex-wrap:wrap;gap:16px">');
    for (const e of b.examples)
      out.push(
        '<figure style="margin:0;width:260px;border:2px solid ' +
          (e.kind === 'do' ? '#1f9d55' : '#e5484d') +
          ';border-radius:8px;overflow:hidden">' +
          (e.src ? '<img src="' + esc(e.src) + '" alt="" style="width:100%;display:block">' : '') +
          '<figcaption style="padding:8px"><strong style="color:' +
          (e.kind === 'do' ? '#1f9d55' : '#e5484d') +
          '">' +
          (e.kind === 'do' ? 'Do' : 'Don’t') +
          '</strong> ' +
          esc(e.caption) +
          '</figcaption></figure>',
      );
    out.push('</div>');
  }
  return out.filter(Boolean).join('\n');
}
