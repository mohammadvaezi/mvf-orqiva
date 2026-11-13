// ── [PCODE-350 | S15 | v0.1.0] T35.3a Templates library for projects, PRDs, sprints and agents ──
//    Why:  the library: built-in templates and the workspace's own, for projects, sprints, agents and PRDs.
//          A project starts from one with its board, labels, epics and settings; a sprint with its length,
//          goal and tasks; an agent with its instructions (switched off until an admin turns it on); and a
//          PRD template becomes the default for its kind of idea, which the Architect's drafts follow.
import {
  BUILTIN_LIBRARY,
  libraryProblem,
  projectTemplateOf,
  sprintEnd,
  templateOf,
  type AgentTemplateBody,
  type LibraryKind,
  type LibraryTemplate,
  type PrdTemplateBody,
  type ProjectTemplateBody,
  type SprintTemplateBody,
  type TemplateSection,
} from '@orqiva/shared';
import type { Pool, PoolClient } from 'pg';
import { DEFAULT_MODEL, DEFAULT_TOOLS } from '../agents/defaults.js';
import { recordEvent } from '../events/outbox.js';
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s } from '../http/schema.js';
import { actorOf, asMember, requireProject, type Access } from './access.js';
import { ensureAgents } from './agents.js';
import { DEFAULT_STATES } from './projects.js';

const uuid = s.string({ format: 'uuid' });
const KINDS = ['project', 'sprint', 'agent', 'prd'] as const;

interface Row {
  id: string;
  kind: LibraryKind;
  name: string;
  description: string;
  body: LibraryTemplate['body'];
}

const own = (r: Row): LibraryTemplate & Record<string, unknown> => ({ ...r, builtIn: false });

/** A template by id: a built-in one ('builtin:…') or the workspace's own. */
async function templateById(c: PoolClient, id: string): Promise<LibraryTemplate> {
  const builtIn = BUILTIN_LIBRARY.find((t) => t.id === id);
  if (builtIn) return builtIn;
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new HttpError(404, 'not_found', 'Template not found');
  const r = (
    await c.query<Row>(
      'SELECT id, kind, name, description, body FROM template_library WHERE id = $1',
      [id],
    )
  ).rows[0];
  if (!r) throw new HttpError(404, 'not_found', 'Template not found');
  return own(r);
}

/** The PRD sections for a kind of idea: the workspace's default template, else the built-in sections. */
export async function prdTemplateFor(
  c: PoolClient,
  kind: string,
): Promise<readonly TemplateSection[]> {
  const id = (
    await c.query<{ template_id: string }>(
      'SELECT template_id FROM prd_template_defaults WHERE idea_kind = $1',
      [kind],
    )
  ).rows[0]?.template_id;
  if (id) {
    const t = await templateById(c, id).catch(() => null);
    if (t?.kind === 'prd') return (t.body as PrdTemplateBody).sections;
  }
  return templateOf(kind);
}

async function insertItem(
  c: PoolClient,
  a: Access,
  projectId: string,
  title: string,
  kind: 'task' | 'epic',
  sprintId: string | null,
): Promise<void> {
  const state = (
    await c.query<{ id: string }>(
      "SELECT id FROM project_states WHERE project_id = $1 ORDER BY (grp = 'unstarted') DESC, (grp = 'backlog') DESC, position LIMIT 1",
      [projectId],
    )
  ).rows[0]?.id;
  const seq = (
    await c.query<{ seq: number }>(
      'UPDATE projects SET next_item_seq = next_item_seq + 1 WHERE id = $1 RETURNING next_item_seq - 1 AS seq',
      [projectId],
    )
  ).rows[0]?.seq;
  await c.query(
    `INSERT INTO items (workspace_id, project_id, sequence, title, state_id, created_by, sprint_id, kind, rank)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, (SELECT coalesce(max(rank), 0) + 1 FROM items WHERE project_id = $2))`,
    [a.workspaceId, projectId, seq, title.slice(0, 200), state, a.user.id, sprintId, kind],
  );
}

