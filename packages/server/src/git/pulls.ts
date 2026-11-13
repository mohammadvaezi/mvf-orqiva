// ── [PCODE-304 | S15 | v0.1.0] T31.5a Conflicts, stacked pull requests, and merge policies the host enforces through a commit status ──
// ── [PCODE-175 | S15 | v0.1.0] B4.1 Test and Versions on the server: suites, steps, configs, evidence, flaky, Playwright, pull requests, releases, notes, flags, DORA ──
//    Why:  the Versions tab shows pull requests as they really are: open, merged or closed, how big, on
//          which branches, what reviewers said and whether the checks pass. All of it arrives in the Git
//          host's webhooks (GitHub and Gitea); nothing is polled. The task comes from the branch, title or
//          description naming its reference, the same rule commits use.
import { POLICY_CONTEXT, type Mergeable } from '@orqiva/shared';
import type { PoolClient } from 'pg';
import { taskNumbers } from './webhook.js';

const str = (v: unknown): string =>
  typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';
const num = (v: unknown): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0;
const obj = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};

export interface PullFacts {
  number: number;
  title: string;
  url: string;
  author: string;
  branch: string;
  base: string;
  headSha: string;
  state: 'open' | 'merged' | 'closed';
  draft: boolean;
  additions: number;
  deletions: number;
  changedFiles: number;
  openedAt: string;
  updatedAt: string;
  mergedAt: string | null;
  closedAt: string | null;
  text: string;
  mergeable: Mergeable; // [PCODE-304 | S15 | v0.1.0]
}

// [PCODE-304 | S15 | v0.1.0] GitHub's mergeable_state (and Gitea's mergeable flag); the other hosts' are read into it
export function mergeableOf(pr: Record<string, unknown>): Mergeable {
  const s = str(pr['mergeable_state']);
  if (s === 'dirty' || pr['mergeable'] === false) return 'conflicts';
  if (s === 'behind') return 'behind';
  if (['clean', 'unstable', 'blocked', 'has_hooks'].includes(s) || pr['mergeable'] === true)
    return 'clean';
  return 'unknown';
}

/** The pull request a payload carries (pull_request and review events of both hosts). */
export function pullOf(payload: unknown): PullFacts | null {
  const p = obj(payload);
  const pr = obj(p['pull_request']);
  const number = num(pr['number'] ?? p['number']);
  if (!number) return null;
  const merged = pr['merged'] === true;
  const head = obj(pr['head']);
  const title = str(pr['title']).slice(0, 300);
  const branch = str(head['ref']).slice(0, 250);
  return {
    number,
    title,
    url: str(pr['html_url']).slice(0, 500),
    author: str(obj(pr['user'])['login']).slice(0, 200),
    branch,
    base: str(obj(pr['base'])['ref']).slice(0, 250),
    headSha: str(head['sha']).slice(0, 64),
    state: merged ? 'merged' : str(pr['state']) === 'closed' ? 'closed' : 'open',
    draft: pr['draft'] === true,
    additions: num(pr['additions']),
    deletions: num(pr['deletions']),
    changedFiles: num(pr['changed_files']),
    openedAt: str(pr['created_at']) || new Date().toISOString(),
    updatedAt: str(pr['updated_at']) || new Date().toISOString(),
    mergedAt: str(pr['merged_at']) || null,
    closedAt: str(pr['closed_at']) || null,
    text: title + '\n' + branch + '\n' + str(pr['body']).slice(0, 5000),
    mergeable: mergeableOf(pr), // [PCODE-304 | S15 | v0.1.0]
  };
}

/** A review's verdict, from GitHub's pull_request_review or Gitea's pull_request_review_* events. */
export function reviewOf(
  event: string,
  payload: unknown,
): 'approved' | 'changes_requested' | 'commented' | null {
  if (event === 'pull_request_review_approved') return 'approved';
  if (event === 'pull_request_review_rejected') return 'changes_requested';
  if (event === 'pull_request_review_comment') return 'commented';
  if (event !== 'pull_request_review') return null;
  const state = str(obj(obj(payload)['review'])['state']).toLowerCase();
  return state === 'approved'
    ? 'approved'
    : state === 'changes_requested'
      ? 'changes_requested'
      : state === 'commented'
        ? 'commented'
        : null;
}

