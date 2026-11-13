// ── [PCODE-181 | S15 | v0.1.0] B5.2 Tokens and costs live: AI spend, budgets, prices, provider keys per project, access tokens with scopes, policy, leak revocation ──
//    Why:  the rules of access tokens and AI spend, shared by server, web app and CLI: the scopes a token
//          can carry and which of them are broad, the prefix of each kind (so scanners find a leaked one),
//          finding tokens in text, the IP allow-list, what a scope lets a request do, and the days whose
//          spend stands out (a looping agent).

export const TOKEN_SCOPES = ['read', 'write', 'loop', 'agents', 'deploys', 'admin'] as const;
export type TokenScope = (typeof TOKEN_SCOPES)[number];
/** Scopes that need an admin's approval when the workspace's policy says so. */
export const BROAD_SCOPES: readonly TokenScope[] = ['admin', 'deploys'];
export const TOKEN_KINDS = ['personal', 'service', 'runner'] as const;
export type TokenKind = (typeof TOKEN_KINDS)[number];
// [PCODE-192 | S15 | v0.1.0] new tokens start orq_; those made before the rename (pe_) keep working
export const TOKEN_PREFIX: Record<TokenKind, string> = {
  personal: 'orq_pat_',
  service: 'orq_svc_',
  runner: 'orq_run_',
};

/** A token as a request sends it: orq_ or the older pe_, with a kind, or one made before kinds (43 characters). */
export const TOKEN_SHAPE = /^(?:orq|pe)_(?:pat_|svc_|run_)?[A-Za-z0-9_-]{43}$/;

/** Every token in a text, e.g. pasted into a task or a comment. */
export function findTokens(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(
    /(?<![A-Za-z0-9_-])(?:orq|pe)_(?:(?:pat_|svc_|run_)[A-Za-z0-9_-]{43}|[A-Za-z0-9_-]{43})(?![A-Za-z0-9_-])/g,
  ))
    out.add(m[0]);
  return [...out];
}

const ipv4 = (ip: string): number | null => {
  const p = ip.split('.');
  if (p.length !== 4 || !p.every((x) => /^\d{1,3}$/.test(x) && Number(x) <= 255)) return null;
  return p.reduce((n, x) => n * 256 + Number(x), 0);
};

/** Whether an address is in the allow-list (IPv4 CIDRs and exact addresses); an empty list allows all. */
export function ipAllowed(ip: string, allow: readonly string[]): boolean {
  if (!allow.length) return true;
  const clean = ip.replace(/^::ffff:/, '');
  return allow.some((rule) => {
    const [base, bits] = rule.split('/');
    if (bits === undefined) return base === clean;
    const a = ipv4(clean);
    const b = ipv4(base ?? '');
    const n = Number(bits);
    if (a === null || b === null || !Number.isInteger(n) || n < 0 || n > 32) return false;
    const mask = n === 0 ? 0 : (0xffffffff << (32 - n)) >>> 0;
    return (a & mask) >>> 0 === (b & mask) >>> 0;
  });
}

/** A valid allow-list entry: an IPv4 address or CIDR, or an IPv6 address. */
export const isIpRule = (rule: string): boolean => {
  const [base, bits] = rule.split('/');
  if (ipv4(base ?? '') !== null)
    return bits === undefined || (/^\d{1,2}$/.test(bits) && Number(bits) <= 32);
  return bits === undefined && /^[0-9a-f:]{2,39}$/i.test(rule) && rule.includes(':');
};

/** What a request may do with a token's scopes; no scopes is everything the person may do. */
export function scopeAllows(
  scopes: readonly string[],
  method: string,
  needsAdmin: boolean,
): boolean {
  if (!scopes.length) return true;
  if (needsAdmin && !scopes.includes('admin')) return false;
  if (method === 'GET' || method === 'HEAD') return scopes.length > 0;
  return scopes.some((s) => s !== 'read');
}

/** Days whose spend is more than `factor` times the average of the other days with spend. */
export function spendAnomalies(days: readonly number[], factor = 3): number[] {
  const out: number[] = [];
  days.forEach((v, i) => {
    const others = days.filter((x, j) => j !== i && x > 0);
    if (!others.length || v <= 0) return;
    const avg = others.reduce((a, b) => a + b, 0) / others.length;
    if (v > avg * factor) out.push(i);
  });
  return out;
}
