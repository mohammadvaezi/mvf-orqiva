// ── [PCODE-292 | S15 | v0.1.0] T30.6 Handoff specs per mockup: tokens, components, states, breakpoints, measures, export areas ──
//    Why:  what a developer (or an agent) needs to build a mockup, kept with the exact version it is about:
//          the tokens and components it uses, its states and breakpoints, distances measured on the image
//          (with the spacing token they match) and the areas to cut out as assets. One spec per version;
//          a version without its own spec shows the last earlier one. Markdown and JSON for handing over.
import { parsePx } from './designtokens.js';
import { modeValue, type DesignToken, type TokenTheme } from './docs.js';

export const EXPORT_FORMATS = ['png', 'jpg', 'webp', 'svg'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

/** A line on the image, both ends as shares of its width and height. */
export interface HandoffMeasure {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  label: string;
}

/** An area of the image to export as an asset, as shares of the image. */
export interface HandoffExport {
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  formats: ExportFormat[];
  scales: number[];
}

export interface HandoffSpec {
  /** the image's size in pixels when the spec was written; measures are given in these pixels */
  imageWidth: number;
  imageHeight: number;
  tokens: string[];
  /** component ids */
  components: string[];
  states: { name: string; note: string }[];
  breakpoints: { name: string; width: number; note: string }[];
  measures: HandoffMeasure[];
  exports: HandoffExport[];
  notes: string;
}

export function emptyHandoff(): HandoffSpec {
  return {
    imageWidth: 0,
    imageHeight: 0,
    tokens: [],
    components: [],
    states: [],
    breakpoints: [],
    measures: [],
    exports: [],
    notes: '',
  };
}

/** A measure in image pixels: across, down and along the line. */
export function measurePx(
  m: Pick<HandoffMeasure, 'x1' | 'y1' | 'x2' | 'y2'>,
  width: number,
  height: number,
): { dx: number; dy: number; length: number } {
  const dx = Math.round(Math.abs(m.x2 - m.x1) * width);
  const dy = Math.round(Math.abs(m.y2 - m.y1) * height);
  return { dx, dy, length: Math.round(Math.hypot(dx, dy)) };
}

/** An export area in image pixels. */
export function areaPx(
  e: Pick<HandoffExport, 'x' | 'y' | 'w' | 'h'>,
  width: number,
  height: number,
): { x: number; y: number; w: number; h: number } {
  return {
    x: Math.round(e.x * width),
    y: Math.round(e.y * height),
    w: Math.round(e.w * width),
    h: Math.round(e.h * height),
  };
}

/** The file names an export area turns into: name.png, name@2x.png, … */
export function exportFileNames(e: Pick<HandoffExport, 'name' | 'formats' | 'scales'>): string[] {
  const base = e.name.trim().replace(/[^\w.-]+/g, '-') || 'asset';
  const out: string[] = [];
  for (const f of e.formats)
    for (const sc of f === 'svg' ? [1] : e.scales)
      out.push(base + (sc === 1 ? '' : '@' + String(sc) + 'x') + '.' + f);
  return out;
}

/** The spacing or size token whose value is the distance, within a pixel; null when none is. */
export function tokenForDistance(px: number, tokens: readonly DesignToken[]): string | null {
  let best: { name: string; off: number } | null = null;
  for (const t of tokens) {
    // spacing and sizes of layout, not of type, corners or lines
    if (!/^(spacing|dimension|size|space)/i.test(t.type) && !/^(space|spacing|size)\./.test(t.name))
      continue;
    if (/^(font|type|text|line|letter|radius|border|stroke|shadow|blur|opacity)/i.test(t.name))
      continue;
    const v = parsePx(t.valueLight);
    if (v === null || v <= 0) continue;
    const off = Math.abs(v - px);
    if (off <= 1 && (!best || off < best.off)) best = { name: t.name, off };
  }
  return best?.name ?? null;
}

/** What no longer fits the kit: tokens that are gone, components that were removed. */
export function handoffProblems(
  spec: HandoffSpec,
  tokens: readonly DesignToken[],
  components: readonly { id: string }[],
): string[] {
  const names = new Set(tokens.map((t) => t.name));
  const ids = new Set(components.map((c) => c.id));
  const out: string[] = [];
  for (const t of spec.tokens) if (!names.has(t)) out.push('Token ' + t + ' no longer exists');
  const gone = spec.components.filter((id) => !ids.has(id)).length;
  if (gone) out.push(String(gone) + ' component' + (gone === 1 ? ' was' : 's were') + ' removed');
  return out;
}

const cell = (s: string): string => s.replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');

/** The spec as Markdown, for a developer or an agent building the screen. */
export function handoffMarkdown(p: {
  title: string;
  version: number;
  status: string;
  imageUrl: string;
  spec: HandoffSpec;
  tokens: readonly DesignToken[];
  themes?: readonly TokenTheme[];
  components: readonly { id: string; name: string; codePath: string; status: string }[];
}): string {
  const { spec } = p;
  const L: string[] = [
    '# Handoff: ' + p.title + ' (version ' + String(p.version) + ')',
    '',
    'Review status: ' + p.status.replace(/_/g, ' ') + '. Image: ' + p.imageUrl,
  ];
  if (spec.imageWidth)
    L.push(
      'Measured on the image at ' +
        String(spec.imageWidth) +
        ' × ' +
        String(spec.imageHeight) +
        ' px.',
    );
  if (spec.notes.trim()) L.push('', spec.notes.trim());
  const byName = new Map(p.tokens.map((t) => [t.name, t]));
  if (spec.tokens.length) {
    const modes = ['light', 'dark', ...(p.themes ?? []).map((t) => t.name)];
    L.push(
      '',
      '## Tokens',
      '',
      '| Token | ' + modes.join(' | ') + ' |',
      '|---|' + modes.map(() => '---|').join(''),
    );
    for (const n of spec.tokens) {
      const t = byName.get(n);
      L.push(
        '| `' +
          n +
          '` | ' +
          modes.map((m) => (t ? cell(modeValue(t, m, p.themes ?? [])) : 'missing')).join(' | ') +
          ' |',
      );
    }
  }
  if (spec.components.length) {
    const byId = new Map(p.components.map((c) => [c.id, c]));
    L.push('', '## Components', '');
    for (const id of spec.components) {
      const c = byId.get(id);
      L.push(
        c
          ? '- ' +
              c.name +
              (c.codePath ? ' (`' + c.codePath + '`)' : '') +
              ', ' +
              c.status.replace(/_/g, ' ')
          : '- (a removed component)',
      );
    }
  }
  if (spec.states.length) {
    L.push('', '## States', '');
    for (const s of spec.states) L.push('- **' + s.name + '**' + (s.note ? ': ' + s.note : ''));
  }
  if (spec.breakpoints.length) {
    L.push('', '## Breakpoints', '');
    for (const b of [...spec.breakpoints].sort((x, y) => x.width - y.width))
      L.push(
        '- **' + b.name + '** from ' + String(b.width) + ' px' + (b.note ? ': ' + b.note : ''),
      );
  }
  if (spec.measures.length && spec.imageWidth) {
    L.push(
      '',
      '## Measures',
      '',
      '| Measure | Across | Down | Length | Token |',
      '|---|---|---|---|---|',
    );
    spec.measures.forEach((m, i) => {
      const d = measurePx(m, spec.imageWidth, spec.imageHeight);
      const along = d.dx >= d.dy ? d.dx : d.dy;
      L.push(
        '| ' +
          cell(m.label || 'Measure ' + String(i + 1)) +
          ' | ' +
          String(d.dx) +
          ' px | ' +
          String(d.dy) +
          ' px | ' +
          String(d.length) +
          ' px | ' +
          (tokenForDistance(along, p.tokens) ?? '–') +
          ' |',
      );
    });
  }
  if (spec.exports.length) {
    L.push('', '## Assets to export', '');
    for (const e of spec.exports) {
      const a = areaPx(e, spec.imageWidth, spec.imageHeight);
      L.push(
        '- **' +
          e.name +
          '**' +
          (spec.imageWidth
            ? ' at ' +
              String(a.x) +
              ', ' +
              String(a.y) +
              ', ' +
              String(a.w) +
              ' × ' +
              String(a.h) +
              ' px'
            : '') +
          ': ' +
          exportFileNames(e).join(', '),
      );
    }
  }
  return L.join('\n') + '\n';
}
