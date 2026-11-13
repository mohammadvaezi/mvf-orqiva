// ── [PCODE-15 | S03 | v0.1.0] Add the status bar item showing active task, fingerprint and queue length ──
//    Task: https://plan.broszio.com/prodsystem/projects/74f47636-71b0-4eb5-94b5-ea2fe840ec01/issues/
//    Why:  the TypeScript twin of fingerprint.py - same MARK regex, same comment-syntax table - so what the
//          extension inserts is exactly what the engine's scanner finds. Pure module.

/** Byte-identical to fingerprint.py MARK (JS syntax). */
export const MARK = /\[([A-Z]{2,5}-\d+)\s*\|\s*([^|\]]+?)\s*\|\s*v(\d+\.\d+\.\d+)\]\s*(.*)/;

export interface Marker {
  task: string;
  sprint: string;
  version: string;
  title: string;
  line: number;
  kind: 'header' | 'block';
}

type Syntax = { line: string } | { open: string; close: string };

// ── [PCODE-15 | S03 | v0.1.0] COMMENT: extension -> comment syntax, mirrored from fingerprint.py ──
const LINE_HASH = [
  'py',
  'sh',
  'bash',
  'ps1',
  'yml',
  'yaml',
  'toml',
  'rb',
  'cfg',
  'ini',
  'dockerfile',
  'r',
  'makefile',
];
const LINE_SLASH = [
  'js',
  'jsx',
  'ts',
  'tsx',
  'mjs',
  'cjs',
  'go',
  'rs',
  'java',
  'kt',
  'cs',
  'c',
  'h',
  'cpp',
  'hpp',
  'swift',
  'php',
  'dart',
  'scala',
  'scss',
  'less',
];
const BLOCK: Record<string, Syntax> = {
  html: { open: '<!--', close: '-->' },
  htm: { open: '<!--', close: '-->' },
  xml: { open: '<!--', close: '-->' },
  vue: { open: '<!--', close: '-->' },
  svelte: { open: '<!--', close: '-->' },
  md: { open: '<!--', close: '-->' },
  css: { open: '/*', close: '*/' },
  jinja: { open: '{#', close: '#}' },
  j2: { open: '{#', close: '#}' },
};
const LINE_DASH = ['sql', 'lua'];

export function extOf(filePath: string): string {
  const base = filePath.replace(/\\/g, '/').split('/').pop()?.toLowerCase() ?? '';
  if (base === 'dockerfile') return 'dockerfile';
  if (base === 'makefile') return 'makefile';
  if (base.endsWith('.html.j2') || base.endsWith('.html.jinja')) return 'jinja';
  const i = base.lastIndexOf('.');
  return i < 0 ? '' : base.slice(i + 1);
}

export function syntaxFor(filePath: string): Syntax {
  const e = extOf(filePath);
  if (LINE_HASH.includes(e)) return { line: '#' };
  if (LINE_SLASH.includes(e)) return { line: '//' };
  if (LINE_DASH.includes(e)) return { line: '--' };
  return BLOCK[e] ?? { line: '#' };
}

export function isCode(filePath: string): boolean {
  const e = extOf(filePath);
  return (
    e !== 'md' &&
    (LINE_HASH.includes(e) || LINE_SLASH.includes(e) || LINE_DASH.includes(e) || e in BLOCK)
  );
}

export function markerText(task: string, sprint: string, version: string, title: string): string {
  return `[${task} | ${sprint} | v${version}] ${title}`;
}

function commentLines(filePath: string, lines: string[]): string[] {
  const s = syntaxFor(filePath);
  return 'line' in s
    ? lines.map((l) => `${s.line} ${l}`.trimEnd())
    : lines.map((l) => `${s.open} ${l} ${s.close}`);
}

// ── [PCODE-15 | S03 | v0.1.0] headerBlock: same shape fingerprint.py header_block() prints ──
export function headerBlock(
  filePath: string,
  task: string,
  sprint: string,
  version: string,
  title: string,
  url?: string,
  why?: string,
): string {
  const lines = [`-- ${markerText(task, sprint, version, title)} --`];
  if (url) lines.push(`   Task: ${url}`);
  if (why) lines.push(`   Why:  ${why}`);
  return commentLines(filePath, lines).join('\n');
}

/** One line to put above a function/class/section written for the task. */
export function blockLine(
  filePath: string,
  task: string,
  sprint: string,
  version: string,
  what: string,
): string {
  return commentLines(filePath, [markerText(task, sprint, version, what)])[0] ?? '';
}

// ── [PCODE-15 | S03 | v0.1.0] scanText: markers in a file's text; first per task = header, later = block ──
export function scanText(text: string): Marker[] {
  const out: Marker[] = [];
  const seen = new Set<string>();
  // [PCODE-40 | S08 | v0.1.0] a marker needs '[' and '|': skipping the regex for the other 99 % of the
  // lines is what keeps a ten-thousand-file scan under a few seconds
  if (!text.includes('[')) return out;
  text.split(/\r?\n/).forEach((line, idx) => {
    if (!line.includes('[') || !line.includes('|')) return;
    const m = MARK.exec(line);
    if (!m?.[1] || !m[2] || !m[3]) return;
    const task = m[1];
    out.push({
      task,
      sprint: m[2].trim(),
      version: m[3],
      title: (m[4] ?? '').trim().replace(/[-—\s]+$/, ''),
      line: idx + 1,
      kind: seen.has(task) ? 'block' : 'header',
    });
    seen.add(task);
  });
  return out;
}

export function hasMarker(text: string, task: string): boolean {
  return scanText(text).some((m) => m.task === task);
}
