// ── [PCODE-41 | S08 | v0.1.0] Generate docs/generated markdown per sprint and task from the fingerprint index ──
// ── [PCODE-43 | S08 | v0.1.0] Post the documentation link as a Plane comment on each task via plane note ──
//    Task: https://plan.broszio.com/prodsystem/projects/74f47636-71b0-4eb5-94b5-ea2fe840ec01/issues/
//    Why:  turns the model into files. Pages are rendered first and written afterwards, so a cancelled or
//          failing run leaves the previous documentation untouched; pages that did not change are not
//          rewritten, which keeps `git status` quiet and tells PCODE-43 which tasks to notify.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { buildModel, type DocsModel, type ModelInput } from './model';
import {
  README_FILE,
  renderReadme,
  renderSprint,
  renderTask,
  sprintFile,
  taskFile,
} from './templates';

export interface GeneratedPage {
  /** posix path relative to the output folder */
  rel: string;
  text: string;
  /** the task this page documents, for the Plane notes of PCODE-43 */
  task?: string;
}

export interface GenerateResult {
  model: DocsModel;
  pages: GeneratedPage[];
  written: string[];
  unchanged: string[];
  removed: string[];
  outDir: string;
  /** [PCODE-43 | S08 | v0.1.0] filled by the command after the pages are written */
  notes?: { posted: string[]; failed: string[]; skipped: 'disabled' | 'declined' | null };
}

export interface WriteIo {
  existsSync: (p: string) => boolean;
  readFileSync: (p: string, enc: 'utf8') => string;
  writeFileSync: (p: string, data: string, enc: 'utf8') => void;
  mkdirSync: (p: string, o: { recursive: true }) => void;
  readdirSync: (p: string) => string[];
  rmSync: (p: string, o: { force: true }) => void;
}

const defaultIo: WriteIo = {
  existsSync: (p) => fs.existsSync(p),
  readFileSync: (p, enc) => fs.readFileSync(p, enc),
  writeFileSync: (p, d, enc) => {
    fs.writeFileSync(p, d, enc);
  },
  mkdirSync: (p, o) => {
    fs.mkdirSync(p, o);
  },
  readdirSync: (p) => fs.readdirSync(p),
  rmSync: (p, o) => {
    fs.rmSync(p, o);
  },
};

// ── [PCODE-41 | S08 | v0.1.0] renderPages: every page of a model, in a stable order ──
export function renderPages(model: DocsModel): GeneratedPage[] {
  const pages: GeneratedPage[] = [{ rel: README_FILE, text: renderReadme(model) }];
  for (const s of model.sprints)
    pages.push({ rel: sprintFile(s.code), text: renderSprint(model, s) });
  for (const t of model.tasks)
    pages.push({ rel: taskFile(t.ref), text: renderTask(model, t), task: t.ref });
  return pages;
}

/** pages of earlier runs that this model no longer produces (a task that lost its last marker) */
export function stalePages(outDir: string, pages: readonly GeneratedPage[], io: WriteIo): string[] {
  const keep = new Set(pages.map((p) => p.rel));
  const out: string[] = [];
  for (const folder of ['sprints', 'tasks']) {
    const dir = path.join(outDir, folder);
    if (!io.existsSync(dir)) continue;
    for (const name of io.readdirSync(dir)) {
      const rel = `${folder}/${name}`;
      if (name.endsWith('.md') && !keep.has(rel)) out.push(rel);
    }
  }
  return out.sort();
}

export interface GenerateOptions {
  outDir: string;
  /** the output folder as written in the pages, e.g. docs/generated */
  outFolder: string;
  io?: WriteIo;
  /** false: render only, write nothing (the dry run of the cancel path) */
  write?: boolean;
}

// ── [PCODE-41 | S08 | v0.1.0] generateDocs: model -> pages -> disk; unchanged pages are left alone ──
export function generateDocs(input: ModelInput, opts: GenerateOptions): GenerateResult {
  const io = opts.io ?? defaultIo;
  const model = buildModel({ ...input, outFolder: opts.outFolder });
  const pages = renderPages(model);
  const result: GenerateResult = {
    model,
    pages,
    written: [],
    unchanged: [],
    removed: [],
    outDir: opts.outDir,
  };
  if (opts.write === false) return result;
  for (const page of pages) {
    const file = path.join(opts.outDir, ...page.rel.split('/'));
    const dir = path.dirname(file);
    if (!io.existsSync(dir)) io.mkdirSync(dir, { recursive: true });
    const before = io.existsSync(file) ? io.readFileSync(file, 'utf8') : null;
    if (before === page.text) {
      result.unchanged.push(page.rel);
      continue;
    }
    io.writeFileSync(file, page.text, 'utf8');
    result.written.push(page.rel);
  }
  for (const rel of stalePages(opts.outDir, pages, io)) {
    io.rmSync(path.join(opts.outDir, ...rel.split('/')), { force: true });
    result.removed.push(rel);
  }
  return result;
}
