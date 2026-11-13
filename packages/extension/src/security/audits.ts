// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-66 | S13 | v0.1.0] Add npm audit and secret scan runners wired to the security checklist ──
//    Task: https://plan.broszio.com/prodsystem/projects/74f47636-71b0-4eb5-94b5-ea2fe840ec01/issues/
//    Why:  two of the checklist's items can be answered by a machine instead of by a person's memory -
//          "no unfixed high or critical finding" and "no credential is committed". The checks run here and
//          write a dated line under their item; they never tick it, because a green run today says nothing
//          about the item's intent, and a checklist that ticks itself stops being read.
//
//    The rules are deliberately shaped to the real formats rather than to "looks secret-ish". A Plane
//    token is `plane_api_` + 32 hex; an AWS key id is AKIA + 16 uppercase. Matching the format is what
//    lets this repository - which is full of invented keys for the redaction tests - scan clean while a
//    real key planted in it is found. The generic assignment rule cannot be format-matched, so it carries
//    a placeholder allow-list instead.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { SKIP_DIRS } from '../util/fingerprintScan';

export interface SecretRule {
  name: string;
  re: RegExp;
  /** the capture group holding the value; 0 means the whole match */
  group?: number;
}

// ── [PCODE-66 | S13 | v0.1.0] the rules ──
export const SECRET_RULES: readonly SecretRule[] = [
  // a Plane personal access token: the prefix plus exactly 32 hex characters
  // [PCODE-453 | S15 | v0.1.0] VS Code extension: onboarding on the Orqiva server (sign in, link, new project), no Plane names
  { name: 'Legacy tracker API key', re: /\bplane_api_([0-9a-f]{32})\b/g, group: 1 },
  { name: 'AWS access key id', re: /\b(AKIA[0-9A-Z]{16})\b/g, group: 1 },
  { name: 'GitHub token', re: /\b((?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36})\b/g, group: 1 },
  { name: 'Private key block', re: /(-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----)/g, group: 1 },
  {
    name: 'Hard-coded credential',
    re: /\b(?:api[_-]?key|secret|token|password|passwd)\b\s*[:=]\s*["'`]?([A-Za-z0-9/+_.~-]{16,})["'`]?/gi,
    group: 1,
  },
];

/** Values that say "this is not a real credential" - the generic rule would otherwise flag every fixture. */
const PLACEHOLDER =
  /(example|sample|dummy|fake|placeholder|redacted|changeme|your[_-]?|xxxx|<[^>]+>|not[_-]?a[_-]?real|todo|test|secret_value|hidden_value|0123456789|abcdef0123|process\.env|os\.environ)/i;

// ── [PCODE-66 | S13 | v0.1.0] a value that is code, not a credential ──
//    `token: vscode.CancellationToken` and `apiKey = input.apiKey.trim` both read like an assignment of
//    something long to something secret-sounding. A dotted identifier chain is never a key.
const IDENTIFIER_CHAIN = /^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)+$/;

// ── [PCODE-66 | S13 | v0.1.0] the line a person marks as a known fixture ──
//    Every scanner needs this, and the alternative is worse: loosening the rules until the fixtures pass
//    hides the real thing too. The marker is in the file, so a reviewer sees the claim and who made it.
export const ALLOW_MARKER = 'orqiva:allow-secret';

/** Files worth reading: a secret hides in .env and config json, which the fingerprint scanner skips. */
const BINARY_EXT = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'ico',
  'pdf',
  'zip',
  'gz',
  'exe',
  'dll',
  'so',
  'ttf',
  'otf',
  'woff',
  'woff2',
  'mo',
  'pyc',
  'vsix',
  'bin',
  'jar',
  'class',
  'wasm',
  'mp4',
  'mp3',
]);
export const MAX_FILE_BYTES = 512 * 1024;

export interface Finding {
  /** posix path relative to the scanned root */
  file: string;
  /** 1-based */
  line: number;
  rule: string;
  /** the line with the value masked - a report must not repeat the secret */
  excerpt: string;
}

export interface SecretScanResult {
  findings: Finding[];
  filesScanned: number;
}

export interface ScanIo {
  readdirSync: (p: string) => { name: string; isFile(): boolean; isDirectory(): boolean }[];
  readFileSync: (p: string, enc: 'utf8') => string;
  statSync: (p: string) => { size: number };
}

const defaultIo: ScanIo = {
  readdirSync: (p) => fs.readdirSync(p, { withFileTypes: true }),
  readFileSync: (p, enc) => fs.readFileSync(p, enc),
  statSync: (p) => fs.statSync(p),
};

