// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-103 | S15 | v0.1.0] Build the CLI `orq` and the Claude Code hooks against the new server ──
//    Why:  the fingerprint rules of v0.1.0 (fingerprint.py), in one place for every tool: the orq CLI scans
//          with them, the VS Code extension and the server read the same markers. A marker is
//          `[TASK | SPRINT | vVERSION] title` inside the language's comment; the first marker of a task in a
//          file is its header, later ones mark blocks. Task keys accept the platform's project keys
//          (2-10 letters and digits), which include every key the engine used.

export const MARKER =
  /\[([A-Z][A-Z0-9]{1,9}-\d+)\s*\|\s*([^|\]]+?)\s*\|\s*v(\d+\.\d+\.\d+)\]\s*(.*)/;

/** extension -> [line prefix, block open, block close]; an extension not listed is not code */
export const COMMENT: Readonly<
  Record<string, readonly [string | null, string | null, string | null]>
> = {
  py: ['#', null, null],
  sh: ['#', null, null],
  bash: ['#', null, null],
  ps1: ['#', null, null],
  yml: ['#', null, null],
  yaml: ['#', null, null],
  toml: ['#', null, null],
  rb: ['#', null, null],
  cfg: ['#', null, null],
  ini: ['#', null, null],
  dockerfile: ['#', null, null],
  r: ['#', null, null],
  makefile: ['#', null, null],
  js: ['//', null, null],
  jsx: ['//', null, null],
  ts: ['//', null, null],
  tsx: ['//', null, null],
  mjs: ['//', null, null],
  cjs: ['//', null, null],
  go: ['//', null, null],
  rs: ['//', null, null],
  java: ['//', null, null],
  kt: ['//', null, null],
  cs: ['//', null, null],
  c: ['//', null, null],
  h: ['//', null, null],
  cpp: ['//', null, null],
  hpp: ['//', null, null],
  swift: ['//', null, null],
  php: ['//', null, null],
  dart: ['//', null, null],
  scala: ['//', null, null],
  html: [null, '<!--', '-->'],
  htm: [null, '<!--', '-->'],
  xml: [null, '<!--', '-->'],
  vue: [null, '<!--', '-->'],
  svelte: [null, '<!--', '-->'],
  md: [null, '<!--', '-->'],
  css: [null, '/*', '*/'],
  scss: ['//', null, null],
  less: ['//', null, null],
  jinja: [null, '{#', '#}'],
  j2: [null, '{#', '#}'],
  sql: ['--', null, null],
  lua: ['--', null, null],
};

export const SKIP_DIRS: ReadonlySet<string> = new Set([
  '.git',
  'node_modules',
  '__pycache__',
  '.venv',
  'venv',
  'dist',
  'build',
  '.plane',
  '.orqiva',
  '.idea',
  '.vscode',
  'vendor',
  'target',
  '.next',
  'coverage',
  'translations',
]);

export const SKIP_EXT: ReadonlySet<string> = new Set([
  'min.js',
  'min.css',
  'map',
  'lock',
  'png',
  'jpg',
  'jpeg',
  'gif',
  'svg',
  'ico',
  'pdf',
  'woff',
  'woff2',
  'ttf',
  'otf',
  'zip',
  'exe',
  'dll',
  'so',
  'pyc',
  'mo',
  'po',
  'pot',
  'json',
  'csv',
  'txt',
]);

/** A folder the scanner walks into: not skipped, and not hidden (except .github). */
export const walkDir = (name: string): boolean =>
  !SKIP_DIRS.has(name) && (!name.startsWith('.') || name === '.github');

export function extOf(path: string): string {
  const base = (path.split(/[\\/]/).pop() ?? '').toLowerCase();
  if (base === 'dockerfile' || base === 'makefile') return base;
  if (!base.includes('.')) return '';
  if (base.endsWith('.min.js') || base.endsWith('.min.css')) return 'min.js';
  if (base.endsWith('.html.j2') || base.endsWith('.html.jinja')) return 'jinja';
  return base.slice(base.lastIndexOf('.') + 1);
}

/** Code is what can carry a fingerprint; Markdown is documentation, not code. */
export function isCode(path: string): boolean {
  const e = extOf(path);
  return e in COMMENT && !SKIP_EXT.has(e) && e !== 'md';
}

