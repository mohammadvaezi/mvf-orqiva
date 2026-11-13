// ── [PCODE-304 | S15 | v0.1.0] T31.5a Conflicts, stacked pull requests, and merge policies the host enforces through a commit status ──
// ── [PCODE-303 | S15 | v0.1.0] T31.4 Line comments from people and the AI, posted to the host with approve or request changes ──
// ── [PCODE-302 | S15 | v0.1.0] T31.3 PR review queue (riskiest first) and side-by-side diff with fingerprints and viewed files ──
//    Why:  a reviewer opens the riskiest pull request first and reads it file by file. The risk is told in
//          words (how big, failing checks, changes asked for, no task, sensitive paths, how old), never as
//          a bare number. A file's change arrives as a unified patch (GitHub, GitLab), as one diff of the
//          whole pull request (Gitea) or as two versions (Azure, diffed here); each becomes the same hunks,
//          shown side by side, with the fingerprints its new lines carry.
import { extOf, isCode, MARKER } from './fingerprint.js';
import { commonRun } from './merge3.js';

export interface PatchLine {
  kind: 'context' | 'add' | 'del';
  /** line number in the old file, or null for an added line */
  old: number | null;
  /** line number in the new file, or null for a removed line */
  new: number | null;
  text: string;
}

export interface Hunk {
  header: string;
  oldStart: number;
  newStart: number;
  lines: PatchLine[];
}

export type FileStatus = 'added' | 'modified' | 'deleted' | 'renamed';

export interface FileDiff {
  path: string;
  /** the earlier path of a renamed file */
  oldPath: string | null;
  status: FileStatus;
  additions: number;
  deletions: number;
  /** the hunks as unified text, from the first @@; empty for a binary file or a pure rename */
  patch: string;
  binary: boolean;
}

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/;

/** The hunks of a unified patch (one file's part, starting at its first @@); each takes the lines its header counts. */
export function parsePatch(patch: string): Hunk[] {
  const out: Hunk[] = [];
  let hunk: Hunk | null = null;
  let o = 0;
  let n = 0;
  let oldLeft = 0;
  let newLeft = 0;
  for (const line of patch.split(/\r?\n/)) {
    const h = HUNK.exec(line);
    if (h) {
      o = Number(h[1]);
      n = Number(h[3]);
      oldLeft = h[2] === undefined ? 1 : Number(h[2]);
      newLeft = h[4] === undefined ? 1 : Number(h[4]);
      hunk = { header: (h[5] ?? '').trim(), oldStart: o, newStart: n, lines: [] };
      out.push(hunk);
      continue;
    }
    // "\ No newline at end of file", and anything after the hunk's counted lines
    if (!hunk || line.startsWith('\\') || (oldLeft <= 0 && newLeft <= 0)) continue;
    const mark = line[0];
    const text = line.slice(1);
    if (mark === '+' && newLeft > 0) {
      hunk.lines.push({ kind: 'add', old: null, new: n++, text });
      newLeft--;
    } else if (mark === '-' && oldLeft > 0) {
      hunk.lines.push({ kind: 'del', old: o++, new: null, text });
      oldLeft--;
    } else if (mark === ' ' || line === '') {
      // some hosts drop the space of an empty context line
      hunk.lines.push({ kind: 'context', old: o++, new: n++, text });
      oldLeft--;
      newLeft--;
    }
  }
  return out;
}

const counts = (patch: string): { additions: number; deletions: number } => {
  let additions = 0;
  let deletions = 0;
  for (const h of parsePatch(patch))
    for (const l of h.lines) {
      if (l.kind === 'add') additions++;
      else if (l.kind === 'del') deletions++;
    }
  return { additions, deletions };
};

/** One file's change from its patch and what the host says about it. */
export function fileDiff(f: {
  path: string;
  oldPath?: string | null;
  status?: string;
  patch: string;
  binary?: boolean;
}): FileDiff {
  const status: FileStatus =
    f.status === 'added' || f.status === 'deleted' || f.status === 'renamed'
      ? f.status
      : f.oldPath && f.oldPath !== f.path
        ? 'renamed'
        : 'modified';
  const at = f.patch.indexOf('@@');
  const patch = at < 0 ? '' : f.patch.slice(at);
  return {
    path: f.path,
    oldPath: f.oldPath && f.oldPath !== f.path ? f.oldPath : null,
    status,
    ...counts(patch),
    patch,
    binary: f.binary === true,
  };
}

