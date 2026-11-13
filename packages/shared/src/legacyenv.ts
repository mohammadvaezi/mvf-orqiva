// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
//    Why:  installs, scripts and CI made before the rename set PRODENGINE_* variables. Each one stands
//          in for its ORQIVA_* name unless that is set too, so nothing has to be re-configured at once.

/** Copies PRODENGINE_X to ORQIVA_X where ORQIVA_X is unset (Node only; a no-op in the browser). */
export function applyLegacyEnv(env?: Record<string, string | undefined>): void {
  const target = env ?? (typeof process === 'undefined' ? undefined : process.env);
  if (!target) return;
  for (const [key, value] of Object.entries(target)) {
    if (!key.startsWith('PRODENGINE_') || value === undefined) continue;
    const now = 'ORQIVA_' + key.slice('PRODENGINE_'.length);
    if (target[now] === undefined) target[now] = value;
  }
}
