// ── [PCODE-313 | S15 | v0.1.0] T32.1 Test repository: shared steps, parameters in the screen, structured BDD ──
//    Why:  the steps many cases share are kept once per project: changing them changes every case that
//          uses them, and one still in use cannot be removed. A feature file comes in as one BDD case per
//          scenario, its steps and parameters made from the Gherkin.
import {
  examplesAsParameters,
  gherkinSteps,
  gherkinText,
  parseGherkin,
  type SharedSteps,
} from '@orqiva/shared';
import type { Pool, PoolClient } from 'pg';
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s } from '../http/schema.js';
import { asMember, isUniqueViolation, requireProject, type Access } from './access.js';

const uuid = s.string({ format: 'uuid' });
const stepIn = s.object({
  action: s.string({ min: 1, max: 2000 }),
  expected: s.string({ max: 2000 }),
});
const sharedOut = s.object({
  id: s.string(),
  name: s.string(),
  steps: s.array(s.object({ action: s.string(), expected: s.string() })),
  version: s.number({ integer: true }),
  usedBy: s.number({ integer: true }),
  updatedAt: s.string(),
});

interface SharedRow {
  id: string;
  project_id: string;
  name: string;
  steps: { action: string; expected: string }[];
  version: number;
  updated_at: Date;
  used_by: string;
}
const SHARED_SELECT = `SELECT x.*, (SELECT count(*) FROM test_cases c WHERE c.project_id = x.project_id
    AND c.step_list @> jsonb_build_array(jsonb_build_object('shared', x.id::text))) AS used_by
  FROM test_shared_steps x`;
const sharedJson = (r: SharedRow) => ({
  id: r.id,
  name: r.name,
  steps: r.steps,
  version: r.version,
  usedBy: Number(r.used_by),
  updatedAt: r.updated_at.toISOString(),
});

/** A project's shared steps by id, to expand the cases' references. */
export async function sharedStepsOf(
  c: PoolClient,
  projectId: string,
): Promise<Map<string, SharedSteps>> {
  const rows = (
    await c.query<{ id: string; name: string; steps: SharedSteps['steps'] }>(
      'SELECT id, name, steps FROM test_shared_steps WHERE project_id = $1',
      [projectId],
    )
  ).rows;
  return new Map(rows.map((r) => [r.id, r]));
}

async function loadShared(c: PoolClient, a: Access, id: string): Promise<SharedRow> {
  const r = (await c.query<SharedRow>(SHARED_SELECT + ' WHERE x.id = $1', [id])).rows[0];
  if (!r) throw new HttpError(404, 'not_found', 'Shared steps not found');
  await requireProject(c, a, r.project_id);
  return r;
}

const cleanSteps = (steps: readonly { action: string; expected: string }[]) =>
  steps.map((x) => ({ action: x.action.trim(), expected: x.expected.trim() }));

const nameTaken = (e: unknown): Error =>
  isUniqueViolation(e)
    ? new HttpError(409, 'conflict', 'The project has shared steps with this name')
    : e instanceof Error
      ? e
      : new Error(String(e));

