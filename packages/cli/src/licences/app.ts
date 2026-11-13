// ── [PCODE-226 | S15 | v0.1.0] T21.3 React Native (Expo) app shell: pairing, live feed, offline cache ──
//    Why:  a phone app ships differently from a server package. Its `dependencies` include the whole
//          build tool chain (Expo's command line, Metro, CSS and image tools), which never reach a phone.
//          What ships is the JavaScript bundle, whose source map names every package inside it, and the
//          native code of the modules linked into the app. So for an app the shipped set is exactly
//          those two; the rest of the closure is build-only and is listed, not judged.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { packageOfSource } from './bundles.js';
import type { PackageNode } from './closure.js';

/** Package names in the source maps of every bundle under `dirs`. */
export function packagesInBundles(dirs: string[]): Set<string> {
  const names = new Set<string>();
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith('.map')) {
        const map = JSON.parse(readFileSync(full, 'utf8')) as { sources?: unknown };
        if (!Array.isArray(map.sources)) continue;
        for (const s of map.sources) {
          const name = typeof s === 'string' ? packageOfSource(s) : null;
          if (name) names.add(name);
        }
      }
    }
  };
  for (const d of dirs) if (existsSync(d)) walk(d);
  return names;
}

/** A package that brings native code into the app: an Expo module, or Android or iOS sources. */
export function hasNativeCode(dir: string): boolean {
  if (existsSync(join(dir, 'expo-module.config.json'))) return true;
  if (existsSync(join(dir, 'android', 'build.gradle'))) return true;
  if (existsSync(join(dir, 'android', 'build.gradle.kts'))) return true;
  try {
    return readdirSync(dir).some((f) => f.endsWith('.podspec'));
  } catch {
    return false;
  }
}

/** The packages of an app's closure that ship: in its bundles, or with native code. */
export function appShipped(
  closure: readonly PackageNode[],
  bundleDirs: string[],
): { shipped: PackageNode[]; buildOnly: PackageNode[] } {
  const inBundles = packagesInBundles(bundleDirs);
  const shipped: PackageNode[] = [];
  const buildOnly: PackageNode[] = [];
  for (const p of closure) {
    if (p.own || inBundles.has(p.name) || hasNativeCode(p.dir)) shipped.push(p);
    else buildOnly.push(p);
  }
  return { shipped, buildOnly };
}
