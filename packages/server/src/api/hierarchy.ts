// ── [PCODE-257 | S15 | v0.1.0] T26.6 Hierarchy: initiatives, custom item types, custom fields ──
//    Why:  the levels and the shape of a team's own work. Initiatives roll up the epics under them and the
//          tasks under those; a project names its own kinds of task on a base kind and its own fields, which
//          every task edit checks.
import { FIELD_TYPES, fieldProblem, type FieldDef } from '@orqiva/shared';
import type { Pool, PoolClient } from 'pg';
import { recordEvent } from '../events/outbox.js';
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s } from '../http/schema.js';
import { actorOf, asMember, requireProject } from './access.js';

const uuid = s.string({ format: 'uuid' });
const projectParams = s.object({ workspaceId: uuid, projectId: uuid });
export const KINDS = ['initiative', 'epic', 'story', 'task', 'bug', 'spike', 'milestone'] as const;

/** The project's fields, in their order. */
export async function fieldsOf(
  c: PoolClient,
  projectId: string,
): Promise<(FieldDef & { id: string })[]> {
  return (
    await c.query<FieldDef & { id: string }>(
      'SELECT id, key, label, type, options FROM custom_fields WHERE project_id = $1 ORDER BY position, key',
      [projectId],
    )
  ).rows;
}

/**
 * A task's custom values after a change: unknown keys and wrong values are refused, null clears a field,
 * a person must be a member. Answers the new values and what changed.
 */
export async function nextCustom(
  c: PoolClient,
  projectId: string,
  current: Record<string, unknown>,
  patch: Record<string, unknown>,
): Promise<{ custom: Record<string, unknown>; changed: string[] }> {
  const defs = await fieldsOf(c, projectId);
  const next = new Map(Object.entries(current));
  const changed: string[] = [];
  for (const [key, value] of Object.entries(patch)) {
    const def = defs.find((d) => d.key === key);
    if (!def)
      throw new HttpError(400, 'invalid_request', 'The project has no field ' + key, [
        { path: 'body.custom.' + key, message: 'is not a field of the project' },
      ]);
    const problem = fieldProblem(def, value);
    if (problem)
      throw new HttpError(400, 'invalid_request', problem, [
        { path: 'body.custom.' + key, message: problem },
      ]);
    if (
      def.type === 'person' &&
      value !== null &&
      !(await c.query('SELECT 1 FROM workspace_members WHERE user_id = $1', [value])).rowCount
    )
      throw new HttpError(400, 'invalid_request', def.label + ' is a person of the workspace');
    if (JSON.stringify(next.get(key) ?? null) === JSON.stringify(value)) continue;
    if (value === null) next.delete(key);
    else next.set(key, value);
    changed.push(key);
  }
  return { custom: Object.fromEntries(next), changed };
}

/** A type of the project, its base kind, or a refusal. */
export async function typeOf(
  c: PoolClient,
  projectId: string,
  typeId: string,
): Promise<{ name: string; base_kind: string }> {
  const t = (
    await c.query<{ name: string; base_kind: string }>(
      'SELECT name, base_kind FROM item_types WHERE id = $1 AND project_id = $2',
      [typeId, projectId],
    )
  ).rows[0];
  if (!t)
    throw new HttpError(400, 'invalid_request', 'The type is not one of this project', [
      { path: 'body.typeId', message: 'is not a type of this project' },
    ]);
  return t;
}

const typeOut = s.object({
  id: s.string(),
  name: s.string(),
  baseKind: s.string(),
  color: s.string(),
  count: s.number({ integer: true }),
});
const fieldOut = s.object({
  id: s.string(),
  key: s.string(),
  label: s.string(),
  type: s.string(),
  options: s.array(s.string()),
});

