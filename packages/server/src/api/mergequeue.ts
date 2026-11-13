// ── [PCODE-305 | S15 | v0.1.0] T31.5b The merge queue: in order per branch, merged through the host when the policy passes ──
//    Why:  ready pull requests wait in line per repository and base branch. "Merge next" takes the first:
//          the host is asked whether it still merges cleanly, the merge policy and the stack are checked,
//          and it is merged through the host pinned to the checked commit. One that cannot merge leaves the
//          line with the reason in words, so the next can go; one that only waits keeps its place.
import type { Pool } from 'pg';
import { inWorkspace } from '../db/pool.js';
import { HostError } from '../git/hostapi.js';
import { mergePull, type MergeMethod } from '../git/prmerge.js';
import { readMergeable } from '../git/prstatus.js';
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s } from '../http/schema.js';
import { asMember, requireProject } from './access.js';
import { filesOf, policyOf, stackFor, verdictOf } from './mergepolicy.js';
import { connOf, hostFailure, loadPull, type PullRow } from './prreview.js';

const uuid = s.string({ format: 'uuid' });

const entryOut = s.object({
  id: s.string(),
  pullId: s.string(),
  number: s.number({ integer: true }),
  title: s.string(),
  url: s.string(),
  repo: s.string(),
  branch: s.string(),
  base: s.string(),
  /** the line it waits in: connection and base branch */
  lane: s.string(),
  method: s.string(),
  state: s.string(),
  reason: s.string(),
  addedBy: s.nullable(s.string()),
  addedAt: s.string(),
  finishedAt: s.nullable(s.string()),
});

const outcomeOut = s.object({
  outcome: s.enum(['merged', 'merging', 'removed', 'waiting', 'empty']),
  number: s.nullable(s.number({ integer: true })),
  reason: s.string(),
});

interface EntryRow {
  id: string;
  pull_request_id: string;
  method: MergeMethod;
  state: string;
  reason: string;
  added_by_name: string | null;
  added_at: Date;
  finished_at: Date | null;
  number: number;
  title: string;
  url: string;
  repo: string;
  branch: string;
  base: string;
  connection_id: string;
}

const laneOf = (connectionId: string, base: string): string => connectionId + ':' + base;

