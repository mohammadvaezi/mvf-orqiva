// ── [PCODE-309 | S15 | v0.1.0] T31.8b Architecture graph, change coupling and bus factor on the code map ──
//    Why:  three questions about a codebase. Which parts depend on which (the imports between folders,
//          with cycles named)? Which files change together without saying so (co-changes in commits,
//          worst across folders)? Who would be missed (the fewest people who wrote most of a folder)?
import { folderAt } from './codework.js';

// ── imports ──

const JS_IMPORT =
  /(?:^|[\s;])(?:import|export)\s[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]|(?:^|[\s;(])import\s*\(?\s*['"]([^'"]+)['"]|\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/gm;
const PY_FROM = /^\s*from\s+(\.+[\w.]*)\s+import\b/gm;

const JS_EXT = /\.(?:[cm]?[jt]sx?)$/;

/** The import specifiers a file names; only relative ones can be followed into the repository. */
export function importsOf(path: string, text: string): string[] {
  const out = new Set<string>();
  if (JS_EXT.test(path) || /\.(vue|svelte)$/.test(path)) {
    for (const m of text.matchAll(JS_IMPORT)) {
      const spec = m[1] ?? m[2] ?? m[3];
      if (spec) out.add(spec);
    }
  } else if (path.endsWith('.py')) {
    for (const m of text.matchAll(PY_FROM)) if (m[1]) out.add(m[1]);
  }
  return [...out];
}

const join = (dir: string, spec: string): string | null => {
  const parts = dir ? dir.split('/') : [];
  for (const p of spec.split('/')) {
    if (p === '.' || p === '') continue;
    if (p === '..') {
      if (!parts.length) return null;
      parts.pop();
    } else parts.push(p);
  }
  return parts.join('/');
};

/** A relative specifier as a file of the repository, or null (a package, or not found). */
export function resolveImport(
  from: string,
  spec: string,
  known: ReadonlySet<string>,
  /** a monorepo's own packages: their name to their folder ("@acme/shared" → "packages/shared") */
  packages: ReadonlyMap<string, string> = new Map(),
): string | null {
  const dir = from.split('/').slice(0, -1).join('/');
  // a package of the same repository, by its name: its entry, or the file named after it
  if (!spec.startsWith('.') && packages.size) {
    for (const [name, folder] of packages) {
      if (spec !== name && !spec.startsWith(name + '/')) continue;
      const sub = spec.slice(name.length).replace(/^\//, '');
      const roots = [folder + '/src', folder];
      const tries = sub
        ? roots.flatMap((r) =>
            ['', '.ts', '.tsx', '.js', '/index.ts', '/index.js'].map(
              (e) => r + '/' + sub.replace(/\.js$/, '') + e,
            ),
          )
        : roots.flatMap((r) => [r + '/index.ts', r + '/index.tsx', r + '/index.js']);
      return tries.find((c) => known.has(c)) ?? null;
    }
  }
  if (from.endsWith('.py')) {
    if (!spec.startsWith('.')) return null;
    const dots = /^\.+/.exec(spec)?.[0].length ?? 0;
    let base: string | null = dir;
    for (let k = 1; k < dots && base !== null; k++) base = join(base, '..');
    if (base === null) return null;
    const rest = spec.slice(dots).replace(/\./g, '/');
    const p = rest ? (base ? base + '/' : '') + rest : base;
    for (const c of [p + '.py', p + '/__init__.py']) if (known.has(c)) return c;
    return null;
  }
  if (!spec.startsWith('.')) return null;
  const p = join(dir, spec);
  if (p === null) return null;
  // TypeScript's ESM style names the .js the .ts becomes
  const stem = p.replace(/\.(?:[cm]?js|jsx)$/, '');
  const tries = [
    p,
    ...['.ts', '.tsx', '.mts', '.js', '.jsx', '.mjs', '.cjs'].map((e) => stem + e),
    ...['/index.ts', '/index.tsx', '/index.js'].map((e) => p + e),
  ];
  return tries.find((c) => known.has(c)) ?? null;
}

// ── the architecture graph ──

export interface ArchNode {
  id: string;
  files: number;
  lines: number;
}
export interface ArchEdge {
  from: string;
  to: string;
  imports: number;
}

/** Folders and the imports between them; imports inside a folder are not edges. */
export function folderGraph(
  files: readonly { path: string; lines: number; imports: readonly string[] }[],
  depth: number,
): { nodes: ArchNode[]; edges: ArchEdge[] } {
  const nodes = new Map<string, ArchNode>();
  const edges = new Map<string, ArchEdge>();
  for (const f of files) {
    const id = folderAt(f.path, depth);
    const n = nodes.get(id) ?? { id, files: 0, lines: 0 };
    n.files += 1;
    n.lines += f.lines;
    nodes.set(id, n);
  }
  for (const f of files) {
    const from = folderAt(f.path, depth);
    for (const i of f.imports) {
      const to = folderAt(i, depth);
      if (to === from) continue;
      const k = from + '\u0000' + to;
      const e = edges.get(k) ?? { from, to, imports: 0 };
      e.imports += 1;
      edges.set(k, e);
    }
  }
  return {
    nodes: [...nodes.values()].sort((a, b) => b.lines - a.lines),
    edges: [...edges.values()].sort((a, b) => b.imports - a.imports),
  };
}

/** Groups of folders that import each other in a circle (strongly connected, two or more). */
export function importCycles(edges: readonly ArchEdge[]): string[][] {
  const next = new Map<string, string[]>();
  for (const e of edges) next.set(e.from, [...(next.get(e.from) ?? []), e.to]);
  const ids = [...new Set(edges.flatMap((e) => [e.from, e.to]))].sort();
  let index = 0;
  const idx = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const on = new Set<string>();
  const out: string[][] = [];
  const visit = (v: string): void => {
    idx.set(v, index);
    low.set(v, index);
    index += 1;
    stack.push(v);
    on.add(v);
    for (const w of next.get(v) ?? []) {
      if (!idx.has(w)) {
        visit(w);
        low.set(v, Math.min(low.get(v) ?? 0, low.get(w) ?? 0));
      } else if (on.has(w)) low.set(v, Math.min(low.get(v) ?? 0, idx.get(w) ?? 0));
    }
    if (low.get(v) === idx.get(v)) {
      const group: string[] = [];
      for (;;) {
        const w = stack.pop();
        if (w === undefined) break;
        on.delete(w);
        group.push(w);
        if (w === v) break;
      }
      if (group.length > 1) out.push(group.sort());
    }
  };
  for (const v of ids) if (!idx.has(v)) visit(v);
  return out.sort((a, b) => b.length - a.length || (a[0] ?? '').localeCompare(b[0] ?? ''));
}

// ── change coupling ──

export interface CoupledPair {
  a: string;
  b: string;
  /** commits that changed both */
  together: number;
  /** together ÷ the changes of the one that changed less: 1 means it never changes alone */
  degree: number;
  /** the two live in different folders: nothing in the structure says they belong together */
  crossFolder: boolean;
}

/** Files that change together; commits touching more than `maxFiles` files (formatting, renames) are skipped. */
export function changeCoupling(
  commits: readonly (readonly string[])[],
  o: { minTogether: number; maxFiles: number; depth: number; limit: number },
): CoupledPair[] {
  const alone = new Map<string, number>();
  const pairs = new Map<string, number>();
  for (const raw of commits) {
    const paths = [...new Set(raw)].sort();
    if (!paths.length || paths.length > o.maxFiles) continue;
    for (const p of paths) alone.set(p, (alone.get(p) ?? 0) + 1);
    for (let i = 0; i < paths.length; i++)
      for (let j = i + 1; j < paths.length; j++) {
        const k = (paths[i] ?? '') + '\u0000' + (paths[j] ?? '');
        pairs.set(k, (pairs.get(k) ?? 0) + 1);
      }
  }
  const out: CoupledPair[] = [];
  for (const [k, together] of pairs) {
    if (together < o.minTogether) continue;
    const [a = '', b = ''] = k.split('\u0000');
    const least = Math.min(alone.get(a) ?? together, alone.get(b) ?? together);
    out.push({
      a,
      b,
      together,
      degree: Math.round((together / least) * 100) / 100,
      crossFolder: folderAt(a, o.depth) !== folderAt(b, o.depth),
    });
  }
  return out
    .sort(
      (x, y) =>
        Number(y.crossFolder) - Number(x.crossFolder) ||
        y.degree - x.degree ||
        y.together - x.together,
    )
    .slice(0, o.limit);
}

// ── bus factor ──

export interface Knowledge {
  /** the fewest people who wrote more than half of the lines */
  busFactor: number;
  owner: string | null;
  ownerShare: number;
  authors: number;
}

/** From lines written per author (agents excluded: an agent leaving is not knowledge lost). */
export function knowledgeOf(lines: Readonly<Record<string, number>>): Knowledge {
  const people = Object.entries(lines)
    .filter(([who, n]) => n > 0 && !/\bagent\b/i.test(who))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const total = people.reduce((s, [, n]) => s + n, 0);
  if (!total) return { busFactor: 0, owner: null, ownerShare: 0, authors: 0 };
  let acc = 0;
  let k = 0;
  while (acc * 2 <= total && k < people.length) acc += people[k++]?.[1] ?? 0;
  return {
    busFactor: k,
    owner: people[0]?.[0] ?? null,
    ownerShare: Math.round(((people[0]?.[1] ?? 0) / total) * 100) / 100,
    authors: people.length,
  };
}
