// ── [PCODE-303 | S15 | v0.1.0] T31.4 Line comments from people and the AI, posted to the host with approve or request changes ──
//    Why:  a reviewer comments on lines of the diff; the comments stay the reviewer's drafts until they submit
//          a review, which posts them to the host with the decision (approve, request changes, or just
//          comments). The Reviewer agent reads the patches and suggests comments on added lines; a person
//          accepts one, and it becomes that person's draft to edit and post, or dismisses it. A comment
//          whose file changed since it was written is outdated: it is shown, but not posted to a line that
//          may no longer be there.
import {
  hostCommentText,
  numberedPatch,
  onDiff,
  parsePatch,
  parseSuggestions,
  type Hunk,
} from '@orqiva/shared';
import type { Pool, PoolClient } from 'pg';
import { askAgent } from '../agents/oneshot.js';
import { MODE_LINES } from '../agents/provider.js';
import type { ProviderFor } from '../agents/runner.js';
import { postReview } from '../git/prwrite.js';
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s, type Infer } from '../http/schema.js';
import { asMember, type Access } from './access.js';
import { connOf, ensureFiles, hostFailure, loadPull, type FileRow } from './prreview.js';

const uuid = s.string({ format: 'uuid' });
/** the patches the agent reads, at most this many characters */
const PROMPT_CHARS = 60_000;

export const LINES_PROMPT =
  MODE_LINES +
  ' Review the changed lines of this pull request. Each file starts with FILE and its path; each line of ' +
  'the new file has its number, added lines are marked +, removed lines - (without a number). Comment only ' +
  'where it matters: bugs, security, missing error handling, unclear names, code that does not fit the task. ' +
  'Answer with a JSON list only: [{"path": "...", "line": <number of an added line>, "severity": ' +
  '"note"|"warning"|"risk", "body": "what is wrong and what to do"}]. An empty list is a fine answer.';

const commentOut = s.object({
  id: s.string(),
  path: s.string(),
  line: s.number({ integer: true }),
  side: s.string(),
  body: s.string(),
  source: s.string(),
  state: s.string(),
  severity: s.nullable(s.string()),
  author: s.nullable(s.string()),
  mine: s.boolean(),
  outdated: s.boolean(),
  createdAt: s.string(),
  postedAt: s.nullable(s.string()),
});

const reviewOut = s.object({
  id: s.string(),
  decision: s.string(),
  body: s.string(),
  comments: s.number({ integer: true }),
  author: s.nullable(s.string()),
  hostRef: s.string(),
  createdAt: s.string(),
});

const threadOut = s.object({
  comments: s.array(commentOut),
  reviews: s.array(reviewOut),
});

interface CommentRow {
  id: string;
  pull_request_id: string;
  path: string;
  line: number;
  side: 'new' | 'old';
  body: string;
  source: 'person' | 'ai';
  state: string;
  severity: string | null;
  author_id: string | null;
  author_name: string | null;
  patch_hash: string;
  file_hash: string | null;
  old_path: string | null;
  created_at: Date;
  posted_at: Date | null;
}

const commentJson = (r: CommentRow, me: string): Infer<typeof commentOut> => ({
  id: r.id,
  path: r.path,
  line: r.line,
  side: r.side,
  body: r.body,
  source: r.source,
  state: r.state,
  severity: r.severity,
  author: r.author_name,
  mine: r.author_id === me,
  outdated: r.file_hash !== r.patch_hash,
  createdAt: r.created_at.toISOString(),
  postedAt: r.posted_at?.toISOString() ?? null,
});

const COMMENT_SELECT = `SELECT m.*, u.name AS author_name, f.patch_hash AS file_hash, f.old_path
  FROM pull_request_comments m LEFT JOIN users u ON u.id = m.author_id
  LEFT JOIN pull_request_files f ON f.pull_request_id = m.pull_request_id AND f.path = m.path`;

