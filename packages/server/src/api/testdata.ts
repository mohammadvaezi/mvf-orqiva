// ── [PCODE-318 | S15 | v0.1.0] T32.4b Masking of personal data in test results and the test-data vault ──
//    Why:  the test-data vault and the mask every test result passes through. Values are sealed with the
//          server key; the list shows an open value and only the name of a sensitive one, which a tester
//          reveals one at a time (who did last is kept). Before a result is kept, personal data and the
//          vault's values are masked, unless the project's setting says not to.
import { maskPersonal } from '@orqiva/shared';
import type { Pool, PoolClient } from 'pg';
import { SecretKeyMissing, open, seal } from '../agents/secrets.js';
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s } from '../http/schema.js';
import { asMember, requireProject } from './access.js';
import { settingFor } from './settingvalue.js';

const uuid = s.string({ format: 'uuid' });
const NAME = /^[a-z][a-z0-9_.-]{0,40}$/;

interface DataRow {
  name: string;
  value_sealed: string;
  sensitive: boolean;
  note: string;
  updated_at: Date;
  updater: string | null;
  revealer: string | null;
  revealed_at: Date | null;
}

const unseal = (sealed: string): string | null => {
  try {
    return open(sealed);
  } catch {
    return null;
  }
};

/** The project's test data with their values, for masking and filling steps. */
export async function testDataOf(
  c: PoolClient,
  projectId: string,
): Promise<{ name: string; value: string; sensitive: boolean }[]> {
  const rows = (
    await c.query<{ name: string; value_sealed: string; sensitive: boolean }>(
      'SELECT name, value_sealed, sensitive FROM test_data WHERE project_id = $1',
      [projectId],
    )
  ).rows;
  return rows.flatMap((r) => {
    const value = unseal(r.value_sealed);
    return value === null ? [] : [{ name: r.name, value, sensitive: r.sensitive }];
  });
}

/** What a project's test results pass through before they are kept. */
export async function maskerFor(
  c: PoolClient,
  projectId: string,
): Promise<(text: string) => string> {
  if ((await settingFor(c, 'tests.mask_personal_data', projectId)) === false) return (t) => t;
  const data = await testDataOf(c, projectId);
  return (t) => (t ? maskPersonal(t, data).text : t);
}

const sealed = (value: string): string => {
  try {
    return seal(value);
  } catch (e) {
    if (e instanceof SecretKeyMissing)
      throw new HttpError(409, 'conflict', 'The server has no secret key to seal test data with');
    throw e;
  }
};

const dataOut = s.object({
  name: s.string(),
  sensitive: s.boolean(),
  /** an open value; a sensitive one is revealed on its own */
  value: s.nullable(s.string()),
  note: s.string(),
  updatedAt: s.string(),
  updatedBy: s.nullable(s.string()),
  revealedBy: s.nullable(s.string()),
  revealedAt: s.nullable(s.string()),
});
const SELECT = `SELECT d.name, d.value_sealed, d.sensitive, d.note, d.updated_at, u.name AS updater, r.name AS revealer, d.revealed_at
  FROM test_data d LEFT JOIN users u ON u.id = d.updated_by LEFT JOIN users r ON r.id = d.revealed_by`;
const dataJson = (r: DataRow) => ({
  name: r.name,
  sensitive: r.sensitive,
  value: r.sensitive ? null : unseal(r.value_sealed),
  note: r.note,
  updatedAt: r.updated_at.toISOString(),
  updatedBy: r.updater,
  revealedBy: r.revealer,
  revealedAt: r.revealed_at?.toISOString() ?? null,
});

export function testDataRoutes(pool: Pool): Route[] {
  const projectParams = s.object({ workspaceId: uuid, projectId: uuid });
  const nameParams = s.object({
    workspaceId: uuid,
    projectId: uuid,
    name: s.string({ pattern: NAME }),
  });

  const list = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/projects/:projectId/test-data',
    summary:
      'The project’s test data: names, notes and open values (sensitive ones are revealed one by one)',
    tags: ['tests'],
    params: projectParams,
    response: s.array(dataOut),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const p = await requireProject(c, a, params.projectId);
        const rows = (
          await c.query<DataRow>(SELECT + ' WHERE d.project_id = $1 ORDER BY d.name', [p.id])
        ).rows;
        return { body: rows.map(dataJson) };
      }),
  });

  const put = route({
    method: 'PUT',
    path: '/api/workspaces/:workspaceId/projects/:projectId/test-data/:name',
    summary:
      'Keep a test-data value under a name, sealed; sensitive unless said otherwise (member)',
    tags: ['tests'],
    params: nameParams,
    body: s.object({
      value: s.string({ min: 1, max: 5000 }),
      sensitive: s.optional(s.boolean()),
      note: s.optional(s.string({ max: 500 })),
    }),
    response: dataOut,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const p = await requireProject(c, a, params.projectId);
        await c.query(
          `INSERT INTO test_data (workspace_id, project_id, name, value_sealed, sensitive, note, updated_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (project_id, name) DO UPDATE SET value_sealed = $4, sensitive = $5,
             note = coalesce($8, test_data.note), updated_by = $7, updated_at = now()`,
          [
            a.workspaceId,
            p.id,
            params.name,
            sealed(body.value),
            body.sensitive ?? true,
            body.note?.trim() ?? '',
            a.user.id,
            body.note === undefined ? null : body.note.trim(),
          ],
        );
        const row = (
          await c.query<DataRow>(SELECT + ' WHERE d.project_id = $1 AND d.name = $2', [
            p.id,
            params.name,
          ])
        ).rows[0];
        if (!row) throw new Error('test data vanished');
        return { body: dataJson(row) };
      }),
  });

  const remove = route({
    method: 'DELETE',
    path: '/api/workspaces/:workspaceId/projects/:projectId/test-data/:name',
    summary: 'Remove a test-data value (member)',
    tags: ['tests'],
    params: nameParams,
    response: s.object({ removed: s.boolean() }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const p = await requireProject(c, a, params.projectId);
        const r = await c.query('DELETE FROM test_data WHERE project_id = $1 AND name = $2', [
          p.id,
          params.name,
        ]);
        if (!r.rowCount) throw new HttpError(404, 'not_found', 'No test data ' + params.name);
        return { body: { removed: true } };
      }),
  });

  const reveal = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/projects/:projectId/test-data/:name/reveal',
    summary: 'Show one test-data value to a tester; who revealed it last is kept (tester)',
    tags: ['tests'],
    params: nameParams,
    response: s.object({ name: s.string(), value: s.string() }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'tester', async (c, a) => {
        const p = await requireProject(c, a, params.projectId);
        const row = (
          await c.query<{ value_sealed: string }>(
            `UPDATE test_data SET revealed_by = $3, revealed_at = now()
              WHERE project_id = $1 AND name = $2 RETURNING value_sealed`,
            [p.id, params.name, a.user.id],
          )
        ).rows[0];
        if (!row) throw new HttpError(404, 'not_found', 'No test data ' + params.name);
        const value = unseal(row.value_sealed);
        if (value === null)
          throw new HttpError(409, 'conflict', 'The value cannot be read; set it again');
        return { body: { name: params.name, value } };
      }),
  });

  return [list, put, remove, reveal];
}
