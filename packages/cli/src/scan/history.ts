// ── [PCODE-321 | S15 | v0.1.0] T32.6 Secrets in the Git history, SARIF upload in the web app, dependency facts on findings ──
//    Why:  a secret removed from the files is still in every clone's history; it has to be rotated. The
//          secret rules run over the lines each commit added, and each secret is reported once, from the
//          commit that first added it, saying whether it is still in the files. Fingerprints are made
//          from the rule, the file and the line without the secret, as in the file scan.
import { fnv, type FindingIn } from '@orqiva/shared';
import { RULES } from './rules.js';
import { scanText } from './scan.js';

export const HISTORY_TOOL = 'orq-history';
const SECRET_RULES = new Set(RULES.filter((r) => r.secret).map((r) => r.id));
const MARK = '\u0001commit ';

/** The git log the scan reads: every branch, newest first, only the lines each commit added. */
export const historyArgs = (depth: number): string[] => [
  'log',
  '--all',
  '-n',
  String(depth),
  '-p',
  '--no-color',
  '--no-ext-diff',
  '--unified=0',
  '--format=' + MARK + '%H%x09%aI%x09%an',
];

export interface Added {
  commit: string;
  date: string;
  author: string;
  file: string;
  text: string;
}

/** The added lines of each file of each commit, from the log's patches. */
export function addedLines(log: string): Added[] {
  const out: Added[] = [];
  let commit = '';
  let date = '';
  let author = '';
  let file = '';
  let lines: string[] = [];
  const flush = (): void => {
    if (commit && file && lines.length)
      out.push({ commit, date, author, file, text: lines.join('\n') });
    lines = [];
  };
  for (const line of log.split('\n')) {
    if (line.startsWith(MARK)) {
      flush();
      file = '';
      [commit = '', date = '', author = ''] = line.slice(MARK.length).split('\t');
    } else if (line.startsWith('+++ ')) {
      flush();
      const path = line.slice(4).trim();
      file = path === '/dev/null' ? '' : path.replace(/^b\//, '');
    } else if (line.startsWith('+') && !line.startsWith('+++')) lines.push(line.slice(1));
  }
  flush();
  return out;
}

/**
 * The secrets the history holds, once each (the oldest commit that added it): the log is newest first,
 * so a later sighting of the same fingerprint is an older commit.
 */
export function historySecrets(log: string, current: readonly FindingIn[]): FindingIn[] {
  const now = new Set(current.map((f) => f.rule + '|' + f.file));
  const oldest = new Map<string, { f: FindingIn; a: Added }>();
  for (const a of addedLines(log)) {
    const found = scanText(a.file, a.text).filter((f) => SECRET_RULES.has(f.rule));
    // a line a named rule knows is not reported again as a generic secret
    const named = new Set(found.filter((f) => f.rule !== 'secret/generic').map((f) => f.line));
    for (const f of found) {
      if (f.rule === 'secret/generic' && named.has(f.line)) continue;
      oldest.set(f.fingerprint, { f, a });
    }
  }
  return [...oldest.values()].map(({ f, a }) => {
    const still = now.has(f.rule + '|' + f.file);
    return {
      rule: f.rule,
      severity: f.severity,
      title: 'In the Git history: ' + f.title,
      message:
        f.title +
        ' added in commit ' +
        a.commit.slice(0, 10) +
        ' (' +
        a.date.slice(0, 10) +
        ', ' +
        a.author +
        ') to ' +
        a.file +
        '. ' +
        (still
          ? 'It is still in the files too.'
          : 'It is no longer in the files, but every clone of the repository still has it.') +
        ' Rotate the secret: removing it does not take it out of the history.',
      file: a.file,
      line: null,
      fingerprint: fnv('history|' + f.fingerprint),
    };
  });
}