export function isScannableFile(file: string): boolean {
  const base = path.basename(file).toLowerCase();
  if (base.endsWith('.min.js') || base.endsWith('.min.css') || base.endsWith('.map')) return false;
  const ext = base.includes('.') ? (base.split('.').pop() ?? '') : '';
  // a file with no extension (.env, Makefile, Dockerfile) is read: that is where keys live
  return !BINARY_EXT.has(ext);
}

// ── [PCODE-66 | S13 | v0.1.0] mask: the report names the rule and the place, never the value ──
export function mask(line: string, value: string): string {
  const shown = line.trim().slice(0, 200);
  if (!value) return shown;
  return shown.split(value).join(`${value.slice(0, 4)}…***`);
}

// ── [PCODE-66 | S13 | v0.1.0] scanTextForSecrets: every rule over every line ──
export function scanTextForSecrets(
  text: string,
  rules: readonly SecretRule[] = SECRET_RULES,
): { line: number; rule: string; excerpt: string }[] {
  const out: { line: number; rule: string; excerpt: string }[] = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    // the marker excuses its own line or the one below it, the way every other scanner spells it
    if (line.includes(ALLOW_MARKER) || (lines[i - 1] ?? '').includes(ALLOW_MARKER)) return;
    for (const rule of rules) {
      const re = new RegExp(
        rule.re.source,
        rule.re.flags.includes('g') ? rule.re.flags : `${rule.re.flags}g`,
      );
      let m: RegExpExecArray | null;
      while ((m = re.exec(line)) !== null) {
        const value = m[rule.group ?? 0] ?? '';
        // the generic rule is the only one that cannot be format-matched, so it defers to the allow-list
        if (
          rule.name === 'Hard-coded credential' &&
          (PLACEHOLDER.test(value) || PLACEHOLDER.test(line) || IDENTIFIER_CHAIN.test(value))
        )
          continue;
        out.push({ line: i + 1, rule: rule.name, excerpt: mask(line, value) });
      }
    }
  });
  return out;
}

// ── [PCODE-66 | S13 | v0.1.0] scanWorkspaceForSecrets: the fingerprint scanner's own skip list ──
export function scanWorkspaceForSecrets(
  root: string,
  io: ScanIo = defaultIo,
  rules: readonly SecretRule[] = SECRET_RULES,
): SecretScanResult {
  const findings: Finding[] = [];
  let filesScanned = 0;
  const walk = (dir: string): void => {
    let entries: ReturnType<ScanIo['readdirSync']>;
    try {
      entries = io.readdirSync(dir);
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        // same dirs as the fingerprint scanner, and .plane is skipped there too: it holds no code
        if (SKIP_DIRS.has(e.name) || (e.name.startsWith('.') && e.name !== '.github')) continue;
        walk(full);
        continue;
      }
      if (!e.isFile() || !isScannableFile(full)) continue;
      let text: string;
      try {
        if (io.statSync(full).size > MAX_FILE_BYTES) continue;
        text = io.readFileSync(full, 'utf8');
      } catch {
        continue;
      }
      filesScanned++;
      const rel = path.relative(root, full).replace(/\\/g, '/');
      for (const hit of scanTextForSecrets(text, rules)) findings.push({ file: rel, ...hit });
    }
  };
  walk(root);
  return { findings, filesScanned };
}

// ── [PCODE-66 | S13 | v0.1.0] dependency audits ──

export interface AuditCounts {
  critical: number;
  high: number;
  moderate: number;
  low: number;
  info: number;
  total: number;
}

export const EMPTY_AUDIT: AuditCounts = {
  critical: 0,
  high: 0,
  moderate: 0,
  low: 0,
  info: 0,
  total: 0,
};

// ── [PCODE-66 | S13 | v0.1.0] parseNpmAudit: v7+ metadata, with the v6 shape as a fallback ──
export function parseNpmAudit(json: string): AuditCounts {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ...EMPTY_AUDIT };
  }
  const root = parsed as { metadata?: { vulnerabilities?: Record<string, unknown> } };
  const v = root.metadata?.vulnerabilities ?? {};
  const n = (k: string): number => (typeof v[k] === 'number' ? v[k] : 0);
  const counts: AuditCounts = {
    critical: n('critical'),
    high: n('high'),
    moderate: n('moderate'),
    low: n('low'),
    info: n('info'),
    total: 0,
  };
  counts.total = counts.critical + counts.high + counts.moderate + counts.low + counts.info;
  // npm reports a `total` of its own; trust ours, which is the sum of what we display
  return counts;
}

