// ── [PCODE-40 | S08 | v0.1.0] Implement the workspace fingerprint scanner and index matching fingerprint.py ──
//    Task: https://plan.broszio.com/prodsystem/projects/74f47636-71b0-4eb5-94b5-ea2fe840ec01/issues/
//    Why:  the documentation generator needs the whole picture - every marker, grouped by sprint, task and
//          file - and it must be the *same* picture `fingerprint.py index` writes, or the generated docs and
//          .plane/fingerprints.md would disagree (criticals #5). The walk reuses the rules of
//          util/fingerprintScan (SKIP_DIRS, SKIP_EXT, dot folders except .github) and runs in chunks with a
//          yield between them, so a ten-thousand-file repo never blocks the extension host.
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { CancelToken } from '../engine/run';
import { scanText, type Marker } from '../util/fingerprint';
import { SKIP_DIRS, shouldScan, type ScanFs } from '../util/fingerprintScan';

export interface Hit extends Marker {
  /** posix path relative to the root */
  file: string;
}

export interface TaskEntry {
  task: string;
  /** the first non-empty marker title, like fingerprint.py write_index */
  title: string;
  versions: string[];
  sprints: string[];
  hits: Hit[];
}

export interface FingerprintIndex {
  /** sprint code -> task ref -> its hits (file/line order) */
  bySprint: Map<string, Map<string, Hit[]>>;
  /** file -> the tasks that fingerprinted it */
  byFile: Map<string, Set<string>>;
  byTask: Map<string, TaskEntry>;
  /** how many code files were read */
  files: number;
  hits: number;
}

export interface ScanProgress {
  files: number;
  total: number;
  hits: number;
}

export interface ScanOptions {
  io?: ScanFs;
  cancel?: CancelToken;
  onProgress?: (p: ScanProgress) => void;
  /** files per chunk; the event loop gets a turn between chunks */
  chunkSize?: number;
  /** injected for tests */
  yieldTo?: () => Promise<void>;
}

const defaultFs: ScanFs = {
  readdirSync: (p) => fs.readdirSync(p, { withFileTypes: true }),
  readFileSync: (p, enc) => fs.readFileSync(p, enc),
};

// ── [PCODE-40 | S08 | v0.1.0] refNumber: PCODE-12 -> 12; the engine sorts tasks numerically, not as text ──
export function refNumber(ref: string): number {
  const n = Number(ref.split('-')[1]);
  return Number.isFinite(n) ? n : 0;
}

export function compareRefs(a: string, b: string): number {
  return refNumber(a) - refNumber(b) || compareFiles(a, b);
}

/** codepoint order, like Python's sorted() - `Dockerfile` before `app/x.py`, not the locale's way */
export function compareFiles(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// ── [PCODE-40 | S08 | v0.1.0] collectFiles: os.walk order - a folder's own files, then its sub-folders ──
//    The order is load-bearing: write_index() takes a task's title from the *first* marker it met, so a
//    different walk order would title a task differently than the engine does.
export function collectFiles(root: string, io: ScanFs = defaultFs): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    let entries: ReturnType<ScanFs['readdirSync']>;
    try {
      entries = io.readdirSync(dir);
    } catch {
      return;
    }
    const sorted = [...entries].sort((a, b) => compareFiles(a.name, b.name));
    for (const e of sorted) {
      const full = path.join(dir, e.name);
      if (e.isFile() && shouldScan(full)) out.push(full);
    }
    for (const e of sorted) {
      if (!e.isDirectory()) continue;
      if (SKIP_DIRS.has(e.name) || (e.name.startsWith('.') && e.name !== '.github')) continue;
      walk(path.join(dir, e.name));
    }
  };
  walk(root);
  return out;
}

export function emptyIndex(): FingerprintIndex {
  return { bySprint: new Map(), byFile: new Map(), byTask: new Map(), files: 0, hits: 0 };
}

// ── [PCODE-40 | S08 | v0.1.0] addHit: one marker into all three maps ──
export function addHit(index: FingerprintIndex, hit: Hit): void {
  const sprint = index.bySprint.get(hit.sprint) ?? new Map<string, Hit[]>();
  index.bySprint.set(hit.sprint, sprint);
  const forTask = sprint.get(hit.task) ?? [];
  sprint.set(hit.task, forTask);
  forTask.push(hit);

  const tasks = index.byFile.get(hit.file) ?? new Set<string>();
  index.byFile.set(hit.file, tasks);
  tasks.add(hit.task);

  const entry = index.byTask.get(hit.task) ?? {
    task: hit.task,
    title: '',
    versions: [],
    sprints: [],
    hits: [],
  };
  index.byTask.set(hit.task, entry);
  entry.hits.push(hit);
  if (!entry.title && hit.title) entry.title = hit.title;
  if (!entry.versions.includes(hit.version)) entry.versions.push(hit.version);
  if (!entry.sprints.includes(hit.sprint)) entry.sprints.push(hit.sprint);
  index.hits++;
}

