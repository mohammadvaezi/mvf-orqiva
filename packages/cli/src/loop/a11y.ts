// ── [PCODE-296 | S15 | v0.1.0] T30.9 Accessibility checks: alt text, names, focus order, target size, in the code and on the page ──
//    Why:  accessibility from the terminal and from CI. `orq a11y check` reads the changed (or named)
//          files, `orq a11y scan` every UI file Git tracks and sends the result; `orq a11y script` prints
//          the page audit for a browser (CI injects it after a page loaded and saves what it gives), and
//          `orq a11y report` sends that to the screen's report. `orq done` warns with the same check.
import {
  A11Y_RULES,
  auditScript,
  isMarkupFile,
  isStyleFile,
  lintA11y,
  type A11yCodeFinding,
  type A11yPageReport,
} from '@orqiva/shared';
import { readFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import {
  LoopError,
  linked,
  option,
  positionals,
  type Linked,
  type LoopDeps,
  type LoopResult,
} from './commands.js';
import { changedFiles } from './kit.js';

export const A11Y_USAGE = [
  '  a11y check [FILE…] [--strict]   accessibility problems in the changed (or named) files',
  '  a11y scan                  check every UI file and send the result',
  '  a11y script                the page audit to run in a browser (prints JavaScript)',
  '  a11y report FILE.json [--name SCREEN] [--commit SHA] [--strict]   send a page audit',
];

export const isA11yFile = (p: string): boolean => isMarkupFile(p) || isStyleFile(p);

export async function a11yFiles(
  root: string,
  paths: readonly string[],
): Promise<A11yCodeFinding[]> {
  const out: A11yCodeFinding[] = [];
  for (const p of paths) {
    if (!isA11yFile(p)) continue;
    const buf = await readFile(join(root, p)).catch(() => null);
    if (!buf || buf.length > 1_000_000 || buf.includes(0)) continue;
    out.push(...lintA11y(p, buf.toString('utf8')));
  }
  return out;
}

export const a11yLine = (f: A11yCodeFinding): string =>
  '  ' + f.path + ':' + String(f.line) + '  ' + A11Y_RULES[f.rule] + ': ' + f.snippet;

async function head(deps: LoopDeps, root: string): Promise<string> {
  const r = await deps.exec('git', ['rev-parse', 'HEAD'], root).catch(() => null);
  return r?.code === 0 ? r.out.trim() : '';
}

async function check(argv: readonly string[], deps: LoopDeps, root: string): Promise<LoopResult> {
  const named = positionals(argv.slice(2), []);
  const files = named.length ? named : await changedFiles(deps, root);
  const found = await a11yFiles(root, files);
  const n = files.filter(isA11yFile).length;
  if (!found.length)
    return {
      code: 0,
      out: 'No accessibility problems in ' + String(n) + (n === 1 ? ' UI file.' : ' UI files.'),
    };
  return {
    code: argv.includes('--strict') ? 1 : 0,
    out: [
      String(found.length) + ' accessibility problem(s) in ' + String(n) + ' UI file(s):',
      ...found.slice(0, 200).map(a11yLine),
      ...(found.length > 200 ? ['  …'] : []),
      'A line with a11y-ignore is skipped.',
    ].join('\n'),
  };
}

async function scan(deps: LoopDeps, l: Linked): Promise<LoopResult> {
  const listed = await deps.exec('git', ['ls-files', '-z'], l.root);
  if (listed.code !== 0)
    throw new LoopError('orq a11y scan reads the files Git tracks; this is not a Git repository');
  const paths = listed.out.split('\u0000').filter(isA11yFile);
  const found = await a11yFiles(l.root, paths);
  const sent = found.slice(0, 5000);
  const commit = await head(deps, l.root);
  await l.api.call('POST', l.ws + '/projects/' + l.link.projectId + '/a11y/code', {
    files: paths.length,
    findings: sent.map((f) => ({ ...f, snippet: f.snippet.slice(0, 200) })),
    ...(commit ? { commit } : {}),
  });
  const counts = new Map<string, number>();
  for (const f of found) counts.set(f.rule, (counts.get(f.rule) ?? 0) + 1);
  return {
    code: 0,
    out:
      'Accessibility scan: ' +
      String(paths.length) +
      ' UI files, ' +
      String(found.length) +
      ' problem(s)' +
      (found.length
        ? ': ' +
          [...counts.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([r, n]) => A11Y_RULES[r as keyof typeof A11Y_RULES] + ' ' + String(n))
            .join(', ')
        : '') +
      '.' +
      (found.length > sent.length ? ' Only the first 5000 were sent.' : ''),
  };
}

/** A saved audit: what the script gave, read from a file, so anything but the findings may be missing. */
type SavedReport = Partial<Omit<A11yPageReport, 'findings'>> & {
  name?: string;
  findings: A11yPageReport['findings'];
};

/** A page audit as saved by CI: the report itself, or a list of them. */
function reportsOf(text: string): SavedReport[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new LoopError('The report is not JSON: save what the audit script returns');
  }
  const list = Array.isArray(data) ? data : [data];
  for (const r of list)
    if (!r || typeof r !== 'object' || !Array.isArray((r as { findings?: unknown }).findings))
      throw new LoopError('The report has no findings list: save what the audit script returns');
  return list as SavedReport[];
}

