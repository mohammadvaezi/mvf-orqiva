// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-140 | S15 | v0.1.0] Write our own secret scanner and code rules: orq scan ──
//    Why:  runs the rules over the files Git tracks (so ignored and generated files stay out), line by
//          line. A line opts out only with a reason: `pe-scan: ignore <rule> -- <why>` on it or the line
//          above, so every exception is written down next to the code. Fingerprints are made from the rule,
//          the file and the line's text without the secret (a hash), so moving code keeps the finding and
//          no fingerprint can give a secret away.
import { fnv, type FindingIn } from '@orqiva/shared';
import { entropy, fileKind, redactSecret, RULES, type Rule } from './rules.js';

export const SCANNER = 'pe-scan';
const MAX_BYTES = 1_000_000;
const SKIP = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|.*\.min\.js|.*\.map)$/i;
const OPT_OUT = /pe-scan:\s*ignore\s+([\w/*-]+)\s+--\s*(\S.{2,})/;

export interface ScanResult {
  findings: FindingIn[];
  files: number;
  /** lines that opted out, with their reasons */
  ignored: { file: string; line: number; rule: string; reason: string }[];
}

const applies = (rule: Rule, kind: 'js' | 'py' | 'other'): boolean =>
  rule.files === 'all' || rule.files === kind;

/** Findings of one file's text. */
export function scanText(
  file: string,
  text: string,
  ignored: ScanResult['ignored'] = [],
): FindingIn[] {
  if (text.includes('\u0000')) return [];
  const kind = fileKind(file);
  const lines = text.split(/\r?\n/);
  const out: FindingIn[] = [];
  const seenPerRule = new Map<string, number>();
  lines.forEach((line, i) => {
    if (line.length > 2000) return;
    for (const rule of RULES) {
      if (!applies(rule, kind)) continue;
      const m = rule.pattern.exec(line);
      if (!m) continue;
      if (rule.unless?.test(line)) continue;
      let shown = line.trim();
      if (rule.secret) {
        const value = m[rule.secret.group ?? 0] ?? m[0];
        if (rule.secret.minEntropy !== undefined && entropy(value) < rule.secret.minEntropy)
          continue;
        if (rule.secret.notWordsOnly && /^[A-Za-z][A-Za-z._-]*$/.test(value)) continue;
        shown = shown.split(value).join(redactSecret(value));
      }
      // on the line itself, or on a comment line of its own just above it
      const above = (lines[i - 1] ?? '').trim();
      const opt =
        OPT_OUT.exec(line) ?? (/^(?:\/\/|#|\/?\*)/.test(above) ? OPT_OUT.exec(above) : null);
      if (
        opt &&
        (opt[1] === rule.id ||
          opt[1] === 'all' ||
          (opt[1]?.endsWith('/*') && rule.id.startsWith(opt[1].slice(0, -1))))
      ) {
        ignored.push({ file, line: i + 1, rule: rule.id, reason: (opt[2] ?? '').trim() });
        continue;
      }
      // the same rule on the same text in one file: numbered, so each keeps its own finding
      const base = rule.id + '|' + file + '|' + shown.replace(/\s+/g, ' ');
      const n = (seenPerRule.get(base) ?? 0) + 1;
      seenPerRule.set(base, n);
      out.push({
        rule: rule.id,
        severity: rule.severity,
        title: rule.title,
        message:
          rule.title +
          ' at ' +
          file +
          ':' +
          String(i + 1) +
          ': ' +
          shown.slice(0, 200) +
          '\n' +
          rule.help,
        file,
        line: i + 1,
        fingerprint: fnv(base) + '-' + String(n),
      });
    }
  });
  return out;
}

export interface ScanDeps {
  /** the files Git tracks, relative to the root */
  listFiles: () => Promise<string[]>;
  readFile: (path: string) => Promise<Buffer | null>;
}

/** Scans every tracked file. */
export async function scanRepository(deps: ScanDeps): Promise<ScanResult> {
  const files = (await deps.listFiles()).filter((f) => !SKIP.test(f));
  const result: ScanResult = { findings: [], files: 0, ignored: [] };
  for (const f of files) {
    const buf = await deps.readFile(f);
    if (!buf || buf.length > MAX_BYTES) continue;
    result.files += 1;
    result.findings.push(...scanText(f, buf.toString('utf8'), result.ignored));
  }
  return result;
}

// ── a repository's written-down exceptions ──

export interface IgnoreEntry {
  path: RegExp;
  rule: string;
  reason: string;
}

/** A path glob as a regular expression: ** any folders, * within one name, ? one character. */
export function globToRegExp(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const ch = glob.charAt(i);
    if (ch === '*' && glob.charAt(i + 1) === '*') {
      re += '.*';
      i += glob.charAt(i + 2) === '/' ? 2 : 1;
    } else if (ch === '*') re += '[^/]*';
    else if (ch === '?') re += '[^/]';
    else re += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp('^' + re + '$');
}

/**
 * .orqiva/scan-ignore: one exception per line, `<path glob> <rule or prefix/*> -- <reason>`.
 * Lines without a reason are refused, so every exception says why.
 */
export function parseIgnore(text: string): { entries: IgnoreEntry[]; problems: string[] } {
  const entries: IgnoreEntry[] = [];
  const problems: string[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    const m = /^(\S+)\s+(\S+)\s+--\s*(\S.{2,})$/.exec(line);
    if (!m) {
      problems.push('scan-ignore line ' + String(i + 1) + ' needs: <path> <rule> -- <reason>');
      return;
    }
    entries.push({ path: globToRegExp(m[1] ?? ''), rule: m[2] ?? '', reason: (m[3] ?? '').trim() });
  });
  return { entries, problems };
}

const ruleMatches = (wanted: string, rule: string): boolean =>
  wanted === 'all' ||
  wanted === rule ||
  (wanted.endsWith('/*') && rule.startsWith(wanted.slice(0, -1)));

/** Drops the findings a repository's exceptions cover, and lists them as ignored with their reason. */
export function applyIgnores(result: ScanResult, entries: IgnoreEntry[]): ScanResult {
  const findings: FindingIn[] = [];
  for (const f of result.findings) {
    const hit = entries.find((e) => e.path.test(f.file) && ruleMatches(e.rule, f.rule));
    if (hit)
      result.ignored.push({ file: f.file, line: f.line ?? 0, rule: f.rule, reason: hit.reason });
    else findings.push(f);
  }
  return { ...result, findings };
}
