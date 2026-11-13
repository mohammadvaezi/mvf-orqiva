// ── [PCODE-85 | S08 | v0.1.0] Build our own licence checker and SBOM generator that fail CI on a denied licence ──
//    Why:  what ships is the runtime dependency closure of our shipped packages: their `dependencies`,
//          and those packages' dependencies, resolved the way Node resolves them (node_modules up the
//          tree). devDependencies never enter it; that is the line between a tool and a product part.
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface Manifest {
  name?: string;
  version?: string;
  license?: unknown;
  licenses?: unknown;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  private?: boolean;
  homepage?: string;
  repository?: unknown;
}

export interface PackageNode {
  name: string;
  version: string;
  dir: string;
  manifest: Manifest;
  /** one of our own workspace packages (its licence is ours, not checked) */
  own: boolean;
  /** who pulled it in first, for the report */
  requiredBy: string;
}

export interface Closure {
  packages: PackageNode[];
  /** "x needs y, which is not installed" */
  missing: string[];
}

export function readManifest(dir: string): Manifest {
  return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as Manifest;
}

/** Node's lookup: <dir>/node_modules/<name>, then the same one folder up, to the root. */
export function resolvePackageDir(name: string, fromDir: string): string | null {
  let dir = fromDir;
  for (;;) {
    const candidate = join(dir, 'node_modules', name);
    if (existsSync(join(candidate, 'package.json'))) return realpathSync(candidate);
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** The runtime closure of the given workspace folders. `isOwn` marks our own packages. */
export function runtimeClosure(workspaceDirs: string[], isOwn: (name: string) => boolean): Closure {
  const byDir = new Map<string, PackageNode>();
  const missing: string[] = [];
  const queue: PackageNode[] = [];

  for (const ws of workspaceDirs) {
    const dir = realpathSync(ws);
    const manifest = readManifest(dir);
    const node: PackageNode = {
      name: manifest.name ?? ws,
      version: manifest.version ?? '0.0.0',
      dir,
      manifest,
      own: true,
      requiredBy: '(shipped)',
    };
    byDir.set(dir, node);
    queue.push(node);
  }

  for (let next = queue.shift(); next; next = queue.shift()) {
    const deps = { ...next.manifest.dependencies };
    const optional = new Set(Object.keys(next.manifest.optionalDependencies ?? {}));
    for (const name of optional) deps[name] = next.manifest.optionalDependencies?.[name] ?? '';
    for (const name of Object.keys(deps).sort()) {
      const dir = resolvePackageDir(name, next.dir);
      if (!dir) {
        if (!optional.has(name))
          missing.push(next.name + ' needs ' + name + ', which is not installed');
        continue;
      }
      if (byDir.has(dir)) continue;
      const manifest = readManifest(dir);
      const node: PackageNode = {
        name: manifest.name ?? name,
        version: manifest.version ?? '0.0.0',
        dir,
        manifest,
        own: isOwn(manifest.name ?? name),
        requiredBy: next.name,
      };
      byDir.set(dir, node);
      queue.push(node);
    }
  }
  const packages = [...byDir.values()].sort((a, b) =>
    a.name === b.name ? a.version.localeCompare(b.version) : a.name.localeCompare(b.name),
  );
  return { packages, missing };
}

const LICENCE_FILE = /^(licen[cs]e|copying|notice)([.\-_].*)?$/i;

/** The texts of a package's licence and notice files, by file name. */
export function licenceFiles(dir: string): { file: string; text: string }[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && LICENCE_FILE.test(e.name))
    .map((e) => e.name)
    .sort()
    .map((file) => ({ file, text: readFileSync(join(dir, file), 'utf8') }));
}
