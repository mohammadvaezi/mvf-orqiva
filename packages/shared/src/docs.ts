// ── [PCODE-287 | S15 | v0.1.0] T30.1 Design tokens: themes and modes, aliases, W3C import, iOS and Android export ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-169 | S15 | v0.1.0] B3.2 Documents and UI kit on the server: page tree, versions, comments, backlinks, templates, knowledge, tokens, components, mockups, assets ──
//    Why:  the rules the server, the web app and the extension share for documents and the UI kit: which
//          links a page holds (to other pages and to the web), the difference between two versions line by
//          line, the page templates, the contrast of two colours as WCAG measures it, and the design tokens
//          written out as CSS variables, a Tailwind theme, TypeScript or the W3C token format.

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

/** Links in a Markdown page: other pages (by id in /docs/<id> links, or [[Title]]) and web addresses. */
export function pageLinks(markdown: string): {
  pageIds: string[];
  titles: string[];
  urls: string[];
} {
  const pageIds = new Set<string>();
  const titles = new Set<string>();
  const urls = new Set<string>();
  for (const m of markdown.matchAll(
    new RegExp('\\]\\((?:[^)\\s]*?/docs/)(' + UUID + ')[^)]*\\)', 'gi'),
  ))
    pageIds.add((m[1] ?? '').toLowerCase());
  for (const m of markdown.matchAll(/\[\[([^\]\n]{1,200})\]\]/g)) titles.add((m[1] ?? '').trim());
  for (const m of markdown.matchAll(
    /\]\((https?:\/\/[^)\s]+)\)|(?<![(\w])(https?:\/\/[^\s)<>"]+)/g,
  )) {
    const u = (m[1] ?? m[2] ?? '').replace(/[.,;:!?]+$/, '');
    if (u) urls.add(u);
  }
  return { pageIds: [...pageIds], titles: [...titles].filter(Boolean), urls: [...urls] };
}

export interface DiffLine {
  op: 'same' | 'add' | 'del';
  text: string;
}

/** Line diff by longest common subsequence; very long pages fall back to "all removed, all added". */
export function lineDiff(before: string, after: string): DiffLine[] {
  const a = before.split('\n');
  const b = after.split('\n');
  if (a.length * b.length > 4_000_000)
    return [
      ...a.map((text): DiffLine => ({ op: 'del', text })),
      ...b.map((text): DiffLine => ({ op: 'add', text })),
    ];
  const n = a.length;
  const m = b.length;
  const lcs: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--) {
      const row = lcs[i] as Uint32Array;
      row[j] =
        a[i] === b[j]
          ? (lcs[i + 1]?.[j + 1] ?? 0) + 1
          : Math.max(lcs[i + 1]?.[j] ?? 0, row[j + 1] ?? 0);
    }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ op: 'same', text: a[i] ?? '' });
      i++;
      j++;
    } else if ((lcs[i + 1]?.[j] ?? 0) >= (lcs[i]?.[j + 1] ?? 0))
      out.push({ op: 'del', text: a[i++] ?? '' });
    else out.push({ op: 'add', text: b[j++] ?? '' });
  }
  while (i < n) out.push({ op: 'del', text: a[i++] ?? '' });
  while (j < m) out.push({ op: 'add', text: b[j++] ?? '' });
  return out;
}

export interface DocTemplate {
  key: string;
  title: string;
  body: string;
}

export const DOC_TEMPLATES: readonly DocTemplate[] = [
  {
    key: 'adr',
    title: 'ADR: ',
    body: '## Status\n\nProposed\n\n## Context\n\nWhat forces are at play?\n\n## Decision\n\nWhat we will do.\n\n## Consequences\n\nWhat becomes easier, what becomes harder.\n',
  },
  {
    key: 'rfc',
    title: 'RFC: ',
    body: '## Summary\n\n## Motivation\n\n## Proposal\n\n## Alternatives considered\n\n## Open questions\n\n## Rollout\n',
  },
  {
    key: 'runbook',
    title: 'Runbook: ',
    body: '## When to use this\n\n## Before you start\n\n- Access needed:\n- Dashboards:\n\n## Steps\n\n1. \n\n## How to check it worked\n\n## Rollback\n',
  },
  {
    key: 'postmortem',
    title: 'Postmortem: ',
    body: '## Summary\n\n## Impact\n\n- Customers affected:\n- Duration:\n\n## Timeline\n\n| Time | What happened |\n| ---- | ------------- |\n|      |               |\n\n## Root cause\n\n## What went well\n\n## What we change\n\n- [ ] \n',
  },
  {
    key: 'meeting',
    title: 'Meeting notes: ',
    body: '**Date:** \n**People:** \n\n## Agenda\n\n1. \n\n## Notes\n\n## Decisions\n\n## Action items\n\n- [ ] \n',
  },
  {
    key: 'api',
    title: 'API: ',
    body: '## Purpose\n\n## Authentication\n\n## Endpoints\n\n### `GET /path`\n\nRequest:\n\n```json\n{}\n```\n\nResponse:\n\n```json\n{}\n```\n\n## Errors\n',
  },
];

