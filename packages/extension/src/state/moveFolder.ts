// ── [PCODE-455 | S15 | v0.1.0] Rename the project folder .plane to .orqiva on Orqiva folders, with a one-time move ──
//    Why:  a folder linked to Orqiva keeps its project files in .orqiva; one that still has them in the old
//          .plane gets them moved there once, the first time VS Code opens it trusted. Nothing is deleted: a
//          file .orqiva already has (orq writes fingerprints.md itself) and the legacy engine's own files go
//          to .orqiva/legacy, so the old folder can go. A file that cannot move (open elsewhere) stays and is
//          tried again next time.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { LEGACY_DIR, ORQIVA_DIR } from './files';

/** The legacy engine's own files: kept, under .orqiva/legacy, not used by Orqiva. */
export const ENGINE_OWN: ReadonlySet<string> = new Set([
  'project.json',
  'state/active.json',
  'state/queue.jsonl',
  'state/session.json',
  '.template-hash.json',
  'plane-archive.json',
]);

export interface MoveFs {
  existsSync(p: string): boolean;
  readdirSync(p: string, o: { withFileTypes: true }): { name: string; isDirectory(): boolean }[];
  mkdirSync(p: string, o: { recursive: true }): unknown;
  renameSync(from: string, to: string): void;
  rmdirSync(p: string): void;
}

export interface MoveReport {
  /** posix paths inside the old folder, with where each went */
  moved: { from: string; to: string }[];
  /** could not move; they stay and are tried again */
  stayed: string[];
  /** the old folder is gone */
  removed: boolean;
}

function filesIn(dir: string, io: MoveFs, prefix = ''): string[] {
  return io
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((e) =>
      e.isDirectory()
        ? filesIn(path.join(dir, e.name), io, prefix + e.name + '/')
        : [prefix + e.name],
    );
}

/** Empty folders, deepest first, then the folder itself. True when the folder is gone. */
function prune(dir: string, io: MoveFs): boolean {
  for (const e of io.readdirSync(dir, { withFileTypes: true }))
    if (e.isDirectory()) prune(path.join(dir, e.name), io);
  if (io.readdirSync(dir, { withFileTypes: true }).length) return false;
  try {
    io.rmdirSync(dir);
    return true;
  } catch {
    return false;
  }
}

// ── [PCODE-455 | S15 | v0.1.0] moveToOrqiva: null when there is nothing to move ──
export function moveToOrqiva(root: string, io: MoveFs = fs): MoveReport | null {
  const from = path.join(root, LEGACY_DIR);
  const to = path.join(root, ORQIVA_DIR);
  if (!io.existsSync(path.join(to, 'project.json')) || !io.existsSync(from)) return null;
  const report: MoveReport = { moved: [], stayed: [], removed: false };
  for (const rel of filesIn(from, io)) {
    const plain = path.join(to, ...rel.split('/'));
    const target =
      ENGINE_OWN.has(rel) || io.existsSync(plain)
        ? path.join(to, 'legacy', ...rel.split('/'))
        : plain;
    if (io.existsSync(target)) {
      report.stayed.push(rel);
      continue;
    }
    try {
      io.mkdirSync(path.dirname(target), { recursive: true });
      io.renameSync(path.join(from, ...rel.split('/')), target);
      report.moved.push({
        from: LEGACY_DIR + '/' + rel,
        to: path.relative(root, target).replace(/\\/g, '/'),
      });
    } catch {
      report.stayed.push(rel);
    }
  }
  report.removed = prune(from, io);
  return report;
}
