// ── [PCODE-306 | S15 | v0.1.0] T31.6 Versions from commits: conventional commits, tags and components per path ──
//    Why:  the version plan reads what reached the default branch since the last version tag and says the
//          next version and why, with a changelog. A monorepo names its components (a folder and a tag
//          prefix) and each is planned from the commits that touched its folder. Planning the release takes
//          that version and the changelog as the team's notes.
import {
  applyBump,
  bumpOf,
  bumpReason,
  commitChangelog,
  lastTag,
  parseCommit,
  touches,
  type Bump,
} from '@orqiva/shared';
import type { Pool, PoolClient } from 'pg';
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s, type Infer } from '../http/schema.js';
import { asMember, requireProject } from './access.js';

const uuid = s.string({ format: 'uuid' });
/** commits read for one plan */
const COMMIT_LIMIT = 2000;

const componentOut = s.object({
  id: s.string(),
  name: s.string(),
  folder: s.string(),
  tagPrefix: s.string(),
  connectionId: s.string(),
  repo: s.string(),
});

const planOut = s.object({
  /** null: the whole repository, when the project names no components */
  componentId: s.nullable(s.string()),
  name: s.string(),
  folder: s.string(),
  tagPrefix: s.string(),
  connectionId: s.string(),
  repo: s.string(),
  lastTag: s.nullable(s.string()),
  lastVersion: s.nullable(s.string()),
  since: s.nullable(s.string()),
  commits: s.number({ integer: true }),
  /** commits whose changed files the host did not list: counted, since they may touch the folder */
  unknownPaths: s.number({ integer: true }),
  nonConventional: s.number({ integer: true }),
  bump: s.string(),
  next: s.nullable(s.string()),
  reason: s.string(),
  changelog: s.string(),
  /** a release with the next version is already planned */
  planned: s.boolean(),
});
type Plan = Infer<typeof planOut>;

interface Target {
  componentId: string | null;
  name: string;
  folder: string;
  tagPrefix: string;
  connectionId: string;
  repo: string;
  defaultBranch: string;
}

async function targetsOf(c: PoolClient, projectId: string): Promise<Target[]> {
  const named = (
    await c.query<{
      id: string;
      name: string;
      folder: string;
      tag_prefix: string;
      connection_id: string;
      repo: string;
      default_branch: string | null;
    }>(
      `SELECT v.*, g.repo, g.default_branch FROM version_components v JOIN git_connections g ON g.id = v.connection_id
        WHERE v.project_id = $1 ORDER BY v.name`,
      [projectId],
    )
  ).rows;
  if (named.length)
    return named.map((v) => ({
      componentId: v.id,
      name: v.name,
      folder: v.folder,
      tagPrefix: v.tag_prefix,
      connectionId: v.connection_id,
      repo: v.repo,
      defaultBranch: v.default_branch ?? 'main',
    }));
  return (
    await c.query<{ id: string; repo: string; default_branch: string | null }>(
      'SELECT id, repo, default_branch FROM git_connections WHERE project_id = $1 ORDER BY created_at',
      [projectId],
    )
  ).rows.map((g) => ({
    componentId: null,
    name: '',
    folder: '',
    tagPrefix: 'v',
    connectionId: g.id,
    repo: g.repo,
    defaultBranch: g.default_branch ?? 'main',
  }));
}

async function planOf(c: PoolClient, projectId: string, t: Target): Promise<Plan> {
  const tags = (
    await c.query<{ name: string; sha: string; created_at: Date }>(
      "SELECT name, sha, created_at FROM git_refs WHERE connection_id = $1 AND kind = 'tag'",
      [t.connectionId],
    )
  ).rows;
  const last = lastTag(tags, t.tagPrefix);
  // the tag's commit time, or when the tag was seen when its commit is not in the history
  const since = last
    ? ((
        await c.query<{ committed_at: Date }>(
          'SELECT committed_at FROM git_commits WHERE connection_id = $1 AND sha = $2',
          [t.connectionId, last.sha],
        )
      ).rows[0]?.committed_at ??
      tags.find((x) => x.name === last.name)?.created_at ??
      null)
    : null;
  const rows = (
    await c.query<{
      sha: string;
      message: string;
      files: { added: string[]; modified: string[]; removed: string[] } | null;
    }>(
      `SELECT sha, message, files FROM git_commits
        WHERE connection_id = $1 AND branch = $2 AND ($3::timestamptz IS NULL OR committed_at > $3) AND reverted_by IS NULL
          AND reverts IS NULL
        ORDER BY committed_at LIMIT $4`,
      [t.connectionId, t.defaultBranch, since, COMMIT_LIMIT],
    )
  ).rows;
  let unknownPaths = 0;
  const mine = rows.filter((r) => {
    const hit = touches(r.files, t.folder);
    if (hit === null) unknownPaths += 1;
    return hit !== false;
  });
  const parsed = mine.map((r) => parseCommit(r.message));
  const bump: Bump = bumpOf(parsed);
  const next = applyBump(last?.version ?? null, bump);
  const planned = next
    ? Boolean(
        (
          await c.query(
            'SELECT 1 FROM releases WHERE project_id = $1 AND component = $2 AND version = $3',
            [projectId, t.name, next],
          )
        ).rowCount,
      )
    : false;
  return {
    componentId: t.componentId,
    name: t.name,
    folder: t.folder,
    tagPrefix: t.tagPrefix,
    connectionId: t.connectionId,
    repo: t.repo,
    lastTag: last?.name ?? null,
    lastVersion: last?.version ?? null,
    since: since?.toISOString() ?? null,
    commits: mine.length,
    unknownPaths,
    nonConventional: parsed.filter((p) => !p.conventional).length,
    bump,
    next,
    reason: bumpReason(parsed, bump),
    changelog: commitChangelog(mine),
    planned,
  };
}

