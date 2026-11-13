// ── [PCODE-305 | S15 | v0.1.0] T31.5b The merge queue: in order per branch, merged through the host when the policy passes ──
//    Why:  the merge queue merges through the host's API with the connection's token, pinned to the head
//          commit that was checked, so a push in between makes the host refuse rather than merge unchecked
//          code. GitLab chooses rebase or merge commits per project, so "rebase" merges without squashing
//          there; Azure DevOps may finish the completion a moment later.
import { hostClient, type ReadConn } from './hostread.js';

export type MergeMethod = 'merge' | 'squash' | 'rebase';

const obj = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
const str = (v: unknown): string =>
  typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';

export const AZURE_STRATEGY: Record<MergeMethod, string> = {
  merge: 'noFastForward',
  squash: 'squash',
  rebase: 'rebase',
};

/** Merges pull request `number` at `sha`; returns a note when the host finishes it later. */
export async function mergePull(
  conn: ReadConn,
  m: { number: number; sha: string; method: MergeMethod; title: string },
  fetchImpl: typeof fetch = fetch,
): Promise<{ done: boolean; note: string }> {
  const { base, send } = hostClient(conn, fetchImpl);
  const n = String(m.number);
  if (conn.provider === 'github') {
    await send('PUT', base + '/repos/' + conn.repo + '/pulls/' + n + '/merge', {
      merge_method: m.method,
      ...(m.sha ? { sha: m.sha } : {}),
      ...(m.method === 'squash' ? { commit_title: m.title + ' (#' + n + ')' } : {}),
    });
    return { done: true, note: '' };
  }
  if (conn.provider === 'gitea') {
    await send('POST', base + '/repos/' + conn.repo + '/pulls/' + n + '/merge', {
      Do: m.method,
      ...(m.sha ? { head_commit_id: m.sha } : {}),
      ...(m.method === 'squash' ? { MergeTitleField: m.title } : {}),
    });
    return { done: true, note: '' };
  }
  if (conn.provider === 'gitlab') {
    const r = obj(
      await send(
        'PUT',
        base + '/projects/' + encodeURIComponent(conn.repo) + '/merge_requests/' + n + '/merge',
        { squash: m.method === 'squash', ...(m.sha ? { sha: m.sha } : {}) },
      ),
    );
    const state = str(r['state']);
    return state === 'merged' || !state
      ? { done: true, note: '' }
      : { done: false, note: 'GitLab will merge it when its pipeline passes' };
  }
  const [org, proj, name] = conn.repo.split('/');
  const r = obj(
    await send(
      'PATCH',
      base +
        '/' +
        encodeURIComponent(org ?? '') +
        '/' +
        encodeURIComponent(proj ?? '') +
        '/_apis/git/repositories/' +
        encodeURIComponent(name ?? '') +
        '/pullRequests/' +
        n +
        '?api-version=7.1',
      {
        status: 'completed',
        ...(m.sha ? { lastMergeSourceCommit: { commitId: m.sha } } : {}),
        completionOptions: { mergeStrategy: AZURE_STRATEGY[m.method], deleteSourceBranch: false },
      },
    ),
  );
  return str(r['status']) === 'completed'
    ? { done: true, note: '' }
    : { done: false, note: 'Azure DevOps is completing it' };
}
