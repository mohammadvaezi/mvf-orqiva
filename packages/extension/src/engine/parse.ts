// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-9 | S02 | v0.1.0] Add typed engine commands and output parsers for list, show, active, start, done ──
//    Task: https://plan.broszio.com/prodsystem/projects/74f47636-71b0-4eb5-94b5-ea2fe840ec01/issues/
//    Why:  the engine talks in plain text meant for Claude; these parsers turn the captured shapes in
//          test/fixtures/engine-output/ into typed objects and reject anything else with a clear error.
import { OrqivaError } from '../util/errors';
import type { ActiveTask } from '../state/types';
import { isActiveTask } from '../state/files';

export interface ListItem {
  ref: string;
  state: string;
  priority: string;
  title: string;
}
export interface ListSprint {
  name: string;
  date: string;
  items: ListItem[];
}
export interface ListResult {
  sprints: ListSprint[];
  active: { ref: string; title: string } | null;
}

export interface ShowResult {
  ref: string;
  title: string;
  state: string;
  priority: string;
  url: string;
  description: string;
  acceptance: { text: string; done: boolean }[];
  comments: { date: string; text: string }[];
  files: { file: string; line: number; kind: string }[];
}

export interface StartResult {
  ref: string;
  title: string;
  from: string;
  to: string;
  fingerprint: string;
}

export interface DoneResult {
  ref: string;
  state: string;
  files: number;
  commit: string | null;
}

export interface CheckResult {
  sprints: number;
  items: number;
  from: string;
  to: string;
  version: string;
  publishedAt: string | null;
  errors: string[];
}

export interface NewResult {
  ref: string;
  title: string;
  sprint: string;
  url: string;
}

export interface SyncResult {
  carried: number;
  promoted: number;
  active: { ref: string; title: string } | null;
}

export interface StatusResult {
  ref: string;
  state: string;
}

const REF = '[A-Z]{2,5}-\\d+';

function fail(what: string, text: string): never {
  throw new OrqivaError(
    `Could not read the engine's ${what} output.`,
    'engine',
    text.slice(0, 500),
  );
}

// ── [PCODE-9 | S02 | v0.1.0] parseActiveLine: "Active: REF Title" | "Active: none - ..." ──
function parseActiveLine(line: string): { ref: string; title: string } | null {
  const m = new RegExp(`^Active(?: task)?:\\s+(${REF})\\s+(.*?)(?:\\s{2}\\[.*)?$`).exec(
    line.trim(),
  );
  return m?.[1] && m[2] !== undefined ? { ref: m[1], title: m[2].trim() } : null;
}

// ── [PCODE-9 | S02 | v0.1.0] parseList: "## Sprint (date)" sections with "- REF [State] (prio) Title" ──
export function parseList(text: string): ListResult {
  const sprints: ListSprint[] = [];
  let active: ListResult['active'] = null;
  let current: ListSprint | null = null;
  const item = new RegExp(`^-\\s+(${REF})\\s+\\[([^\\]]+)\\]\\s+\\(([^)]*)\\)\\s+(.*)$`);
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd();
    const head = /^##\s+(.*?)(?:\s+\((\d{4}-\d{2}-\d{2})\))?\s*$/.exec(line);
    if (head?.[1]) {
      current = { name: head[1], date: head[2] ?? '', items: [] };
      sprints.push(current);
      continue;
    }
    const m = item.exec(line);
    if (m?.[1] && m[2] && m[4] !== undefined) {
      if (!current) fail('list', text);
      current.items.push({ ref: m[1], state: m[2], priority: m[3] ?? '-', title: m[4] });
      continue;
    }
    if (line.startsWith('Active:')) active = parseActiveLine(line);
  }
  if (!sprints.length && !/^Active:/m.test(text)) fail('list', text);
  return { sprints, active };
}

// ── [PCODE-9 | S02 | v0.1.0] parseShow: title line, state line, description, acceptance, comments, files ──
export function parseShow(text: string): ShowResult {
  const lines = text.split(/\r?\n/);
  const title = new RegExp(`^#\\s+(${REF})\\s+(.*)$`).exec(lines[0] ?? '');
  const state = /^State:\s*([^|]+?)\s*\|\s*Priority:\s*([^|]+?)\s*\|\s*(\S+)\s*$/.exec(
    lines[1] ?? '',
  );
  if (!title?.[1] || !state?.[1]) fail('show', text);
  const result: ShowResult = {
    ref: title[1],
    title: title[2] ?? '',
    state: state[1],
    priority: state[2] ?? '-',
    url: state[3] ?? '',
    description: '',
    acceptance: [],
    comments: [],
    files: [],
  };
  let section: 'description' | 'acceptance' | 'comments' | 'files' | 'other' = 'description';
  const desc: string[] = [];
  for (const line of lines.slice(2)) {
    if (/^## Comments/.test(line)) {
      section = 'comments';
      continue;
    }
    if (/^## Code fingerprinted/.test(line)) {
      section = 'files';
      continue;
    }
    if (/^Acceptance\s*$/.test(line)) {
      section = 'acceptance';
      continue;
    }
    if (/^Files \(hint\)\s*$/.test(line)) {
      section = 'other';
      continue;
    }
    if (section === 'description') desc.push(line);
    else if (section === 'acceptance') {
      const m = /^-\s+([☐☑☒]|\[( |x)\])\s+(.*)$/.exec(line);
      if (m?.[3]) result.acceptance.push({ text: m[3], done: m[1] === '☑' || m[2] === 'x' });
    } else if (section === 'comments') {
      const m = /^-\s+(\d{4}-\d{2}-\d{2}):\s*(.*)$/.exec(line);
      if (m?.[1]) result.comments.push({ date: m[1], text: m[2] ?? '' });
    } else if (section === 'files') {
      const m = /^-\s+(.+?):(\d+)\s+\((\w+)\)\s*$/.exec(line);
      if (m?.[1] && m[2]) result.files.push({ file: m[1], line: Number(m[2]), kind: m[3] ?? '' });
    }
  }
  result.description = desc
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return result;
}