/** Everyone sees the AI's suggestions and what was posted; a draft only its author. */
async function threadOf(c: PoolClient, pullId: string, me: string) {
  const comments = (
    await c.query<CommentRow>(
      COMMENT_SELECT +
        " WHERE m.pull_request_id = $1 AND (m.state <> 'draft' OR m.author_id = $2) ORDER BY m.path, m.line, m.created_at",
      [pullId, me],
    )
  ).rows;
  const reviews = (
    await c.query<{
      id: string;
      decision: string;
      body: string;
      comments: number;
      author_name: string | null;
      host_ref: string;
      created_at: Date;
    }>(
      `SELECT r.*, u.name AS author_name FROM pull_request_reviews r LEFT JOIN users u ON u.id = r.user_id
        WHERE r.pull_request_id = $1 ORDER BY r.created_at`,
      [pullId],
    )
  ).rows;
  return {
    comments: comments.map((r) => commentJson(r, me)),
    reviews: reviews.map((r) => ({
      id: r.id,
      decision: r.decision,
      body: r.body,
      comments: r.comments,
      author: r.author_name,
      hostRef: r.host_ref,
      createdAt: r.created_at.toISOString(),
    })),
  };
}

async function fileOf(c: PoolClient, pullId: string, path: string): Promise<FileRow> {
  const f = (
    await c.query<FileRow>(
      'SELECT * FROM pull_request_files WHERE pull_request_id = $1 AND path = $2',
      [pullId, path],
    )
  ).rows[0];
  if (!f) throw new HttpError(404, 'not_found', 'The pull request has no such file');
  return f;
}

async function ownComment(c: PoolClient, a: Access, id: string): Promise<CommentRow> {
  const m = (await c.query<CommentRow>(COMMENT_SELECT + ' WHERE m.id = $1', [id])).rows[0];
  if (!m) throw new HttpError(404, 'not_found', 'Comment not found');
  await loadPull(c, a, m.pull_request_id);
  return m;
}

