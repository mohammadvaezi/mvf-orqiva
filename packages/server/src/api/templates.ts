// ── [PCODE-359 | S15 | v0.1.0] T35.7a Plan contents enforced ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-119 | S15 | v0.1.0] Add workspace lifecycle templates with an editor ──
//    Why:  every team has its own process. Admins copy the default lifecycle and shape it: phases, stages,
//          gates, criteria and who signs. A definition is checked before it is saved, and a project that
//          already runs keeps its own copy, so editing a template never changes work in progress.
import { DEFAULT_LIFECYCLE, lifecycleProblems, type LifecycleDef } from '@orqiva/shared';
import type { Pool } from 'pg';
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s } from '../http/schema.js';
import { asMember } from './access.js';
import { requireFeature } from '../licence/licence.js'; // [PCODE-359 | S15 | v0.1.0]

const uuid = s.string({ format: 'uuid' });
const ws = s.object({ workspaceId: uuid });

const definition = s.object({
  phases: s.array(
    s.object({
      key: s.string({ min: 1, max: 40 }),
      name: s.string({ max: 80 }),
      stages: s.array(
        s.object({
          key: s.string({ min: 1, max: 40 }),
          name: s.string({ max: 80 }),
          agent: s.string({ max: 80 }),
          owner: s.string({ max: 80 }),
        }),
        { max: 20 },
      ),
      gate: s.optional(
        s.object({
          key: s.string({ min: 1, max: 40 }),
          name: s.string({ max: 80 }),
          signer: s.enum(['owner', 'admin', 'member']),
          criteria: s.array(
            s.object({ key: s.string({ min: 1, max: 40 }), text: s.string({ max: 300 }) }),
            { max: 30 },
          ),
        }),
      ),
    }),
    { max: 12 },
  ),
});

const templateOut = s.object({
  id: s.string(),
  name: s.string(),
  definition: s.anyObject(),
  updatedAt: s.string(),
  projects: s.number({ integer: true }),
});
interface Row {
  id: string;
  name: string;
  definition: LifecycleDef;
  updated_at: Date;
  projects: string;
}
const json = (r: Row) => ({
  id: r.id,
  name: r.name,
  definition: r.definition as unknown as Record<string, unknown>,
  updatedAt: r.updated_at.toISOString(),
  projects: Number(r.projects),
});
const SELECT = `SELECT t.id, t.name, t.definition, t.updated_at,
                (SELECT count(*) FROM project_lifecycles l WHERE l.template_name = t.name) AS projects
                FROM lifecycle_templates t`;

function check(def: LifecycleDef): void {
  const problems = lifecycleProblems(def);
  if (problems.length) throw new HttpError(400, 'invalid_request', problems.join(' '));
}

export function templateRoutes(pool: Pool): Route[] {
  const list = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/lifecycle/templates',
    summary: 'The workspace’s lifecycle templates, and the built-in default',
    tags: ['lifecycle'],
    params: ws,
    response: s.object({ default: s.anyObject(), templates: s.array(templateOut) }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c) => ({
        body: {
          default: DEFAULT_LIFECYCLE as unknown as Record<string, unknown>,
          templates: (await c.query<Row>(SELECT + ' ORDER BY t.name')).rows.map(json),
        },
      })),
  });

  const create = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/lifecycle/templates',
    summary: 'Create a template, from a definition or as a copy of the default (admin)',
    tags: ['lifecycle'],
    params: ws,
    body: s.object({ name: s.string({ min: 1, max: 120 }), definition: s.optional(definition) }),
    response: templateOut,
    status: 201,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'admin', async (c, a) => {
        // [PCODE-359 | S15 | v0.1.0]
        await requireFeature(c, a.workspaceId, 'custom-gates', 'Your own lifecycles and gates');
        const def = (body.definition as LifecycleDef | undefined) ?? DEFAULT_LIFECYCLE;
        check(def);
        const taken = (
          await c.query('SELECT 1 FROM lifecycle_templates WHERE name = $1', [body.name.trim()])
        ).rowCount;
        if (taken)
          throw new HttpError(409, 'conflict', 'A template named ' + body.name.trim() + ' exists');
        const id = (
          await c.query<{ id: string }>(
            'INSERT INTO lifecycle_templates (workspace_id, name, definition, created_by) VALUES ($1, $2, $3, $4) RETURNING id',
            [a.workspaceId, body.name.trim(), JSON.stringify(def), a.user.id],
          )
        ).rows[0]?.id;
        const row = (await c.query<Row>(SELECT + ' WHERE t.id = $1', [id])).rows[0];
        if (!row) throw new Error('template insert returned nothing');
        return { status: 201, body: json(row) };
      }),
  });

  const update = route({
    method: 'PATCH',
    path: '/api/workspaces/:workspaceId/lifecycle/templates/:templateId',
    summary:
      'Rename a template or replace its definition; running projects keep their copy (admin)',
    tags: ['lifecycle'],
    params: s.object({ workspaceId: uuid, templateId: uuid }),
    body: s.object({
      name: s.optional(s.string({ min: 1, max: 120 })),
      definition: s.optional(definition),
    }),
    response: templateOut,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'admin', async (c) => {
        const row = (await c.query<Row>(SELECT + ' WHERE t.id = $1', [params.templateId])).rows[0];
        if (!row) throw new HttpError(404, 'not_found', 'Template not found');
        if (body.definition) check(body.definition);
        const name = body.name?.trim() ?? row.name;
        if (
          name !== row.name &&
          (await c.query('SELECT 1 FROM lifecycle_templates WHERE name = $1', [name])).rowCount
        )
          throw new HttpError(409, 'conflict', 'A template named ' + name + ' exists');
        await c.query(
          'UPDATE lifecycle_templates SET name = $2, definition = $3, updated_at = now() WHERE id = $1',
          [row.id, name, JSON.stringify(body.definition ?? row.definition)],
        );
        const after = (await c.query<Row>(SELECT + ' WHERE t.id = $1', [row.id])).rows[0];
        if (!after) throw new Error('template vanished');
        return { body: json(after) };
      }),
  });

  const remove = route({
    method: 'DELETE',
    path: '/api/workspaces/:workspaceId/lifecycle/templates/:templateId',
    summary: 'Delete a template; projects started from it keep their copy (admin)',
    tags: ['lifecycle'],
    params: s.object({ workspaceId: uuid, templateId: uuid }),
    response: s.object({ ok: s.literal(true) }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'admin', async (c) => {
        const r = await c.query('DELETE FROM lifecycle_templates WHERE id = $1', [
          params.templateId,
        ]);
        if (!r.rowCount) throw new HttpError(404, 'not_found', 'Template not found');
        return { body: { ok: true as const } };
      }),
  });

  return [list, create, update, remove];
}
