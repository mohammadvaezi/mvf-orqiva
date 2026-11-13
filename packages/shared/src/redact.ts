// ── [PCODE-247 | S15 | v0.1.0] T25.2 Agent scopes enforced: files, branches, network, trace redaction ──
//    Why:  a trace keeps what an agent read, said and did, and people read it later; a key it fetched or a
//          password in a URL must not stay there. Every text of a step is cleaned before it is stored: known key
//          shapes (Orqiva, Anthropic, OpenAI, xAI, Google, AWS, GitHub, GitLab, Slack, Stripe), private key
//          blocks, passwords in URLs, bearer tokens and "password"/"secret" values become [redacted <kind>].
//          What was found is said by kind, never by value.

const PATTERNS: [kind: string, re: RegExp][] = [
  ['private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g],
  [
    'Orqiva token',
    /(?<![A-Za-z0-9_-])(?:orq|pe)_(?:(?:pat_|svc_|run_)[A-Za-z0-9_-]{43}|[A-Za-z0-9_-]{43})(?![A-Za-z0-9_-])/g,
  ],
  ['Anthropic key', /\bsk-ant-[A-Za-z0-9_-]{20,}/g],
  ['OpenAI key', /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}/g],
  ['xAI key', /\bxai-[A-Za-z0-9_-]{20,}/g],
  ['Google key', /\bAIza[0-9A-Za-z_-]{35}\b/g],
  ['AWS access key', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g],
  ['GitHub token', /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})/g],
  ['GitLab token', /\bglpat-[A-Za-z0-9_-]{20,}/g],
  ['Slack token', /\bxox[abposr]-[A-Za-z0-9-]{10,}/g],
  ['Stripe key', /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}/g],
  ['webhook secret', /\bwhs_[A-Za-z0-9_-]{24,}/g],
];

/** user:password@ in a URL; the user stays. */
const URL_PASSWORD = /(\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)([^\s@/]+)(@)/gi;
const BEARER = /(\bBearer\s+)([A-Za-z0-9._~+/=-]{16,})/g;
/** "password": "…", password=…, api_key: … */
const NAMED =
  /((?:"|')?(?:password|passwd|secret|api[_-]?key|access[_-]?token|client[_-]?secret)(?:"|')?\s*[:=]\s*)("[^"\n]{4,}"|'[^'\n]{4,}'|[^\s,;"'&]{6,})/gi;

export interface Redacted {
  text: string;
  /** the kinds found, each once */
  found: string[];
}

/** The text with every secret replaced by [redacted <kind>]. */
export function redactSecrets(text: string): Redacted {
  const found = new Set<string>();
  let out = text;
  for (const [kind, re] of PATTERNS)
    out = out.replace(re, () => {
      found.add(kind);
      return '[redacted ' + kind + ']';
    });
  out = out.replace(URL_PASSWORD, (_m, a: string, _p: string, b: string) => {
    found.add('password in a URL');
    return a + '[redacted]' + b;
  });
  out = out.replace(BEARER, (_m, a: string) => {
    found.add('bearer token');
    return a + '[redacted]';
  });
  out = out.replace(NAMED, (m, a: string, v: string) => {
    if (v.includes('[redacted')) return m;
    found.add('password or secret');
    const q = v.startsWith('"') ? '"' : v.startsWith("'") ? "'" : '';
    return a + q + '[redacted]' + q;
  });
  return { text: out, found: [...found] };
}

/** Every string inside a JSON value, cleaned; the kinds found are added to `found`. */
export function redactValue(value: unknown, found: Set<string>): unknown {
  if (typeof value === 'string') {
    const r = redactSecrets(value);
    for (const f of r.found) found.add(f);
    return r.text;
  }
  if (Array.isArray(value)) return value.map((v) => redactValue(v, found));
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, redactValue(v, found)]),
    );
  return value;
}
