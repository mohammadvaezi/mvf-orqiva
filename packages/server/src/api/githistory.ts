// ── [PCODE-301 | S15 | v0.1.0] T31.2b Git history backfill through the hosts' APIs; branches and tags in the Repositories screen ──
//    Why:  a repository connected today already has a past. An admin reads it once through the host's API:
//          it is kept exactly as the webhooks keep what is new (the same code, fed the same shapes), but
//          quietly: tasks are linked to their commits and pull requests, nothing moves or closes, and the
//          activity gets one line instead of hundreds. The branches and tags are listed with their commit.
import type { Pool } from 'pg';
import { open } from '../agents/secrets.js';
import { recordEvent } from '../events/outbox.js';
import { HostError } from '../git/hostapi.js';
import { readHistory, type RepoHistory } from '../git/hostread.js';
import { HOST_NAME, type Provider } from '../git/hosts.js';
import { recordHistory, type HistoryConn } from '../git/history.js';
import { recordPulls } from '../git/pulls.js';
import { applyChanges, changesOf } from '../git/webhook.js';
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s } from '../http/schema.js';
import { actorOf, asMember, requireProject } from './access.js';

const uuid = s.string({ format: 'uuid' });

interface ConnRow {
  id: string;
  workspace_id: string;
  project_id: string;
  provider: Provider;
  repo: string;
  secret: string;
  key: string;
  api_url: string | null;
  api_token: string | null;
  host_repo_id: string | null;
  default_branch: string | null;
}