export function hierarchyRoutes(pool: Pool): Route[] {
  const typesOf = async (c: PoolClient, projectId: string) =>
    (
      await c.query<{ id: string; name: string; base_kind: string; color: string; n: string }>(
        `SELECT t.id, t.name, t.base_kind, t.color, (SELECT count(*) FROM items i WHERE i.type_id = t.id) AS n
           FROM item_types t WHERE t.project_id = $1 ORDER BY t.name`,
        [projectId],
      )
    ).rows.map((t) => ({
      id: t.id,
      name: t.name,
      baseKind: t.base_kind,
      color: t.color,
      count: Number(t.n),
    }));
  const projectEvent = (
    c: PoolClient,
    ws: string,
    a: Parameters<typeof actorOf>[0],
    p: { id: string; key: string },
    change: Record<string, { from: unknown; to: unknown }>,
  ) =>
    recordEvent(
      c,
      ws,
      {
        actor: actorOf(a),
        verb: 'updated',
        object: { type: 'project', id: p.id, label: p.key },
        changes: change,
      },
      { projectId: p.id },
    );

  const types = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/projects/:projectId/item-types',
    summary: "The project's own kinds of task (guest)",
    tags: ['projects'],
    params: projectParams,
    response: s.array(typeOut),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        const p = await requireProject(c, a, params.projectId);
        return { body: await typesOf(c, p.id) };
      }),
  });

  const addType = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/projects/:projectId/item-types',
    summary: 'A kind of task of the project, on a base kind, e.g. Incident on bug (admin)',
    tags: ['projects'],
    params: projectParams,
    body: s.object({
      name: s.string({ min: 1, max: 40 }),
      baseKind: s.enum(KINDS),
      color: s.optional(s.string({ pattern: /^#[0-9a-f]{6}$/ })),
    }),
    response: s.array(typeOut),
    status: 201,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'admin', async (c, a) => {
        const p = await requireProject(c, a, params.projectId);
        try {
          await c.query(
            'INSERT INTO item_types (workspace_id, project_id, name, base_kind, color) VALUES ($1, $2, $3, $4, $5)',
            [a.workspaceId, p.id, body.name.trim(), body.baseKind, body.color ?? '#6b6a8a'],
          );
        } catch (e) {
          if ((e as { code?: string }).code === '23505')
            throw new HttpError(
              409,
              'conflict',
              'The project has a type ' + body.name.trim() + ' already',
            );
          throw e;
        }
        await projectEvent(c, a.workspaceId, a, p, {
          itemType: { from: null, to: body.name.trim() + ' on ' + body.baseKind },
        });
        return { status: 201, body: await typesOf(c, p.id) };
      }),
  });

  const dropType = route({
    method: 'DELETE',
    path: '/api/workspaces/:workspaceId/projects/:projectId/item-types/:typeId',
    summary: 'Remove a kind of task; its tasks keep their base kind (admin)',
    tags: ['projects'],
    params: s.object({ workspaceId: uuid, projectId: uuid, typeId: uuid }),
    response: s.array(typeOut),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'admin', async (c, a) => {
        const p = await requireProject(c, a, params.projectId);
        await c.query('DELETE FROM item_types WHERE id = $1 AND project_id = $2', [
          params.typeId,
          p.id,
        ]);
        return { body: await typesOf(c, p.id) };
      }),
  });

  const fields = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/projects/:projectId/custom-fields',
    summary: "The project's own fields (guest)",
    tags: ['projects'],
    params: projectParams,
    response: s.array(fieldOut),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        const p = await requireProject(c, a, params.projectId);
        return { body: await fieldsOf(c, p.id) };
      }),
  });

  const addField = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/projects/:projectId/custom-fields',
    summary: 'A field of the project: text, number, choice, date or person (admin)',
    tags: ['projects'],
    params: projectParams,
    body: s.object({
      key: s.string({ pattern: /^[a-z][a-z0-9_]{0,39}$/ }),
      label: s.string({ min: 1, max: 60 }),
      type: s.enum(FIELD_TYPES),
      options: s.optional(s.array(s.string({ min: 1, max: 60 }), { max: 50 })),
    }),
    response: s.array(fieldOut),
    status: 201,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'admin', async (c, a) => {
        const p = await requireProject(c, a, params.projectId);
        if (body.type === 'choice' && !body.options?.length)
          throw new HttpError(400, 'invalid_request', 'A choice field lists its options', [
            { path: 'body.options', message: 'is needed for a choice' },
          ]);
        try {
          await c.query(
            `INSERT INTO custom_fields (workspace_id, project_id, key, label, type, options, position)
             VALUES ($1, $2, $3, $4, $5, $6, (SELECT coalesce(max(position), 0) + 1 FROM custom_fields WHERE project_id = $2))`,
            [
              a.workspaceId,
              p.id,
              body.key,
              body.label.trim(),
              body.type,
              body.type === 'choice' ? body.options : [],
            ],
          );
        } catch (e) {
          if ((e as { code?: string }).code === '23505')
            throw new HttpError(
              409,
              'conflict',
              'The project has a field ' + body.key + ' already',
            );
          throw e;
        }
        await projectEvent(c, a.workspaceId, a, p, {
          customField: { from: null, to: body.label.trim() + ' (' + body.type + ')' },
        });
        return { status: 201, body: await fieldsOf(c, p.id) };
      }),
  });

  const dropField = route({
    method: 'DELETE',
    path: '/api/workspaces/:workspaceId/projects/:projectId/custom-fields/:fieldId',
    summary: 'Remove a field and its values from every task (admin)',
    tags: ['projects'],
    params: s.object({ workspaceId: uuid, projectId: uuid, fieldId: uuid }),
    response: s.array(fieldOut),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'admin', async (c, a) => {
        const p = await requireProject(c, a, params.projectId);
        const f = (
          await c.query<{ key: string }>(
            'DELETE FROM custom_fields WHERE id = $1 AND project_id = $2 RETURNING key',
            [params.fieldId, p.id],
          )
        ).rows[0];
        if (f)
          await c.query(
            'UPDATE items SET custom = custom - $2 WHERE project_id = $1 AND custom ? $2',
            [p.id, f.key],
          );
        return { body: await fieldsOf(c, p.id) };
      }),
  });

  const initiatives = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/projects/:projectId/initiatives',
    summary: 'Initiatives with their epics and the progress of everything under them (guest)',
    tags: ['planning'],
    params: projectParams,
    response: s.array(
      s.object({
        id: s.string(),
        ref: s.string(),
        title: s.string(),
        state: s.string(),
        done: s.number({ integer: true }),
        total: s.number({ integer: true }),
        donePoints: s.number(),
        totalPoints: s.number(),
        epics: s.array(
          s.object({
            id: s.string(),
            ref: s.string(),
            title: s.string(),
            done: s.number({ integer: true }),
            total: s.number({ integer: true }),
          }),
        ),
      }),
    ),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        const p = await requireProject(c, a, params.projectId);
        const rows = (
          await c.query<{
            id: string;
            parent_id: string | null;
            ref: string;
            title: string;
            kind: string;
            grp: string;
            state: string;
            estimate: number | null;
          }>(
            `SELECT i.id, i.parent_id, $2::text || '-' || i.sequence AS ref, i.title, i.kind, st.grp, st.name AS state, i.estimate
               FROM items i JOIN project_states st ON st.id = i.state_id WHERE i.project_id = $1`,
            [p.id, p.key],
          )
        ).rows;
        const children = new Map<string, typeof rows>();
        for (const r of rows)
          if (r.parent_id) children.set(r.parent_id, [...(children.get(r.parent_id) ?? []), r]);
        /** every task below, not counting the ones that only group others */
        const below = (id: string): typeof rows => {
          const out: typeof rows = [];
          const walk = (x: string, depth: number): void => {
            if (depth > 10) return;
            for (const ch of children.get(x) ?? []) {
              if (ch.grp === 'cancelled') continue;
              if (!['initiative', 'epic'].includes(ch.kind)) out.push(ch);
              walk(ch.id, depth + 1);
            }
          };
          walk(id, 0);
          return out;
        };
        return {
          body: rows
            .filter((r) => r.kind === 'initiative')
            .map((r) => {
              const all = below(r.id);
              const done = all.filter((x) => x.grp === 'completed');
              return {
                id: r.id,
                ref: r.ref,
                title: r.title,
                state: r.state,
                done: done.length,
                total: all.length,
                donePoints: done.reduce((n, x) => n + (x.estimate ?? 0), 0),
                totalPoints: all.reduce((n, x) => n + (x.estimate ?? 0), 0),
                epics: (children.get(r.id) ?? [])
                  .filter((e) => e.kind === 'epic')
                  .map((e) => {
                    const eb = below(e.id);
                    return {
                      id: e.id,
                      ref: e.ref,
                      title: e.title,
                      done: eb.filter((x) => x.grp === 'completed').length,
                      total: eb.length,
                    };
                  }),
              };
            }),
        };
      }),
  });

  return [types, addType, dropType, fields, addField, dropField, initiatives];
}
