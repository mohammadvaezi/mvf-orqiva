// ── [PCODE-351 | S15 | v0.1.0] T35.3b Settings for teams and projects in the screen, project leads as project admins, budget warnings at 50/80/100 % ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-131 | S15 | v0.1.0] Add environments and the secrets vault ──
//    Why:  a project's environments and their secrets. Admins set them up; members see them, with secret
//          names only. A secret's value is sealed on the way in and never comes back out of this API: only a
//          deploy run of the environment opens it, for the runner that claimed the run.
import { ENVIRONMENT_KINDS, SECRET_NAME, settingsProblems } from '@orqiva/shared';
import type { Pool, PoolClient } from 'pg';
import { SecretKeyMissing, seal } from '../agents/secrets.js';
import { recordEvent } from '../events/outbox.js';
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s, type Infer } from '../http/schema.js';
import {
  actorOf,
  asMember,
  isUniqueViolation,
  requireProject,
  type Access,
  requireProjectAdmin,
  projectOf,
} from './access.js';

const uuid = s.string({ format: 'uuid' });
const envParams = s.object({ workspaceId: uuid, environmentId: uuid });

export const environmentOut = s.object({
  id: s.string(),
  projectId: s.string(),
  key: s.string(),
  name: s.string(),
  kind: s.string(),
  settings: s.anyObject(),
  healthUrl: s.string(),
  deployOnGate: s.nullable(s.string()),
  secrets: s.array(
    s.object({ name: s.string(), updatedAt: s.string(), updatedBy: s.nullable(s.string()) }),
  ),
  createdAt: s.string(),
});
type EnvironmentJson = Infer<typeof environmentOut>;

export interface EnvironmentRow {
  id: string;
  project_id: string;
  project_key: string;
  key: string;
  name: string;
  kind: string;
  settings: Record<string, string>;
  health_url: string;
  deploy_on_gate: string | null;
  created_at: Date;
}

const ENV_SELECT = `SELECT e.*, p.key AS project_key FROM environments e JOIN projects p ON p.id = e.project_id`;

async function withSecrets(c: PoolClient, rows: EnvironmentRow[]): Promise<EnvironmentJson[]> {
  const secrets = (
    await c.query<{
      environment_id: string;
      name: string;
      updated_at: Date;
      updated_by_name: string | null;
    }>(
      `SELECT k.environment_id, k.name, k.updated_at, u.name AS updated_by_name
         FROM environment_secrets k LEFT JOIN users u ON u.id = k.updated_by
        WHERE k.environment_id = ANY($1::uuid[]) ORDER BY k.name`,
      [rows.map((r) => r.id)],
    )
  ).rows;
  return rows.map((r) => ({
    id: r.id,
    projectId: r.project_id,
    key: r.key,
    name: r.name,
    kind: r.kind,
    settings: r.settings,
    healthUrl: r.health_url,
    deployOnGate: r.deploy_on_gate,
    secrets: secrets
      .filter((k) => k.environment_id === r.id)
      .map((k) => ({
        name: k.name,
        updatedAt: k.updated_at.toISOString(),
        updatedBy: k.updated_by_name,
      })),
    createdAt: r.created_at.toISOString(),
  }));
}

/** The environment, if the caller may see its project; guests never see environments. */
export async function visibleEnvironment(
  c: PoolClient,
  a: Access,
  id: string,
): Promise<EnvironmentRow> {
  const r = (await c.query<EnvironmentRow>(ENV_SELECT + ' WHERE e.id = $1', [id])).rows[0];
  if (!r || a.role === 'guest') throw new HttpError(404, 'not_found', 'Environment not found');
  await requireProject(c, a, r.project_id);
  return r;
}

async function envEvent(
  c: PoolClient,
  a: Access,
  r: EnvironmentRow,
  verb: 'created' | 'updated' | 'deleted',
  changes: Record<string, { from: unknown; to: unknown }> = {},
): Promise<void> {
  await recordEvent(
    c,
    a.workspaceId,
    {
      actor: actorOf(a),
      verb,
      object: { type: 'environment', id: r.id, label: r.project_key + ' ' + r.name },
      parent: { type: 'project', id: r.project_id, label: r.project_key },
      changes,
    },
    { projectId: r.project_id },
  );
}