const unquote = (p: string): string => p.replace(/^"(.*)"$/, '$1').replace(/^[ab]\//, '');

/** The files of a whole `git diff` (what Gitea sends for a pull request). */
export function splitDiff(diff: string): FileDiff[] {
  const out: FileDiff[] = [];
  const parts = diff.split(/^(?=diff --git )/m).filter((p) => p.startsWith('diff --git '));
  for (const part of parts) {
    const lines = part.split(/\r?\n/);
    const head = /^diff --git (\S+|"[^"]+") (\S+|"[^"]+")/.exec(lines[0] ?? '');
    let oldPath = unquote(head?.[1] ?? '');
    let path = unquote(head?.[2] ?? '');
    let status = 'modified';
    let binary = false;
    for (const l of lines.slice(1)) {
      if (l.startsWith('@@')) break;
      if (l.startsWith('new file mode')) status = 'added';
      else if (l.startsWith('deleted file mode')) status = 'deleted';
      else if (l.startsWith('rename from ')) {
        oldPath = l.slice(12);
        status = 'renamed';
      } else if (l.startsWith('rename to ')) path = l.slice(10);
      else if (l.startsWith('Binary files ') || l === 'GIT binary patch') binary = true;
      else if (l.startsWith('--- ') && l !== '--- /dev/null') oldPath = unquote(l.slice(4));
      else if (l.startsWith('+++ ') && l !== '+++ /dev/null') path = unquote(l.slice(4));
    }
    if (status === 'deleted') path = oldPath;
    out.push(fileDiff({ path, oldPath, status, patch: part, binary }));
  }
  return out;
}

/** A unified patch between two versions of a file, with `context` lines around each change. */
export function unifiedPatch(before: string, after: string, context = 3): string {
  const a = before === '' ? [] : before.replace(/\r?\n$/, '').split(/\r?\n/);
  const b = after === '' ? [] : after.replace(/\r?\n$/, '').split(/\r?\n/);
  // the edit script: context, removed and added lines in order
  const ops: { kind: PatchLine['kind']; text: string; o: number; n: number }[] = [];
  let i = 0;
  let j = 0;
  for (const [ai, bj] of [...commonRun(a, b), [a.length, b.length] as [number, number]]) {
    while (i < ai) ops.push({ kind: 'del', text: a[i] ?? '', o: i++, n: j });
    while (j < bj) ops.push({ kind: 'add', text: b[j] ?? '', o: i, n: j++ });
    if (ai < a.length && bj < b.length)
      ops.push({ kind: 'context', text: a[i] ?? '', o: i++, n: j++ });
  }
  // hunks: changes with their context, joined when the context between them is short
  const changed = ops.map((op, k) => (op.kind === 'context' ? -1 : k)).filter((k) => k >= 0);
  if (!changed.length) return '';
  const ranges: [number, number][] = [];
  for (const k of changed) {
    const from = Math.max(0, k - context);
    const to = Math.min(ops.length - 1, k + context);
    const last = ranges[ranges.length - 1];
    if (last && from <= last[1] + 1) last[1] = Math.max(last[1], to);
    else ranges.push([from, to]);
  }
  const out: string[] = [];
  for (const [from, to] of ranges) {
    const part = ops.slice(from, to + 1);
    const first = part[0];
    if (!first) continue;
    const oldLen = part.filter((p) => p.kind !== 'add').length;
    const newLen = part.filter((p) => p.kind !== 'del').length;
    out.push(
      '@@ -' +
        String(oldLen ? first.o + 1 : first.o) +
        ',' +
        String(oldLen) +
        ' +' +
        String(newLen ? first.n + 1 : first.n) +
        ',' +
        String(newLen) +
        ' @@',
    );
    for (const p of part)
      out.push((p.kind === 'add' ? '+' : p.kind === 'del' ? '-' : ' ') + p.text);
  }
  return out.join('\n');
}

/** One row of a side-by-side view: the old line left, the new line right, or a hunk's heading. */
export type SideRow =
  | { kind: 'hunk'; header: string; oldStart: number; newStart: number }
  | { kind: 'lines'; left: PatchLine | null; right: PatchLine | null };

/** Rows for a side-by-side view: removed and added runs are paired line by line. */
export function sideBySide(hunks: readonly Hunk[]): SideRow[] {
  const rows: SideRow[] = [];
  for (const h of hunks) {
    rows.push({ kind: 'hunk', header: h.header, oldStart: h.oldStart, newStart: h.newStart });
    let dels: PatchLine[] = [];
    let adds: PatchLine[] = [];
    const flush = (): void => {
      for (let k = 0; k < Math.max(dels.length, adds.length); k++)
        rows.push({ kind: 'lines', left: dels[k] ?? null, right: adds[k] ?? null });
      dels = [];
      adds = [];
    };
    for (const l of h.lines) {
      if (l.kind === 'del') {
        if (adds.length) flush();
        dels.push(l);
      } else if (l.kind === 'add') adds.push(l);
      else {
        flush();
        rows.push({ kind: 'lines', left: l, right: l });
      }
    }
    flush();
  }
  return rows;
}

export interface FileMarks {
  /** fingerprints on added lines, by new line number */
  markers: { line: number; task: string; title: string }[];
  /** code was added without any fingerprint in the new lines */
  missing: boolean;
  /** tasks other than the pull request's own that new fingerprints name */
  foreign: string[];
}

/** The fingerprints a file's new lines carry, measured against the pull request's task. */
export function fileMarks(file: FileDiff, hunks: readonly Hunk[], task: string | null): FileMarks {
  const markers: FileMarks['markers'] = [];
  for (const h of hunks)
    for (const l of h.lines) {
      if (l.kind !== 'add' || l.new === null) continue;
      const m = MARKER.exec(l.text);
      if (m?.[1])
        markers.push({
          line: l.new,
          task: m[1],
          title: (m[4] ?? '')
            .replace(/\s*(-->|\*\/|#\})\s*$/, '')
            .replace(/[\s─—-]+$/, '')
            .trim(),
        });
    }
  const foreign = task
    ? [...new Set(markers.map((m) => m.task).filter((t) => t.toUpperCase() !== task.toUpperCase()))]
    : [];
  return {
    markers,
    missing:
      isCode(file.path) && file.status !== 'deleted' && file.additions > 0 && !markers.length,
    foreign,
  };
}

/** Paths whose change deserves a second look: data, access, money, the pipeline, the build. */
export const SENSITIVE: readonly { label: string; re: RegExp }[] = [
  { label: 'migrations', re: /(^|\/)(migrations?|migrate|schema)(\/|\.)|\.sql$/i },
  {
    label: 'access',
    re: /(^|\/|[._-])(auth|login|session|permission|rbac|acl|secret|token|crypto|password)s?(?=[/._-]|$)/i,
  },
  {
    label: 'money',
    re: /(^|\/|[._-])(billing|payment|invoice|checkout|price|pricing)s?(?=[/._-]|$)/i,
  },
  {
    label: 'the pipeline',
    re: /(^|\/)(\.github\/workflows|\.gitlab-ci|azure-pipelines|jenkinsfile)/i,
  },
  { label: 'the build', re: /(^|\/)(dockerfile|docker-compose[^/]*|package\.json|Makefile)$/i },
];

/** The sensitive areas some paths touch, in a stable order. */
export function sensitiveAreas(paths: readonly string[]): string[] {
  return SENSITIVE.filter((s) => paths.some((p) => s.re.test(p))).map((s) => s.label);
}

export interface PullRiskFacts {
  additions: number;
  deletions: number;
  changedFiles: number;
  checksState: string;
  reviewState: string;
  draft: boolean;
  noTask: boolean;
  openedAt: string;
  /** the changed paths when they are known (read once), else empty */
  paths?: readonly string[];
  /** code files changed without a fingerprint, when known */
  unmarked?: number;
  // [PCODE-304 | S15 | v0.1.0] the host says it does not merge cleanly
  conflicts?: boolean;
}

export interface PullRisk {
  score: number;
  level: 'high' | 'medium' | 'low';
  reasons: string[];
}

const plural = (n: number, one: string, many = one + 's'): string =>
  String(n) + ' ' + (n === 1 ? one : many);

/** How risky a pull request is to merge, with the reasons in words; drafts count half. */
export function prRisk(p: PullRiskFacts, now = Date.now()): PullRisk {
  let score = 0;
  const reasons: string[] = [];
  const lines = p.additions + p.deletions;
  const size = lines < 10 ? 0 : lines < 100 ? 1 : lines < 400 ? 3 : lines < 1000 ? 5 : 8;
  if (size >= 3) reasons.push(plural(lines, 'line') + ' changed');
  score += size;
  if (p.changedFiles > 20) {
    score += 2;
    reasons.push(plural(p.changedFiles, 'file'));
  }
  if (p.checksState === 'failing') {
    score += 4;
    reasons.push('checks fail');
  } else if (p.checksState === 'pending') score += 1;
  if (p.reviewState === 'changes_requested') {
    score += 3;
    reasons.push('changes requested');
  }
  // [PCODE-304 | S15 | v0.1.0]
  if (p.conflicts) {
    score += 3;
    reasons.push('conflicts');
  }
  if (p.noTask) {
    score += 2;
    reasons.push('no task');
  }
  const areas = sensitiveAreas(p.paths ?? []);
  if (areas.length) {
    score += 2 + areas.length;
    reasons.push('touches ' + areas.join(', '));
  }
  if (p.unmarked) {
    score += 1;
    reasons.push(plural(p.unmarked, 'code file') + ' without a fingerprint');
  }
  const days = Math.floor((now - Date.parse(p.openedAt)) / 86_400_000);
  if (days >= 7) {
    score += days >= 30 ? 2 : 1;
    reasons.push('open ' + plural(days, 'day'));
  }
  if (p.reviewState === 'approved') score = Math.max(0, score - 2);
  if (p.draft) {
    score = Math.floor(score / 2);
    reasons.push('draft');
  }
  return { score, level: score >= 8 ? 'high' : score >= 4 ? 'medium' : 'low', reasons };
}

/** A short hash of a patch: a file marked viewed stays viewed until this changes. */
export function patchHash(patch: string): string {
  // FNV-1a, 32 bits twice with different seeds: enough to notice a change, not a security measure
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ patch.length;
  for (let k = 0; k < patch.length; k++) {
    const c = patch.charCodeAt(k);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x5bd1e995) >>> 0;
  }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

/** The language a path is shown in, from its extension (for a label, not highlighting). */
export const languageOf = (path: string): string => extOf(path) || 'text';

// [PCODE-303 | S15 | v0.1.0] T31.4 Line comments from people and the AI, posted to the host with approve or request changes
//   a comment sits on a line the diff shows; the AI reads the patches with the new file's line numbers and
//   answers with a JSON list, of which only comments on lines the diff shows are kept

export type CommentSide = 'new' | 'old';
export type CommentSeverity = 'note' | 'warning' | 'risk';

export interface SuggestedComment {
  path: string;
  line: number;
  severity: CommentSeverity;
  body: string;
}

/** Whether the diff shows `line` on that side (only such lines take a comment on the hosts). */
export function onDiff(hunks: readonly Hunk[], side: CommentSide, line: number): boolean {
  return hunks.some((h) =>
    h.lines.some((l) => (side === 'new' ? l.new === line : l.kind === 'del' && l.old === line)),
  );
}

/** A file's hunks for a model: each new-side line with its number, removed lines without. */
export function numberedPatch(path: string, hunks: readonly Hunk[]): string {
  const out = ['FILE ' + path];
  for (const h of hunks) {
    out.push('@@ ' + h.header);
    for (const l of h.lines)
      out.push(
        (l.new === null ? '     ' : String(l.new).padStart(5)) +
          (l.kind === 'add' ? ' + ' : l.kind === 'del' ? ' - ' : '   ') +
          l.text,
      );
  }
  return out.join('\n');
}

export const SUGGESTION_LIMITS = { comments: 30, body: 2000 };

/** The comments in a model's answer that sit on lines of the given files' new side, at most 30. */
export function parseSuggestions(
  text: string,
  files: ReadonlyMap<string, readonly Hunk[]>,
): SuggestedComment[] {
  const from = text.indexOf('[');
  const to = text.lastIndexOf(']');
  if (from < 0 || to <= from) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(from, to + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const out: SuggestedComment[] = [];
  const seen = new Set<string>();
  for (const r of raw as unknown[]) {
    if (typeof r !== 'object' || r === null) continue;
    const o = r as Record<string, unknown>;
    const path = typeof o['path'] === 'string' ? o['path'] : '';
    const line = typeof o['line'] === 'number' ? Math.trunc(o['line']) : NaN;
    const body = typeof o['body'] === 'string' ? o['body'].trim() : '';
    const hunks = files.get(path);
    if (!hunks || !body || !onDiff(hunks, 'new', line)) continue;
    const key = path + ':' + String(line);
    if (seen.has(key)) continue;
    seen.add(key);
    const sev = o['severity'];
    out.push({
      path,
      line,
      severity: sev === 'risk' || sev === 'warning' ? sev : 'note',
      body: body.slice(0, SUGGESTION_LIMITS.body),
    });
    if (out.length >= SUGGESTION_LIMITS.comments) break;
  }
  return out;
}

/** The text a comment carries to the host: the account behind the token is shared, so it names the writer. */
export function hostCommentText(body: string, author: string, ai: boolean): string {
  return body.trim() + '\n\n— ' + author + (ai ? ', from an AI suggestion' : '') + ' (via Orqiva)';
}
