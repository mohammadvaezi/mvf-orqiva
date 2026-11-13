// ── [PCODE-311 | S15 | v0.1.0] T31.9b Code review in VS Code: the queue, the diff and line comments ──
//    Why:  the review queue in the editor: the open pull requests riskiest first, their changed files with
//          the viewed marks, each file as a diff with the comments on its lines, and the review submitted
//          from here. The patch holds only the changed parts, so both sides are drawn with each line at its
//          own number and blank lines between: a comment lands on the line the host knows. Free of vscode,
//          so it is tested on its own.
import { parsePatch, type Hunk } from '@orqiva/shared';
import type { Api } from '../../../cli/src/loop/api';

export interface ReviewSource {
  api: Api;
  workspaceId: string;
  projectId: string;
}

export interface QueueEntry {
  id: string;
  number: number;
  title: string;
  url: string;
  author: string;
  repo: string;
  branch: string;
  base: string;
  draft: boolean;
  additions: number;
  deletions: number;
  changedFiles: number;
  reviewState: string;
  checksState: string;
  itemRef: string | null;
  risk: { level: string; reasons: string[] };
  files: number | null;
  viewed: number;
  mergeable?: string;
}

export interface ReviewFile {
  path: string;
  oldPath: string | null;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  additions: number;
  deletions: number;
  binary: boolean;
  tooBig: boolean;
  patch: string;
  viewed: boolean;
}

export interface PullFiles {
  id: string;
  number: number;
  title: string;
  url: string;
  repo: string;
  branch: string;
  base: string;
  state: string;
  itemRef: string | null;
  truncated: boolean;
  files: ReviewFile[];
}

export interface ReviewComment {
  id: string;
  path: string;
  line: number;
  side: 'new' | 'old';
  body: string;
  source: 'person' | 'ai';
  state: 'suggested' | 'dismissed' | 'draft' | 'posted';
  severity: string | null;
  author: string | null;
  mine: boolean;
  outdated: boolean;
}

export interface Thread {
  comments: ReviewComment[];
  reviews: { decision: string; author: string | null; comments: number }[];
}

export type Decision = 'approve' | 'request_changes' | 'comment';

const W = (s: ReviewSource, p: string): string => '/api/workspaces/' + s.workspaceId + p;
const P = (s: ReviewSource, pullId: string, p = ''): string => W(s, '/pull-requests/' + pullId + p);

export const queueOf = (s: ReviewSource): Promise<QueueEntry[]> =>
  s.api.call<QueueEntry[]>('GET', W(s, '/projects/' + s.projectId + '/review-queue'));

export const filesOf = (s: ReviewSource, pullId: string, refresh = false): Promise<PullFiles> =>
  s.api.call<PullFiles>('GET', P(s, pullId, '/files' + (refresh ? '?refresh=1' : '')));

export const threadOf = (s: ReviewSource, pullId: string): Promise<Thread> =>
  s.api.call<Thread>('GET', P(s, pullId, '/comments'));

export const markViewed = (
  s: ReviewSource,
  pullId: string,
  path: string,
  viewed: boolean,
): Promise<{ viewed: number; files: number }> =>
  s.api.call('PUT', P(s, pullId, '/viewed'), { path, viewed });

export const addComment = (
  s: ReviewSource,
  pullId: string,
  c: { path: string; line: number; side: 'new' | 'old'; body: string },
): Promise<ReviewComment> => s.api.call<ReviewComment>('POST', P(s, pullId, '/comments'), c);

export const deleteComment = (s: ReviewSource, commentId: string): Promise<unknown> =>
  s.api.call('DELETE', W(s, '/pull-request-comments/' + commentId));

export const decide = (
  s: ReviewSource,
  commentId: string,
  accept: boolean,
): Promise<ReviewComment> =>
  s.api.call<ReviewComment>('POST', W(s, '/pull-request-comments/' + commentId + '/decide'), {
    accept,
  });

export const suggest = (s: ReviewSource, pullId: string): Promise<Thread> =>
  s.api.call<Thread>('POST', P(s, pullId, '/ai-comments'), {});

export const submitReview = (
  s: ReviewSource,
  pullId: string,
  decision: Decision,
  body: string,
): Promise<{ posted: number; outdated: number }> =>
  s.api.call('POST', P(s, pullId, '/reviews'), {
    decision,
    ...(body.trim() ? { body: body.trim() } : {}),
  });

const SIGN: Record<string, string> = {
  approved: '$(pass) approved',
  changes_requested: '$(request-changes) changes requested',
  commented: '$(comment) commented',
};
const CHECKS: Record<string, string> = {
  passing: '$(check) checks pass',
  failing: '$(error) checks fail',
  pending: '$(clock) checks run',
};

