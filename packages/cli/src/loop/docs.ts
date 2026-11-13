// ── [PCODE-309 | S15 | v0.1.0] T31.8b Architecture graph, change coupling and bus factor on the code map ──
// ── [PCODE-281 | S15 | v0.1.0] T29.3 Document embeds: live task lists, designs, Gantt, repo code; README import ──
// ── [PCODE-201 | S15 | v0.1.0] T16.5 Docs and handover from the terminal and VS Code: orq docs scan/build/drift, orq handover ──
//    Why:  the documentation and the handover from the terminal. `orq docs scan` sends what the server's
//          code map and docs from code are built from, read from Git: every tracked text file with its
//          lines, language and complexity, how often it changed and who wrote it in the last 90 days, the
//          share agents wrote, and when it last changed; then the pages are rebuilt. `orq handover` shows
//          the checks and the team checklist, ticks items and sends the pack.
import { importsOf, isReadme, resolveImport } from '@orqiva/shared'; // [PCODE-281 | S15 | v0.1.0] [PCODE-309 | S15 | v0.1.0]
import { readFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import {
  LoopError,
  linked,
  option,
  positionals,
  type Linked,
  type LoopDeps,
  type LoopResult,
} from './commands.js';

export const DOCS_USAGE = [
  '  docs scan [--openapi FILE] [--no-build]   send the code scan (and the OpenAPI document), rebuild the docs',
  '  docs build                 rebuild the pages built from the code',
  '  docs drift                 pages that name files changed after them, or gone',
  '  handover                   the handover checks and the team checklist, numbered',
  '  handover check N           tick (or untick) item N of the checklist',
  '  handover send [--note "…"]   send the handover pack to the client',
];

const DAY = 86_400_000;
const LANG: Record<string, string> = {
  ts: 'TypeScript',
  tsx: 'TypeScript',
  mts: 'TypeScript',
  js: 'JavaScript',
  jsx: 'JavaScript',
  mjs: 'JavaScript',
  cjs: 'JavaScript',
  py: 'Python',
  go: 'Go',
  rs: 'Rust',
  java: 'Java',
  kt: 'Kotlin',
  swift: 'Swift',
  cs: 'C#',
  rb: 'Ruby',
  php: 'PHP',
  sql: 'SQL',
  css: 'CSS',
  scss: 'CSS',
  html: 'HTML',
  md: 'Markdown',
  json: 'JSON',
  yaml: 'YAML',
  yml: 'YAML',
  sh: 'Shell',
  ps1: 'PowerShell',
};

/** The language of a file by its ending; empty when unknown. */
export const languageOf = (path: string): string =>
  LANG[(/\.([A-Za-z0-9]+)$/.exec(path)?.[1] ?? '').toLowerCase()] ?? '';

/** Branches in a file: a rough cyclomatic count (if, loops, case, catch, &&, ||, ?:). */
export function complexityOf(text: string): number {
  const words = text.match(/\b(if|for|while|case|catch|elif|except|when)\b/g)?.length ?? 0;
  const ops = text.match(/&&|\|\||\?\?|\s\?\s/g)?.length ?? 0;
  return words + ops;
}

export interface GitFacts {
  lastCommitAt: string;
  /** commits in the last 90 days */
  churn: number;
  /** lines added in the last 90 days, per author */
  authors: Record<string, number>;
  /** of those, lines added by agents */
  agentLines: number;
}

const isAgent = (author: string, coAuthors: string): boolean =>
  /\b(agent|bot)\b|claude/i.test(author) || /claude|agent/i.test(coAuthors);

/**
 * Reads `git log --numstat` written with the format "@@date<TAB>author<TAB>co-authors", newest first:
 * per file its last change, and its changes and authors since a day.
 */
export function parseGitLog(text: string, since: number): Map<string, GitFacts> {
  const out = new Map<string, GitFacts>();
  let when = '';
  let author = '';
  let agent = false;
  for (const line of text.split('\n')) {
    if (line.startsWith('@@')) {
      const [date = '', name = '', co = ''] = line.slice(2).split('\t');
      when = date;
      author = name;
      agent = isAgent(name, co);
      continue;
    }
    const m = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line);
    if (!m || !when) continue;
    const path = m[3] ?? '';
    let f = out.get(path);
    if (!f) {
      f = { lastCommitAt: when, churn: 0, authors: {}, agentLines: 0 };
      out.set(path, f);
    }
    if (Date.parse(when) < since) continue;
    f.churn++;
    const added = m[1] === '-' ? 0 : Number(m[1]);
    const who = agent ? 'Agent' : author;
    f.authors[who] = (f.authors[who] ?? 0) + added;
    if (agent) f.agentLines += added;
  }
  return out;
}

