// ── [PCODE-455 | S15 | v0.1.0] Rename the project folder .plane to .orqiva on Orqiva folders, with a one-time move ──
// ── [PCODE-60 | S12 | v0.1.0] Add the security checklist template and a panel with persistent checkboxes ──
//    Task: https://plan.broszio.com/prodsystem/projects/74f47636-71b0-4eb5-94b5-ea2fe840ec01/issues/
//    Why:  the ticks belong in the repo, not in the editor's storage: a reviewer reads .plane/security.md
//          without VS Code, and a tick survives a new machine. So the file is the state, the panel only
//          toggles one character in it, and everything else in the file is written back untouched.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { projectFile } from '../state/files';

/** in the project's folder (.orqiva, or .plane on a legacy folder) */
export const CHECKLIST_FILE = ['security.md'] as const;
export const TEMPLATE_FILE = ['templates', 'security.md'] as const;

export interface ChecklistItem {
  /** index over the whole file, which is what the panel toggles by */
  index: number;
  /** 0-based line in the file */
  line: number;
  text: string;
  checked: boolean;
  /** the indented lines under the item */
  hint: string;
  /** [PCODE-66 | S13 | v0.1.0] what the last automated run wrote, if anything */
  note: string;
  /** 0-based line of that note, or -1 when the item has none */
  noteLine: number;
}

export interface ChecklistSection {
  title: string;
  items: ChecklistItem[];
}

export interface Checklist {
  sections: ChecklistSection[];
  total: number;
  checked: number;
}

export interface ChecklistIo {
  existsSync: (p: string) => boolean;
  readFileSync: (p: string, enc: 'utf8') => string;
  writeFileSync: (p: string, data: string, enc: 'utf8') => void;
  mkdirSync: (p: string, o: { recursive: true }) => void;
}

const defaultIo: ChecklistIo = {
  existsSync: (p) => fs.existsSync(p),
  readFileSync: (p, enc) => fs.readFileSync(p, enc),
  writeFileSync: (p, d, enc) => {
    fs.writeFileSync(p, d, enc);
  },
  mkdirSync: (p, o) => {
    fs.mkdirSync(p, o);
  },
};

export function checklistPath(root: string): string {
  return projectFile(root, CHECKLIST_FILE);
}

const ITEM = /^(\s*)- \[( |x|X)\] (.*)$/;
const HEADING = /^##\s+(.*)$/;
// ── [PCODE-66 | S13 | v0.1.0] the line an audit writes under its item ──
//    It sits where a hint sits, so it is recognised by its opening words and kept out of the hint:
//    otherwise every run would append to the sentence the template wrote.
export const NOTE_PREFIX = 'Last run ';
const NOTE = /^(\s+)_?Last run .*$/;

// ── [PCODE-60 | S12 | v0.1.0] parseChecklist: sections, items and the hint lines under them ──
export function parseChecklist(text: string): Checklist {
  const lines = text.split(/\r?\n/);
  const sections: ChecklistSection[] = [];
  let current: ChecklistSection | null = null;
  let index = 0;
  lines.forEach((line, i) => {
    const heading = HEADING.exec(line);
    if (heading) {
      current = { title: (heading[1] ?? '').trim(), items: [] };
      sections.push(current);
      return;
    }
    const item = ITEM.exec(line);
    if (!item) return;
    const hint: string[] = [];
    let note = '';
    let noteLineNo = -1;
    for (let j = i + 1; j < lines.length; j++) {
      const next = lines[j] ?? '';
      if (!/^\s+\S/.test(next) || ITEM.test(next)) break;
      if (NOTE.test(next)) {
        // [PCODE-66 | S13 | v0.1.0] a run's own line, replaced next time rather than appended to
        note = next.trim().replace(/^_|_$/g, '');
        noteLineNo = j;
        continue;
      }
      hint.push(next.trim().replace(/^_|_$/g, ''));
    }
    const entry: ChecklistItem = {
      index: index++,
      line: i,
      text: (item[3] ?? '').trim(),
      checked: (item[2] ?? ' ').toLowerCase() === 'x',
      hint: hint.join(' ').trim(),
      note,
      noteLine: noteLineNo,
    };
    if (!current) {
      current = { title: 'Checklist', items: [] };
      sections.push(current);
    }
    current.items.push(entry);
  });
  const all = sections.flatMap((s) => s.items);
  return { sections, total: all.length, checked: all.filter((i) => i.checked).length };
}

