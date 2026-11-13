// ── [PCODE-351 | S15 | v0.1.0] T35.3b Settings for teams and projects in the screen, project leads as project admins, budget warnings at 50/80/100 % ──
// ── [PCODE-307 | S15 | v0.1.0] T31.7 Environment config diff: variables, secrets, settings, flags and versions side by side ──
//    Why:  an environment's plain variables are kept and shown (admins set them); two environments are
//          compared key by key across variables, secrets, settings, feature flags and the version deployed
//          last. A secret's value is opened only on the server to tell whether both are equal, through a
//          keyed hash; the answer says "set" and same or different, never the value. Keys meant to differ
//          are marked expected by an admin.
import { createHmac } from 'node:crypto';
import {
  configDiff,
  driftText,
  flattenSettings,
  keyOf,
  SECRET_NAME,
  type ConfigEntry,
} from '@orqiva/shared';
import type { Pool, PoolClient } from 'pg';
import { open, serverKey } from '../agents/secrets.js';
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s } from '../http/schema.js';
import { asMember, requireProject, requireProjectAdmin, projectOf } from './access.js';
import { visibleEnvironment, type EnvironmentRow } from './environments.js';

const uuid = s.string({ format: 'uuid' });

const envVarsOut = s.object({
  id: s.string(),
  key: s.string(),
  name: s.string(),
  vars: s.array(s.object({ name: s.string(), value: s.string(), updatedAt: s.string() })),
});

const rowOut = s.object({
  key: s.string(),
  area: s.string(),
  name: s.string(),
  a: s.nullable(s.string()),
  b: s.nullable(s.string()),
  state: s.string(),
  expected: s.boolean(),
});

async function varsOf(c: PoolClient, envId: string) {
  return (
    await c.query<{ name: string; value: string; updated_at: Date }>(
      'SELECT name, value, updated_at FROM environment_vars WHERE environment_id = $1 ORDER BY name',
      [envId],
    )
  ).rows.map((v) => ({ name: v.name, value: v.value, updatedAt: v.updated_at.toISOString() }));
}

/** Everything an environment's configuration consists of, ready to compare. */
async function entriesOf(c: PoolClient, env: EnvironmentRow): Promise<ConfigEntry[]> {
  const out: ConfigEntry[] = [];
  for (const v of await varsOf(c, env.id))
    out.push({ area: 'variable', name: v.name, shown: v.value, compare: v.value });

  let key: Buffer | null = null;
  try {
    key = serverKey();
  } catch {
    key = null;
  }
  const secrets = (
    await c.query<{ name: string; ciphertext: string }>(
      'SELECT name, ciphertext FROM environment_secrets WHERE environment_id = $1',
      [env.id],
    )
  ).rows;
  for (const sec of secrets) {
    let compare: string;
    try {
      if (!key) throw new Error('no key');
      // the same value gives the same hash within this server; the hash never leaves it
      compare = createHmac('sha256', key)
        .update('env-config:' + open(sec.ciphertext, key))
        .digest('hex');
    } catch {
      compare = 'unreadable:' + sec.ciphertext;
    }
    out.push({ area: 'secret', name: sec.name, shown: 'set', compare });
  }

  for (const f of flattenSettings(env.settings))
    out.push({ area: 'setting', name: f.name, shown: f.value, compare: f.value });

  const flags = (
    await c.query<{ key: string; enabled: Record<string, unknown> }>(
      'SELECT key, enabled FROM feature_flags WHERE project_id = $1 AND removed_at IS NULL',
      [env.project_id],
    )
  ).rows;
  for (const f of flags) {
    const on = f.enabled[env.key];
    if (typeof on !== 'boolean') continue;
    const shown = on ? 'on' : 'off';
    out.push({ area: 'flag', name: f.key, shown, compare: shown });
  }

  const deployed = (
    await c.query<{ ref: string }>(
      `SELECT ref FROM deploy_runs WHERE environment_id = $1 AND status = 'succeeded'
        ORDER BY coalesce(finished_at, created_at) DESC LIMIT 1`,
      [env.id],
    )
  ).rows[0];
  if (deployed?.ref)
    out.push({ area: 'version', name: 'deployed', shown: deployed.ref, compare: deployed.ref });
  return out;
}