// ── colours ──
/** #rgb, #rrggbb (or #rrggbbaa, alpha ignored) as 0–255 channels; null when it is not a hex colour. */
export function parseHex(v: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(v.trim());
  if (!m) return null;
  let h = m[1] ?? '';
  if (h.length === 3) h = h.replace(/./g, (c) => c + c);
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

const luminance = ([r, g, b]: [number, number, number]): number => {
  const ch = (c: number): number => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
};

/** WCAG contrast ratio of two hex colours (1 to 21), or null when one is not a hex colour. */
export function contrastRatio(a: string, b: string): number | null {
  const x = parseHex(a);
  const y = parseHex(b);
  if (!x || !y) return null;
  const [hi, lo] = [luminance(x), luminance(y)].sort((p, q) => q - p) as [number, number];
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
}

/** AA needs 4.5 for body text and 3 for large text and interface parts; AAA needs 7. */
export const contrastGrade = (ratio: number): 'AAA' | 'AA' | 'AA large' | 'fail' =>
  ratio >= 7 ? 'AAA' : ratio >= 4.5 ? 'AA' : ratio >= 3 ? 'AA large' : 'fail';

// ── design tokens ──
export interface DesignToken {
  name: string;
  type: string;
  valueLight: string;
  valueDark: string;
  description: string;
  /** [PCODE-287 | S15 | v0.1.0] values in named themes, where they differ from the theme's base */
  themes?: Record<string, string>;
}

// [PCODE-287 | S15 | v0.1.0] themes beyond light and dark, and values that point at another token
/** A theme of the project: its own values where set, the rest from light or dark. */
export interface TokenTheme {
  name: string;
  base: 'light' | 'dark';
}
const ALIAS = /^\{([a-z][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*){0,5})\}$/;
/** The token a value points at, as in the W3C format: {color.blue.500}. */
export const aliasOf = (value: string): string | null => ALIAS.exec(value.trim())?.[1] ?? null;

/** A token's own value in a mode (light, dark or a theme's name), before aliases are followed. */
export function modeValue(
  t: DesignToken,
  mode: string,
  themes: readonly TokenTheme[] = [],
): string {
  if (mode === 'light') return t.valueLight;
  if (mode === 'dark') return t.valueDark || t.valueLight;
  const own = t.themes?.[mode];
  if (own) return own;
  return modeValue(t, themes.find((x) => x.name === mode)?.base ?? 'light', themes);
}

/** Reads final values: aliases followed in the same mode; null for a missing token or a loop. */
export function tokenResolver(
  tokens: readonly DesignToken[],
  themes: readonly TokenTheme[] = [],
): (name: string, mode: string) => string | null {
  const byName = new Map(tokens.map((t) => [t.name, t]));
  return (name, mode) => {
    const seen = new Set<string>();
    let at = name;
    for (;;) {
      const t = byName.get(at);
      if (!t || seen.has(at)) return null;
      seen.add(at);
      const v = modeValue(t, mode, themes);
      const next = aliasOf(v);
      if (!next) return v;
      at = next;
    }
  };
}

/** Aliases that point at nothing, or round in a loop, per mode. */
export function aliasProblems(
  tokens: readonly DesignToken[],
  themes: readonly TokenTheme[] = [],
): { name: string; mode: string; target: string; problem: 'missing' | 'loop' }[] {
  const read = tokenResolver(tokens, themes);
  const names = new Set(tokens.map((t) => t.name));
  const out: { name: string; mode: string; target: string; problem: 'missing' | 'loop' }[] = [];
  for (const t of tokens)
    for (const mode of ['light', 'dark', ...themes.map((x) => x.name)]) {
      const target = aliasOf(modeValue(t, mode, themes));
      if (!target || read(t.name, mode) !== null) continue;
      if (out.some((p) => p.name === t.name && p.target === target)) continue;
      out.push({ name: t.name, mode, target, problem: names.has(target) ? 'loop' : 'missing' });
    }
  return out;
}

const cssName = (name: string): string => '--' + name.replace(/\./g, '-');
const cssValue = (v: string): string => {
  const a = aliasOf(v);
  return a ? 'var(' + cssName(a) + ')' : v;
};

/** CSS custom properties: light on :root, dark in the dark media query and under [data-theme='dark'],
 *  each theme complete under its own [data-theme]. Aliases become var(). */
export function tokensToCss(
  tokens: readonly DesignToken[],
  themes: readonly TokenTheme[] = [],
): string {
  const sorted = [...tokens].sort((a, b) => a.name.localeCompare(b.name));
  const line = (t: DesignToken, v: string): string =>
    '  ' + cssName(t.name) + ': ' + cssValue(v) + ';';
  const light = sorted.map((t) => line(t, t.valueLight)).join('\n');
  const dark = sorted
    .filter((t) => t.valueDark)
    .map((t) => line(t, t.valueDark))
    .join('\n');
  // a theme lists every token, so the dark media query never leaks into a light-based theme
  const themed = themes
    .map(
      (th) =>
        "\n:root[data-theme='" +
        th.name +
        "'] {\n  color-scheme: " +
        th.base +
        ';\n' +
        sorted.map((t) => line(t, modeValue(t, th.name, themes))).join('\n') +
        '\n}\n',
    )
    .join('');
  return (
    '/* Design tokens, generated by Orqiva. Do not edit by hand. */\n:root {\n' +
    light +
    '\n}\n' +
    (dark
      ? "\n@media (prefers-color-scheme: dark) {\n  :root:not([data-theme='light']) {\n" +
        dark.replace(/^/gm, '  ') +
        "\n  }\n}\n\n:root[data-theme='dark'] {\n" +
        dark +
        '\n}\n'
      : '') +
    themed
  );
}

const nest = (
  tokens: readonly DesignToken[],
  value: (t: DesignToken) => unknown,
): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const t of [...tokens].sort((a, b) => a.name.localeCompare(b.name))) {
    const parts = t.name.split('.');
    let at = out;
    parts.slice(0, -1).forEach((p) => {
      const next = at[p];
      at[p] = typeof next === 'object' && next !== null ? next : {};
      at = at[p] as Record<string, unknown>;
    });
    at[parts[parts.length - 1] ?? t.name] = value(t);
  }
  return out;
};

