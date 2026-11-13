// ── [PCODE-41 | S08 | v0.1.0] Generate docs/generated markdown per sprint and task from the fingerprint index ──
//    Task: https://plan.broszio.com/prodsystem/projects/74f47636-71b0-4eb5-94b5-ea2fe840ec01/issues/
//    Why:  one pure model between "what the scan and the board know" and "what the pages print". Everything
//          is sorted here, so two runs over unchanged code produce byte-identical pages, and a task that
//          Plane cannot answer for (offline) still gets its page from the fingerprints alone.
import type { Sprint } from '../state/board';
import { compareFiles, compareRefs, type FingerprintIndex, type Hit } from './scan';

export interface DocComment {
  date: string;
  kind: 'Start' | 'Commit' | 'Review' | 'Test' | 'Blocked' | 'Done' | 'Note';
  text: string;
  who?: string;
}

/** what Plane adds to a task; absent when the board was read from sprints.md */
export interface TaskDetail {
  description?: string;
  acceptance?: { text: string; done: boolean }[];
  comments?: DocComment[];
  url?: string;
}

export interface DocFile {
  file: string;
  /** lines of this task's markers in that file, ascending */
  lines: number[];
  header: boolean;
}

export interface DocTask {
  ref: string;
  title: string;
  state: string;
  priority: string;
  labels: string[];
  sprints: string[];
  versions: string[];
  files: DocFile[];
  detail: TaskDetail;
  /** no Plane data for this task */
  offline: boolean;
}

export interface DocSprint {
  code: string;
  name: string;
  date: string;
  goal: string;
  done: number;
  total: number;
  /** task refs, numerically sorted */
  tasks: string[];
}

export interface DocsModel {
  project: { name: string; identifier: string; version: string };
  /** where the pages are written, relative to the project root - the source links depend on it */
  outFolder: string;
  generatedAt: string;
  sprints: DocSprint[];
  tasks: DocTask[];
  files: number;
  hits: number;
}

// ── [PCODE-41 | S08 | v0.1.0] commentKind: the engine's own comments, recognised by their first words ──
export function commentKind(text: string): DocComment['kind'] {
  const t = text.trim();
  if (/^started\b/i.test(t)) return 'Start';
  if (/\bcommit\b/i.test(t)) return 'Commit';
  if (/->\s*done\b|^done\b/i.test(t)) return 'Done';
  if (/->\s*review\b/i.test(t)) return 'Review';
  if (/->\s*test\b|tests green/i.test(t)) return 'Test';
  if (/->\s*blocked\b|blocked\b/i.test(t)) return 'Blocked';
  return 'Note';
}

function filesOf(hits: readonly Hit[]): DocFile[] {
  const byFile = new Map<string, DocFile>();
  for (const h of hits) {
    const entry = byFile.get(h.file) ?? { file: h.file, lines: [], header: false };
    byFile.set(h.file, entry);
    entry.lines.push(h.line);
    if (h.kind === 'header') entry.header = true;
  }
  for (const f of byFile.values()) f.lines.sort((a, b) => a - b);
  return [...byFile.values()].sort((a, b) => compareFiles(a.file, b.file));
}

export interface ModelInput {
  index: FingerprintIndex;
  /** the board: from Plane when online, else from sprints.md */
  board: readonly Sprint[];
  project: { name: string; identifier: string; version: string };
  /** Plane details per task ref; missing entries mark the task offline */
  details?: Map<string, TaskDetail>;
  /** YYYY-MM-DD; a date, not a timestamp, so an unchanged day regenerates identical pages */
  generatedAt: string;
  /** posix, relative to the project root; default docs/generated */
  outFolder?: string;
}

// ── [PCODE-41 | S08 | v0.1.0] buildModel: index + board + Plane details -> the pages' data, fully sorted ──
export function buildModel(input: ModelInput): DocsModel {
  const { index, board, details } = input;
  const boardItem = new Map<string, { sprint: Sprint; item: Sprint['items'][number] }>();
  for (const s of board) for (const item of s.items) boardItem.set(item.ref, { sprint: s, item });

  const refs = new Set<string>([...index.byTask.keys()]);
  const tasks: DocTask[] = [...refs].sort(compareRefs).map((ref) => {
    const entry = index.byTask.get(ref);
    const known = boardItem.get(ref);
    const detail = details?.get(ref);
    const sprints = [...new Set([...(entry?.sprints ?? []), ...(known ? [known.sprint.code] : [])])]
      .filter(Boolean)
      .sort(compareFiles);
    return {
      ref,
      title: known?.item.title ?? entry?.title ?? ref,
      state: known?.item.state.name ?? 'unknown',
      priority: known?.item.priority ?? 'none',
      labels: known?.item.labels ?? [],
      sprints,
      versions: entry?.versions ?? [],
      files: filesOf(entry?.hits ?? []),
      detail: detail ?? (known?.item.url ? { url: known.item.url } : {}),
      offline: !detail,
    };
  });
  const byRef = new Map(tasks.map((t) => [t.ref, t]));

  // sprints: every code the board or the index knows, with the board's numbers when it has them
  const codes = new Set<string>([...index.bySprint.keys(), ...board.map((s) => s.code)]);
  const sprints: DocSprint[] = [...codes].sort(compareFiles).map((code) => {
    const s = board.find((b) => b.code === code);
    const fromIndex = [...(index.bySprint.get(code)?.keys() ?? [])];
    const fromBoard = s?.items.map((i) => i.ref) ?? [];
    const all = [...new Set([...fromBoard, ...fromIndex])].sort(compareRefs);
    return {
      code,
      name: s?.name ?? code,
      date: s?.date ?? '',
      goal: s?.goal ?? '',
      done:
        s?.items.filter((i) => i.done).length ??
        all.filter((r) => byRef.get(r)?.state === 'Done').length,
      total: s?.items.length ?? all.length,
      tasks: all,
    };
  });

  return {
    project: input.project,
    outFolder: input.outFolder ?? 'docs/generated',
    generatedAt: input.generatedAt,
    sprints,
    tasks,
    files: index.files,
    hits: index.hits,
  };
}