export interface ScanFile {
  path: string;
  language: string;
  lines: number;
  complexity: number;
  churn: number;
  authors: Record<string, number>;
  agentShare: number;
  lastCommitAt: string | null;
  /** [PCODE-309 | S15 | v0.1.0] the repository's own files it imports */
  imports: string[];
}

/** One file of the code scan, from its text and its Git history (and the repository's paths, for imports). */
export function scanFile(
  path: string,
  text: string,
  git: GitFacts | undefined,
  known: ReadonlySet<string> = new Set(),
  packages: ReadonlyMap<string, string> = new Map(),
): ScanFile {
  const lines = text ? text.split('\n').length - (text.endsWith('\n') ? 1 : 0) : 0;
  const added = git ? Object.values(git.authors).reduce((a, b) => a + b, 0) : 0;
  return {
    path,
    language: languageOf(path),
    lines,
    complexity: complexityOf(text),
    churn: git?.churn ?? 0,
    authors: git?.authors ?? {},
    agentShare: added ? Math.round((Math.min(added, git?.agentLines ?? 0) / added) * 100) / 100 : 0,
    lastCommitAt: git?.lastCommitAt ?? null,
    // [PCODE-309 | S15 | v0.1.0] followed into the repository; packages are left out
    imports: [
      ...new Set(
        importsOf(path, text).flatMap((spec) => {
          const to = resolveImport(path, spec, known, packages);
          return to && to !== path ? [to] : [];
        }),
      ),
    ]
      .sort()
      .slice(0, 500),
  };
}

// [PCODE-309 | S15 | v0.1.0] a monorepo's packages: the name in each tracked package.json to its folder
export async function packagesOf(
  root: string,
  paths: readonly string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const p of paths) {
    if (p !== 'package.json' && !p.endsWith('/package.json')) continue;
    const text = await readFile(join(root, p), 'utf8').catch(() => '');
    let name: unknown;
    try {
      name = (JSON.parse(text) as { name?: unknown }).name;
    } catch {
      continue;
    }
    if (typeof name === 'string' && name && p.includes('/'))
      out.set(name, p.slice(0, -'/package.json'.length));
  }
  return out;
}

const BATCH = 3000;
// [PCODE-201 | S15 | v0.1.0] a big scan and a rebuild take longer than a hook's call
const SLOW = 120_000;

