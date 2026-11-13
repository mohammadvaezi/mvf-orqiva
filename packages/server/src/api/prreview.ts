// ── [PCODE-304 | S15 | v0.1.0] T31.5a Conflicts, stacked pull requests, and merge policies the host enforces through a commit status ──
// ── [PCODE-303 | S15 | v0.1.0] T31.4 Line comments from people and the AI, posted to the host with approve or request changes ──
// ── [PCODE-302 | S15 | v0.1.0] T31.3 PR review queue (riskiest first) and side-by-side diff with fingerprints and viewed files ──
//    Why:  the review queue puts a project's open pull requests riskiest first and says why; opening one shows
//          its changed files with their patches, the fingerprints the new lines carry, and which files the
//          reader has viewed. The files come from the host's API once per head commit and are kept; a file
//          marked viewed lapses when a push changes its patch.
import {
  fileMarks,
  parsePatch,
  patchHash,
  prRisk,
  stackOf,
  type FileDiff,
  type FileMarks,
  type FileStatus,
  type Mergeable,
} from '@orqiva/shared';
import type { IncomingMessage } from 'node:http';
import type { Pool, PoolClient } from 'pg';
import { open } from '../agents/secrets.js';
import { HostError } from '../git/hostapi.js';
import type { Provider } from '../git/hosts.js';
import { readPullFiles, type PullFiles } from '../git/prfiles.js';
import type { ReadConn } from '../git/hostread.js';
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s } from '../http/schema.js';
import { asMember, requireProject } from './access.js';
import { sizeOf } from './versions.js';
import { policyOf, verdictOf } from './mergepolicy.js'; // [PCODE-304 | S15 | v0.1.0]

const uuid = s.string({ format: 'uuid' });
/** files read for a head commit are re-read after this when the host gave no head commit */
const NO_SHA_TTL_MS = 10 * 60_000;

const riskOut = s.object({
  score: s.number({ integer: true }),
  level: s.string(),
  reasons: s.array(s.string()),
});

const queueOut = s.object({
  id: s.string(),
  number: s.number({ integer: true }),
  title: s.string(),
  url: s.string(),
  author: s.string(),
  repo: s.string(),
  provider: s.string(),
  branch: s.string(),
  base: s.string(),
  draft: s.boolean(),
  additions: s.number({ integer: true }),
  deletions: s.number({ integer: true }),
  changedFiles: s.number({ integer: true }),
  size: s.string(),
  reviewState: s.string(),
  checksState: s.string(),
  itemRef: s.nullable(s.string()),
  openedAt: s.string(),
  updatedAt: s.string(),
  risk: riskOut,
  /** files read from the host for the current head, or null when not read yet */
  files: s.nullable(s.number({ integer: true })),
  viewed: s.number({ integer: true }),
  // [PCODE-304 | S15 | v0.1.0] whether it merges cleanly, where it sits in a stack, the policy's verdict
  mergeable: s.string(),
  stackedOn: s.nullable(s.number({ integer: true })),
  baseMerged: s.nullable(s.number({ integer: true })),
  policy: s.nullable(s.object({ state: s.string(), description: s.string() })),
});

const fileOut = s.object({
  path: s.string(),
  oldPath: s.nullable(s.string()),
  status: s.string(),
  additions: s.number({ integer: true }),
  deletions: s.number({ integer: true }),
  binary: s.boolean(),
  tooBig: s.boolean(),
  patch: s.string(),
  viewed: s.boolean(),
  markers: s.array(
    s.object({ line: s.number({ integer: true }), task: s.string(), title: s.string() }),
  ),
  missing: s.boolean(),
  foreign: s.array(s.string()),
});

// [PCODE-303 | S15 | v0.1.0] shared with the comments and reviews
export interface PullRow {
  id: string;
  workspace_id: string;
  project_id: string;
  connection_id: string;
  number: number;
  title: string;
  url: string;
  author: string;
  branch: string;
  base: string;
  head_sha: string;
  state: string;
  draft: boolean;
  additions: number;
  deletions: number;
  changed_files: number;
  review_state: string;
  checks_state: string;
  item_ref: string | null;
  opened_at: Date;
  updated_at: Date;
  files_sha: string | null;
  files_read_at: Date | null;
  files_truncated: boolean;
  // [PCODE-304 | S15 | v0.1.0]
  mergeable: Mergeable;
  policy_posted: string;
  policy_posted_at: Date | null;
  policy_error: string;
  repo: string;
  provider: Provider;
  api_url: string | null;
  api_token: string | null;
}

