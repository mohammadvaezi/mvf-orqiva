// ── [PCODE-85 | S08 | v0.1.0] Build our own licence checker and SBOM generator that fail CI on a denied licence ──
//    Why:  the ownership and licence policy of the plan, as data the checker reads: which licences we
//          accept, which packages ship, and the rare reviewed exception. Everything not accepted is denied.
import { readFileSync } from 'node:fs';

export interface ShippedPackage {
  /** workspace folder, relative to the repository root */
  workspace: string;
  /** build output folders whose files ship, relative to the workspace */
  bundles: string[];
  /** folders under the bundles that do not ship (e.g. dist/test), relative to the workspace */
  exclude?: string[];
  /** module names the host provides at run time (e.g. "vscode") */
  provided?: string[];
  /** [PCODE-226 | S15 | v0.1.0] a phone app: what ships is its bundles and its native modules (app.ts) */
  app?: boolean;
}

export interface LicenceException {
  /** the licence we determined by hand */
  licence: string;
  /** why it is acceptable, and who checked it */
  reason: string;
}

export interface LicencePolicy {
  accepted: string[];
  shipped: ShippedPackage[];
  /** keyed by "name@version"; a reviewed decision for one exact package version */
  exceptions: Record<string, LicenceException>;
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

/** Reads and validates the policy file; throws with the field that is wrong. */
export function loadPolicy(file: string): LicencePolicy {
  const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  if (!isStringArray(raw['accepted']))
    throw new Error(file + ': "accepted" must be a list of licence ids');
  const shipped = raw['shipped'];
  if (!Array.isArray(shipped) || shipped.length === 0) {
    throw new Error(file + ': "shipped" must list at least one workspace');
  }
  const packages: ShippedPackage[] = shipped.map((s: unknown, i) => {
    const o = (s ?? {}) as Record<string, unknown>;
    if (typeof o['workspace'] !== 'string' || !isStringArray(o['bundles'])) {
      throw new Error(file + ': shipped[' + String(i) + '] needs "workspace" and "bundles"');
    }
    const p: ShippedPackage = { workspace: o['workspace'], bundles: o['bundles'] };
    if (isStringArray(o['exclude'])) p.exclude = o['exclude'];
    if (isStringArray(o['provided'])) p.provided = o['provided'];
    if (o['app'] === true) p.app = true; // [PCODE-226 | S15 | v0.1.0]
    return p;
  });
  const exceptions: Record<string, LicenceException> = {};
  const rawEx = (raw['exceptions'] ?? {}) as Record<string, unknown>;
  for (const [key, value] of Object.entries(rawEx)) {
    const e = (value ?? {}) as Record<string, unknown>;
    if (typeof e['licence'] !== 'string' || typeof e['reason'] !== 'string' || !key.includes('@')) {
      throw new Error(
        file + ': exception "' + key + '" needs name@version, "licence" and "reason"',
      );
    }
    exceptions[key] = { licence: e['licence'], reason: e['reason'] };
  }
  return { accepted: raw['accepted'], shipped: packages, exceptions };
}