const checkSettings = (kind: string, settings: unknown): void => {
  const problems = settingsProblems(kind, settings);
  if (problems.length)
    throw new HttpError(
      400,
      'invalid_request',
      'The settings are not complete',
      problems.map((message) => ({ path: 'body.settings', message })),
    );
};

const healthUrl = s.optional(s.string({ max: 500, pattern: /^(https?:\/\/\S+)?$/ }));
const gateKey = s.optional(s.nullable(s.string({ pattern: /^[a-z0-9-]{1,40}$/ })));

export function environmentRoutes(pool: Pool): Route[] {
  const list = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/projects/:projectId/environments',
    summary: 'The project’s environments, with the names of their secrets (member)',
    tags: ['environments'],
    params: s.object({ workspaceId: uuid, projectId: uuid }),
    response: s.array(environmentOut),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const p = await requireProject(c, a, params.projectId);
        const rows = (
          await c.query<EnvironmentRow>(
            ENV_SELECT + ' WHERE e.project_id = $1 ORDER BY e.position, e.created_at',
            [p.id],
          )
        ).rows;
        return { body: await withSecrets(c, rows) };
      }),
  });

  const create = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/projects/:projectId/environments',
    summary: 'Add an environment (admin)',
    tags: ['environments'],
    params: s.object({ workspaceId: uuid, projectId: uuid }),
    body: s.object({
      key: s.string({ pattern: /^[a-z][a-z0-9-]{0,29}$/ }),
      name: s.string({ min: 1, max: 60 }),
      kind: s.enum([...ENVIRONMENT_KINDS]),
      settings: s.anyObject(),
      healthUrl,
      deployOnGate: gateKey,
    }),
    response: environmentOut,
    status: 201,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        // [PCODE-351 | S15 | v0.1.0] an admin, or the lead of this project
        await requireProjectAdmin(c, a, params.projectId);
        const p = await requireProject(c, a, params.projectId);
        checkSettings(body.kind, body.settings);
        let id: string | undefined;
        try {
          id = (
            await c.query<{ id: string }>(
              `INSERT INTO environments (workspace_id, project_id, key, name, kind, settings, health_url, deploy_on_gate, position)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, (SELECT count(*) FROM environments WHERE project_id = $2)) RETURNING id`,
              [
                a.workspaceId,
                p.id,
                body.key,
                body.name.trim(),
                body.kind,
                JSON.stringify(body.settings),
                body.healthUrl ?? '',
                body.deployOnGate ?? null,
              ],
            )
          ).rows[0]?.id;
        } catch (e) {
          if (isUniqueViolation(e))
            throw new HttpError(
              409,
              'conflict',
              'The project already has an environment ' + body.key,
            );
          throw e;
        }
        if (!id) throw new Error('environment insert returned nothing');
        const env = await visibleEnvironment(c, a, id);
        await envEvent(c, a, env, 'created');
        const [json] = await withSecrets(c, [env]);
        if (!json) throw new Error('environment vanished');
        return { status: 201, body: json };
      }),
  });

  const update = route({
    method: 'PATCH',
    path: '/api/workspaces/:workspaceId/environments/:environmentId',
    summary: 'Change an environment’s name, settings, health URL or gate (admin)',
    tags: ['environments'],
    params: envParams,
    body: s.object({
      name: s.optional(s.string({ min: 1, max: 60 })),
      settings: s.optional(s.anyObject()),
      healthUrl,
      deployOnGate: gateKey,
    }),
    response: environmentOut,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        // [PCODE-351 | S15 | v0.1.0] an admin, or the lead of this project
        await requireProjectAdmin(c, a, await projectOf(c, 'environments', params.environmentId));
        const env = await visibleEnvironment(c, a, params.environmentId);
        if (body.settings) checkSettings(env.kind, body.settings);
        await c.query(
          `UPDATE environments SET name = coalesce($2, name), settings = coalesce($3, settings),
                  health_url = coalesce($4, health_url),
                  deploy_on_gate = CASE WHEN $5 THEN $6 ELSE deploy_on_gate END
            WHERE id = $1`,
          [
            env.id,
            body.name?.trim() ?? null,
            body.settings ? JSON.stringify(body.settings) : null,
            body.healthUrl ?? null,
            body.deployOnGate !== undefined,
            body.deployOnGate ?? null,
          ],
        );
        const after = await visibleEnvironment(c, a, env.id);
        await envEvent(c, a, after, 'updated');
        const [json] = await withSecrets(c, [after]);
        if (!json) throw new Error('environment vanished');
        return { body: json };
      }),
  });

  const remove = route({
    method: 'DELETE',
    path: '/api/workspaces/:workspaceId/environments/:environmentId',
    summary: 'Remove an environment and its secrets (admin)',
    tags: ['environments'],
    params: envParams,
    response: s.object({ deleted: s.boolean() }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        // [PCODE-351 | S15 | v0.1.0] an admin, or the lead of this project
        await requireProjectAdmin(c, a, await projectOf(c, 'environments', params.environmentId));
        const env = await visibleEnvironment(c, a, params.environmentId);
        await c.query('DELETE FROM environments WHERE id = $1', [env.id]);
        await envEvent(c, a, env, 'deleted');
        return { body: { deleted: true } };
      }),
  });

  const setSecret = route({
    method: 'PUT',
    path: '/api/workspaces/:workspaceId/environments/:environmentId/secrets/:name',
    summary: 'Store or replace a secret; its value is sealed and never shown again (admin)',
    tags: ['environments'],
    params: s.object({
      workspaceId: uuid,
      environmentId: uuid,
      name: s.string({ pattern: SECRET_NAME }),
    }),
    body: s.object({ value: s.string({ min: 1, max: 20_000 }) }),
    response: environmentOut,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        // [PCODE-351 | S15 | v0.1.0] an admin, or the lead of this project
        await requireProjectAdmin(c, a, await projectOf(c, 'environments', params.environmentId));
        const env = await visibleEnvironment(c, a, params.environmentId);
        let sealed: string;
        try {
          sealed = seal(body.value);
        } catch (e) {
          if (e instanceof SecretKeyMissing) throw new HttpError(409, 'conflict', e.message);
          throw e;
        }
        const existed = (
          await c.query(
            `INSERT INTO environment_secrets (workspace_id, environment_id, name, ciphertext, updated_by)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (environment_id, name) DO UPDATE SET ciphertext = $4, updated_by = $5, updated_at = now()
             RETURNING (xmax <> 0) AS replaced`,
            [a.workspaceId, env.id, params.name, sealed, a.user.id],
          )
        ).rows[0] as { replaced: boolean } | undefined;
        await envEvent(c, a, env, 'updated', {
          secret: { from: existed?.replaced ? params.name : null, to: params.name },
        });
        const [json] = await withSecrets(c, [env]);
        if (!json) throw new Error('environment vanished');
        return { body: json };
      }),
  });

  const removeSecret = route({
    method: 'DELETE',
    path: '/api/workspaces/:workspaceId/environments/:environmentId/secrets/:name',
    summary: 'Remove a secret (admin)',
    tags: ['environments'],
    params: s.object({
      workspaceId: uuid,
      environmentId: uuid,
      name: s.string({ pattern: SECRET_NAME }),
    }),
    response: environmentOut,
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        // [PCODE-351 | S15 | v0.1.0] an admin, or the lead of this project
        await requireProjectAdmin(c, a, await projectOf(c, 'environments', params.environmentId));
        const env = await visibleEnvironment(c, a, params.environmentId);
        const gone = await c.query(
          'DELETE FROM environment_secrets WHERE environment_id = $1 AND name = $2',
          [env.id, params.name],
        );
        if (!gone.rowCount) throw new HttpError(404, 'not_found', 'No secret ' + params.name);
        await envEvent(c, a, env, 'updated', { secret: { from: params.name, to: null } });
        const [json] = await withSecrets(c, [env]);
        if (!json) throw new Error('environment vanished');
        return { body: json };
      }),
  });

  return [list, create, update, remove, setSecret, removeSecret];
}