async function docsScan(argv: readonly string[], deps: LoopDeps, l: Linked): Promise<string[]> {
  const listed = await deps.exec('git', ['ls-files', '-z'], l.root);
  if (listed.code !== 0)
    throw new LoopError('orq docs scan reads the files Git tracks; this is not a Git repository');
  const paths = listed.out.split('\u0000').filter(Boolean);
  const log = await deps.exec(
    'git',
    [
      'log',
      '--no-renames',
      '--format=@@%aI%x09%an%x09%(trailers:key=Co-Authored-By,valueonly,separator=%x2C)',
      '--numstat',
    ],
    l.root,
  );
  const now = deps.now?.() ?? Date.now();
  const history =
    log.code === 0 ? parseGitLog(log.out, now - 90 * DAY) : new Map<string, GitFacts>();
  const files: ScanFile[] = [];
  // [PCODE-309 | S15 | v0.1.0] the repository's paths, and its own packages by name (a monorepo)
  const known = new Set(paths);
  const packages = await packagesOf(l.root, paths);
  for (const p of paths) {
    const buf = await readFile(join(l.root, p)).catch(() => null);
    if (!buf || buf.length > 2_000_000 || buf.includes(0)) continue;
    files.push(scanFile(p, buf.toString('utf8'), history.get(p), known, packages));
  }
  const P = l.ws + '/projects/' + l.link.projectId;
  const lines: string[] = [];
  if (files.length <= BATCH) {
    const r = await l.api.call<{ files: number; removed: number }>(
      'POST',
      P + '/code-scan',
      {
        files,
        full: true,
      },
      SLOW,
    );
    lines.push(
      'Code scan: ' +
        String(r.files) +
        ' files sent' +
        (r.removed ? ', ' + String(r.removed) + ' gone from the map' : '') +
        '.',
    );
  } else {
    for (let at = 0; at < files.length; at += BATCH)
      await l.api.call('POST', P + '/code-scan', { files: files.slice(at, at + BATCH) }, SLOW);
    lines.push(
      'Code scan: ' +
        String(files.length) +
        ' files sent in parts (files deleted from the repository stay in the map; a scan this large is not sent as a full one).',
    );
  }
  // [PCODE-281 | S15 | v0.1.0] the text of what pages need: the README files and the files code embeds name
  const want = await l.api.call<{ paths: string[] }>('GET', P + '/code-texts/wanted');
  const tracked = new Set(paths);
  const needed = [
    ...new Set([
      ...paths.filter(isReadme).slice(0, 20),
      ...want.paths.filter((p) => tracked.has(p)),
    ]),
  ];
  const texts: { path: string; text: string }[] = [];
  let size = 0;
  for (const p of needed) {
    const buf = await readFile(join(l.root, p)).catch(() => null);
    if (!buf || buf.includes(0) || buf.length > 300_000 || size + buf.length > 3_000_000) continue;
    size += buf.length;
    texts.push({ path: p, text: buf.toString('utf8') });
  }
  await l.api.call('PUT', P + '/code-texts', { texts, full: true }, SLOW);
  const missing = want.paths.filter((p) => !tracked.has(p));
  lines.push(
    'Texts for pages: ' +
      String(texts.length) +
      (texts.length === 1 ? ' file' : ' files') +
      ' (README and code embeds)' +
      (missing.length ? '; not in the repository: ' + missing.slice(0, 5).join(', ') : '') +
      '.',
  );
  const spec = option(argv, '--openapi');
  if (spec) {
    const text = await readFile(isAbsolute(spec) ? spec : join(deps.cwd, spec), 'utf8').catch(
      () => null,
    );
    if (text === null) throw new LoopError('Cannot read ' + spec);
    let doc: unknown;
    try {
      doc = JSON.parse(text);
    } catch {
      throw new LoopError(spec + ' is not JSON (send the OpenAPI document as JSON)');
    }
    const r = await l.api.call<{ endpoints: number; removed: number }>(
      'POST',
      P + '/api-endpoints/import',
      { openapi: doc },
    );
    lines.push(
      'OpenAPI: ' +
        String(r.endpoints) +
        ' endpoints' +
        (r.removed ? ', ' + String(r.removed) + ' dropped' : '') +
        '.',
    );
  }
  if (!argv.includes('--no-build')) lines.push(...(await docsBuild(l)));
  return lines;
}

async function docsBuild(l: Linked): Promise<string[]> {
  const r = await l.api.call<{
    created: number;
    updated: number;
    unchanged: number;
    removed: number;
  }>('POST', l.ws + '/projects/' + l.link.projectId + '/docs/from-code', undefined, SLOW);
  if (!r.created && !r.updated && !r.unchanged)
    return [
      'Nothing to build yet: run orq docs scan (and pass --openapi FILE for the API reference).',
    ];
  return [
    'Docs from code: ' +
      [
        r.created ? String(r.created) + ' new' : '',
        r.updated ? String(r.updated) + ' changed' : '',
        r.unchanged ? String(r.unchanged) + ' unchanged' : '',
        r.removed ? String(r.removed) + ' removed' : '',
      ]
        .filter(Boolean)
        .join(', ') +
      ' (Documents, folder "Built from the code").',
  ];
}

interface DriftOut {
  title: string;
  ownerName: string | null;
  refs: { path: string; line: number | null; state: string }[];
}