const TAILWIND_GROUP: Record<string, string> = {
  color: 'colors',
  dimension: 'spacing',
  fontFamily: 'fontFamily',
  fontWeight: 'fontWeight',
  duration: 'transitionDuration',
  shadow: 'boxShadow',
};

/** A Tailwind theme extension whose values read the CSS variables, so light and dark both work. */
export function tokensToTailwind(tokens: readonly DesignToken[]): string {
  const theme: Record<string, Record<string, unknown>> = {};
  for (const [type, key] of Object.entries(TAILWIND_GROUP)) {
    // color.text.muted becomes colors.text.muted = var(--color-text-muted)
    const list = tokens
      .filter((t) => t.type === type)
      .map((t) => ({
        ...t,
        name: t.name.split('.').slice(1).join('.') || t.name,
        valueLight: 'var(' + cssName(t.name) + ')',
      }));
    if (list.length) theme[key] = nest(list, (t) => t.valueLight);
  }
  return (
    '// Design tokens, generated by Orqiva. Do not edit by hand.\nexport default ' +
    JSON.stringify({ theme: { extend: theme } }, null, 2) +
    ';\n'
  );
}

/** A typed TypeScript object of the final values: light, dark and each theme where they differ. */
export function tokensToTs(
  tokens: readonly DesignToken[],
  themes: readonly TokenTheme[] = [], // [PCODE-287 | S15 | v0.1.0]
): string {
  const read = tokenResolver(tokens, themes);
  return (
    '// Design tokens, generated by Orqiva. Do not edit by hand.\nexport const tokens = ' +
    JSON.stringify(
      nest(tokens, (t) => {
        const light = read(t.name, 'light') ?? t.valueLight;
        const modes: Record<string, string> = {};
        const dark = read(t.name, 'dark');
        if (dark !== null && dark !== light) modes['dark'] = dark;
        for (const th of themes) {
          const v = read(t.name, th.name);
          if (v !== null && v !== (read(t.name, th.base) ?? light)) modes[th.name] = v;
        }
        return Object.keys(modes).length ? { light, ...modes } : light;
      }),
      null,
      2,
    ) +
    ' as const;\n'
  );
}

/** The W3C Design Tokens format ($value, $type, $description, aliases as they are); dark and theme
 *  values as an extension, and the themes with their bases on the root. */
export function tokensToW3c(
  tokens: readonly DesignToken[],
  themes: readonly TokenTheme[] = [], // [PCODE-287 | S15 | v0.1.0]
): string {
  const tree = nest(tokens, (t) => {
    const modes: Record<string, string> = {
      ...(t.valueDark ? { dark: t.valueDark } : {}),
      ...(t.themes ?? {}),
    };
    return {
      $value: t.valueLight,
      $type: t.type,
      ...(t.description ? { $description: t.description } : {}),
      ...(Object.keys(modes).length ? { $extensions: { 'com.orqiva.modes': modes } } : {}),
    };
  });
  return (
    JSON.stringify(
      themes.length ? { ...tree, $extensions: { 'com.orqiva.themes': themes } } : tree,
      null,
      2,
    ) + '\n'
  );
}