// ── [PCODE-9 | S02 | v0.1.0] parseStart: "Active: REF Title  [From -> To]" + the fingerprint line ──
export function parseStart(text: string): StartResult {
  const active = new RegExp(
    `^Active:\\s+(${REF})\\s+(.*?)\\s{2}\\[(.+?)\\s+->\\s+(.+?)\\]\\s*$`,
    'm',
  ).exec(text);
  const fp = /^Fingerprint[^:]*:\s*(\[.*?\]\s*.*)$/m.exec(text);
  if (!active?.[1] || !fp?.[1]) fail('start', text);
  return {
    ref: active[1],
    title: active[2] ?? '',
    from: active[3] ?? '',
    to: active[4] ?? '',
    fingerprint: fp[1].trim(),
  };
}

// ── [PCODE-9 | S02 | v0.1.0] parseDone: "REF -> State. N file(s)[, commit abc]. Index: ..." ──
export function parseDone(text: string): DoneResult {
  const m = new RegExp(
    `^(${REF})\\s+->\\s+([^.]+)\\.\\s+(\\d+) file\\(s\\)(?:,\\s+commit\\s+([0-9a-f]+))?`,
    'm',
  ).exec(text);
  if (!m?.[1] || !m[2]) fail('done', text);
  return { ref: m[1], state: m[2].trim(), files: Number(m[3]), commit: m[4] ?? null };
}

// ── [PCODE-9 | S02 | v0.1.0] parseCheck: summary line + "- error" lines ──
export function parseCheck(text: string): CheckResult {
  const m =
    /^(\d+) sprint\(s\), (\d+) item\(s\), (\S+) to (\S+), version (\S+?); (published (\S+)|not yet published)/m.exec(
      text,
    );
  if (!m?.[1]) fail('plan check', text);
  const errors = text
    .split(/\r?\n/)
    .filter((l) => l.startsWith('- '))
    .map((l) => l.slice(2).trim());
  return {
    sprints: Number(m[1]),
    items: Number(m[2]),
    from: m[3] ?? '',
    to: m[4] ?? '',
    version: m[5] ?? '',
    publishedAt: m[7] ?? null,
    errors,
  };
}

// ── [PCODE-9 | S02 | v0.1.0] parseNew: "Created REF Title in Sprint -> url" ──
export function parseNew(text: string): NewResult {
  const m = new RegExp(`^Created\\s+(${REF})\\s+(.*?)\\s+in\\s+(.*?)\\s+->\\s+(\\S+)`, 'm').exec(
    text,
  );
  if (!m?.[1]) fail('new', text);
  return { ref: m[1], title: m[2] ?? '', sprint: m[3] ?? '', url: m[4] ?? '' };
}

// ── [PCODE-9 | S02 | v0.1.0] parseSync / parseStatus / parseActive ──
export function parseSync(text: string): SyncResult {
  const m = /^Synced\.\s+(\d+) carried over(?:,\s+(\d+) moved to \w+)?\.\s*(.*)$/m.exec(text);
  if (!m?.[1]) fail('sync', text);
  return {
    carried: Number(m[1]),
    promoted: Number(m[2] ?? 0),
    active: parseActiveLine(m[3] ?? ''),
  };
}

export function parseStatus(text: string): StatusResult {
  const m = new RegExp(`^(${REF})\\s+->\\s+([^.]+)\\.`, 'm').exec(text);
  if (!m?.[1] || !m[2]) fail('status', text);
  return { ref: m[1], state: m[2].trim() };
}

export function parseActive(text: string): ActiveTask | null {
  const t = text.trim();
  if (t === 'null' || t === '') return null;
  let v: unknown;
  try {
    v = JSON.parse(t);
  } catch {
    fail('active', text);
  }
  if (!isActiveTask(v)) fail('active', text);
  return v;
}