/** file/line order inside every task, versions and sprints sorted - so two runs render identically */
export function sortIndex(index: FingerprintIndex): FingerprintIndex {
  const byFileLine = (a: Hit, b: Hit): number => compareFiles(a.file, b.file) || a.line - b.line;
  for (const tasks of index.bySprint.values())
    for (const hits of tasks.values()) hits.sort(byFileLine);
  for (const entry of index.byTask.values()) {
    entry.hits.sort(byFileLine);
    entry.versions.sort();
    entry.sprints.sort();
  }
  return index;
}

export function buildIndex(hits: readonly Hit[]): FingerprintIndex {
  const index = emptyIndex();
  for (const h of hits) addHit(index, h);
  return sortIndex(index);
}

/** setImmediate, not setTimeout(0): the timer's minimum delay would cost seconds over a big repo */
const nextTick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

// ── [PCODE-40 | S08 | v0.1.0] scanProject: chunked walk + scan; cancelling returns what was read so far ──
//    A chunk's files are read at once: the scan is I/O bound (ten thousand files take seconds when read one
//    after the other on Windows, under a second in parallel), and the chunk boundary is where the extension
//    host gets its turn back.
export async function scanProject(root: string, opts: ScanOptions = {}): Promise<FingerprintIndex> {
  const io = opts.io;
  const chunkSize = opts.chunkSize ?? 200;
  const yieldTo = opts.yieldTo ?? nextTick;
  const files = collectFiles(root, io ?? defaultFs);
  const index = emptyIndex();
  const read = async (file: string): Promise<string | null> => {
    try {
      return io ? io.readFileSync(file, 'utf8') : await fs.promises.readFile(file, 'utf8');
    } catch {
      return null; // unreadable file: the engine skips it too
    }
  };
  opts.onProgress?.({ files: 0, total: files.length, hits: 0 });
  for (let start = 0; start < files.length; start += chunkSize) {
    if (opts.cancel?.isCancellationRequested) break; // cancelling takes effect on the next chunk
    const chunk = files.slice(start, start + chunkSize);
    const texts = await Promise.all(chunk.map(read));
    chunk.forEach((file, i) => {
      const text = texts[i];
      if (text === null || text === undefined) return;
      const rel = path.relative(root, file).replace(/\\/g, '/');
      for (const m of scanText(text)) addHit(index, { ...m, file: rel });
      index.files++;
    });
    opts.onProgress?.({ files: index.files, total: files.length, hits: index.hits });
    await yieldTo();
  }
  return sortIndex(index);
}

// ── [PCODE-40 | S08 | v0.1.0] renderIndexMarkdown: byte-for-byte what fingerprint.py write_index() writes ──
export function renderIndexMarkdown(
  index: FingerprintIndex,
  link?: { name?: string; identifier?: string } | null,
): string {
  const lines = [
    '# Fingerprint index',
    '',
    'Generated by `plane_task.py done` — maps every task to the code written for it. ' +
      'Markers: `[TASK | SPRINT | vVERSION]` in comments.',
    '',
  ];
  if (link) {
    lines.push(`Project: ${link.name ?? ''} (\`${link.identifier ?? ''}\`)`, '');
  }
  lines.push('## By sprint and task');
  for (const sprint of [...index.bySprint.keys()].sort(compareFiles)) {
    lines.push('', `### ${sprint}`);
    const tasks = index.bySprint.get(sprint) ?? new Map<string, Hit[]>();
    for (const task of [...tasks.keys()].sort(compareRefs)) {
      const items = tasks.get(task) ?? [];
      // the title is the first one met while walking (byTask), not the first in file order
      const title = index.byTask.get(task)?.title ?? '';
      const versions = [...new Set(items.map((i) => i.version))].sort(compareFiles);
      lines.push(`- **${task}** ${title} _(v${versions.join(', ')})_`);
      for (const i of items) lines.push(`  - \`${i.file}:${String(i.line)}\` ${i.kind}`);
    }
  }
  lines.push('', '## By file');
  for (const file of [...index.byFile.keys()].sort(compareFiles)) {
    const tasks = [...(index.byFile.get(file) ?? [])].sort(compareRefs);
    lines.push(`- \`${file}\` — ${tasks.join(', ')}`);
  }
  return `${lines.join('\n')}\n`;
}