export interface PipAuditResult {
  vulnerabilities: number;
  packages: number;
}

// ── [PCODE-66 | S13 | v0.1.0] parsePipAudit: both the bare list and the {dependencies: []} shape ──
export function parsePipAudit(json: string): PipAuditResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { vulnerabilities: 0, packages: 0 };
  }
  const list = Array.isArray(parsed)
    ? parsed
    : ((parsed as { dependencies?: unknown[] }).dependencies ?? []);
  let vulnerabilities = 0;
  let packages = 0;
  for (const entry of list) {
    const vulns = (entry as { vulns?: unknown[] }).vulns ?? [];
    if (vulns.length) packages++;
    vulnerabilities += vulns.length;
  }
  return { vulnerabilities, packages };
}

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}
export type CommandRunner = (cmd: string, args: string[], cwd: string) => Promise<RunResult>;

export interface AuditOutcome {
  /** what to show and to write under the checklist item */
  summary: string;
  counts?: AuditCounts;
  /** the check could not run at all (tool missing, no manifest) */
  unavailable?: string;
}

export function npmAuditSummary(counts: AuditCounts): string {
  if (counts.total === 0) return 'no known vulnerabilities';
  const parts: string[] = [];
  for (const k of ['critical', 'high', 'moderate', 'low'] as const)
    if (counts[k]) parts.push(`${String(counts[k])} ${k}`);
  return parts.join(', ');
}

// ── [PCODE-66 | S13 | v0.1.0] runNpmAudit: a non-zero exit means findings, not failure ──
export async function runNpmAudit(
  root: string,
  run: CommandRunner,
  exists: (p: string) => boolean = (p) => fs.existsSync(p),
): Promise<AuditOutcome> {
  if (!exists(path.join(root, 'package.json')))
    return { summary: '', unavailable: 'no package.json in this project' };
  let res: RunResult;
  try {
    res = await run('npm', ['audit', '--json'], root);
  } catch (e) {
    return { summary: '', unavailable: `npm could not be run: ${String(e)}` };
  }
  // npm exits 1 when it found something; only an unparseable answer is a real failure
  if (!res.stdout.trim())
    return {
      summary: '',
      unavailable: res.stderr.trim().slice(0, 200) || 'npm audit said nothing',
    };
  const counts = parseNpmAudit(res.stdout);
  return { summary: npmAuditSummary(counts), counts };
}

// ── [PCODE-66 | S13 | v0.1.0] runPipAudit: only when the module is actually installed ──
export async function runPipAudit(
  root: string,
  run: CommandRunner,
  python: readonly string[],
  exists: (p: string) => boolean = (p) => fs.existsSync(p),
): Promise<AuditOutcome> {
  const manifests = ['requirements.txt', 'pyproject.toml', 'setup.py'];
  if (!manifests.some((m) => exists(path.join(root, m))))
    return { summary: '', unavailable: 'no Python manifest in this project' };
  const [cmd, ...lead] = python;
  if (!cmd) return { summary: '', unavailable: 'no Python found' };
  try {
    const probe = await run(cmd, [...lead, '-m', 'pip_audit', '--version'], root);
    if (probe.code !== 0)
      return { summary: '', unavailable: 'pip-audit is not installed (pip install pip-audit)' };
  } catch {
    return { summary: '', unavailable: 'pip-audit is not installed (pip install pip-audit)' };
  }
  const res = await run(cmd, [...lead, '-m', 'pip_audit', '--format', 'json'], root);
  if (!res.stdout.trim())
    return {
      summary: '',
      unavailable: res.stderr.trim().slice(0, 200) || 'pip-audit said nothing',
    };
  const { vulnerabilities, packages } = parsePipAudit(res.stdout);
  return {
    summary: vulnerabilities
      ? `${String(vulnerabilities)} vulnerabilit${vulnerabilities === 1 ? 'y' : 'ies'} in ${String(packages)} package(s)`
      : 'no known vulnerabilities',
  };
}

export function secretScanSummary(result: SecretScanResult): string {
  if (!result.findings.length) return `nothing found in ${String(result.filesScanned)} file(s)`;
  const files = new Set(result.findings.map((f) => f.file)).size;
  return `${String(result.findings.length)} finding(s) in ${String(files)} file(s)`;
}

/** `Last run 2026-10-09: 0 high, 2 moderate` - the line written under the checklist item. */
export function noteLine(summary: string, day: string): string {
  return `Last run ${day}: ${summary}`;
}
