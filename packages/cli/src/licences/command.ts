// ── [PCODE-226 | S15 | v0.1.0] T21.3 React Native (Expo) app shell: pairing, live feed, offline cache ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-85 | S08 | v0.1.0] Build our own licence checker and SBOM generator that fail CI on a denied licence ──
//    Why:  `orq licences` is the gate CI runs after the build: it judges every third-party package that
//          ships, proves the bundles hold nothing else, and writes the SBOM and the notices. Exit 1 on any
//          denial, so a restrictive licence can never reach a release.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { PLATFORM_VERSION, PRODUCT_NAME } from '@orqiva/shared';
import { appShipped } from './app.js';
import { checkBundles } from './bundles.js';
import { judge, type Verdict } from './check.js';
import { runtimeClosure } from './closure.js';
import { loadPolicy } from './policy.js';
import { buildNotices, buildSbom } from './sbom.js';

export const POLICY_FILE = 'licence-policy.json';

export interface LicencesOptions {
  /** repository root; default: the nearest folder upwards holding licence-policy.json */
  root?: string;
  /** output folder for the SBOM and notices, relative to root; default out/licences */
  out?: string;
  /** for tests: a fixed timestamp and serial make the SBOM reproducible */
  timestamp?: string;
  serial?: string;
}

export interface LicencesResult {
  code: number;
  out: string;
  verdicts: Verdict[];
}

function findRoot(from: string): string | null {
  let dir = resolve(from);
  for (;;) {
    if (existsSync(join(dir, POLICY_FILE))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function runLicences(opts: LicencesOptions = {}): LicencesResult {
  const root = opts.root ? resolve(opts.root) : findRoot(process.cwd());
  if (!root) return { code: 2, out: 'No ' + POLICY_FILE + ' found here or above.', verdicts: [] };
  const policy = loadPolicy(join(root, POLICY_FILE));

  const isOwn = (name: string): boolean => name.startsWith('@orqiva/');
  const workspaces = policy.shipped.filter((s) => !s.app).map((s) => join(root, s.workspace));
  const closure = runtimeClosure(workspaces, isOwn);
  // [PCODE-226 | S15 | v0.1.0] an app ships its bundles and native modules, not its build tools
  const allowed = new Set<string>(closure.packages.map((p) => p.name));
  const shippedDirs = new Set(closure.packages.map((p) => p.dir));
  let buildOnly = 0;
  for (const app of policy.shipped.filter((s) => s.app)) {
    const c = runtimeClosure([join(root, app.workspace)], isOwn);
    closure.missing.push(...c.missing);
    for (const p of c.packages) allowed.add(p.name);
    const split = appShipped(
      c.packages,
      app.bundles.map((b) => join(root, app.workspace, b)),
    );
    buildOnly += split.buildOnly.length;
    for (const p of split.shipped)
      if (!shippedDirs.has(p.dir)) {
        shippedDirs.add(p.dir);
        closure.packages.push(p);
      }
  }
  const thirdParty = closure.packages.filter((p) => !p.own);
  const verdicts = thirdParty.map((p) => judge(p, policy));
  const denied = verdicts.filter((v) => !v.ok);

  for (const s of policy.shipped) for (const p of s.provided ?? []) allowed.add(p);
  const bundleFindings = checkBundles(
    root,
    policy.shipped.flatMap((s) => s.bundles.map((b) => join(root, s.workspace, b))),
    policy.shipped.flatMap((s) => (s.exclude ?? []).map((e) => join(root, s.workspace, e))),
    allowed,
  );

  const outDir = join(root, opts.out ?? join('out', 'licences'));
  mkdirSync(outDir, { recursive: true });
  const accepted = verdicts.filter((v) => v.ok);
  const sbom = buildSbom({
    product: PRODUCT_NAME,
    version: PLATFORM_VERSION,
    verdicts: accepted,
    ...(opts.timestamp ? { timestamp: opts.timestamp } : {}),
    ...(opts.serial ? { serial: opts.serial } : {}),
  });
  writeFileSync(join(outDir, 'sbom.cdx.json'), JSON.stringify(sbom, null, 2) + '\n');
  writeFileSync(join(outDir, 'THIRD-PARTY-NOTICES.md'), buildNotices(PRODUCT_NAME, accepted));

  const lines: string[] = [];
  for (const v of denied) {
    lines.push(
      'DENIED  ' +
        v.name +
        '@' +
        v.version +
        '  ' +
        v.licences.join(', ') +
        '  (' +
        v.reason +
        '; required by ' +
        v.requiredBy +
        ')',
    );
  }
  for (const m of closure.missing) lines.push('MISSING ' + m);
  for (const f of bundleFindings) lines.push('BUNDLE  ' + f.file + ': ' + f.problem);
  for (const v of verdicts)
    for (const w of v.warnings) lines.push('note    ' + v.name + '@' + v.version + ': ' + w);
  const failed = denied.length + closure.missing.length + bundleFindings.length;
  lines.push(
    (failed ? 'FAILED: ' : 'OK: ') +
      String(thirdParty.length) +
      ' third-party package(s) ship, ' +
      String(denied.length) +
      ' denied; ' +
      String(bundleFindings.length) +
      ' bundle problem(s)' +
      (buildOnly ? '; ' + String(buildOnly) + ' build-only package(s) of the apps left out' : '') +
      '. SBOM and notices in ' +
      outDir,
  );
  return { code: failed ? 1 : 0, out: lines.join('\n'), verdicts };
}
