// ── [PCODE-303 | S15 | v0.1.0] T31.4 Line comments from people and the AI, posted to the host with approve or request changes ──
//    Why:  a review submitted in Orqiva is posted to the host with the connection's token, so the people who
//          work on the host see it where they are. GitHub and Gitea take a review with its line comments in
//          one call. GitLab takes each comment as a discussion on the diff, the summary as a note, and an
//          approval of its own. Azure DevOps takes each comment as a thread on the file, and the decision as
//          the token's user's vote. The token speaks for one account, so each text says who wrote it.
import { HostError } from './hostapi.js';
import { hostClient, type ReadConn } from './hostread.js';

export type Decision = 'approve' | 'request_changes' | 'comment';

export interface LineComment {
  path: string;
  /** the file's path before a rename, for a comment on the old side */
  oldPath: string | null;
  line: number;
  side: 'new' | 'old';
  body: string;
}

export interface ReviewToPost {
  number: number;
  /** the head commit the comments were written against */
  headSha: string;
  decision: Decision;
  body: string;
  comments: LineComment[];
}

const str = (v: unknown): string =>
  typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';
const obj = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};

/** Azure DevOps' votes: 10 approved, -5 waiting for the author, 0 no vote. */
export const AZURE_VOTE: Record<Decision, number> = {
  approve: 10,
  request_changes: -5,
  comment: 0,
};

/** Posts the review; returns what the host calls it (a review's id, or the first note's). */
export async function postReview(
  conn: ReadConn,
  review: ReviewToPost,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const { base, get, send } = hostClient(conn, fetchImpl);
  const n = String(review.number);

  if (conn.provider === 'github') {
    const event =
      review.decision === 'approve'
        ? 'APPROVE'
        : review.decision === 'request_changes'
          ? 'REQUEST_CHANGES'
          : 'COMMENT';
    const r = obj(
      await send('POST', base + '/repos/' + conn.repo + '/pulls/' + n + '/reviews', {
        ...(review.headSha ? { commit_id: review.headSha } : {}),
        event,
        body: review.body,
        comments: review.comments.map((c) => ({
          path: c.side === 'old' ? (c.oldPath ?? c.path) : c.path,
          line: c.line,
          side: c.side === 'old' ? 'LEFT' : 'RIGHT',
          body: c.body,
        })),
      }),
    );
    return str(r['id']);
  }

  if (conn.provider === 'gitea') {
    const event =
      review.decision === 'approve'
        ? 'APPROVED'
        : review.decision === 'request_changes'
          ? 'REQUEST_CHANGES'
          : 'COMMENT';
    const r = obj(
      await send('POST', base + '/repos/' + conn.repo + '/pulls/' + n + '/reviews', {
        ...(review.headSha ? { commit_id: review.headSha } : {}),
        event,
        body: review.body,
        comments: review.comments.map((c) => ({
          path: c.path,
          body: c.body,
          new_position: c.side === 'new' ? c.line : 0,
          old_position: c.side === 'old' ? c.line : 0,
        })),
      }),
    );
    return str(r['id']);
  }

  if (conn.provider === 'gitlab') {
    const mr = base + '/projects/' + encodeURIComponent(conn.repo) + '/merge_requests/' + n;
    const refs = obj(obj(await get(mr))['diff_refs']);
    if (review.comments.length && !str(refs['head_sha']))
      throw new HostError('GitLab gave no diff references for the merge request', 502);
    let first = '';
    for (const c of review.comments) {
      const d = obj(
        await send('POST', mr + '/discussions', {
          body: c.body,
          position: {
            position_type: 'text',
            base_sha: str(refs['base_sha']),
            start_sha: str(refs['start_sha']),
            head_sha: str(refs['head_sha']),
            new_path: c.path,
            old_path: c.oldPath ?? c.path,
            ...(c.side === 'new' ? { new_line: c.line } : { old_line: c.line }),
          },
        }),
      );
      first ||= str(d['id']);
    }
    const summary =
      review.decision === 'request_changes'
        ? '**Changes requested.**' + (review.body ? '\n\n' + review.body : '')
        : review.body;
    if (summary) {
      const note = str(obj(await send('POST', mr + '/notes', { body: summary }))['id']);
      first ||= note;
    }
    if (review.decision === 'approve')
      await send('POST', mr + '/approve', review.headSha ? { sha: review.headSha } : {});
    return first;
  }

  // Azure Repos: a thread per comment, a thread for the summary, then the vote
  const [org, proj, name] = conn.repo.split('/');
  const pr =
    base +
    '/' +
    encodeURIComponent(org ?? '') +
    '/' +
    encodeURIComponent(proj ?? '') +
    '/_apis/git/repositories/' +
    encodeURIComponent(name ?? '') +
    '/pullRequests/' +
    n;
  const v = 'api-version=7.1';
  let first = '';
  const thread = async (content: string, context?: Record<string, unknown>): Promise<void> => {
    const t = obj(
      await send('POST', pr + '/threads?' + v, {
        comments: [{ parentCommentId: 0, content, commentType: 1 }],
        status: 1,
        ...(context ? { threadContext: context } : {}),
      }),
    );
    first ||= str(t['id']);
  };
  for (const c of review.comments) {
    const at = { line: c.line, offset: 1 };
    await thread(
      c.body,
      c.side === 'new'
        ? { filePath: '/' + c.path, rightFileStart: at, rightFileEnd: at }
        : { filePath: '/' + (c.oldPath ?? c.path), leftFileStart: at, leftFileEnd: at },
    );
  }
  if (review.body) await thread(review.body);
  if (review.decision !== 'comment') {
    const me = str(
      obj(
        obj(await get(base + '/' + encodeURIComponent(org ?? '') + '/_apis/connectionData'))[
          'authenticatedUser'
        ],
      )['id'],
    );
    if (!me) throw new HostError('Azure DevOps did not say whose token this is', 502);
    await send('PUT', pr + '/reviewers/' + encodeURIComponent(me) + '?' + v, {
      vote: AZURE_VOTE[review.decision],
    });
  }
  return first;
}