// ── [PCODE-60 | S12 | v0.1.0] toggleItem: one character changes; every other byte stays as it was ──
export function toggleItem(text: string, index: number, checked: boolean): string {
  const list = parseChecklist(text);
  const item = list.sections.flatMap((s) => s.items).find((i) => i.index === index);
  if (!item) return text;
  const lines = text.split(/\r?\n/);
  const line = lines[item.line] ?? '';
  lines[item.line] = line.replace(
    ITEM,
    (_m, indent: string, _mark: string, rest: string) =>
      `${indent}- [${checked ? 'x' : ' '}] ${rest}`,
  );
  // the file's own line ending is kept
  return lines.join(text.includes('\r\n') ? '\r\n' : '\n');
}

// ── [PCODE-66 | S13 | v0.1.0] setNote: the run's line under its item, replacing the previous one ──
//    Nothing is ticked: a green run today is evidence for the person deciding, not the decision.
export function setNote(text: string, index: number, note: string): string {
  const list = parseChecklist(text);
  const item = list.sections.flatMap((s) => s.items).find((i) => i.index === index);
  if (!item) return text;
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const indent = /^(\s*)/.exec(lines[item.line] ?? '')?.[1] ?? '';
  const written = `${indent}      _${note}_`;
  if (item.noteLine >= 0) lines[item.noteLine] = written;
  else lines.splice(item.line + 1, 0, written);
  return lines.join(eol);
}

/** The first item whose text matches, so a check can find its own line without a hard-coded index. */
export function findItem(list: Checklist, pattern: RegExp): ChecklistItem | null {
  return list.sections.flatMap((s) => s.items).find((i) => pattern.test(i.text)) ?? null;
}

export function progressLine(list: Checklist): string {
  return `${String(list.checked)} of ${String(list.total)} checked`;
}

export function shortProgress(list: Checklist): string {
  return `${String(list.checked)}/${String(list.total)}`;
}

export interface EnsureDeps {
  root: string;
  /** where the extension keeps templates/security.md */
  extensionPath: string;
  io?: ChecklistIo;
}

// ── [PCODE-60 | S12 | v0.1.0] ensureChecklist: the template is copied once, never over an existing file ──
export function ensureChecklist(deps: EnsureDeps): { created: boolean; text: string } {
  const io = deps.io ?? defaultIo;
  const file = checklistPath(deps.root);
  if (io.existsSync(file)) return { created: false, text: io.readFileSync(file, 'utf8') };
  const template = path.join(deps.extensionPath, ...TEMPLATE_FILE);
  const text = io.existsSync(template)
    ? io.readFileSync(template, 'utf8')
    : '# Security checklist\n\n## Checklist\n\n- [ ] Write the checklist for this project.\n';
  const dir = path.dirname(file);
  if (!io.existsSync(dir)) io.mkdirSync(dir, { recursive: true });
  io.writeFileSync(file, text, 'utf8');
  return { created: true, text };
}

export function readChecklist(root: string, io: ChecklistIo = defaultIo): Checklist | null {
  const file = checklistPath(root);
  if (!io.existsSync(file)) return null;
  return parseChecklist(io.readFileSync(file, 'utf8'));
}

export function writeToggle(
  root: string,
  index: number,
  checked: boolean,
  io: ChecklistIo = defaultIo,
): Checklist | null {
  const file = checklistPath(root);
  if (!io.existsSync(file)) return null;
  const text = io.readFileSync(file, 'utf8');
  const next = toggleItem(text, index, checked);
  if (next !== text) io.writeFileSync(file, next, 'utf8');
  return parseChecklist(next);
}

// ── [PCODE-66 | S13 | v0.1.0] writeNote: find the item by its wording, write the dated line ──
//    Matching on the wording rather than an index means an edited checklist - a reordered item, an added
//    section - still gets its note in the right place, and a rewritten item simply stops receiving one.
export function writeNote(
  root: string,
  pattern: RegExp,
  note: string,
  io: ChecklistIo = defaultIo,
): Checklist | null {
  const file = checklistPath(root);
  if (!io.existsSync(file)) return null;
  const text = io.readFileSync(file, 'utf8');
  const item = findItem(parseChecklist(text), pattern);
  if (!item) return parseChecklist(text);
  const next = setNote(text, item.index, note);
  if (next !== text) io.writeFileSync(file, next, 'utf8');
  return parseChecklist(next);
}