/** A check result for a commit: check_suite, check_run and status events. */
export function checkOf(
  event: string,
  payload: unknown,
): { sha: string; state: 'pending' | 'passing' | 'failing' } | null {
  const p = obj(payload);
  const verdict = (status: string, conclusion: string): 'pending' | 'passing' | 'failing' =>
    status !== 'completed' && !conclusion
      ? 'pending'
      : ['success', 'neutral', 'skipped'].includes(conclusion)
        ? 'passing'
        : 'failing';
  if (event === 'check_suite' || event === 'check_run') {
    const c = obj(p[event]);
    const sha = str(c['head_sha']);
    return sha ? { sha, state: verdict(str(c['status']), str(c['conclusion'])) } : null;
  }
  if (event === 'status') {
    // [PCODE-304 | S15 | v0.1.0] Orqiva's own verdict is not one of the pull request's checks
    if (str(p['context']) === POLICY_CONTEXT) return null;
    const sha = str(p['sha']);
    const s = str(p['state']);
    return sha
      ? { sha, state: s === 'pending' ? 'pending' : s === 'success' ? 'passing' : 'failing' }
      : null;
  }
  return null;
}

/** Stores what a delivery says about pull requests; returns how many rows changed. */
export async function recordPulls(
  c: PoolClient,
  conn: { id: string; workspace_id: string; project_id: string; key: string },
  event: string,
  payload: unknown,
): Promise<number> {
  const check = checkOf(event, payload);
  if (check) {
    const r = await c.query(
      "UPDATE pull_requests SET checks_state = $3 WHERE connection_id = $1 AND head_sha = $2 AND state = 'open'",
      [conn.id, check.sha, check.state],
    );
    return r.rowCount ?? 0;
  }
  const pr =
    event === 'pull_request' || event.startsWith('pull_request_review') ? pullOf(payload) : null;
  if (!pr) return 0;
  const n = taskNumbers(conn.key, pr.text)[0];
  const item = n
    ? ((
        await c.query<{ id: string }>(
          'SELECT id FROM items WHERE project_id = $1 AND sequence = $2',
          [conn.project_id, n],
        )
      ).rows[0]?.id ?? null)
    : null;
  const review = reviewOf(event, payload);
  await c.query(
    `INSERT INTO pull_requests (workspace_id, project_id, connection_id, number, title, url, author, branch, base, head_sha, state, draft,
                                additions, deletions, changed_files, review_state, item_id, opened_at, updated_at, merged_at, closed_at, mergeable)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, coalesce($16, 'none'), $17, $18, $19, $20, $21, $22)
     ON CONFLICT (connection_id, number) DO UPDATE SET
       title = EXCLUDED.title, url = EXCLUDED.url, branch = EXCLUDED.branch, base = EXCLUDED.base,
       head_sha = CASE WHEN EXCLUDED.head_sha <> '' THEN EXCLUDED.head_sha ELSE pull_requests.head_sha END,
       state = EXCLUDED.state, draft = EXCLUDED.draft,
       additions = greatest(EXCLUDED.additions, CASE WHEN EXCLUDED.additions = 0 THEN pull_requests.additions ELSE 0 END),
       deletions = greatest(EXCLUDED.deletions, CASE WHEN EXCLUDED.deletions = 0 THEN pull_requests.deletions ELSE 0 END),
       changed_files = greatest(EXCLUDED.changed_files, CASE WHEN EXCLUDED.changed_files = 0 THEN pull_requests.changed_files ELSE 0 END),
       review_state = coalesce($16, pull_requests.review_state),
       checks_state = CASE WHEN EXCLUDED.head_sha <> '' AND EXCLUDED.head_sha <> pull_requests.head_sha THEN 'none' ELSE pull_requests.checks_state END,
       mergeable = CASE WHEN EXCLUDED.mergeable <> 'unknown' THEN EXCLUDED.mergeable
                        WHEN EXCLUDED.head_sha <> '' AND EXCLUDED.head_sha <> pull_requests.head_sha THEN 'unknown'
                        ELSE pull_requests.mergeable END,
       item_id = coalesce(EXCLUDED.item_id, pull_requests.item_id),
       updated_at = EXCLUDED.updated_at, merged_at = EXCLUDED.merged_at, closed_at = EXCLUDED.closed_at`,
    [
      conn.workspace_id,
      conn.project_id,
      conn.id,
      pr.number,
      pr.title,
      pr.url,
      pr.author,
      pr.branch,
      pr.base,
      pr.headSha,
      pr.state,
      pr.draft,
      pr.additions,
      pr.deletions,
      pr.changedFiles,
      review,
      item,
      pr.openedAt,
      pr.updatedAt,
      pr.mergedAt,
      pr.closedAt,
      pr.mergeable, // [PCODE-304 | S15 | v0.1.0]
    ],
  );
  return 1;
}