export function commentLines(path: string, lines: string[]): string[] {
  const [pre, open, close] = COMMENT[extOf(path)] ?? ['#', null, null];
  return pre
    ? lines.map((l) => (pre + ' ' + l).trimEnd())
    : lines.map((l) => (open ?? '') + ' ' + l + ' ' + (close ?? ''));
}

export function markerText(task: string, sprint: string, version: string, title: string): string {
  return '[' + task + ' | ' + sprint + ' | v' + version + '] ' + title;
}

/** The header a file gets for a task: the marker, and optionally the task link and why. */
export function headerBlock(
  path: string,
  m: { task: string; sprint: string; version: string; title: string; url?: string; why?: string },
): string {
  const lines = ['── ' + markerText(m.task, m.sprint, m.version, m.title) + ' ──'];
  if (m.url) lines.push('   Task: ' + m.url);
  if (m.why) lines.push('   Why:  ' + m.why);
  return commentLines(path, lines).join('\n');
}

export interface FingerprintHit {
  /** relative to the project root, forward slashes */
  file: string;
  line: number;
  task: string;
  sprint: string;
  version: string;
  title: string;
  kind: 'header' | 'block';
}

/** Markers in one file's text, in order; `file` is filled in by the caller. */
export function scanText(text: string, file = ''): FingerprintHit[] {
  const out: FingerprintHit[] = [];
  const seen = new Set<string>();
  text.split(/\r?\n/).forEach((line, i) => {
    const m = MARKER.exec(line);
    if (!m?.[1]) return;
    const task = m[1];
    out.push({
      file,
      line: i + 1,
      task,
      sprint: (m[2] ?? '').trim(),
      version: m[3] ?? '',
      // the decorations around a header (── … ──, -->, */) are not part of the title
      title: (m[4] ?? '')
        .replace(/\s*(-->|\*\/|#\})\s*$/, '')
        .replace(/[\s─—-]+$/, '')
        .trim(),
      kind: seen.has(task) ? 'block' : 'header',
    });
    seen.add(task);
  });
  return out;
}

/** The fingerprint index as Markdown: tasks by sprint, then files. */
export function indexMarkdown(
  hits: FingerprintHit[],
  project?: { name: string; key: string },
): string {
  const bySprint = new Map<string, Map<string, FingerprintHit[]>>();
  const byFile = new Map<string, Set<string>>();
  for (const h of hits) {
    const tasks = bySprint.get(h.sprint) ?? new Map<string, FingerprintHit[]>();
    tasks.set(h.task, [...(tasks.get(h.task) ?? []), h]);
    bySprint.set(h.sprint, tasks);
    byFile.set(h.file, (byFile.get(h.file) ?? new Set()).add(h.task));
  }
  const num = (t: string): number => Number(t.split('-')[1]);
  const lines = [
    '# Fingerprint index',
    '',
    'Generated by `orq done`: every task and the code written for it. Markers: `[TASK | SPRINT | vVERSION]` in comments.',
    '',
  ];
  if (project) lines.push('Project: ' + project.name + ' (`' + project.key + '`)', '');
  lines.push('## By sprint and task');
  for (const sprint of [...bySprint.keys()].sort()) {
    lines.push('', '### ' + sprint);
    const tasks = bySprint.get(sprint) ?? new Map<string, FingerprintHit[]>();
    for (const task of [...tasks.keys()].sort((a, b) => num(a) - num(b))) {
      const items = tasks.get(task) ?? [];
      const title = items.find((i) => i.title)?.title ?? '';
      const versions = [...new Set(items.map((i) => i.version))].sort();
      lines.push('- **' + task + '** ' + title + ' _(v' + versions.join(', ') + ')_');
      for (const i of [...items].sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line))
        lines.push('  - `' + i.file + ':' + String(i.line) + '` ' + i.kind);
    }
  }
  lines.push('', '## By file');
  for (const f of [...byFile.keys()].sort())
    lines.push(
      '- `' + f + '` — ' + [...(byFile.get(f) ?? [])].sort((a, b) => num(a) - num(b)).join(', '),
    );
  return lines.join('\n') + '\n';
}