async function report(argv: readonly string[], deps: LoopDeps, l: Linked): Promise<LoopResult> {
  const file = positionals(argv.slice(2), ['--name', '--commit'])[0];
  if (!file)
    throw new LoopError('orq a11y report FILE.json [--name SCREEN] [--commit SHA] [--strict]');
  const text = await readFile(resolve(deps.cwd, file), 'utf8').catch(() => null);
  if (text === null) throw new LoopError('Cannot read ' + file);
  const reports = reportsOf(text);
  const name = option(argv, '--name');
  if (name && reports.length > 1)
    throw new LoopError('--name names one report; the file holds several');
  const commit = option(argv, '--commit') ?? (await head(deps, l.root));
  const lines: string[] = [];
  let total = 0;
  for (const r of reports) {
    const screen = name ?? r.name ?? basename(file).replace(/\.json$/i, '');
    await l.api.call('POST', l.ws + '/projects/' + l.link.projectId + '/a11y/pages', {
      name: screen,
      url: (r.url ?? '').slice(0, 2000),
      title: (r.title ?? '').slice(0, 300),
      ...(r.checked ? { checked: r.checked } : {}),
      findings: r.findings.slice(0, 500).map((f) => ({
        rule: f.rule,
        selector: f.selector.slice(0, 500),
        message: f.message.slice(0, 500),
      })),
      ...(commit ? { commit } : {}),
    });
    total += r.findings.length;
    lines.push(
      (r.findings.length ? 'FAIL ' : 'ok   ') +
        screen +
        ': ' +
        String(r.findings.length) +
        ' problem(s)' +
        (r.checked
          ? ' in ' + String(r.checked.targets) + ' targets, ' + String(r.checked.images) + ' images'
          : ''),
    );
    for (const f of r.findings.slice(0, 10))
      lines.push('  ' + A11Y_RULES[f.rule] + ': ' + f.selector + ' (' + f.message + ')');
  }
  return { code: argv.includes('--strict') && total ? 1 : 0, out: lines.join('\n') };
}

export async function runA11y(argv: readonly string[], deps: LoopDeps): Promise<LoopResult | null> {
  const [command, sub] = argv;
  if (command !== 'a11y') return null;
  // the script needs no project
  if (sub === 'script') return { code: 0, out: auditScript() };
  const l = linked(deps);
  if (sub === 'check') return await check(argv, deps, l.root);
  if (sub === 'scan') return await scan(deps, l);
  if (sub === 'report') return await report(argv, deps, l);
  throw new LoopError(
    'orq a11y check [FILE…] [--strict] | scan | script | report FILE.json [--name SCREEN]',
  );
}