export function prCommentRoutes(
  pool: Pool,
  models: ProviderFor,
  fetchImpl?: typeof fetch,
): Route[] {
  const pullParams = s.object({ workspaceId: uuid, pullId: uuid });
  const commentParams = s.object({ workspaceId: uuid, commentId: uuid });

  const list = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/pull-requests/:pullId/comments',
    summary:
      'The comments on a pull request’s lines (the caller’s drafts, the AI’s suggestions, what was posted) and the reviews submitted',
    tags: ['review'],
    params: pullParams,
    response: threadOut,
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        await loadPull(c, a, params.pullId);
        return { body: await threadOf(c, params.pullId, a.user.id) };
      }),
  });

  const add = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/pull-requests/:pullId/comments',
    summary: 'Write a draft comment on a line the diff shows; it is posted with the next review',
    tags: ['review'],
    params: pullParams,
    body: s.object({
      path: s.string({ min: 1, max: 1000 }),
      line: s.number({ integer: true, min: 1 }),
      side: s.optional(s.enum(['new', 'old'])),
      body: s.string({ min: 1, max: 20000 }),
    }),
    response: commentOut,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const p = await loadPull(c, a, params.pullId);
        const f = await fileOf(c, p.id, body.path);
        const side = body.side ?? 'new';
        if (!onDiff(parsePatch(f.patch), side, body.line))
          throw new HttpError(
            422,
            'invalid_request',
            'Line ' + String(body.line) + ' is not part of the change shown for ' + body.path,
          );
        const me = a.user.id;
        const id = (
          await c.query<{ id: string }>(
            `INSERT INTO pull_request_comments (workspace_id, pull_request_id, path, line, side, body, source, state, author_id, patch_hash)
             VALUES ($1, $2, $3, $4, $5, $6, 'person', 'draft', $7, $8) RETURNING id`,
            [p.workspace_id, p.id, body.path, body.line, side, body.body.trim(), me, f.patch_hash],
          )
        ).rows[0]?.id;
        const row = (await c.query<CommentRow>(COMMENT_SELECT + ' WHERE m.id = $1', [id])).rows[0];
        if (!row) throw new Error('comment insert returned nothing');
        return { status: 201, body: commentJson(row, me) };
      }),
  });

  const change = route({
    method: 'PATCH',
    path: '/api/workspaces/:workspaceId/pull-request-comments/:commentId',
    summary: 'Change the text of one of the caller’s draft comments',
    tags: ['review'],
    params: commentParams,
    body: s.object({ body: s.string({ min: 1, max: 20000 }) }),
    response: commentOut,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const me = a.user.id;
        const m = await ownComment(c, a, params.commentId);
        if (m.state !== 'draft' || m.author_id !== me)
          throw new HttpError(409, 'conflict', 'Only your own draft can be changed');
        await c.query('UPDATE pull_request_comments SET body = $2 WHERE id = $1', [
          m.id,
          body.body.trim(),
        ]);
        return { body: commentJson({ ...m, body: body.body.trim() }, me) };
      }),
  });

  const remove = route({
    method: 'DELETE',
    path: '/api/workspaces/:workspaceId/pull-request-comments/:commentId',
    summary: 'Delete one of the caller’s draft comments',
    tags: ['review'],
    params: commentParams,
    response: s.object({ deleted: s.boolean() }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const m = await ownComment(c, a, params.commentId);
        if (m.state !== 'draft' || m.author_id !== a.user.id)
          throw new HttpError(409, 'conflict', 'Only your own draft can be deleted');
        await c.query('DELETE FROM pull_request_comments WHERE id = $1', [m.id]);
        return { body: { deleted: true } };
      }),
  });

  const decide = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/pull-request-comments/:commentId/decide',
    summary:
      'Accept an AI suggestion (it becomes the caller’s draft, with an edited text if given) or dismiss it',
    tags: ['review'],
    params: commentParams,
    body: s.object({ accept: s.boolean(), body: s.optional(s.string({ min: 1, max: 20000 })) }),
    response: commentOut,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const me = a.user.id;
        const m = await ownComment(c, a, params.commentId);
        if (m.state !== 'suggested')
          throw new HttpError(409, 'conflict', 'This suggestion was already decided');
        const text = body.accept ? (body.body?.trim() ?? m.body) : m.body;
        await c.query(
          `UPDATE pull_request_comments SET state = $2, decided_by = $3, body = $4,
                  author_id = CASE WHEN $2 = 'draft' THEN $3 ELSE author_id END WHERE id = $1`,
          [m.id, body.accept ? 'draft' : 'dismissed', me, text],
        );
        const row = (await c.query<CommentRow>(COMMENT_SELECT + ' WHERE m.id = $1', [m.id]))
          .rows[0];
        if (!row) throw new Error('comment vanished');
        return { body: commentJson(row, me) };
      }),
  });

  const suggest = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/pull-requests/:pullId/ai-comments',
    summary:
      'The Reviewer agent reads the changed lines and suggests comments; earlier suggestions not decided yet are replaced',
    tags: ['review'],
    params: pullParams,
    response: threadOut,
    handler: async ({ params, req }) => {
      await ensureFiles(pool, req, params.workspaceId, params.pullId, false, fetchImpl);
      const before = await asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const p = await loadPull(c, a, params.pullId);
        const files = (
          await c.query<FileRow>(
            'SELECT * FROM pull_request_files WHERE pull_request_id = $1 ORDER BY position',
            [p.id],
          )
        ).rows;
        const title = p.item_ref
          ? (
              await c.query<{ title: string }>(
                'SELECT i.title FROM items i JOIN pull_requests x ON x.item_id = i.id WHERE x.id = $1',
                [p.id],
              )
            ).rows[0]?.title
          : undefined;
        return { p, files, title, me: a.user.id };
      });
      const hunks = new Map<string, Hunk[]>();
      const parts: string[] = [];
      let size = 0;
      for (const f of before.files) {
        if (f.is_binary || f.too_big || f.status === 'deleted' || !f.patch) continue;
        const h = parsePatch(f.patch);
        const text = numberedPatch(f.path, h);
        if (size + text.length > PROMPT_CHARS) break;
        size += text.length;
        hunks.set(f.path, h);
        parts.push(text);
      }
      if (!parts.length)
        throw new HttpError(409, 'conflict', 'The pull request has no changed text to read');
      const asked = await askAgent(pool, models, {
        workspaceId: params.workspaceId,
        projectId: before.p.project_id,
        agentKey: 'reviewer',
        requestedBy: before.me,
        instruction: 'Comment on the lines of pull request #' + String(before.p.number),
        system: LINES_PROMPT,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text:
                  'Pull request #' +
                  String(before.p.number) +
                  ': ' +
                  before.p.title +
                  '\n' +
                  (before.p.item_ref
                    ? 'Task ' + before.p.item_ref + ': ' + (before.title ?? '') + '\n'
                    : 'No task is linked.\n') +
                  '\n' +
                  parts.join('\n\n'),
              },
            ],
          },
        ],
      });
      const found = parseSuggestions(asked.text, hunks);
      return asMember(pool, req, params.workspaceId, 'member', async (c) => {
        await c.query(
          "DELETE FROM pull_request_comments WHERE pull_request_id = $1 AND source = 'ai' AND state = 'suggested'",
          [before.p.id],
        );
        for (const x of found) {
          const f = before.files.find((y) => y.path === x.path);
          await c.query(
            `INSERT INTO pull_request_comments (workspace_id, pull_request_id, path, line, side, body, source, state, severity, run_id, patch_hash)
             VALUES ($1, $2, $3, $4, 'new', $5, 'ai', 'suggested', $6, $7, $8)`,
            [
              before.p.workspace_id,
              before.p.id,
              x.path,
              x.line,
              x.body,
              x.severity,
              asked.runId,
              f?.patch_hash ?? '',
            ],
          );
        }
        return { status: 201, body: await threadOf(c, before.p.id, before.me) };
      });
    },
  });

  const submit = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/pull-requests/:pullId/reviews',
    summary:
      'Submit a review: the caller’s drafts and the decision are posted to the host with the connection’s token',
    tags: ['review'],
    params: pullParams,
    body: s.object({
      decision: s.enum(['approve', 'request_changes', 'comment']),
      body: s.optional(s.string({ max: 20000 })),
    }),
    response: s.object({
      review: reviewOut,
      posted: s.number({ integer: true }),
      /** drafts on files that changed since; kept, not posted */
      outdated: s.number({ integer: true }),
    }),
    handler: async ({ params, body, req }) => {
      const before = await asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const p = await loadPull(c, a, params.pullId);
        const user = a.user;
        const drafts = (
          await c.query<CommentRow>(
            COMMENT_SELECT +
              " WHERE m.pull_request_id = $1 AND m.state = 'draft' AND m.author_id = $2 ORDER BY m.path, m.line",
            [p.id, user.id],
          )
        ).rows;
        return { p, user, drafts };
      });
      const { p, user } = before;
      if (p.state !== 'open')
        throw new HttpError(
          409,
          'conflict',
          'The pull request is ' + p.state + '; it takes no review',
        );
      const fresh = before.drafts.filter((d) => d.file_hash === d.patch_hash);
      const text = body.body?.trim() ?? '';
      if (body.decision !== 'approve' && !text && !fresh.length)
        throw new HttpError(
          422,
          'invalid_request',
          body.decision === 'request_changes'
            ? 'Say what should change: a summary or a comment on a line'
            : 'There is nothing to post: write a summary or a comment on a line',
        );
      const conn = connOf(p, 'the review is posted with it');
      let hostRef: string;
      try {
        hostRef = await postReview(
          conn,
          {
            number: p.number,
            headSha: p.head_sha,
            decision: body.decision,
            body: text ? hostCommentText(text, user.name, false) : '',
            comments: fresh.map((d) => ({
              path: d.path,
              oldPath: d.old_path,
              line: d.line,
              side: d.side,
              body: hostCommentText(d.body, user.name, d.source === 'ai'),
            })),
          },
          fetchImpl,
        );
      } catch (e) {
        throw hostFailure(e);
      }
      return asMember(pool, req, params.workspaceId, 'member', async (c) => {
        const r = (
          await c.query<{ id: string; created_at: Date }>(
            `INSERT INTO pull_request_reviews (workspace_id, pull_request_id, user_id, decision, body, comments, host_ref)
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, created_at`,
            [
              p.workspace_id,
              p.id,
              user.id,
              body.decision,
              text,
              fresh.length,
              hostRef.slice(0, 200),
            ],
          )
        ).rows[0];
        if (!r) throw new Error('review insert returned nothing');
        await c.query(
          "UPDATE pull_request_comments SET state = 'posted', posted_at = now(), review_id = $2 WHERE id = ANY($1::uuid[])",
          [fresh.map((d) => d.id), r.id],
        );
        // the webhook says it again later; until then the queue shows the decision
        if (body.decision !== 'comment')
          await c.query('UPDATE pull_requests SET review_state = $2 WHERE id = $1', [
            p.id,
            body.decision === 'approve' ? 'approved' : 'changes_requested',
          ]);
        else
          await c.query(
            "UPDATE pull_requests SET review_state = 'commented' WHERE id = $1 AND review_state = 'none'",
            [p.id],
          );
        return {
          status: 201,
          body: {
            review: {
              id: r.id,
              decision: body.decision,
              body: text,
              comments: fresh.length,
              author: user.name,
              hostRef,
              createdAt: r.created_at.toISOString(),
            },
            posted: fresh.length,
            outdated: before.drafts.length - fresh.length,
          },
        };
      });
    },
  });

  return [list, add, change, remove, decide, suggest, submit];
}
