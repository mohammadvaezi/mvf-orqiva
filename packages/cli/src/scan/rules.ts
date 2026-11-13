// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-140 | S15 | v0.1.0] Write our own secret scanner and code rules: orq scan ──
//    Why:  the rules of our scanner, as data. Secrets: well-known token shapes, private keys, and generic
//          "password = '…'" assignments whose value looks random (Shannon entropy), not like a placeholder.
//          Code rules: patterns in JavaScript/TypeScript and Python that let input become code, shell
//          commands or HTML, switch off TLS checks, or deserialise untrusted data. A finding never carries
//          a secret's value: only its first characters.
import type { Severity } from '@orqiva/shared';

export interface Rule {
  id: string;
  title: string;
  severity: Severity;
  /** which files it applies to */
  files: 'all' | 'js' | 'py';
  pattern: RegExp;
  /** a secret rule redacts the match and may check its randomness */
  /** wordsOnly: a value of letters and dots only (a setting's name) is not a secret */
  secret?: { group?: number; minEntropy?: number; notWordsOnly?: boolean };
  /** the line is fine when this also matches it */
  unless?: RegExp;
  help: string;
}

export const RULES: Rule[] = [
  // ── secrets ──
  {
    id: 'secret/aws-access-key',
    title: 'AWS access key id in the code',
    severity: 'critical',
    files: 'all',
    pattern: /\b((?:AKIA|ASIA)[0-9A-Z]{16})\b/,
    secret: { group: 1 },
    help: 'Remove it, rotate the key in AWS, and read it from the environment or the secrets vault.',
  },
  {
    id: 'secret/github-token',
    title: 'GitHub token in the code',
    severity: 'critical',
    files: 'all',
    pattern: /\b((?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{60,})\b/,
    secret: { group: 1 },
    help: 'Revoke the token on GitHub and keep the new one out of the repository.',
  },
  {
    id: 'secret/gitlab-token',
    title: 'GitLab token in the code',
    severity: 'critical',
    files: 'all',
    pattern: /\b(glpat-[A-Za-z0-9_-]{20,})\b/,
    secret: { group: 1 },
    help: 'Revoke the token in GitLab and keep the new one out of the repository.',
  },
  {
    id: 'secret/slack-token',
    title: 'Slack token in the code',
    severity: 'high',
    files: 'all',
    pattern: /\b(xox[baprs]-[A-Za-z0-9-]{10,})\b/,
    secret: { group: 1 },
    help: 'Revoke it in Slack and use a secret store.',
  },
  {
    id: 'secret/stripe-key',
    title: 'Stripe live key in the code',
    severity: 'critical',
    files: 'all',
    pattern: /\b((?:sk|rk)_live_[0-9a-zA-Z]{24,})\b/,
    secret: { group: 1 },
    help: 'Roll the key in Stripe and keep it in the secrets vault.',
  },
  {
    id: 'secret/anthropic-key',
    title: 'Anthropic API key in the code',
    severity: 'critical',
    files: 'all',
    pattern: /\b(sk-ant-[A-Za-z0-9_-]{20,})/,
    secret: { group: 1 },
    help: 'Delete the key in the Anthropic console and store the new one in Orqiva’s AI provider settings.',
  },
  {
    id: 'secret/google-api-key',
    title: 'Google API key in the code',
    severity: 'high',
    files: 'all',
    pattern: /\b(AIza[0-9A-Za-z_-]{35})\b/,
    secret: { group: 1 },
    help: 'Restrict or replace the key in the Google Cloud console.',
  },
  {
    id: 'secret/private-key',
    title: 'Private key in the code',
    severity: 'critical',
    files: 'all',
    pattern: /-----BEGIN ((?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY)-----/,
    secret: { group: 1 },
    help: 'Remove the key, replace it everywhere it was trusted, and keep keys out of the repository.',
  },
  {
    id: 'secret/orqiva-token',
    title: 'Orqiva token in the code',
    severity: 'critical',
    files: 'all',
    pattern: /\b((?:orq|pe)_(?:runner_|pat_|svc_|run_)?[A-Za-z0-9_-]{43})\b/,
    secret: { group: 1 },
    help: 'Revoke it in Orqiva (Settings, Personal tokens, or Runners) and make a new one.',
  },
  {
    id: 'secret/generic',
    title: 'Hard-coded secret',
    severity: 'high',
    files: 'all',
    pattern:
      /(?:password|passwd|secret|token|api[_-]?key|access[_-]?key)["']?\s*[:=]\s*["']([^"'\s]{12,})["']/i,
    secret: { group: 1, minEntropy: 3.5, notWordsOnly: true },
    unless: /example|changeme|change-me|placeholder|dummy|\$\{|<[^>]+>|xxxx|\*\*\*\*|your[_-]/i,
    help: 'Read it from the environment or the environment’s secrets in Orqiva.',
  },
  // ── JavaScript / TypeScript ──
  {
    id: 'js/eval',
    title: 'eval() runs text as code',
    severity: 'medium',
    files: 'js',
    pattern: /(?<![\w.])eval\s*\(/,
    help: 'Parse the data (JSON.parse) or map names to functions instead.',
  },
  {
    id: 'js/new-function',
    title: 'new Function() builds code from text',
    severity: 'medium',
    files: 'js',
    pattern: /\bnew\s+Function\s*\(/,
    help: 'Use a real function; never build code from strings.',
  },
  {
    id: 'js/shell-from-string',
    title: 'Shell command built from a string',
    severity: 'high',
    files: 'js',
    // exec on its own or on child_process, not a method of something else (RegExp.exec)
    pattern:
      /(?:(?<![\w.])|(?<=\b(?:child_process|childProcess|cp)\.))(?:exec|execSync)\s*\(\s*(?:`[^`]*\$\{|['"][^'"]*['"]\s*\+)/,
    help: 'Use execFile/spawn with an argument list, so input cannot become shell syntax.',
  },
  {
    id: 'js/html-injection',
    title: 'HTML written from a value',
    severity: 'medium',
    files: 'js',
    pattern:
      /\.(?:innerHTML|outerHTML)\s*=(?!=)|\bdangerouslySetInnerHTML\b|\bdocument\.write\s*\(/,
    unless: /\.innerHTML\s*=\s*(['"`])\s*\1/,
    help: 'Set textContent, or render through the framework, which escapes values.',
  },
  {
    id: 'js/tls-off',
    title: 'TLS certificate checks switched off',
    severity: 'high',
    files: 'js',
    pattern: /rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*['"]?0/,
    help: 'Keep certificate checks on; trust the right CA instead.',
  },
  // ── Python ──
  {
    id: 'py/eval-exec',
    title: 'eval() or exec() runs text as code',
    severity: 'medium',
    files: 'py',
    pattern: /(?<![\w.])(?:eval|exec)\s*\(/,
    help: 'Use ast.literal_eval for data, or explicit code paths.',
  },
  {
    id: 'py/shell-true',
    title: 'Subprocess through the shell',
    severity: 'high',
    files: 'py',
    pattern: /\bsubprocess\.\w+\(.*\bshell\s*=\s*True/,
    help: 'Pass the command as a list and leave shell off.',
  },
  {
    id: 'py/pickle',
    title: 'pickle loads untrusted data',
    severity: 'medium',
    files: 'py',
    pattern: /\b(?:pickle|cPickle|dill)\.loads?\s*\(/,
    help: 'Use JSON or another data-only format for anything from outside.',
  },
  {
    id: 'py/yaml-load',
    title: 'yaml.load without the safe loader',
    severity: 'medium',
    files: 'py',
    pattern: /\byaml\.load\s*\(/,
    unless: /SafeLoader|CSafeLoader/,
    help: 'Use yaml.safe_load.',
  },
  {
    id: 'py/tls-off',
    title: 'TLS certificate checks switched off',
    severity: 'high',
    files: 'py',
    pattern: /\bverify\s*=\s*False\b|_create_unverified_context\s*\(/,
    help: 'Keep verification on; point it at the right CA bundle.',
  },
  {
    id: 'py/weak-hash',
    title: 'MD5 or SHA-1 where security may depend on it',
    severity: 'low',
    files: 'py',
    pattern: /\bhashlib\.(?:md5|sha1)\s*\(/,
    unless: /usedforsecurity\s*=\s*False/,
    help: 'Use sha256 or better, or say usedforsecurity=False when it is only a checksum.',
  },
];

/** Shannon entropy in bits per character: random keys score high, words and placeholders low. */
export function entropy(text: string): number {
  if (!text) return 0;
  const counts = new Map<string, number>();
  for (const ch of text) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let e = 0;
  for (const n of counts.values()) {
    const p = n / text.length;
    e -= p * Math.log2(p);
  }
  return e;
}

/** The first characters of a secret, enough to find it, never enough to use it. */
export const redactSecret = (value: string): string =>
  value.slice(0, Math.min(4, Math.floor(value.length / 4))) + '…';

export const fileKind = (path: string): 'js' | 'py' | 'other' =>
  /\.(?:[cm]?js|jsx|tsx?|[cm]ts)$/i.test(path) ? 'js' : /\.py$/i.test(path) ? 'py' : 'other';
