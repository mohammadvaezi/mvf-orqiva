// ── [PCODE-281 | S15 | v0.1.0] T29.3 Document embeds: live task lists, designs, Gantt, repo code; README import ──
//    Why:  a page can show live parts of the project: a list of tasks by a query, a design, the plan as a
//          timeline, lines of repository code. An embed is a fenced block of kind embed with one line, so
//          it stays plain Markdown that versions, diffs and agents read. The same reading is used by the
//          web app (to draw it), the server (to know which files a scan should send) and exports.

export type Embed =
  | { kind: 'tasks'; query: TaskQuery }
  | { kind: 'design'; ref: string }
  | { kind: 'gantt'; sprint: string }
  | { kind: 'code'; path: string; from: number | null; to: number | null };

export interface TaskQuery {
  state: string | null;
  kind: string | null;
  assignee: string | null;
  label: string | null;
  sprint: string | null;
  q: string;
  limit: number;
}

export class EmbedError extends Error {}

/** The words of a query: key:value pairs (values may be quoted), the rest is free text. */
export function readTaskQuery(src: string): TaskQuery {
  const out: TaskQuery = {
    state: null,
    kind: null,
    assignee: null,
    label: null,
    sprint: null,
    q: '',
    limit: 20,
  };
  const free: string[] = [];
  for (const m of src.matchAll(/(\w+):(?:"([^"]*)"|(\S+))|"([^"]*)"|(\S+)/g)) {
    const key = (m[1] ?? '').toLowerCase();
    const value = (m[2] ?? m[3] ?? '').trim();
    if (
      key === 'state' ||
      key === 'kind' ||
      key === 'assignee' ||
      key === 'label' ||
      key === 'sprint'
    )
      out[key] = value;
    else if (key === 'q') free.push(value);
    else if (key === 'limit') {
      const n = Number(value);
      if (Number.isInteger(n) && n > 0) out.limit = Math.min(n, 100);
    } else free.push(m[4] ?? m[5] ?? m[0]);
  }
  out.q = free.join(' ').trim();
  return out;
}

/** One embed from the text of its block. */
export function readEmbed(text: string): Embed {
  const line = text.trim().split('\n')[0]?.trim() ?? '';
  const m = /^(\w+)\s*(?::\s*(.*))?$/.exec(line);
  const kind = (m?.[1] ?? '').toLowerCase();
  const arg = (m?.[2] ?? '').trim();
  if (kind === 'tasks') return { kind: 'tasks', query: readTaskQuery(arg) };
  if (kind === 'design') {
    if (!arg) throw new EmbedError('Name the design: design: <title or id>');
    return { kind: 'design', ref: arg };
  }
  if (kind === 'gantt' || kind === 'plan') return { kind: 'gantt', sprint: arg };
  if (kind === 'code') {
    const c = /^([^#\s]+)(?:#L(\d+)(?:-L?(\d+))?)?$/.exec(arg);
    if (!c) throw new EmbedError('Name the file: code: src/file.ts#L10-L40');
    const from = c[2] ? Number(c[2]) : null;
    const to = c[3] ? Number(c[3]) : from;
    return {
      kind: 'code',
      path: (c[1] ?? '').replace(/^\.?\//, ''),
      from,
      to: to !== null && from !== null && to < from ? from : to,
    };
  }
  throw new EmbedError(
    (kind || 'This') + ' is not something a page embeds; use tasks, design, gantt or code',
  );
}

/** Every embed of a page, in order; ones that cannot be read are left out. */
export function embedsIn(md: string): Embed[] {
  const out: Embed[] = [];
  for (const m of md.matchAll(/^```\s*embed\s*\n([\s\S]*?)\n```/gm))
    try {
      out.push(readEmbed(m[1] ?? ''));
    } catch {
      // drawn as an error where it stands
    }
  return out;
}

/** The repository files the pages' code embeds name. */
export const codePathsIn = (bodies: readonly string[]): string[] => [
  ...new Set(
    bodies.flatMap((b) => embedsIn(b).flatMap((e) => (e.kind === 'code' ? [e.path] : []))),
  ),
];

/** A README a scan sends and the docs turn into pages. */
export const isReadme = (path: string): boolean => /(^|\/)readme(\.md|\.markdown)?$/i.test(path);

/** Whether a task matches a query (the server has already narrowed by project). */
export function matchesQuery(
  t: {
    title: string;
    ref: string;
    state: string;
    stateGroup: string;
    kind: string;
    assignee: string | null;
    assigneeId: string | null;
    labels: readonly string[];
    sprintCurrent: boolean;
  },
  q: TaskQuery,
  meId: string,
): boolean {
  const eq = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();
  if (q.state) {
    const done = t.stateGroup === 'completed' || t.stateGroup === 'cancelled';
    if (eq(q.state, 'open') ? done : eq(q.state, 'done') ? !done : !eq(t.state, q.state))
      return false;
  }
  if (q.kind && !eq(t.kind, q.kind)) return false;
  if (q.assignee) {
    if (
      eq(q.assignee, 'me')
        ? t.assigneeId !== meId
        : eq(q.assignee, 'none')
          ? t.assigneeId !== null
          : !(t.assignee ?? '').toLowerCase().includes(q.assignee.toLowerCase())
    )
      return false;
  }
  if (q.label && !t.labels.some((l) => eq(l, q.label ?? ''))) return false;
  if (q.sprint && eq(q.sprint, 'current') && !t.sprintCurrent) return false;
  if (q.q && !(t.title + ' ' + t.ref).toLowerCase().includes(q.q.toLowerCase())) return false;
  return true;
}