export function envConfigRoutes(pool: Pool): Route[] {
  const projectParams = s.object({ workspaceId: uuid, projectId: uuid });

  const list = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/projects/:projectId/env-config',
    summary:
      'Each environment’s plain variables (secrets are listed with the environments, by name)',
    tags: ['environments'],
    params: projectParams,
    response: s.array(envVarsOut),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        await requireProject(c, a, params.projectId);
        const envs = (
          await c.query<{ id: string; key: string; name: string }>(
            'SELECT id, key, name FROM environments WHERE project_id = $1 ORDER BY position, created_at',
            [params.projectId],
          )
        ).rows;
        const out = [];
        for (const e of envs) out.push({ ...e, vars: await varsOf(c, e.id) });
        return { body: out };
      }),
  });

  const varParams = s.object({
    workspaceId: uuid,
    environmentId: uuid,
    name: s.string({ pattern: SECRET_NAME }),
  });

  const setVar = route({
    method: 'PUT',
    path: '/api/workspaces/:workspaceId/environments/:environmentId/vars/:name',
    summary:
      'Set a plain variable of an environment; it can be read, so secrets belong in secrets (admin)',
    tags: ['environments'],
    params: varParams,
    body: s.object({ value: s.string({ max: 4000 }) }),
    response: envVarsOut,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        // [PCODE-351 | S15 | v0.1.0] an admin, or the lead of this project
        await requireProjectAdmin(c, a, await projectOf(c, 'environments', params.environmentId));
        const env = await visibleEnvironment(c, a, params.environmentId);
        await c.query(
          `INSERT INTO environment_vars (environment_id, name, workspace_id, value, updated_by) VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (environment_id, name) DO UPDATE SET value = $4, updated_by = $5, updated_at = now()`,
          [env.id, params.name, a.workspaceId, body.value, a.user.id],
        );
        return {
          body: { id: env.id, key: env.key, name: env.name, vars: await varsOf(c, env.id) },
        };
      }),
  });

  const removeVar = route({
    method: 'DELETE',
    path: '/api/workspaces/:workspaceId/environments/:environmentId/vars/:name',
    summary: 'Remove a plain variable of an environment (admin)',
    tags: ['environments'],
    params: varParams,
    response: envVarsOut,
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        // [PCODE-351 | S15 | v0.1.0] an admin, or the lead of this project
        await requireProjectAdmin(c, a, await projectOf(c, 'environments', params.environmentId));
        const env = await visibleEnvironment(c, a, params.environmentId);
        const gone = await c.query(
          'DELETE FROM environment_vars WHERE environment_id = $1 AND name = $2',
          [env.id, params.name],
        );
        if (!gone.rowCount) throw new HttpError(404, 'not_found', 'No variable ' + params.name);
        return {
          body: { id: env.id, key: env.key, name: env.name, vars: await varsOf(c, env.id) },
        };
      }),
  });

  const diff = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/projects/:projectId/env-diff',
    summary:
      'Two environments side by side: variables, secrets (same or different, never the value), settings, flags and the deployed version',
    tags: ['environments'],
    params: projectParams,
    query: s.object({ a: uuid, b: uuid }),
    response: s.object({
      a: s.object({ id: s.string(), name: s.string() }),
      b: s.object({ id: s.string(), name: s.string() }),
      rows: s.array(rowOut),
      drift: s.string(),
    }),
    handler: ({ params, query, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        await requireProject(c, a, params.projectId);
        const ea = await visibleEnvironment(c, a, query.a);
        const eb = await visibleEnvironment(c, a, query.b);
        if (ea.project_id !== params.projectId || eb.project_id !== params.projectId)
          throw new HttpError(404, 'not_found', 'Environment not found');
        const expected = new Set(
          (
            await c.query<{ key: string }>(
              'SELECT key FROM config_expected_diffs WHERE project_id = $1',
              [params.projectId],
            )
          ).rows.map((r) => r.key),
        );
        const rows = configDiff(await entriesOf(c, ea), await entriesOf(c, eb), expected);
        return {
          body: {
            a: { id: ea.id, name: ea.name },
            b: { id: eb.id, name: eb.name },
            rows,
            drift: driftText(rows, ea.name, eb.name),
          },
        };
      }),
  });

  const expect = route({
    method: 'PUT',
    path: '/api/workspaces/:workspaceId/projects/:projectId/expected-diffs',
    summary: 'Mark a configuration key as meant to differ between environments, or not (admin)',
    tags: ['environments'],
    params: projectParams,
    body: s.object({
      area: s.enum(['variable', 'secret', 'setting', 'flag', 'version']),
      name: s.string({ min: 1, max: 280 }),
      expected: s.boolean(),
      note: s.optional(s.string({ max: 300 })),
    }),
    response: s.object({ expected: s.array(s.string()) }),
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        // [PCODE-351 | S15 | v0.1.0] an admin, or the lead of this project
        await requireProjectAdmin(c, a, params.projectId);
        await requireProject(c, a, params.projectId);
        const key = keyOf(body.area, body.name);
        if (body.expected)
          await c.query(
            `INSERT INTO config_expected_diffs (project_id, key, workspace_id, note, created_by) VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (project_id, key) DO UPDATE SET note = $4`,
            [params.projectId, key, a.workspaceId, body.note ?? '', a.user.id],
          );
        else
          await c.query('DELETE FROM config_expected_diffs WHERE project_id = $1 AND key = $2', [
            params.projectId,
            key,
          ]);
        return {
          body: {
            expected: (
              await c.query<{ key: string }>(
                'SELECT key FROM config_expected_diffs WHERE project_id = $1 ORDER BY key',
                [params.projectId],
              )
            ).rows.map((r) => r.key),
          },
        };
      }),
  });

  return [list, setVar, removeVar, diff, expect];
}