/** A pull request in the queue as a quick pick row. */
export function queueLabel(q: QueueEntry): { label: string; description: string; detail: string } {
  const read = q.files === null ? '' : String(q.viewed) + '/' + String(q.files) + ' viewed';
  return {
    label:
      (q.risk.level === 'high' ? '$(warning) ' : '') +
      '#' +
      String(q.number) +
      ' ' +
      q.title +
      (q.draft ? ' (draft)' : ''),
    description: [q.repo, q.author, '+' + String(q.additions) + ' −' + String(q.deletions)].join(
      ' · ',
    ),
    detail: [
      q.itemRef ?? 'no task',
      SIGN[q.reviewState] ?? 'not reviewed',
      CHECKS[q.checksState] ?? '',
      q.mergeable === 'conflicts' ? '$(git-merge) conflicts' : '',
      read,
      // the reasons not said already (a missing task is the first part)
      q.risk.reasons
        .filter((r) => r !== 'no task')
        .slice(0, 2)
        .join(', '),
    ]
      .filter(Boolean)
      .join(' · '),
  };
}

/** A changed file as a quick pick row: the viewed mark, the path and its counts. */
export function fileLabel(f: ReviewFile, comments: number): { label: string; description: string } {
  return {
    label: (f.viewed ? '$(eye) ' : '$(circle-large-outline) ') + f.path,
    description: [
      f.status === 'renamed' && f.oldPath ? 'renamed from ' + f.oldPath : f.status,
      '+' + String(f.additions) + ' −' + String(f.deletions),
      comments ? String(comments) + ' comment' + (comments === 1 ? '' : 's') : '',
      f.binary ? 'binary' : f.tooBig ? 'too big to show' : '',
    ]
      .filter(Boolean)
      .join(' · '),
  };
}

export interface Sides {
  /** the old file's changed parts, each line at its own number (1-based), blank lines between */
  old: string;
  new: string;
  /** the lines a comment may sit on: the new side's lines of the patch, the old side's removed lines */
  newLines: number[];
  oldLines: number[];
}

/** Both sides of a file drawn from its patch, with every line at the number the host gives it. */
export function sidesOf(patch: string): Sides {
  const hunks: Hunk[] = parsePatch(patch);
  const oldAt = new Map<number, string>();
  const newAt = new Map<number, string>();
  const oldLines: number[] = [];
  const newLines: number[] = [];
  for (const h of hunks)
    for (const l of h.lines) {
      if (l.old !== null) oldAt.set(l.old, l.text);
      if (l.new !== null) {
        newAt.set(l.new, l.text);
        newLines.push(l.new);
      } else if (l.kind === 'del' && l.old !== null) oldLines.push(l.old);
    }
  const draw = (at: Map<number, string>): string => {
    const last = Math.max(0, ...at.keys());
    const out: string[] = [];
    for (let i = 1; i <= last; i++) out.push(at.get(i) ?? '');
    return out.join('\n');
  };
  return { old: draw(oldAt), new: draw(newAt), newLines, oldLines };
}

/** The comments to show on a file: what was posted, the AI's open suggestions and the caller's drafts. */
export const shownOn = (thread: Thread, path: string): ReviewComment[] =>
  thread.comments.filter((c) => c.path === path && c.state !== 'dismissed');

/** How a comment reads in the editor: who wrote it and where it stands. */
export function commentLabel(c: ReviewComment): string {
  const who =
    c.source === 'ai' && c.state === 'suggested' ? 'Reviewer agent' : (c.author ?? 'someone');
  const state =
    c.state === 'suggested'
      ? 'suggestion' + (c.severity ? ', ' + c.severity : '')
      : c.state === 'draft'
        ? 'draft, posted with your review'
        : 'posted';
  return who + ' · ' + state + (c.outdated ? ' · outdated' : '');
}

const plural = (n: number, one: string): string => String(n) + ' ' + one + (n === 1 ? '' : 's');

/** What the submit says goes with it: the drafts, the outdated ones kept back, open suggestions. */
export function submitSummary(thread: Thread): string {
  const drafts = thread.comments.filter((c) => c.mine && c.state === 'draft');
  const outdated = drafts.filter((c) => c.outdated).length;
  const open = thread.comments.filter((c) => c.state === 'suggested').length;
  return [
    plural(drafts.length - outdated, 'draft comment') + ' posted with it',
    outdated ? plural(outdated, 'outdated draft') + ' kept back' : '',
    open ? plural(open, 'AI suggestion') + ' not decided' : '',
  ]
    .filter(Boolean)
    .join(' · ');
}
