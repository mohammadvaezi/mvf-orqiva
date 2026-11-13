// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-2 | S01 | v0.1.0] Add the output channel logger with secret redaction ──
//    Task: https://plan.broszio.com/prodsystem/projects/74f47636-71b0-4eb5-94b5-ea2fe840ec01/issues/f53f2b89-534f-4247-aa0f-9daaee1ed961/
//    Why:  criticals.md #1 - a secret must never reach the output channel, a notification or a comment.
//          Pure module (no vscode import) so it is unit-tested and reusable by every logger and error path.

const MASK = '***';

// ── [PCODE-2 | S01 | v0.1.0] patterns: Plane keys, bearer tokens, API-key headers, env assignments ──
const PATTERNS: RegExp[] = [
  /plane_api_[A-Za-z0-9_-]+/g,
  /(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi,
  /(X-API-Key["']?\s*[:=]\s*)["']?[^\s"',;]+/gi,
  /(PLANE_API_KEY["']?\s*[:=]\s*)["']?[^\s"',;]+/gi,
  /((?:orqiva|prodengine)\.[a-z]+\.(?:apiKey|token)[^=:\s"']*["']?\s*[:=]\s*)["']?[^\s"',;]+/gi,
];

const registered = new Set<string>();

// ── [PCODE-2 | S01 | v0.1.0] registerSecret: values from SecretStorage are masked wherever they appear ──
export function registerSecret(value: string | undefined | null): void {
  if (value && value.length >= 6) registered.add(value);
}

export function forgetSecret(value: string | undefined | null): void {
  if (value) registered.delete(value);
}

export function clearRegisteredSecrets(): void {
  registered.clear();
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ── [PCODE-2 | S01 | v0.1.0] redact: mask every known secret shape in a string; ordinary text is untouched ──
export function redact(text: string, extraSecrets: readonly string[] = []): string {
  let out = text;
  for (const secret of [...registered, ...extraSecrets]) {
    if (secret.length >= 6) out = out.replace(new RegExp(escapeRegExp(secret), 'g'), MASK);
  }
  for (const pattern of PATTERNS) {
    out = out.replace(pattern, (match: string, prefix?: string) =>
      typeof prefix === 'string' && match.startsWith(prefix) ? `${prefix}${MASK}` : MASK,
    );
  }
  return out;
}