export function commitVersionRoutes(pool: Pool): Route[] {
  const projectParams = s.object({ workspaceId: uuid, projectId: uuid });

  const components = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/projects/:projectId/version-components',
    summary:
      'The components of a monorepo: each with a folder and a tag prefix, versioned on its own',
    tags: ['versions'],
    params: projectParams,
    response: s.array(componentOut),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        await requireProject(c, a, params.projectId);
        const rows = (
          await c.query<{
            id: string;
            name: string;
            folder: string;
            tag_prefix: string;
            connection_id: string;
            repo: string;
          }>(
            `SELECT v.*, g.repo FROM version_components v JOIN git_connections g ON g.id = v.connection_id
              WHERE v.project_id = $1 ORDER BY v.name`,
            [params.projectId],
          )
        ).rows;
        return {
          body: rows.map((r) => ({
            id: r.id,
            name: r.name,
            folder: r.folder,
            tagPrefix: r.tag_prefix,
            connectionId: r.connection_id,
            repo: r.repo,
          })),
        };
      }),
  });

  const addComponent = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/projects/:projectId/version-components',
    summary:
      'Name a component: a folder of a connected repository and the prefix of its version tags (admins)',
    tags: ['versions'],
    params: projectParams,
    body: s.object({
      connectionId: uuid,
      name: s.string({ min: 1, max: 60 }),
      folder: s.string({ max: 250 }),
      tagPrefix: s.string({ max: 60 }),
    }),
    response: componentOut,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'admin', async (c, a) => {
        await requireProject(c, a, params.projectId);
        const g = (
          await c.query<{ repo: string }>(
            'SELECT repo FROM git_connections WHERE id = $1 AND project_id = $2',
            [body.connectionId, params.projectId],
          )
        ).rows[0];
        if (!g) throw new HttpError(404, 'not_found', 'The project has no such repository');
        const folder = body.folder.trim().replace(/^\/+|\/+$/g, '');
        const r = await c
          .query<{ id: string }>(
            `INSERT INTO version_components (workspace_id, project_id, connection_id, name, folder, tag_prefix)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
            [
              params.workspaceId,
              params.projectId,
              body.connectionId,
              body.name.trim(),
              folder,
              body.tagPrefix.trim(),
            ],
          )
          .catch((e: unknown) => {
            if ((e as { code?: string }).code === '23505')
              throw new HttpError(409, 'conflict', 'A component is already called ' + body.name);
            throw e;
          });
        return {
          status: 201,
          body: {
            id: r.rows[0]?.id ?? '',
            name: body.name.trim(),
            folder,
            tagPrefix: body.tagPrefix.trim(),
            connectionId: body.connectionId,
            repo: g.repo,
          },
        };
      }),
  });

  const removeComponent = route({
    method: 'DELETE',
    path: '/api/workspaces/:workspaceId/version-components/:componentId',
    summary: 'Stop versioning a component on its own (admins); its releases stay',
    tags: ['versions'],
    params: s.object({ workspaceId: uuid, componentId: uuid }),
    response: s.object({ deleted: s.boolean() }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'admin', async (c, a) => {
        const v = (
          await c.query<{ project_id: string }>(
            'SELECT project_id FROM version_components WHERE id = $1',
            [params.componentId],
          )
        ).rows[0];
        if (!v) throw new HttpError(404, 'not_found', 'Component not found');
        await requireProject(c, a, v.project_id);
        await c.query('DELETE FROM version_components WHERE id = $1', [params.componentId]);
        return { body: { deleted: true } };
      }),
  });

  const plan = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/projects/:projectId/version-plan',
    summary:
      'The next version of each component (or repository) from the conventional commits since its last version tag, with the reason and a changelog',
    tags: ['versions'],
    params: projectParams,
    response: s.array(planOut),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        await requireProject(c, a, params.projectId);
        const out: Plan[] = [];
        for (const t of await targetsOf(c, params.projectId))
          out.push(await planOf(c, params.projectId, t));
        return { body: out };
      }),
  });

  const release = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/projects/:projectId/version-plan/release',
    summary:
      'Plan the release a component’s commits call for: its next version, with the changelog as the team’s notes',
    tags: ['versions'],
    params: projectParams,
    body: s.object({ connectionId: uuid, componentId: s.nullable(uuid) }),
    response: s.object({ id: s.string(), version: s.string(), component: s.string() }),
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        await requireProject(c, a, params.projectId);
        const t = (await targetsOf(c, params.projectId)).find(
          (x) => x.connectionId === body.connectionId && x.componentId === body.componentId,
        );
        if (!t) throw new HttpError(404, 'not_found', 'No such component');
        const p = await planOf(c, params.projectId, t);
        if (!p.next)
          throw new HttpError(409, 'conflict', p.reason + ': there is nothing to release');
        if (p.planned)
          throw new HttpError(
            409,
            'conflict',
            (p.name || 'The project') + ' ' + p.next + ' is already planned',
          );
        const id = (
          await c.query<{ id: string }>(
            `INSERT INTO releases (workspace_id, project_id, version, name, component, notes_team, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
            [
              params.workspaceId,
              params.projectId,
              p.next,
              (p.name ? p.name + ' ' : '') + p.next,
              p.name,
              p.changelog,
              a.user.id,
            ],
          )
        ).rows[0]?.id;
        if (!id) throw new Error('release insert returned nothing');
        return { status: 201, body: { id, version: p.next, component: p.name } };
      }),
  });

  return [components, addComponent, removeComponent, plan, release];
}