export const PULL_SELECT = `SELECT x.*, g.repo, g.provider, g.api_url, g.api_token, p.key || '-' || i.sequence AS item_ref
  FROM pull_requests x JOIN git_connections g ON g.id = x.connection_id
  LEFT JOIN items i ON i.id = x.item_id LEFT JOIN projects p ON p.id = i.project_id`;

export interface FileRow {
  path: string;
  old_path: string | null;
  status: FileStatus;
  additions: number;
  deletions: number;
  is_binary: boolean;
  patch: string;
  too_big: boolean;
  patch_hash: string;
}

/** Whether the kept files still describe the pull request's head. */
export const current = (p: PullRow): boolean =>
  p.files_read_at !== null &&
  (p.head_sha
    ? p.files_sha === p.head_sha
    : Date.now() - p.files_read_at.getTime() < NO_SHA_TTL_MS);

const riskOf = (p: PullRow, files: readonly FileRow[] | null) =>
  prRisk({
    additions: p.additions,
    deletions: p.deletions,
    changedFiles: p.changed_files,
    checksState: p.checks_state,
    reviewState: p.review_state,
    draft: p.draft,
    noTask: p.item_ref === null,
    openedAt: p.opened_at.toISOString(),
    paths: files?.map((f) => f.path) ?? [],
    ...(files ? { unmarked: files.filter((f) => marksOf(f, p.item_ref).missing).length } : {}),
    conflicts: p.mergeable === 'conflicts', // [PCODE-304 | S15 | v0.1.0]
  });

const asDiff = (f: FileRow): FileDiff => ({
  path: f.path,
  oldPath: f.old_path,
  status: f.status,
  additions: f.additions,
  deletions: f.deletions,
  patch: f.patch,
  binary: f.is_binary,
});
// [PCODE-304 | S15 | v0.1.0] exported for the merge policy
export const marksOf = (f: FileRow, task: string | null): FileMarks =>
  fileMarks(asDiff(f), parsePatch(f.patch), task);

// [PCODE-303 | S15 | v0.1.0] a pull request the caller may see, and the connection to its host
export async function loadPull(
  c: PoolClient,
  a: Parameters<typeof requireProject>[1],
  id: string,
): Promise<PullRow> {
  const p = (await c.query<PullRow>(PULL_SELECT + ' WHERE x.id = $1', [id])).rows[0];
  if (!p) throw new HttpError(404, 'not_found', 'Pull request not found');
  await requireProject(c, a, p.project_id);
  return p;
}

export function connOf(p: PullRow, what: string): ReadConn {
  if (!p.api_token)
    throw new HttpError(
      409,
      'conflict',
      'Give the repository’s connection an API token first: ' + what,
    );
  let token: string;
  try {
    token = open(p.api_token);
  } catch {
    throw new HttpError(409, 'conflict', 'The API token cannot be read; set it again');
  }
  return { provider: p.provider, repo: p.repo, token, apiUrl: p.api_url };
}

/** The host's refusal as an answer: a token or setup problem is the caller's to fix (409), the rest 502. */
export function hostFailure(e: unknown): unknown {
  if (e instanceof HostError)
    return new HttpError(
      e.status === 401 || e.status === 403 || e.status === 409 || e.status === 422 ? 409 : 502,
      'bad_gateway',
      e.message,
    );
  return e;
}

/** Reads the pull request's files from the host unless the kept ones describe its head (or refresh). */
export async function ensureFiles(
  pool: Pool,
  req: IncomingMessage,
  workspaceId: string,
  pullId: string,
  refresh: boolean,
  fetchImpl?: typeof fetch,
): Promise<void> {
  const p = await asMember(pool, req, workspaceId, 'member', (c, a) => loadPull(c, a, pullId));
  if (!refresh && current(p)) return;
  const conn = connOf(p, 'the changed files are read with it');
  let read: PullFiles;
  try {
    read = await readPullFiles(conn, p.number, fetchImpl);
  } catch (e) {
    throw hostFailure(e);
  }
  await asMember(pool, req, workspaceId, 'member', (c) => keepFiles(c, p, read));
}

