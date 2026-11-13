// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-43 | S08 | v0.1.0] Post the documentation link as a Plane comment on each task via plane note ──
//    Task: https://plan.broszio.com/prodsystem/projects/74f47636-71b0-4eb5-94b5-ea2fe840ec01/issues/
//    Why:  a task's page is only worth a comment when it actually changed, so every run records each page's
//          hash in <out>/.index.json and the next run compares. The notes go through the engine (`plane note`),
//          never through the client (criticals #2), one per second, and a flood asks first.
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { EngineCommands } from '../engine/commands';
import type { GeneratedPage } from './generate';

export const INDEX_FILE = '.index.json';
/** more than this many notes in one run is unusual (a first run, a version bump): ask first */
export const CONFIRM_ABOVE = 20;
export const NOTE_INTERVAL_MS = 1000;

export interface DocsIndexFile {
  version: string;
  generatedAt: string;
  /** page path (relative to the output folder) -> content hash */
  pages: Record<string, string>;
}

export interface ChangedPage {
  ref: string;
  rel: string;
  hash: string;
}

export interface NotesIo {
  existsSync: (p: string) => boolean;
  readFileSync: (p: string, enc: 'utf8') => string;
  writeFileSync: (p: string, data: string, enc: 'utf8') => void;
  mkdirSync: (p: string, o: { recursive: true }) => void;
}

const defaultIo: NotesIo = {
  existsSync: (p) => fs.existsSync(p),
  readFileSync: (p, enc) => fs.readFileSync(p, enc),
  writeFileSync: (p, d, enc) => {
    fs.writeFileSync(p, d, enc);
  },
  mkdirSync: (p, o) => {
    fs.mkdirSync(p, o);
  },
};

export function hashPage(text: string): string {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16);
}

// ── [PCODE-43 | S08 | v0.1.0] the record of the last run ──
export function readDocsIndex(outDir: string, io: NotesIo = defaultIo): DocsIndexFile {
  const file = path.join(outDir, INDEX_FILE);
  if (!io.existsSync(file)) return { version: '', generatedAt: '', pages: {} };
  try {
    const parsed = JSON.parse(io.readFileSync(file, 'utf8')) as Record<string, unknown>;
    const pages = parsed['pages'];
    return {
      version: typeof parsed['version'] === 'string' ? parsed['version'] : '',
      generatedAt: typeof parsed['generatedAt'] === 'string' ? parsed['generatedAt'] : '',
      pages: typeof pages === 'object' && pages !== null ? (pages as Record<string, string>) : {},
    };
  } catch {
    return { version: '', generatedAt: '', pages: {} };
  }
}

export function writeDocsIndex(
  outDir: string,
  pages: readonly GeneratedPage[],
  meta: { version: string; generatedAt: string },
  io: NotesIo = defaultIo,
): DocsIndexFile {
  const data: DocsIndexFile = { ...meta, pages: {} };
  for (const p of [...pages].sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0)))
    data.pages[p.rel] = hashPage(p.text);
  if (!io.existsSync(outDir)) io.mkdirSync(outDir, { recursive: true });
  io.writeFileSync(path.join(outDir, INDEX_FILE), `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  return data;
}

// ── [PCODE-43 | S08 | v0.1.0] changedTaskPages: task pages whose content differs from the recorded hash ──
export function changedTaskPages(
  pages: readonly GeneratedPage[],
  previous: DocsIndexFile,
): ChangedPage[] {
  const out: ChangedPage[] = [];
  for (const page of pages) {
    if (!page.task) continue;
    const hash = hashPage(page.text);
    if (previous.pages[page.rel] === hash) continue;
    out.push({ ref: page.task, rel: page.rel, hash });
  }
  return out.sort((a, b) => (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0));
}

export function noteText(outFolder: string, rel: string, version: string, date: string): string {
  return `Docs — ${outFolder}/${rel} (v${version}, ${date})`;
}

export interface PostNotesDeps {
  engine: Pick<EngineCommands, 'note'>;
  outFolder: string;
  version: string;
  date: string;
  /** false: the setting orqiva.docs.postToPlane is off */
  enabled?: boolean;
  confirm?: (count: number) => Promise<boolean>;
  /** injected for tests; the real one waits NOTE_INTERVAL_MS between notes */
  wait?: (ms: number) => Promise<void>;
  log?: (line: string) => void;
}

export interface PostNotesResult {
  posted: string[];
  failed: string[];
  skipped: 'disabled' | 'declined' | null;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// ── [PCODE-43 | S08 | v0.1.0] postNotes: one `plane note` per changed page, a second apart, failures survive ──
export async function postNotes(
  changes: readonly ChangedPage[],
  deps: PostNotesDeps,
): Promise<PostNotesResult> {
  const result: PostNotesResult = { posted: [], failed: [], skipped: null };
  if (deps.enabled === false) return { ...result, skipped: 'disabled' };
  if (!changes.length) return result;
  if (changes.length > CONFIRM_ABOVE && deps.confirm && !(await deps.confirm(changes.length)))
    return { ...result, skipped: 'declined' };
  const wait = deps.wait ?? sleep;
  for (const [i, change] of changes.entries()) {
    if (i > 0) await wait(NOTE_INTERVAL_MS);
    try {
      await deps.engine.note(
        change.ref,
        noteText(deps.outFolder, change.rel, deps.version, deps.date),
      );
      result.posted.push(change.ref);
    } catch (e) {
      result.failed.push(change.ref);
      deps.log?.(
        `documentation note for ${change.ref} failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
  return result;
}