export function mergeQueueRoutes(pool: Pool, o: { fetchImpl?: typeof fetch } = {}): Route[] {
  const list = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/projects/:projectId/merge-queue',
    summary:
      'The merge queue: what waits in line per repository and base branch, and what left it lately and why',
    tags: ['review'],
    params: s.object({ workspaceId: uuid, projectId: uuid }),
    response: s.array(entryOut),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        await requireProject(c, a, params.projectId);
        const rows = (
          await c.query<EntryRow>(
            `SELECT e.*, u.name AS added_by_name, x.number, x.title, x.url, x.branch, x.base, x.connection_id, g.repo
               FROM merge_queue_entries e JOIN pull_requests x ON x.id = e.pull_request_id
               JOIN git_connections g ON g.id = x.connection_id LEFT JOIN users u ON u.id = e.added_by
              WHERE e.project_id = $1 AND (e.state = 'queued' OR e.finished_at > now() - interval '7 days')
              ORDER BY e.state = 'queued' DESC, e.added_at`,
            [params.projectId],
          )
        ).rows;
        return {
          body: rows.map((r) => ({
            id: r.id,
            pullId: r.pull_request_id,
            number: r.number,
            title: r.title,
            url: r.url,
            repo: r.repo,
            branch: r.branch,
            base: r.base,
            lane: laneOf(r.connection_id, r.base),
            method: r.method,
            state: r.state,
            reason: r.reason,
            addedBy: r.added_by_name,
            addedAt: r.added_at.toISOString(),
            finishedAt: r.finished_at?.toISOString() ?? null,
          })),
        };
      }),
  });

  const add = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/pull-requests/:pullId/queue',
    summary: 'Put an open pull request at the end of its branch’s merge queue',
    tags: ['review'],
    params: s.object({ workspaceId: uuid, pullId: uuid }),
    body: s.object({ method: s.optional(s.enum(['merge', 'squash', 'rebase'])) }),
    response: s.object({ position: s.number({ integer: true }) }),
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const p = await loadPull(c, a, params.pullId);
        if (p.state !== 'open')
          throw new HttpError(409, 'conflict', 'The pull request is ' + p.state);
        if (p.draft) throw new HttpError(409, 'conflict', 'A draft cannot be queued');
        const r = await c.query(
          `INSERT INTO merge_queue_entries (workspace_id, project_id, pull_request_id, method, added_by)
           VALUES ($1, $2, $3, $4, $5) ON CONFLICT (pull_request_id) WHERE state = 'queued' DO NOTHING`,
          [p.workspace_id, p.project_id, p.id, body.method ?? 'squash', a.user.id],
        );
        if (!r.rowCount) throw new HttpError(409, 'conflict', 'It is already in the queue');
        const n = (
          await c.query<{ n: string }>(
            `SELECT count(*) AS n FROM merge_queue_entries e JOIN pull_requests x ON x.id = e.pull_request_id
              WHERE e.state = 'queued' AND x.connection_id = $1 AND x.base = $2`,
            [p.connection_id, p.base],
          )
        ).rows[0];
        return { status: 201, body: { position: Number(n?.n ?? 1) } };
      }),
  });

  const remove = route({
    method: 'DELETE',
    path: '/api/workspaces/:workspaceId/pull-requests/:pullId/queue',
    summary: 'Take a pull request out of the merge queue',
    tags: ['review'],
    params: s.object({ workspaceId: uuid, pullId: uuid }),
    response: s.object({ removed: s.boolean() }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const p = await loadPull(c, a, params.pullId);
        const r = await c.query(
          `UPDATE merge_queue_entries SET state = 'removed', reason = $2, finished_at = now()
            WHERE pull_request_id = $1 AND state = 'queued'`,
          [p.id, 'taken out by ' + a.user.name],
        );
        return { body: { removed: (r.rowCount ?? 0) > 0 } };
      }),
  });

  const next = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/projects/:projectId/merge-queue/next',
    summary:
      'Merge the first pull request of a line when the host says it merges cleanly and the policy passes; otherwise say why',
    tags: ['review'],
    params: s.object({ workspaceId: uuid, projectId: uuid }),
    body: s.object({ lane: s.string({ min: 3, max: 400 }) }),
    response: outcomeOut,
    handler: async ({ params, body, req }) => {
      const sep = body.lane.indexOf(':');
      const connectionId = body.lane.slice(0, sep);
      const base = body.lane.slice(sep + 1);
      if (sep < 0 || !/^[0-9a-f-]{36}$/i.test(connectionId))
        throw new HttpError(400, 'invalid_request', 'Not a queue line');
      const first = await asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        await requireProject(c, a, params.projectId);
        const e = (
          await c.query<{ id: string; pull_request_id: string; method: MergeMethod }>(
            `SELECT e.id, e.pull_request_id, e.method FROM merge_queue_entries e JOIN pull_requests x ON x.id = e.pull_request_id
              WHERE e.project_id = $1 AND e.state = 'queued' AND x.connection_id = $2 AND x.base = $3
              ORDER BY e.added_at LIMIT 1 FOR UPDATE OF e`,
            [params.projectId, connectionId, base],
          )
        ).rows[0];
        if (!e) return null;
        return { e, p: await loadPull(c, a, e.pull_request_id) };
      });
      if (!first)
        return { body: { outcome: 'empty' as const, number: null, reason: 'The line is empty' } };
      const { e, p } = first;
      const finish = (state: 'merged' | 'removed' | 'queued', reason: string) =>
        inWorkspace(pool, params.workspaceId, (c) =>
          c.query(
            `UPDATE merge_queue_entries SET state = $2, reason = $3, finished_at = CASE WHEN $2 = 'queued' THEN NULL ELSE now() END
              WHERE id = $1`,
            [e.id, state, reason.slice(0, 500)],
          ),
        );
      const leave = async (reason: string) => {
        await finish('removed', reason);
        return { body: { outcome: 'removed' as const, number: p.number, reason } };
      };
      const wait = async (reason: string) => {
        await finish('queued', reason);
        return { body: { outcome: 'waiting' as const, number: p.number, reason } };
      };
      if (p.state !== 'open') return leave('It is already ' + p.state);
      if (p.draft) return leave('It became a draft');
      const conn = connOf(p, 'the queue merges with it');
      // a stacked pull request waits for the one below without asking the host
      const stack = await inWorkspace(pool, params.workspaceId, (c) => stackFor(c, p));
      if (stack.parent !== null)
        return wait('Stacked on #' + String(stack.parent) + ': that merges first');

      let mergeable;
      try {
        mergeable = await readMergeable(conn, p.number, o.fetchImpl);
      } catch (err) {
        throw hostFailure(err);
      }
      const check = await inWorkspace(pool, params.workspaceId, async (c) => {
        await c.query('UPDATE pull_requests SET mergeable = $2 WHERE id = $1', [p.id, mergeable]);
        const fresh: PullRow = { ...p, mergeable };
        const policy = await policyOf(c, p.project_id);
        return { verdict: verdictOf(policy, fresh, await filesOf(c, fresh)) };
      });
      if (mergeable === 'conflicts') return leave('It has conflicts with ' + p.base);
      if (check.verdict.state === 'failure') return leave(check.verdict.description);
      if (check.verdict.state === 'pending') return wait(check.verdict.description);
      if (mergeable === 'unknown')
        return wait('The host does not know yet whether it merges cleanly');

      let merged: { done: boolean; note: string };
      try {
        merged = await mergePull(
          conn,
          { number: p.number, sha: p.head_sha, method: e.method, title: p.title },
          o.fetchImpl,
        );
      } catch (err) {
        if (err instanceof HostError) return leave('The host did not merge it: ' + err.message);
        throw err;
      }
      // the host's webhook says it too; until then the queue and the stacks see it merged
      if (merged.done)
        await inWorkspace(pool, params.workspaceId, (c) =>
          c.query(
            "UPDATE pull_requests SET state = 'merged', merged_at = now(), updated_at = now() WHERE id = $1",
            [p.id],
          ),
        );
      await finish('merged', merged.note || 'Merged by ' + e.method);
      return {
        body: {
          outcome: merged.done ? ('merged' as const) : ('merging' as const),
          number: p.number,
          reason: merged.note || 'Merged by ' + e.method,
        },
      };
    },
  });

  return [list, add, remove, next];
}