async function keepFiles(c: PoolClient, p: PullRow, read: PullFiles): Promise<void> {
  await c.query('DELETE FROM pull_request_files WHERE pull_request_id = $1', [p.id]);
  let position = 0;
  for (const f of read.files) {
    await c.query(
      `INSERT INTO pull_request_files (pull_request_id, path, workspace_id, position, old_path, status, additions, deletions, is_binary, patch, too_big, patch_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) ON CONFLICT (pull_request_id, path) DO NOTHING`,
      [
        p.id,
        f.path.slice(0, 1000),
        p.workspace_id,
        position++,
        f.oldPath?.slice(0, 1000) ?? null,
        f.status,
        f.additions,
        f.deletions,
        f.binary,
        f.patch,
        f.tooBig,
        // a binary file or one too big to keep is told apart by its counts
        patchHash(f.patch || f.status + ':' + String(f.additions) + ':' + String(f.deletions)),
      ],
    );
  }
  await c.query(
    'UPDATE pull_requests SET files_sha = $2, files_read_at = now(), files_truncated = $3 WHERE id = $1',
    [p.id, p.head_sha || null, read.truncated],
  );
}

export function prReviewRoutes(pool: Pool, fetchImpl?: typeof fetch): Route[] {
  const queue = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/projects/:projectId/review-queue',
    summary:
      'The project’s open pull requests, riskiest first, with the reasons and how many files the caller has viewed',
    tags: ['review'],
    params: s.object({ workspaceId: uuid, projectId: uuid }),
    response: s.array(queueOut),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        await requireProject(c, a, params.projectId);
        const pulls = (
          await c.query<PullRow>(
            PULL_SELECT + " WHERE x.project_id = $1 AND x.state = 'open' LIMIT 300",
            [params.projectId],
          )
        ).rows;
        const ids = pulls.map((p) => p.id);
        const files = (
          await c.query<FileRow & { pull_request_id: string }>(
            'SELECT * FROM pull_request_files WHERE pull_request_id = ANY($1::uuid[])',
            [ids],
          )
        ).rows;
        const views = (
          await c.query<{ pull_request_id: string; n: string }>(
            `SELECT v.pull_request_id, count(*) AS n FROM pull_request_views v
               JOIN pull_request_files f ON f.pull_request_id = v.pull_request_id AND f.path = v.path AND f.patch_hash = v.patch_hash
              WHERE v.user_id = $1 AND v.pull_request_id = ANY($2::uuid[]) GROUP BY v.pull_request_id`,
            [a.user.id, ids],
          )
        ).rows;
        // [PCODE-304 | S15 | v0.1.0] the stacks (with recently merged bases) and the policy
        const merged = (
          await c.query<{
            id: string;
            number: number;
            branch: string;
            base: string;
            connection_id: string;
          }>(
            `SELECT id, number, branch, base, connection_id FROM pull_requests
              WHERE project_id = $1 AND state = 'merged' AND merged_at > now() - interval '90 days' LIMIT 500`,
            [params.projectId],
          )
        ).rows;
        const stackable = [
          ...pulls.map((p) => ({ ...p, connection: p.connection_id })),
          ...merged.map((m) => ({ ...m, state: 'merged', connection: m.connection_id })),
        ];
        const policy = await policyOf(c, params.projectId);
        const ruled = Object.entries(policy).some(([k, v]) => v === true && k !== 'postStatus');
        const rows = pulls.map((p) => {
          const own = current(p) ? files.filter((f) => f.pull_request_id === p.id) : null;
          const stack = stackOf(stackable, p.id);
          const verdict = ruled ? verdictOf(policy, p, own) : null;
          return {
            id: p.id,
            number: p.number,
            title: p.title,
            url: p.url,
            author: p.author,
            repo: p.repo,
            provider: p.provider,
            branch: p.branch,
            base: p.base,
            draft: p.draft,
            additions: p.additions,
            deletions: p.deletions,
            changedFiles: p.changed_files,
            size: sizeOf(p.additions + p.deletions),
            reviewState: p.review_state,
            checksState: p.checks_state,
            itemRef: p.item_ref,
            openedAt: p.opened_at.toISOString(),
            updatedAt: p.updated_at.toISOString(),
            risk: riskOf(p, own),
            files: own ? own.length : null,
            viewed: own ? Number(views.find((v) => v.pull_request_id === p.id)?.n ?? 0) : 0,
            mergeable: p.mergeable,
            stackedOn: stack.parent,
            baseMerged: stack.parentMerged,
            policy: verdict ? { state: verdict.state, description: verdict.description } : null,
          };
        });
        // riskiest first; among equals, the one waiting longest
        return {
          body: rows.sort(
            (x, y) => y.risk.score - x.risk.score || x.updatedAt.localeCompare(y.updatedAt),
          ),
        };
      }),
  });

  const files = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/pull-requests/:pullId/files',
    summary:
      'A pull request’s changed files with their patches, fingerprints and viewed marks; read from the host once per head commit (refresh=1 reads again)',
    tags: ['review'],
    params: s.object({ workspaceId: uuid, pullId: uuid }),
    query: s.object({ refresh: s.optional(s.enum(['1'])) }),
    response: s.object({
      id: s.string(),
      number: s.number({ integer: true }),
      title: s.string(),
      url: s.string(),
      repo: s.string(),
      branch: s.string(),
      base: s.string(),
      state: s.string(),
      itemRef: s.nullable(s.string()),
      risk: riskOut,
      readAt: s.string(),
      truncated: s.boolean(),
      files: s.array(fileOut),
    }),
    handler: async ({ params, query, req }) => {
      // [PCODE-303 | S15 | v0.1.0] the reading moved to ensureFiles, shared with the AI's comments
      await ensureFiles(
        pool,
        req,
        params.workspaceId,
        params.pullId,
        query.refresh === '1',
        fetchImpl,
      );
      return asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const fresh = await loadPull(c, a, params.pullId);
        const rows = (
          await c.query<FileRow>(
            'SELECT * FROM pull_request_files WHERE pull_request_id = $1 ORDER BY position',
            [fresh.id],
          )
        ).rows;
        const seen = new Map(
          (
            await c.query<{ path: string; patch_hash: string }>(
              'SELECT path, patch_hash FROM pull_request_views WHERE pull_request_id = $1 AND user_id = $2',
              [fresh.id, a.user.id],
            )
          ).rows.map((v) => [v.path, v.patch_hash]),
        );
        return {
          body: {
            id: fresh.id,
            number: fresh.number,
            title: fresh.title,
            url: fresh.url,
            repo: fresh.repo,
            branch: fresh.branch,
            base: fresh.base,
            state: fresh.state,
            itemRef: fresh.item_ref,
            risk: riskOf(fresh, rows),
            readAt: (fresh.files_read_at ?? new Date()).toISOString(),
            truncated: fresh.files_truncated,
            files: rows.map((f) => ({
              path: f.path,
              oldPath: f.old_path,
              status: f.status,
              additions: f.additions,
              deletions: f.deletions,
              binary: f.is_binary,
              tooBig: f.too_big,
              patch: f.patch,
              viewed: seen.get(f.path) === f.patch_hash,
              ...marksOf(f, fresh.item_ref),
            })),
          },
        };
      });
    },
  });

  const viewed = route({
    method: 'PUT',
    path: '/api/workspaces/:workspaceId/pull-requests/:pullId/viewed',
    summary:
      'Mark a file of a pull request viewed or not, for the caller; the mark lapses when the file’s patch changes',
    tags: ['review'],
    params: s.object({ workspaceId: uuid, pullId: uuid }),
    body: s.object({ path: s.string({ min: 1, max: 1000 }), viewed: s.boolean() }),
    response: s.object({ viewed: s.number({ integer: true }), files: s.number({ integer: true }) }),
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const p = await loadPull(c, a, params.pullId);
        const file = (
          await c.query<{ patch_hash: string }>(
            'SELECT patch_hash FROM pull_request_files WHERE pull_request_id = $1 AND path = $2',
            [p.id, body.path],
          )
        ).rows[0];
        if (!file) throw new HttpError(404, 'not_found', 'The pull request has no such file');
        if (body.viewed)
          await c.query(
            `INSERT INTO pull_request_views (pull_request_id, user_id, path, workspace_id, patch_hash) VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (pull_request_id, user_id, path) DO UPDATE SET patch_hash = EXCLUDED.patch_hash, viewed_at = now()`,
            [p.id, a.user.id, body.path, p.workspace_id, file.patch_hash],
          );
        else
          await c.query(
            'DELETE FROM pull_request_views WHERE pull_request_id = $1 AND user_id = $2 AND path = $3',
            [p.id, a.user.id, body.path],
          );
        const n = (
          await c.query<{ viewed: string; files: string }>(
            `SELECT (SELECT count(*) FROM pull_request_files WHERE pull_request_id = $1) AS files,
                    (SELECT count(*) FROM pull_request_views v JOIN pull_request_files f
                        ON f.pull_request_id = v.pull_request_id AND f.path = v.path AND f.patch_hash = v.patch_hash
                      WHERE v.pull_request_id = $1 AND v.user_id = $2) AS viewed`,
            [p.id, a.user.id],
          )
        ).rows[0];
        return { body: { viewed: Number(n?.viewed ?? 0), files: Number(n?.files ?? 0) } };
      }),
  });

  return [queue, files, viewed];
}
