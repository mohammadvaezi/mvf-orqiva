// ── [PCODE-85 | S08 | v0.1.0] Build our own licence checker and SBOM generator that fail CI on a denied licence ──
// ── [PCODE-107 | S15 | v0.1.0] Build the Plane importer: projects, items, states, comments, cycles, history ──
//    Why:  the licence check covers the runtime closure; this proves the built files contain nothing else.
//          A bundle's source map names every file it was built from, so a development-only package inlined
//          by mistake shows up as node_modules/<name>/… in its `sources`. Unbundled output (tsc) is checked
//          by its imports: every bare module it loads must be a Node built-in, provided by the host, or in
//          the closure. A .js without a source map cannot be proven and fails.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { isBuiltin } from 'node:module';
import { join, relative } from 'node:path';

export interface BundleFinding {
  file: string;
  problem: string;
}

/** "node_modules/@scope/name/lib/x.js" -> "@scope/name" (the last node_modules segment wins). */
export function packageOfSource(source: string): string | null {
  const parts = source.replace(/\\/g, '/').split('/');
  const at = parts.lastIndexOf('node_modules');
  if (at < 0) return null;
  const first = parts[at + 1];
  if (!first) return null;
  if (first.startsWith('@')) {
    const second = parts[at + 2];
    return second ? first + '/' + second : null;
  }
  return first;
}

/** "lodash/fp" -> "lodash", "@a/b/c" -> "@a/b"; null for relative, absolute and node: specifiers. */
export function packageOfSpecifier(spec: string): string | null {
  if (
    spec.startsWith('.') ||
    spec.startsWith('/') ||
    spec.startsWith('node:') ||
    /^[a-z]:/i.test(spec)
  ) {
    return null;
  }
  const parts = spec.split('/');
  if (spec.startsWith('@'))
    return parts.length >= 2 ? (parts[0] ?? '') + '/' + (parts[1] ?? '') : null;
  return parts[0] ?? null;
}

// [PCODE-107 | S15 | v0.1.0] a specifier never spans lines, and a bare `import 'x'` starts a statement:
// the word 'import' inside a string ("tags: ['import']") is not an import
const IMPORTS = [
  /\b(?:import|export)\s[^'"`;]*?\bfrom\s*['"]([^'"\n]+)['"]/g,
  /(?:^|[;{}])\s*import\s*['"]([^'"\n]+)['"]/gm,
  /\bimport\(\s*['"]([^'"\n]+)['"]\s*\)/g,
  /\brequire\(\s*['"]([^'"\n]+)['"]\s*\)/g,
];

/** Bare module names a JavaScript file loads. */
export function importedPackages(code: string): string[] {
  const found = new Set<string>();
  for (const re of IMPORTS) {
    for (const m of code.matchAll(re)) {
      const spec = m[1];
      if (spec && !isBuiltin(spec)) {
        const pkg = packageOfSpecifier(spec);
        if (pkg) found.add(pkg);
      }
    }
  }
  return [...found];
}

function walk(dir: string, skip: Set<string>, out: string[]): void {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (skip.has(full)) continue;
    if (e.isDirectory()) walk(full, skip, out);
    else if (/\.(m|c)?js$/.test(e.name)) out.push(full);
  }
}

/**
 * Checks every shipped .js under `bundleDirs` (absolute) against `allowed` package names.
 * `excludeDirs` are absolute folders that do not ship.
 */
export function checkBundles(
  root: string,
  bundleDirs: string[],
  excludeDirs: string[],
  allowed: ReadonlySet<string>,
): BundleFinding[] {
  const findings: BundleFinding[] = [];
  const skip = new Set(excludeDirs);
  for (const dir of bundleDirs) {
    if (!existsSync(dir)) {
      findings.push({
        file: relative(root, dir),
        problem: 'not built; run the build before the licence check',
      });
      continue;
    }
    const files: string[] = [];
    walk(dir, skip, files);
    for (const file of files) {
      const rel = relative(root, file).replace(/\\/g, '/');
      const mapFile = file + '.map';
      if (!existsSync(mapFile)) {
        findings.push({ file: rel, problem: 'no source map, so its contents cannot be proven' });
        continue;
      }
      const map = JSON.parse(readFileSync(mapFile, 'utf8')) as { sources?: unknown };
      const sources = Array.isArray(map.sources)
        ? map.sources.filter((s): s is string => typeof s === 'string')
        : [];
      for (const pkg of new Set(
        sources.map(packageOfSource).filter((p): p is string => p !== null),
      )) {
        if (!allowed.has(pkg))
          findings.push({
            file: rel,
            problem: 'contains code from ' + pkg + ', which is not a runtime dependency',
          });
      }
      for (const pkg of importedPackages(readFileSync(file, 'utf8'))) {
        if (!allowed.has(pkg))
          findings.push({
            file: rel,
            problem: 'loads ' + pkg + ', which is not a runtime dependency',
          });
      }
    }
  }
  return findings;
}