export function testDesignRoutes(pool: Pool): Route[] {
  const projectParams = s.object({ workspaceId: uuid, projectId: uuid });
  const sharedParams = s.object({ workspaceId: uuid, sharedId: uuid });

  const list = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/projects/:projectId/test-shared-steps',
    summary: 'The project’s shared steps, with how many cases use each',
    tags: ['tests'],
    params: projectParams,
    response: s.array(sharedOut),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        const p = await requireProject(c, a, params.projectId);
        const rows = (
          await c.query<SharedRow>(SHARED_SELECT + ' WHERE x.project_id = $1 ORDER BY x.name', [
            p.id,
          ])
        ).rows;
        return { body: rows.map(sharedJson) };
      }),
  });

  const create = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/projects/:projectId/test-shared-steps',
    summary: 'Write shared steps for the project’s cases to use (member)',
    tags: ['tests'],
    params: projectParams,
    body: s.object({
      name: s.string({ min: 1, max: 200 }),
      steps: s.array(stepIn, { min: 1, max: 50 }),
    }),
    response: sharedOut,
    status: 201,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const p = await requireProject(c, a, params.projectId);
        const id = await c
          .query<{ id: string }>(
            `INSERT INTO test_shared_steps (workspace_id, project_id, name, steps, updated_by)
             VALUES ($1, $2, $3, $4, $5) RETURNING id`,
            [
              a.workspaceId,
              p.id,
              body.name.trim(),
              JSON.stringify(cleanSteps(body.steps)),
              a.user.id,
            ],
          )
          .then(
            (r) => r.rows[0]?.id ?? '',
            (e: unknown) => Promise.reject(nameTaken(e)),
          );
        return { status: 201, body: sharedJson(await loadShared(c, a, id)) };
      }),
  });

  const change = route({
    method: 'PATCH',
    path: '/api/workspaces/:workspaceId/test-shared-steps/:sharedId',
    summary: 'Rename shared steps or change them; every case using them shows the change (member)',
    tags: ['tests'],
    params: sharedParams,
    body: s.object({
      name: s.optional(s.string({ min: 1, max: 200 })),
      steps: s.optional(s.array(stepIn, { min: 1, max: 50 })),
    }),
    response: sharedOut,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const r = await loadShared(c, a, params.sharedId);
        const steps = body.steps ? cleanSteps(body.steps) : null;
        const changed = steps !== null && JSON.stringify(steps) !== JSON.stringify(r.steps);
        await c
          .query(
            `UPDATE test_shared_steps SET name = coalesce($2, name), steps = coalesce($3::jsonb, steps),
                    version = version + $4, updated_by = $5, updated_at = now() WHERE id = $1`,
            [
              r.id,
              body.name?.trim() ?? null,
              steps ? JSON.stringify(steps) : null,
              changed ? 1 : 0,
              a.user.id,
            ],
          )
          .catch((e: unknown) => Promise.reject(nameTaken(e)));
        return { body: sharedJson(await loadShared(c, a, r.id)) };
      }),
  });

  const remove = route({
    method: 'DELETE',
    path: '/api/workspaces/:workspaceId/test-shared-steps/:sharedId',
    summary: 'Remove shared steps no case uses any more (member)',
    tags: ['tests'],
    params: sharedParams,
    response: s.object({ removed: s.boolean() }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const r = await loadShared(c, a, params.sharedId);
        const users = (
          await c.query<{ title: string }>(
            `SELECT title FROM test_cases WHERE project_id = $1
               AND step_list @> jsonb_build_array(jsonb_build_object('shared', $2::text)) ORDER BY title LIMIT 6`,
            [r.project_id, r.id],
          )
        ).rows;
        if (users.length)
          throw new HttpError(
            409,
            'conflict',
            'Still used by ' +
              users
                .slice(0, 5)
                .map((u) => '“' + u.title + '”')
                .join(', ') +
              (Number(r.used_by) > 5 ? ' and ' + String(Number(r.used_by) - 5) + ' more' : ''),
          );
        await c.query('DELETE FROM test_shared_steps WHERE id = $1', [r.id]);
        return { body: { removed: true } };
      }),
  });

  const importFeature = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/projects/:projectId/test-cases/gherkin',
    summary:
      'Read a Gherkin feature: one BDD case per scenario, with steps and parameters from it (member)',
    tags: ['tests'],
    params: projectParams,
    body: s.object({
      text: s.string({ min: 1, max: 200_000 }),
      suite: s.optional(s.string({ max: 300 })),
    }),
    response: s.object({
      created: s.array(s.object({ id: s.string(), title: s.string() })),
    }),
    status: 201,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const p = await requireProject(c, a, params.projectId);
        const g = parseGherkin(body.text);
        if (g.errors.length)
          throw new HttpError(
            400,
            'invalid_request',
            'The Gherkin has mistakes',
            g.errors.slice(0, 20).map((e) => ({
              path: 'body.text' + (e.line ? ':' + String(e.line) : ''),
              message: e.message,
            })),
          );
        const suite = (body.suite?.trim() || g.feature || 'Features').slice(0, 300);
        const created: { id: string; title: string }[] = [];
        for (const sc of g.scenarios.slice(0, 200)) {
          const steps = gherkinSteps(g.background, sc);
          const id = (
            await c.query<{ id: string }>(
              `INSERT INTO test_cases (workspace_id, project_id, key, title, steps, kind, suite, step_list, parameters, gherkin, created_by)
               VALUES ($1, $2, '', $3, $4, 'bdd', $5, $6, $7, $8, $9) RETURNING id`,
              [
                a.workspaceId,
                p.id,
                (sc.name || 'Scenario').slice(0, 300),
                steps
                  .map(
                    (x, i) =>
                      String(i + 1) + '. ' + x.action + (x.expected ? ' → ' + x.expected : ''),
                  )
                  .join('\n'),
                suite,
                JSON.stringify(steps),
                JSON.stringify(sc.outline ? examplesAsParameters(sc) : {}),
                gherkinText(g.feature, g.background, sc),
                a.user.id,
              ],
            )
          ).rows[0]?.id;
          if (id) created.push({ id, title: sc.name });
        }
        return { status: 201, body: { created } };
      }),
  });

  return [list, create, change, remove, importFeature];
}
