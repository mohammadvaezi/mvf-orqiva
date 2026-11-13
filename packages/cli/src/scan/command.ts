// ── [PCODE-321 | S15 | v0.1.0] T32.6 Secrets in the Git history, SARIF upload in the web app, dependency facts on findings ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-140 | S15 | v0.1.0] Write our own secret scanner and code rules: orq scan ──
// ── [PCODE-141 | S15 | v0.1.0] Audit dependencies against the OSV database ──
//    Why:  `orq scan` in a repository: scan the tracked files, print what was found by severity, write
//          SARIF when asked (for any other tool), and upload to the linked project as a full scan, so what
//          is gone is marked fixed there. `--fail-on high` makes CI fail on serious findings.
import { readFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { writeFileSync } from 'node:fs';
import {
  PLATFORM_VERSION,
  SEVERITIES,
  toSarif,
  type FindingIn,
  type Severity,
} from '@orqiva/shared';
import { dotDir, findRoot } from '../loop/config.js';
import { linked, option, LoopError, type LoopDeps, type LoopResult } from '../loop/commands.js';
import { applyIgnores, parseIgnore, scanRepository, SCANNER } from './scan.js';
import { HISTORY_TOOL, historyArgs, historySecrets } from './history.js'; // [PCODE-321 | S15 | v0.1.0]

export const SCAN_USAGE =
  '  scan [--deps] [--history [--history-depth N]] [--sarif FILE] [--no-upload]\n' +
  '       [--fail-on high|critical|medium]\n' +
  '                             scan the repository for secrets and risky code (--history: the secrets\n' +
  '                             in the last N commits, 2000 by default); upload to the project';

export interface ExtraScan {
  tool: string;
  findings: FindingIn[];
  note: string;
}

export async function runScan(
  argv: readonly string[],
  deps: LoopDeps,
  // [PCODE-141 | S15 | v0.1.0] another scan over the same files (the dependency audit)
  extra?: (root: string, files: string[]) => Promise<ExtraScan | null>,
): Promise<LoopResult> {
  const root = findRoot(deps.cwd) ?? deps.cwd;
  const listed = await deps.exec('git', ['ls-files', '-z'], root);
  if (listed.code !== 0)
    throw new LoopError('orq scan reads the files Git tracks; this is not a Git repository');
  const files = listed.out.split('\u0000').filter(Boolean);
  const scanned = await scanRepository({
    listFiles: () => Promise.resolve(files),
    readFile: (f) => readFile(join(root, f)).catch(() => null),
  });
  // the repository's written-down exceptions
  const ignoreText = await readFile(join(dotDir(root), 'scan-ignore'), 'utf8').catch(() => '');
  const { entries, problems } = parseIgnore(ignoreText);
  if (problems.length) throw new LoopError(problems.join('\n'));
  const result = applyIgnores(scanned, entries);
  const scans: ExtraScan[] = [
    { tool: SCANNER, findings: result.findings, note: String(result.files) + ' files' },
  ];
  const more = extra ? await extra(root, files) : null;
  if (more) scans.push(more);
  // [PCODE-321 | S15 | v0.1.0] the secrets the commits added, still in every clone's history
  if (argv.includes('--history')) {
    const depth = Math.max(
      1,
      Math.min(100_000, Number(option(argv, '--history-depth') ?? '2000') || 2000),
    );
    const log = await deps.exec('git', historyArgs(depth), root);
    if (log.code !== 0) throw new LoopError('git log failed: ' + log.out.slice(0, 300));
    // an exception already written down for the files (scan-ignore, or an opt-out on the line) holds here
    const optedOut = new Set(result.ignored.map((i) => i.rule + '|' + i.file));
    const history = applyIgnores(
      {
        findings: historySecrets(log.out, result.findings).filter(
          (f) => !optedOut.has(f.rule + '|' + f.file),
        ),
        files: 0,
        ignored: [],
      },
      entries,
    );
    scans.push({
      tool: HISTORY_TOOL,
      findings: history.findings,
      note: 'the last ' + String(depth) + ' commits at most',
    });
  }

  const lines: string[] = [];
  for (const sc of scans) {
    const by = (s: Severity): number => sc.findings.filter((f) => f.severity === s).length;
    lines.push(
      sc.tool +
        ' (' +
        sc.note +
        '): ' +
        SEVERITIES.filter((s) => by(s) > 0)
          .map((s) => String(by(s)) + ' ' + s)
          .join(', ') +
        (sc.findings.length ? '' : 'nothing found'),
    );
    for (const f of sc.findings.slice(0, 25))
      lines.push(
        '  ' +
          f.severity.padEnd(8) +
          ' ' +
          f.rule +
          '  ' +
          (f.file ? f.file + ':' + String(f.line ?? '') : f.title),
      );
    if (sc.findings.length > 25) lines.push('  … and ' + String(sc.findings.length - 25) + ' more');
  }
  if (result.ignored.length)
    lines.push(
      String(result.ignored.length) + ' lines opted out with a reason (pe-scan: ignore … -- …)',
    );

  const sarifPath = option(argv, '--sarif');
  if (sarifPath) {
    const doc = {
      ...toSarif(SCANNER, PLATFORM_VERSION, []),
      runs: scans.map(
        (sc) => (toSarif(sc.tool, PLATFORM_VERSION, sc.findings)['runs'] as unknown[])[0],
      ),
    };
    writeFileSync(
      isAbsolute(sarifPath) ? sarifPath : join(deps.cwd, sarifPath),
      JSON.stringify(doc, null, 2),
    );
    lines.push('SARIF written to ' + sarifPath);
  }

  if (!argv.includes('--no-upload')) {
    try {
      const l = linked(deps);
      for (const sc of scans)
        await l.api.call('POST', l.ws + '/projects/' + l.link.projectId + '/scans', {
          sarif: toSarif(sc.tool, PLATFORM_VERSION, sc.findings),
          full: true,
        });
      lines.push(
        'Uploaded to ' +
          l.link.projectKey +
          ' on ' +
          l.link.server +
          ' (full scan: what is gone is marked fixed).',
      );
    } catch (e) {
      if (!(e instanceof LoopError)) throw e;
      lines.push('Not uploaded: ' + e.message);
    }
  }

  const failOn = option(argv, '--fail-on') as Severity | undefined;
  const rank = (s: Severity): number => SEVERITIES.indexOf(s);
  const failing =
    failOn && SEVERITIES.includes(failOn)
      ? scans.flatMap((sc) => sc.findings).filter((f) => rank(f.severity) <= rank(failOn)).length
      : 0;
  return { code: failing ? 1 : 0, out: lines.join('\n') };
}
