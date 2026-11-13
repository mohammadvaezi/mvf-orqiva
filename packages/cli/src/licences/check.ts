// ── [PCODE-85 | S08 | v0.1.0] Build our own licence checker and SBOM generator that fail CI on a denied licence ──
//    Why:  one verdict per third-party package, from both the manifest and the licence files, so a package
//          that declares MIT but ships a GPL text, or appends the Commons Clause, is caught.
import type { PackageNode } from './closure.js';
import { licenceFiles } from './closure.js';
import { RIDERS, detectLicences, sameFamily } from './detect.js';
import type { LicencePolicy } from './policy.js';
import { chooseAccepted, parseSpdx, spdxIds } from './spdx.js';

export interface Verdict {
  name: string;
  version: string;
  requiredBy: string;
  /** what the manifest says, as written */
  declared: string | null;
  /** what the licence files say */
  detected: string[];
  /** the licences that bind us when accepted (the chosen OR branches), else what blocked it */
  licences: string[];
  ok: boolean;
  /** why it was denied, or a note a person should read */
  reason: string;
  warnings: string[];
  files: { file: string; text: string }[];
}

/** The manifest's licence as one SPDX-ish string, from `license` or the legacy `licenses` list. */
export function declaredLicence(node: PackageNode): string | null {
  const { license, licenses } = node.manifest;
  if (typeof license === 'string' && license.trim()) return license.trim();
  if (
    license &&
    typeof license === 'object' &&
    typeof (license as { type?: unknown }).type === 'string'
  ) {
    return (license as { type: string }).type;
  }
  if (Array.isArray(licenses)) {
    const types = licenses
      .map((l: unknown) => (l && typeof l === 'object' ? (l as { type?: unknown }).type : l))
      .filter((t): t is string => typeof t === 'string');
    if (types.length)
      return types.length === 1 ? (types[0] ?? null) : '(' + types.join(' OR ') + ')';
  }
  return null;
}

export function judge(node: PackageNode, policy: LicencePolicy): Verdict {
  const accepted = new Set(policy.accepted);
  const files = licenceFiles(node.dir);
  const detected = [...new Set(files.flatMap((f) => detectLicences(f.text)))];
  const declared = declaredLicence(node);
  const base = {
    name: node.name,
    version: node.version,
    requiredBy: node.requiredBy,
    declared,
    detected,
    files,
  };
  const deny = (reason: string, licences: string[]): Verdict => ({
    ...base,
    licences,
    ok: false,
    reason,
    warnings: [],
  });

  const exception = policy.exceptions[node.name + '@' + node.version];
  if (exception) {
    return {
      ...base,
      licences: [exception.licence],
      ok: true,
      reason: 'exception: ' + exception.reason,
      warnings: [],
    };
  }

  const riders = detected.filter((id) => (RIDERS as readonly string[]).includes(id));
  if (riders.length) return deny('licence file adds ' + riders.join(', '), riders);

  const tree = declared ? parseSpdx(declared) : null;
  const chosen = tree ? chooseAccepted(tree, accepted) : null;
  const declaredIds = tree ? spdxIds(tree) : [];

  // a licence text in the package that is not accepted and that the manifest does not offer as a choice
  const hidden = detected.filter(
    (id) => !accepted.has(id) && !declaredIds.some((d) => sameFamily(id, d)),
  );
  if (hidden.length) {
    return deny(
      'licence file is ' + hidden.join(', ') + ', the manifest says ' + (declared ?? 'nothing'),
      hidden,
    );
  }

  if (tree && !chosen)
    return deny(
      'declared ' + (declared ?? ''),
      declaredIds.filter((id) => !accepted.has(id)),
    );

  const warnings: string[] = [];
  if (chosen) {
    if (files.length === 0) warnings.push('no licence file; the notice is built from the manifest');
    else if (detected.length === 0)
      warnings.push('licence file not recognised; read ' + files.map((f) => f.file).join(', '));
    return { ...base, licences: chosen, ok: true, reason: '', warnings };
  }

  // no usable declaration: the licence files decide, and they must all be accepted
  if (detected.length && detected.every((id) => accepted.has(id))) {
    warnings.push(
      'manifest has no SPDX licence (' + (declared ?? 'none') + '); judged from the licence file',
    );
    return { ...base, licences: detected, ok: true, reason: '', warnings };
  }
  return deny(
    declared ? 'licence "' + declared + '" is not an SPDX id we accept' : 'no licence found',
    detected,
  );
}
