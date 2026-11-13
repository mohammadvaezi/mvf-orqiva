// ── [PCODE-351 | S15 | v0.1.0] T35.3b Settings for teams and projects in the screen, project leads as project admins, budget warnings at 50/80/100 % ──
// ── [PCODE-299 | S15 | v0.1.0] T31.1 GitLab and Azure Repos: webhooks, secrets, setup, read into one shape ──
// ── [PCODE-288 | S15 | v0.1.0] T30.2 Design tokens exported as a pull request (GitHub, Gitea) ──
// ── [PCODE-108 | S15 | v0.1.0] Integrate Git hosts: GitHub and Gitea webhooks, commits and PRs on items, live ──
//    Why:  connecting a repository is an admin's decision: it lets a Git host write into the project. The
//          secret is made here, shown once, and checked on every delivery; the list never shows it again.
//          An item's commits and pull requests are readable by anyone who sees the item.
import { randomBytes } from 'node:crypto';
import type { Pool } from 'pg';
import { recordEvent } from '../events/outbox.js';
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s } from '../http/schema.js';
import { actorOf, asMember, requireProject, requireProjectAdmin, projectOf } from './access.js';
import { seal, SecretKeyMissing } from '../agents/secrets.js'; // [PCODE-288 | S15 | v0.1.0]
import { apiUrlProblem } from '../git/hostapi.js';
import { PROVIDERS, repoProblem } from '../git/hosts.js'; // [PCODE-299 | S15 | v0.1.0]

const uuid = s.string({ format: 'uuid' });
const hookPath = (id: string): string => '/hooks/git/' + id;

const connectionOut = s.object({
  id: s.string(),
  provider: s.string(),
  repo: s.string(),
  webhookPath: s.string(),
  createdAt: s.string(),
  lastDeliveryAt: s.nullable(s.string()),
  apiUrl: s.nullable(s.string()), // [PCODE-288 | S15 | v0.1.0] for a self-hosted host
  canWrite: s.boolean(), // an API token is set
});
interface ConnRow {
  id: string;
  provider: string;
  repo: string;
  created_at: Date;
  last_delivery_at: Date | null;
  api_url?: string | null;
  can_write?: boolean;
}
const CONN_COLS =
  'id, provider, repo, created_at, last_delivery_at, api_url, api_token IS NOT NULL AS can_write';
const connJson = (r: ConnRow) => ({
  id: r.id,
  provider: r.provider,
  repo: r.repo,
  webhookPath: hookPath(r.id),
  createdAt: r.created_at.toISOString(),
  lastDeliveryAt: r.last_delivery_at?.toISOString() ?? null,
  apiUrl: r.api_url ?? null,
  canWrite: r.can_write ?? false,
});

