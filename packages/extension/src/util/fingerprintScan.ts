// ── [PCODE-21 | S04 | v0.1.0] List fingerprinted files in the task panel with click-to-open at line ──
//    Task: https://plan.broszio.com/prodsystem/projects/74f47636-71b0-4eb5-94b5-ea2fe840ec01/issues/
//    Why:  scanFile / scanWorkspace mirror fingerprint.py scan() - same SKIP_DIRS, SKIP_EXT, dot-folder rule
//          (.github allowed) and header/block semantics - so the panel lists what `plane done` will see
//          (criticals #5). Pure: fs is injected for tests.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { isCode, scanText, type Marker } from './fingerprint';

export const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  '__pycache__',
  '.venv',
  'venv',
  'dist',
  'build',
  '.plane',
  '.orqiva', // [PCODE-455 | S15 | v0.1.0]
  '.idea',
  '.vscode',
  'vendor',
  'target',
  '.next',
  'coverage',
  'translations',
]);
export const SKIP_EXT = new Set([
  'min.js',
  'min.css',
  'map',
  'lock',
  'png',
  'jpg',
  'jpeg',
  'gif',
  'svg',
  'ico',
  'pdf',
  'woff',
  'woff2',
  'ttf',
  'otf',
  'zip',
  'exe',
  'dll',
  'so',
  'pyc',
  'mo',
  'po',
  'pot',
  'json',
  'csv',
  'txt',
]);

export interface FileMarker extends Marker {
  /** posix path relative to the root */
  file: string;
}

export interface ScanFs {
  readdirSync: (p: string) => { name: string; isDirectory(): boolean; isFile(): boolean }[];
  readFileSync: (p: string, enc: 'utf8') => string;
}

const defaultFs: ScanFs = {
  readdirSync: (p) => fs.readdirSync(p, { withFileTypes: true }),
  readFileSync: (p, enc) => fs.readFileSync(p, enc),
};

function extOf(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith('.min.js')) return 'min.js';
  if (lower.endsWith('.min.css')) return 'min.css';
  const i = lower.lastIndexOf('.');
  return i < 0 ? '' : lower.slice(i + 1);
}

export function shouldScan(filePath: string): boolean {
  const name = path.basename(filePath);
  return !SKIP_EXT.has(extOf(name)) && isCode(filePath);
}

// ── [PCODE-21 | S04 | v0.1.0] scanFile: markers of one file (first per task = header, later = block) ──
export function scanFile(absPath: string, root: string, io: ScanFs = defaultFs): FileMarker[] {
  let text: string;
  try {
    text = io.readFileSync(absPath, 'utf8');
  } catch {
    return [];
  }
  const rel = path.relative(root, absPath).replace(/\\/g, '/');
  return scanText(text).map((m) => ({ ...m, file: rel }));
}

// ── [PCODE-21 | S04 | v0.1.0] scanWorkspace: walk like fingerprint.py, skip the same folders and extensions ──
export function scanWorkspace(root: string, task?: string, io: ScanFs = defaultFs): FileMarker[] {
  const out: FileMarker[] = [];
  const walk = (dir: string): void => {
    let entries: ReturnType<ScanFs['readdirSync']>;
    try {
      entries = io.readdirSync(dir);
    } catch {
      return;
    }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name) || (e.name.startsWith('.') && e.name !== '.github')) continue;
        walk(full);
      } else if (e.isFile() && shouldScan(full)) {
        for (const m of scanFile(full, root, io)) if (!task || m.task === task) out.push(m);
      }
    }
  };
  walk(root);
  return out;
}

export function filesForTask(
  root: string,
  task: string,
  io: ScanFs = defaultFs,
): { file: string; line: number; kind: string }[] {
  return scanWorkspace(root, task, io).map((m) => ({ file: m.file, line: m.line, kind: m.kind }));
}
