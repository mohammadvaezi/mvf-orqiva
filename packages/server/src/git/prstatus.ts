// ── [PCODE-304 | S15 | v0.1.0] T31.5a Conflicts, stacked pull requests, and merge policies the host enforces through a commit status ──
//    Why:  whether a pull request merges cleanly is read again from the host when someone asks (GitHub works
//          it out only when the pull request is read); the policy's verdict goes to the host as a commit
//          status named orqiva/policy on the head commit (a pull request status on Azure DevOps), which
//          the host's branch protection can require before merging.
import { POLICY_CONTEXT, type Mergeable } from '@orqiva/shared';
import { azureMergeState, gitlabMergeState } from './hosts.js';
import { hostClient, type ReadConn } from './hostread.js';
import { mergeableOf } from './pulls.js';

const obj = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
const str = (v: unknown): string =>
  typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';

export type StatusState = 'success' | 'failure' | 'pending';

/** The Azure DevOps pull request's address: organisation/project/repository. */
function azurePull(base: string, repo: string, number: number): string {
  const [org, proj, name] = repo.split('/');
  return (
    base +
    '/' +
    encodeURIComponent(org ?? '') +
    '/' +
    encodeURIComponent(proj ?? '') +
    '/_apis/git/repositories/' +
    encodeURIComponent(name ?? '') +
    '/pullRequests/' +
    String(number)
  );
}

/** Whether the pull request merges cleanly, as the host says now. */
export async function readMergeable(
  conn: ReadConn,
  number: number,
  fetchImpl: typeof fetch = fetch,
): Promise<Mergeable> {
  const { base, get } = hostClient(conn, fetchImpl);
  const n = String(number);
  if (conn.provider === 'github' || conn.provider === 'gitea')
    return mergeableOf(obj(await get(base + '/repos/' + conn.repo + '/pulls/' + n)));
  if (conn.provider === 'gitlab')
    return mergeableOf({
      mergeable_state: gitlabMergeState(
        obj(
          await get(base + '/projects/' + encodeURIComponent(conn.repo) + '/merge_requests/' + n),
        ),
      ),
    });
  return mergeableOf({
    mergeable_state: azureMergeState(
      obj(await get(azurePull(base, conn.repo, number) + '?api-version=7.1')),
    ),
  });
}

/** Posts the verdict on the head commit; returns what the host called it. */
export async function postStatus(
  conn: ReadConn,
  s: { number: number; sha: string; state: StatusState; description: string; url: string | null },
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const { base, send } = hostClient(conn, fetchImpl);
  const link = s.url ?? undefined;
  if (conn.provider === 'github' || conn.provider === 'gitea') {
    const r = obj(
      await send('POST', base + '/repos/' + conn.repo + '/statuses/' + s.sha, {
        state: s.state,
        context: POLICY_CONTEXT,
        description: s.description,
        ...(link ? { target_url: link } : {}),
      }),
    );
    return str(r['id']);
  }
  if (conn.provider === 'gitlab') {
    const r = obj(
      await send(
        'POST',
        base + '/projects/' + encodeURIComponent(conn.repo) + '/statuses/' + s.sha,
        {
          state: s.state === 'failure' ? 'failed' : s.state,
          name: POLICY_CONTEXT,
          description: s.description,
          ...(link ? { target_url: link } : {}),
        },
      ),
    );
    return str(r['id']);
  }
  const [genre, name] = POLICY_CONTEXT.split('/');
  const r = obj(
    await send('POST', azurePull(base, conn.repo, s.number) + '/statuses?api-version=7.1', {
      state: s.state === 'success' ? 'succeeded' : s.state === 'failure' ? 'failed' : 'pending',
      description: s.description,
      context: { genre, name },
      ...(link ? { targetUrl: link } : {}),
    }),
  );
  return str(r['id']);
}