export function gitRoutes(pool: Pool): Route[] {
  const create = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/projects/:projectId/git',
    summary:
      'Connect a GitHub, Gitea, GitLab or Azure Repos repository; the webhook secret is in this answer only (admin)',
    tags: ['git'],
    params: s.object({ workspaceId: uuid, projectId: uuid }),
    body: s.object({
      provider: s.enum(PROVIDERS), // [PCODE-299 | S15 | v0.1.0] GitLab and Azure Repos too
      repo: s.string({ min: 3, max: 200 }),
    }),
    response: s.object({ connection: connectionOut, secret: s.string() }),
    status: 201,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        // [PCODE-351 | S15 | v0.1.0] an admin, or the lead of this project
        await requireProjectAdmin(c, a, params.projectId);
        const p = await requireProject(c, a, params.projectId);
        const bad = repoProblem(body.provider, body.repo.trim());
        if (bad)
          throw new HttpError(400, 'invalid_request', 'The repository ' + bad, [
            { path: 'body.repo', message: bad },
          ]);
        const secret = randomBytes(32).toString('hex');
        const row = (
          await c.query<ConnRow>(
            `INSERT INTO git_connections (workspace_id, project_id, provider, repo, secret, created_by)
             VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (project_id, provider, repo) DO NOTHING
             RETURNING ${CONN_COLS}`,
            [a.workspaceId, p.id, body.provider, body.repo, secret, a.user.id],
          )
        ).rows[0];
        if (!row)
          throw new HttpError(409, 'conflict', body.repo + ' is already connected to ' + p.key);
        await recordEvent(
          c,
          a.workspaceId,
          {
            actor: actorOf(a),
            verb: 'created',
            object: { type: 'project', id: p.id, label: p.key + ' ' + p.name },
            changes: { git: { from: null, to: body.provider + ':' + body.repo } },
          },
          { projectId: p.id },
        );
        return { status: 201, body: { connection: connJson(row), secret } };
      }),
  });

  const list = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/projects/:projectId/git',
    summary: 'The repositories connected to a project (without their secrets)',
    tags: ['git'],
    params: s.object({ workspaceId: uuid, projectId: uuid }),
    response: s.array(connectionOut),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const p = await requireProject(c, a, params.projectId);
        const rows = (
          await c.query<ConnRow>(
            'SELECT ' +
              CONN_COLS +
              ' FROM git_connections WHERE project_id = $1 ORDER BY created_at',
            [p.id],
          )
        ).rows;
        return { body: rows.map(connJson) };
      }),
  });

  // [PCODE-288 | S15 | v0.1.0] the connection may write: an API token, sealed, and the address of a self-hosted host
  const writeAccess = route({
    method: 'PUT',
    path: '/api/workspaces/:workspaceId/git/:connectionId/api',
    summary:
      'Give a connection an API token so it can open pull requests (or remove it with null); the token is never shown again (admin)',
    tags: ['git'],
    params: s.object({ workspaceId: uuid, connectionId: uuid }),
    body: s.object({
      token: s.nullable(s.string({ min: 8, max: 500 })),
      apiUrl: s.optional(s.nullable(s.string({ max: 500 }))),
    }),
    response: connectionOut,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        // [PCODE-351 | S15 | v0.1.0] an admin, or the lead of this project
        await requireProjectAdmin(c, a, await projectOf(c, 'git_connections', params.connectionId));
        const url = body.apiUrl?.trim() || null;
        const bad = url ? apiUrlProblem(url) : null;
        if (bad)
          throw new HttpError(400, 'invalid_request', 'The API address ' + bad, [
            { path: 'body.apiUrl', message: bad },
          ]);
        let sealed: string | null = null;
        try {
          sealed = body.token ? seal(body.token.trim()) : null;
        } catch (e) {
          if (e instanceof SecretKeyMissing) throw new HttpError(409, 'conflict', e.message);
          throw e;
        }
        const row = (
          await c.query<ConnRow & { provider: string }>(
            'UPDATE git_connections SET api_token = $2, api_url = $3 WHERE id = $1 RETURNING ' +
              CONN_COLS,
            [params.connectionId, sealed, url],
          )
        ).rows[0];
        if (!row) throw new HttpError(404, 'not_found', 'Connection not found');
        if (row.provider === 'gitea' && sealed && !url)
          throw new HttpError(400, 'invalid_request', 'A Gitea server needs its API address', [
            {
              path: 'body.apiUrl',
              message: 'is required for Gitea, e.g. https://git.example.com/api/v1',
            },
          ]);
        return { body: connJson(row) };
      }),
  });

  const remove = route({
    method: 'DELETE',
    path: '/api/workspaces/:workspaceId/git/:connectionId',
    summary: 'Disconnect a repository; its deliveries are refused from now on (admin)',
    tags: ['git'],
    params: s.object({ workspaceId: uuid, connectionId: uuid }),
    response: s.object({ ok: s.literal(true) }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        // [PCODE-351 | S15 | v0.1.0] an admin, or the lead of this project
        await requireProjectAdmin(c, a, await projectOf(c, 'git_connections', params.connectionId));
        const r = await c.query('DELETE FROM git_connections WHERE id = $1', [params.connectionId]);
        if (!r.rowCount) throw new HttpError(404, 'not_found', 'Connection not found');
        return { body: { ok: true as const } };
      }),
  });

  const ofItem = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/items/:itemId/git',
    summary: 'The commits and pull requests that name an item, newest first',
    tags: ['git'],
    params: s.object({ workspaceId: uuid, itemId: uuid }),
    response: s.array(
      s.object({
        kind: s.string(),
        ref: s.string(),
        title: s.string(),
        url: s.string(),
        author: s.string(),
        state: s.string(),
        at: s.string(),
        provider: s.string(),
        repo: s.string(),
      }),
    ),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        const projectId = (
          await c.query<{ project_id: string }>('SELECT project_id FROM items WHERE id = $1', [
            params.itemId,
          ])
        ).rows[0]?.project_id;
        if (!projectId) throw new HttpError(404, 'not_found', 'Item not found');
        try {
          await requireProject(c, a, projectId);
        } catch {
          throw new HttpError(404, 'not_found', 'Item not found');
        }
        const rows = (
          await c.query<{
            kind: string;
            ref: string;
            title: string;
            url: string;
            author: string;
            state: string;
            at: Date;
            provider: string;
            repo: string;
          }>(
            `SELECT l.kind, l.ref, l.title, l.url, l.author, l.state, l.at, g.provider, g.repo
             FROM item_git_links l JOIN git_connections g ON g.id = l.connection_id
             WHERE l.item_id = $1 ORDER BY l.at DESC, l.ref`,
            [params.itemId],
          )
        ).rows;
        return { body: rows.map((r) => ({ ...r, at: r.at.toISOString() })) };
      }),
  });

  return [create, list, writeAccess, remove, ofItem]; // [PCODE-288 | S15 | v0.1.0] writeAccess
}