async function docsDrift(l: Linked): Promise<string[]> {
  const r = await l.api.call<DriftOut[]>(
    'GET',
    l.ws + '/projects/' + l.link.projectId + '/docs/drift',
  );
  if (!r.length) return ['No page names a file that changed after it or is gone.'];
  return r.flatMap((p) => [
    p.title + (p.ownerName ? ' (' + p.ownerName + ')' : ''),
    ...p.refs.map(
      (x) =>
        '  ' +
        x.path +
        (x.line ? ':' + String(x.line) : '') +
        (x.state === 'gone' ? ' is gone' : ' changed after the page'),
    ),
  ]);
}

interface HandoverOut {
  checks: { key: string; label: string; state: string; detail: string }[];
  ready: boolean;
  items: { id: string; label: string; done: boolean }[];
  client: string | null;
  packs: { number: number; status: string; signedName: string; decisionNote: string }[];
}

const MARK: Record<string, string> = { ok: '✓', warn: '!', missing: '✗' };

/** The handover status as the terminal prints it. */
export function handoverText(h: HandoverOut): string[] {
  const out = h.checks
    .filter((c) => !c.key.startsWith('item:'))
    .map((c) => (MARK[c.state] ?? '?') + ' ' + c.label + ': ' + c.detail);
  out.push('', 'Team checklist:');
  h.items.forEach((it, i) =>
    out.push('  ' + String(i + 1) + '. [' + (it.done ? 'x' : ' ') + '] ' + it.label),
  );
  if (!h.items.length) out.push('  (empty: add items in the web app, Handover tab)');
  const last = h.packs[0];
  out.push(
    '',
    last
      ? 'Latest: pack ' +
          String(last.number) +
          ', ' +
          (last.status === 'accepted'
            ? 'accepted by ' + last.signedName
            : last.status === 'changes_requested'
              ? 'changes asked for: ' + last.decisionNote
              : last.status === 'sent'
                ? 'waiting for ' + (h.client ?? 'the client')
                : last.status)
      : 'No pack sent yet.',
    h.ready
      ? 'Ready: orq handover send'
      : 'Not ready: ' +
          h.checks
            .filter((c) => c.state === 'missing')
            .map((c) => c.label)
            .join(', '),
  );
  return out;
}

async function handover(argv: readonly string[], l: Linked): Promise<string[]> {
  const P = l.ws + '/projects/' + l.link.projectId;
  const [, sub, n] = positionals(argv, ['--note']);
  const status = (): Promise<HandoverOut> => l.api.call<HandoverOut>('GET', P + '/handover');
  if (!sub) return handoverText(await status());
  if (sub === 'check') {
    const h = await status();
    const it = h.items[Number(n) - 1];
    if (!it) throw new LoopError('No checklist item ' + (n ?? '') + ' (orq handover lists them)');
    await l.api.call('PATCH', l.ws + '/handover-items/' + it.id, { done: !it.done });
    return [(it.done ? 'Unticked: ' : 'Ticked: ') + it.label];
  }
  if (sub === 'send') {
    const note = option(argv, '--note');
    const r = await l.api.call<{ pack: { number: number } }>(
      'POST',
      P + '/handover/packs',
      note ? { note } : {},
    );
    return [
      'Sent handover pack ' +
        String(r.pack.number) +
        ' to ' +
        l.link.projectKey +
        '’s client. They read and sign it in the portal.',
    ];
  }
  throw new LoopError('orq handover [check N | send [--note "…"]]');
}

/** orq docs … and orq handover …; null for any other command. */
export async function runDocs(argv: readonly string[], deps: LoopDeps): Promise<LoopResult | null> {
  const [command, sub] = argv;
  if (command === 'handover')
    return { code: 0, out: (await handover(argv, linked(deps))).join('\n') };
  if (command !== 'docs') return null;
  const l = linked(deps);
  if (sub === 'scan') return { code: 0, out: (await docsScan(argv, deps, l)).join('\n') };
  if (sub === 'build') return { code: 0, out: (await docsBuild(l)).join('\n') };
  if (sub === 'drift') return { code: 0, out: (await docsDrift(l)).join('\n') };
  throw new LoopError('orq docs scan | build | drift');
}