export function gitHistoryRoutes(pool: Pool, fetchImpl?: typeof fetch): Route[] {
  const backfill = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/git/:connectionId/backfill',
    summary:
      'Read a repository’s past through its host’s API (default branch, its last 500 commits, branches, tags, the last 200 pull requests) and keep it; tasks are linked, nothing moves (admin)',
    tags: ['git'],
    params: s.object({ workspaceId: uuid, connectionId: uuid }),
    body: s.object({}),
    response: s.object({
      defaultBranch: s.string(),
      commits: s.number({ integer: true }),
      branches: s.number({ integer: true }),
      tags: s.number({ integer: true }),
      pullRequests: s.number({ integer: true }),
      linked: s.number({ integer: true }),
    }),
    handler: async ({ params, req }) => {
      // the connection and its token, then the host, then one transaction to keep it all
      const conn = await asMember(pool, req, params.workspaceId, 'admin', async (c, a) => {
        const r = (
          await c.query<ConnRow>(
            `SELECT g.id, g.workspace_id, g.project_id, g.provider, g.repo, g.secret, p.key, g.api_url, g.api_token, g.host_repo_id, g.default_branch
               FROM git_connections g JOIN projects p ON p.id = g.project_id WHERE g.id = $1`,
            [params.connectionId],
          )
        ).rows[0];
        if (!r) throw new HttpError(404, 'not_found', 'Connection not found');
        await requireProject(c, a, r.project_id);
        return r;
      });
      if (!conn.api_token)
        throw new HttpError(
          409,
          'conflict',
          'Give the connection an API token first: it reads the history',
        );
      let token: string;
      try {
        token = open(conn.api_token);
      } catch {
        throw new HttpError(409, 'conflict', 'The API token cannot be read; set it again');
      }
      let history: RepoHistory;
      try {
        history = await readHistory(
          { provider: conn.provider, repo: conn.repo, token, apiUrl: conn.api_url },
          fetchImpl,
        );
      } catch (e) {
        if (e instanceof HostError)
          throw new HttpError(
            e.status === 401 || e.status === 403 || e.status === 409 ? 409 : 502,
            'bad_gateway',
            e.message,
          );
        throw e;
      }
      return asMember(pool, req, params.workspaceId, 'admin', async (c, a) => {
        const hc: HistoryConn = { ...conn };
        const repository = { full_name: conn.repo, default_branch: history.defaultBranch };
        let linked = 0;
        for (const b of history.branches)
          await recordHistory(c, hc, {
            event: 'create',
            payload: { ref: b.name, ref_type: 'branch', sha: b.sha, repository },
          });
        for (const t of history.tags)
          await recordHistory(c, hc, {
            event: 'create',
            payload: { ref: t.name, ref_type: 'tag', sha: t.sha, repository },
          });
        if (history.commits.length) {
          const head = history.branches.find((b) => b.name === history.defaultBranch)?.sha ?? '';
          const pushed = {
            ref: 'refs/heads/' + history.defaultBranch,
            after: head,
            commits: history.commits,
            repository,
          };
          await recordHistory(c, hc, { event: 'push', payload: pushed });
          linked += await applyChanges(c, conn, changesOf('push', pushed), { quiet: true });
        }
        let pullRequests = 0;
        for (const pr of history.pulls) {
          const delivery = {
            action: 'backfill',
            number: pr['number'],
            pull_request: pr,
            repository,
          };
          pullRequests += await recordPulls(c, conn, 'pull_request', delivery);
          linked += await applyChanges(c, conn, changesOf('pull_request', delivery), {
            quiet: true,
          });
        }
        await c.query('UPDATE git_connections SET last_backfill_at = now() WHERE id = $1', [
          conn.id,
        ]);
        // one line in the activity for all of it
        await recordEvent(
          c,
          a.workspaceId,
          {
            actor: actorOf(a),
            verb: 'updated',
            object: { type: 'project', id: conn.project_id, label: conn.key },
            changes: {
              gitHistory: {
                from: null,
                to:
                  HOST_NAME[conn.provider] +
                  ' ' +
                  conn.repo +
                  ': ' +
                  String(history.commits.length) +
                  ' commits, ' +
                  String(history.pulls.length) +
                  ' pull requests read',
              },
            },
          },
          { projectId: conn.project_id },
        );
        return {
          body: {
            defaultBranch: history.defaultBranch,
            commits: history.commits.length,
            branches: history.branches.length,
            tags: history.tags.length,
            pullRequests,
            linked,
          },
        };
      });
    },
  });

  const refOut = s.object({
    name: s.string(),
    sha: s.string(),
    updatedAt: s.string(),
    message: s.nullable(s.string()),
    author: s.nullable(s.string()),
    committedAt: s.nullable(s.string()),
  });
  const refs = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/projects/:projectId/git/refs',
    summary:
      'Each repository’s branches and tags with the commit they point at (the default branch first)',
    tags: ['git'],
    params: s.object({ workspaceId: uuid, projectId: uuid }),
    response: s.array(
      s.object({
        connectionId: s.string(),
        provider: s.string(),
        repo: s.string(),
        defaultBranch: s.nullable(s.string()),
        lastBackfillAt: s.nullable(s.string()),
        commits: s.number({ integer: true }),
        branches: s.array(refOut),
        tags: s.array(refOut),
      }),
    ),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const p = await requireProject(c, a, params.projectId);
        const conns = (
          await c.query<{
            id: string;
            provider: string;
            repo: string;
            default_branch: string | null;
            last_backfill_at: Date | null;
            commits: string;
          }>(
            `SELECT g.id, g.provider, g.repo, g.default_branch, g.last_backfill_at,
                    (SELECT count(*) FROM git_commits k WHERE k.connection_id = g.id) AS commits
               FROM git_connections g WHERE g.project_id = $1 ORDER BY g.created_at`,
            [p.id],
          )
        ).rows;
        const rows = (
          await c.query<{
            connection_id: string;
            kind: string;
            name: string;
            sha: string;
            updated_at: Date;
            message: string | null;
            author: string | null;
            committed_at: Date | null;
          }>(
            `SELECT r.connection_id, r.kind, r.name, r.sha, r.updated_at, k.message, k.author, k.committed_at
               FROM git_refs r LEFT JOIN git_commits k ON k.connection_id = r.connection_id AND k.sha = r.sha
              WHERE r.project_id = $1 ORDER BY r.updated_at DESC LIMIT 2000`,
            [p.id],
          )
        ).rows;
        const json = (r: (typeof rows)[number]) => ({
          name: r.name,
          sha: r.sha,
          updatedAt: r.updated_at.toISOString(),
          message: r.message ? (r.message.split('\n')[0] ?? '') : null,
          author: r.author,
          committedAt: r.committed_at?.toISOString() ?? null,
        });
        return {
          body: conns.map((g) => {
            const mine = rows.filter((r) => r.connection_id === g.id);
            const branches = mine.filter((r) => r.kind === 'branch').map(json);
            // the default branch first, then the most recently moved
            branches.sort(
              (x, y) => Number(y.name === g.default_branch) - Number(x.name === g.default_branch),
            );
            return {
              connectionId: g.id,
              provider: g.provider,
              repo: g.repo,
              defaultBranch: g.default_branch,
              lastBackfillAt: g.last_backfill_at?.toISOString() ?? null,
              commits: Number(g.commits),
              branches,
              tags: mine.filter((r) => r.kind === 'tag').map(json),
            };
          }),
        };
      }),
  });

  return [backfill, refs];
}