export function templateLibraryRoutes(pool: Pool): Route[] {
  const ws = s.object({ workspaceId: uuid });

  const list = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/template-library',
    summary:
      'The templates of the library, built in and the workspace’s own, and the PRD defaults (member)',
    tags: ['templates'],
    params: ws,
    query: s.object({ kind: s.optional(s.enum(KINDS)) }),
    response: s.anyObject(),
    handler: ({ params, query, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c) => {
        const rows = (
          await c.query<Row>(
            'SELECT id, kind, name, description, body FROM template_library WHERE ($1::text IS NULL OR kind = $1) ORDER BY kind, name',
            [query.kind ?? null],
          )
        ).rows.map(own);
        const defaults = Object.fromEntries(
          (
            await c.query<{ idea_kind: string; template_id: string }>(
              'SELECT idea_kind, template_id FROM prd_template_defaults',
            )
          ).rows.map((r) => [r.idea_kind, r.template_id]),
        );
        return {
          body: {
            templates: [
              ...BUILTIN_LIBRARY.filter((t) => !query.kind || t.kind === query.kind),
              ...rows,
            ],
            prdDefaults: defaults,
          },
        };
      }),
  });

  const add = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/template-library',
    summary: 'Keep a template in the library (admin)',
    tags: ['templates'],
    params: ws,
    body: s.object({
      kind: s.enum(KINDS),
      name: s.string({ min: 1, max: 120 }),
      description: s.optional(s.string({ max: 500 })),
      body: s.anyObject(),
    }),
    response: s.anyObject(),
    status: 201,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'admin', async (c, a) => {
        const problem = libraryProblem(body.kind, body.body);
        if (problem)
          throw new HttpError(400, 'invalid_request', problem, [
            { path: 'body.body', message: problem },
          ]);
        const r = await keep(c, a, body.kind, body.name, body.description ?? '', body.body);
        return { status: 201, body: own(r) };
      }),
  });

  const keep = async (
    c: PoolClient,
    a: Access,
    kind: LibraryKind,
    name: string,
    description: string,
    b: unknown,
  ): Promise<Row> => {
    const exists = (
      await c.query('SELECT 1 FROM template_library WHERE kind = $1 AND lower(name) = lower($2)', [
        kind,
        name.trim(),
      ])
    ).rowCount;
    if (exists)
      throw new HttpError(
        409,
        'conflict',
        'A ' + kind + ' template named ' + name.trim() + ' exists already',
      );
    const r = (
      await c.query<Row>(
        `INSERT INTO template_library (workspace_id, kind, name, description, body, created_by) VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, kind, name, description, body`,
        [a.workspaceId, kind, name.trim(), description.trim(), JSON.stringify(b), a.user.id],
      )
    ).rows[0];
    if (!r) throw new Error('template insert returned nothing');
    return r;
  };

  const fromProject = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/template-library/from-project',
    summary: 'Keep a project’s board, labels, epics and settings as a template (admin)',
    tags: ['templates'],
    params: ws,
    body: s.object({
      projectId: uuid,
      name: s.string({ min: 1, max: 120 }),
      description: s.optional(s.string({ max: 500 })),
    }),
    response: s.anyObject(),
    status: 201,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'admin', async (c, a) => {
        const p = await requireProject(c, a, body.projectId);
        const states = (
          await c.query<{ name: string; grp: string; color: string }>(
            'SELECT name, grp, color FROM project_states WHERE project_id = $1 ORDER BY position',
            [p.id],
          )
        ).rows;
        const labels = (
          await c.query<{ name: string; color: string }>(
            'SELECT name, color FROM labels WHERE project_id = $1 ORDER BY name LIMIT 40',
            [p.id],
          )
        ).rows;
        const epics = (
          await c.query<{ title: string }>(
            `SELECT i.title FROM items i JOIN project_states st ON st.id = i.state_id
              WHERE i.project_id = $1 AND i.kind = 'epic' AND st.grp <> 'cancelled' ORDER BY i.rank LIMIT 30`,
            [p.id],
          )
        ).rows.map((r) => r.title);
        const settings = Object.fromEntries(
          (
            await c.query<{ key: string; value: unknown }>(
              "SELECT key, value FROM settings WHERE scope_type = 'project' AND scope_id = $1",
              [p.id],
            )
          ).rows.map((r) => [r.key, r.value]),
        );
        const tbody = projectTemplateOf({ states, labels, epics, settings });
        const problem = libraryProblem('project', tbody);
        if (problem)
          throw new HttpError(409, 'conflict', 'The project does not make a template: ' + problem);
        return {
          status: 201,
          body: own(
            await keep(
              c,
              a,
              'project',
              body.name,
              body.description ?? 'From ' + p.key + ' ' + p.name,
              tbody,
            ),
          ),
        };
      }),
  });

  const remove = route({
    method: 'DELETE',
    path: '/api/workspaces/:workspaceId/template-library/:templateId',
    summary: 'Remove one of the workspace’s templates; built-in ones stay (admin)',
    tags: ['templates'],
    params: s.object({ workspaceId: uuid, templateId: uuid }),
    response: s.object({ removed: s.boolean() }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'admin', async (c) => {
        await c.query('DELETE FROM prd_template_defaults WHERE template_id = $1', [
          params.templateId,
        ]);
        return {
          body: {
            removed: Boolean(
              (await c.query('DELETE FROM template_library WHERE id = $1', [params.templateId]))
                .rowCount,
            ),
          },
        };
      }),
  });

  const use = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/template-library/:templateId/use',
    summary:
      'Use a template: a project (key, name), a sprint (projectId, startDate), an agent (key) or the PRD default for its kind (admin for agents and PRDs)',
    tags: ['templates'],
    params: s.object({ workspaceId: uuid, templateId: s.string({ min: 3, max: 80 }) }),
    body: s.object({
      key: s.optional(s.string({ max: 40 })),
      name: s.optional(s.string({ min: 1, max: 200 })),
      projectId: s.optional(uuid),
      startDate: s.optional(s.string({ pattern: /^\d{4}-\d{2}-\d{2}$/ })),
    }),
    response: s.anyObject(),
    status: 201,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const t = await templateById(c, params.templateId);
        const admin = a.role === 'admin' || a.role === 'owner';
        if (t.kind === 'project') {
          const b = t.body as ProjectTemplateBody;
          if (!body.key || !/^[A-Z][A-Z0-9]{1,9}$/.test(body.key) || !body.name?.trim())
            throw new HttpError(
              400,
              'invalid_request',
              'A project needs a key like APP and a name',
              [{ path: 'body.key', message: 'is 2 to 10 capitals and digits' }],
            );
          if ((await c.query('SELECT 1 FROM projects WHERE key = $1', [body.key])).rowCount)
            throw new HttpError(
              409,
              'conflict',
              'The key ' + body.key + ' is taken in this workspace',
            );
          const id = (
            await c.query<{ id: string }>(
              'INSERT INTO projects (workspace_id, key, name, description) VALUES ($1, $2, $3, $4) RETURNING id',
              [a.workspaceId, body.key, body.name.trim(), t.description],
            )
          ).rows[0]?.id;
          if (!id) throw new Error('project insert returned nothing');
          for (const [i, st] of (b.states ?? DEFAULT_STATES).entries())
            await c.query(
              'INSERT INTO project_states (workspace_id, project_id, name, grp, color, position) VALUES ($1, $2, $3, $4, $5, $6)',
              [a.workspaceId, id, st.name, st.grp, st.color, i],
            );
          for (const l of b.labels)
            await c.query(
              'INSERT INTO labels (workspace_id, project_id, name, color) VALUES ($1, $2, $3, $4)',
              [a.workspaceId, id, l.name, l.color],
            );
          for (const e of b.epics) await insertItem(c, a, id, e, 'epic', null);
          for (const [k, v] of Object.entries(b.settings))
            await c.query(
              "INSERT INTO settings (workspace_id, scope_type, scope_id, key, value, updated_by) VALUES ($1, 'project', $2, $3, $4, $5)",
              [a.workspaceId, id, k, JSON.stringify(v), a.user.id],
            );
          await recordEvent(
            c,
            a.workspaceId,
            {
              actor: actorOf(a),
              verb: 'created',
              object: { type: 'project', id, label: body.key + ' ' + body.name.trim() },
              parent: { type: 'workspace', id: a.workspaceId },
            },
            { projectId: id },
          );
          return { status: 201, body: { kind: 'project', projectId: id } };
        }
        if (t.kind === 'sprint') {
          const b = t.body as SprintTemplateBody;
          if (!body.projectId || !body.startDate)
            throw new HttpError(
              400,
              'invalid_request',
              'A sprint needs a project and a start date',
            );
          const p = await requireProject(c, a, body.projectId);
          const end = sprintEnd(body.startDate, b.days);
          const id = (
            await c.query<{ id: string }>(
              `INSERT INTO sprints (workspace_id, project_id, name, goal, start_date, end_date, number)
               VALUES ($1, $2, $3, $4, $5, $6, (SELECT coalesce(max(number), 0) + 1 FROM sprints WHERE project_id = $2)) RETURNING id`,
              [
                a.workspaceId,
                p.id,
                body.name?.trim() || t.name + ' from ' + body.startDate,
                b.goal,
                body.startDate,
                end,
              ],
            )
          ).rows[0]?.id;
          if (!id) throw new Error('sprint insert returned nothing');
          for (const task of b.tasks) await insertItem(c, a, p.id, task, 'task', id);
          return { status: 201, body: { kind: 'sprint', sprintId: id, endDate: end } };
        }
        if (!admin) throw new HttpError(403, 'forbidden', 'Agents and PRD defaults are for admins');
        if (t.kind === 'agent') {
          const b = t.body as AgentTemplateBody;
          const key = body.key ?? '';
          if (!/^[a-z][a-z0-9-]{0,39}$/.test(key))
            throw new HttpError(400, 'invalid_request', 'An agent needs a key like release-notes', [
              { path: 'body.key', message: 'is lower case letters, digits and dashes' },
            ]);
          await ensureAgents(c, a.workspaceId);
          if ((await c.query('SELECT 1 FROM agents WHERE key = $1', [key])).rowCount)
            throw new HttpError(
              409,
              'conflict',
              'An agent with the key ' + key + ' exists already',
            );
          const id = (
            await c.query<{ id: string }>(
              `INSERT INTO agents (workspace_id, key, name, description, system_prompt, model, tools, enabled, owner_id)
               VALUES ($1, $2, $3, $4, $5, $6, $7, false, $8) RETURNING id`,
              [
                a.workspaceId,
                key,
                body.name?.trim() || b.name,
                b.description,
                b.instructions,
                b.model ?? DEFAULT_MODEL,
                DEFAULT_TOOLS,
                a.user.id,
              ],
            )
          ).rows[0]?.id;
          if (!id) throw new Error('agent insert returned nothing');
          await c.query(
            'INSERT INTO agent_prompt_versions (workspace_id, agent_id, version, prompt, note, created_by) VALUES ($1, $2, 1, $3, $4, $5)',
            [
              a.workspaceId,
              id,
              b.instructions,
              ('from the template ' + t.name).slice(0, 200),
              a.user.id,
            ],
          );
          return { status: 201, body: { kind: 'agent', agentId: id } };
        }
        const b = t.body as PrdTemplateBody;
        await c.query(
          `INSERT INTO prd_template_defaults (workspace_id, idea_kind, template_id) VALUES ($1, $2, $3)
           ON CONFLICT (workspace_id, idea_kind) DO UPDATE SET template_id = EXCLUDED.template_id`,
          [a.workspaceId, b.ideaKind, t.id],
        );
        return { status: 201, body: { kind: 'prd', ideaKind: b.ideaKind } };
      }),
  });

  const resetPrd = route({
    method: 'DELETE',
    path: '/api/workspaces/:workspaceId/prd-template-defaults/:ideaKind',
    summary: 'PRDs of this kind of idea use the built-in sections again (admin)',
    tags: ['templates'],
    params: s.object({
      workspaceId: uuid,
      ideaKind: s.enum(['feature', 'improvement', 'bug', 'research', 'change_request']),
    }),
    response: s.object({ removed: s.boolean() }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'admin', async (c) => ({
        body: {
          removed: Boolean(
            (
              await c.query('DELETE FROM prd_template_defaults WHERE idea_kind = $1', [
                params.ideaKind,
              ])
            ).rowCount,
          ),
        },
      })),
  });

  return [list, add, fromProject, remove, use, resetPrd];
}
