// ── [PCODE-359 | S15 | v0.1.0] T35.7a Plan contents enforced ──
// ── [PCODE-351 | S15 | v0.1.0] T35.3b Settings for teams and projects in the screen, project leads as project admins, budget warnings at 50/80/100 % ──
// ── [PCODE-328 | S15 | v0.1.0] T33.1b Cost estimate before a run, chargeback per client and cost centre, unit costs ──
// ── [PCODE-254 | S15 | v0.1.0] T26.3 Flow and backlog: links, WIP limits, warnings, definition of done, triage, templates, recurring tasks ──
// ── [PCODE-163 | S15 | v0.1.0] B1.2 Roles, clients and portal sign-in on the server ──
// ── [PCODE-92 | S15 | v0.1.0] Add workspaces, projects, members and roles to the API ──
// ── [PCODE-102 | S15 | v0.1.0] Port the engine's loop to the server: sync, start, status, note, done ──
// ── [PCODE-115 | S15 | v0.1.0] Add settings and user management: profile, password, tokens, members, invitations, project settings ──
//    Why:  projects and who may see them. Members create projects; admins archive them and invite guests.
//          A new project starts with the board's states (Backlog … Cancelled, the colours of v0.1.0), so
//          items can be filed at once.
import type { Pool, PoolClient } from 'pg';
import { recordEvent } from '../events/outbox.js';
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s } from '../http/schema.js';
import { requireProjectRoom } from '../licence/licence.js'; // [PCODE-359 | S15 | v0.1.0]
import {
  actorOf,
  asMember,
  atLeast,
  isUniqueViolation,
  requireProject,
  type ProjectRow,
  requireProjectAdmin,
} from './access.js';

export const DEFAULT_STATES: readonly { name: string; grp: string; color: string }[] = [
  { name: 'Backlog', grp: 'backlog', color: '#8b8d98' },
  { name: 'Todo', grp: 'unstarted', color: '#3f76ff' },
  { name: 'In Progress', grp: 'started', color: '#f59e0b' },
  { name: 'Review', grp: 'started', color: '#a855f7' },
  { name: 'Test', grp: 'started', color: '#06b6d4' },
  { name: 'Blocked', grp: 'started', color: '#ef4444' },
  { name: 'Done', grp: 'completed', color: '#16a34a' },
  { name: 'Cancelled', grp: 'cancelled', color: '#6b7280' },
];

const uuid = s.string({ format: 'uuid' });
const wsParams = s.object({ workspaceId: uuid });
const projectParams = s.object({ workspaceId: uuid, projectId: uuid });

const stateOut = s.object({
  id: s.string(),
  name: s.string(),
  group: s.string(),
  color: s.string(),
  position: s.number({ integer: true }),
  wipLimit: s.nullable(s.number({ integer: true })), // [PCODE-254 | S15 | v0.1.0]
});
const projectOut = s.object({
  id: s.string(),
  key: s.string(),
  name: s.string(),
  description: s.string(),
  archived: s.boolean(),
  createdAt: s.string(),
});
const projectDetail = s.object({
  id: s.string(),
  key: s.string(),
  name: s.string(),
  description: s.string(),
  archived: s.boolean(),
  createdAt: s.string(),
  states: s.array(stateOut),
  guests: s.array(s.object({ userId: s.string(), name: s.string(), email: s.string() })),
  // [PCODE-102 | S15 | v0.1.0] the version fingerprints carry, and the rules of the development loop
  version: s.string(),
  loopRules: s.object({
    reviewBeforeDone: s.boolean(),
    autoTestState: s.boolean(),
    unguardedPaths: s.array(s.string()),
  }),
  // [PCODE-328 | S15 | v0.1.0] the cost centre its AI cost is booked to
  costCentre: s.string(),
});

const projectJson = (
  p: ProjectRow,
): {
  id: string;
  key: string;
  name: string;
  description: string;
  archived: boolean;
  createdAt: string;
} => ({
  id: p.id,
  key: p.key,
  name: p.name,
  description: p.description,
  archived: p.archived_at !== null,
  createdAt: p.created_at.toISOString(),
});

interface StateRow {
  id: string;
  name: string;
  grp: string;
  color: string;
  position: number;
  wip_limit: number | null; // [PCODE-254 | S15 | v0.1.0]
}

async function detail(
  c: PoolClient,
  p: ProjectRow,
): Promise<
  ReturnType<typeof projectJson> & {
    states: {
      id: string;
      name: string;
      group: string;
      color: string;
      position: number;
      wipLimit: number | null;
    }[];
    guests: { userId: string; name: string; email: string }[];
    version: string;
    loopRules: { reviewBeforeDone: boolean; autoTestState: boolean; unguardedPaths: string[] };
    costCentre: string;
  }
> {
  const extra = (
    await c.query<{
      version: string;
      loop_rules: { reviewBeforeDone: boolean; autoTestState: boolean; unguardedPaths: string[] };
      cost_centre: string;
    }>('SELECT version, loop_rules, cost_centre FROM projects WHERE id = $1', [p.id])
  ).rows[0];
  const states = (
    await c.query<StateRow>(
      'SELECT id, name, grp, color, position, wip_limit FROM project_states WHERE project_id = $1 ORDER BY position',
      [p.id],
    )
  ).rows;
  const guests = (
    await c.query<{ user_id: string; name: string; email: string }>(
      'SELECT g.user_id, u.name, u.email FROM project_guests g JOIN users u ON u.id = g.user_id WHERE g.project_id = $1 ORDER BY u.name',
      [p.id],
    )
  ).rows;
  return {
    ...projectJson(p),
    states: states.map((st) => ({
      id: st.id,
      name: st.name,
      group: st.grp,
      color: st.color,
      position: st.position,
      wipLimit: st.wip_limit,
    })),
    guests: guests.map((g) => ({ userId: g.user_id, name: g.name, email: g.email })),
    version: extra?.version ?? '0.1.0',
    loopRules: extra?.loop_rules ?? {
      reviewBeforeDone: true,
      autoTestState: true,
      unguardedPaths: [],
    },
    costCentre: extra?.cost_centre ?? '', // [PCODE-328 | S15 | v0.1.0]
  };
}

const PROJECT_COLUMNS = 'id, key, name, description, archived_at, created_at';

export function projectRoutes(pool: Pool): Route[] {
  const list = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/projects',
    summary: 'The projects the caller may see (guests: the ones they are invited to)',
    tags: ['projects'],
    params: wsParams,
    response: s.array(projectOut),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        const rows = (
          await c.query<ProjectRow>(
            `SELECT ${PROJECT_COLUMNS} FROM projects p
             WHERE $1 <> 'guest' OR guest_sees_project(p.id, $2)
             ORDER BY archived_at NULLS FIRST, name`,
            [a.role, a.user.id],
          )
        ).rows;
        return { body: rows.map(projectJson) };
      }),
  });

  const create = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/projects',
    summary: 'Create a project with the default board states (member)',
    tags: ['projects'],
    params: wsParams,
    body: s.object({
      key: s.string({ pattern: /^[A-Z][A-Z0-9]{1,9}$/ }),
      name: s.string({ min: 1, max: 200 }),
      description: s.optional(s.string({ max: 10_000 })),
    }),
    response: projectDetail,
    status: 201,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        await requireProjectRoom(c, a.workspaceId); // [PCODE-359 | S15 | v0.1.0]
        let p: ProjectRow | undefined;
        try {
          p = (
            await c.query<ProjectRow>(
              `INSERT INTO projects (workspace_id, key, name, description) VALUES ($1, $2, $3, $4) RETURNING ${PROJECT_COLUMNS}`,
              [a.workspaceId, body.key, body.name.trim(), body.description ?? ''],
            )
          ).rows[0];
        } catch (err) {
          if (isUniqueViolation(err))
            throw new HttpError(
              409,
              'conflict',
              'The key ' + body.key + ' is taken in this workspace',
            );
          throw err;
        }
        if (!p) throw new Error('project insert returned nothing');
        for (const [i, st] of DEFAULT_STATES.entries()) {
          await c.query(
            'INSERT INTO project_states (workspace_id, project_id, name, grp, color, position) VALUES ($1, $2, $3, $4, $5, $6)',
            [a.workspaceId, p.id, st.name, st.grp, st.color, i],
          );
        }
        await recordEvent(
          c,
          a.workspaceId,
          {
            actor: actorOf(a),
            verb: 'created',
            object: { type: 'project', id: p.id, label: p.key + ' ' + p.name },
            parent: { type: 'workspace', id: a.workspaceId },
          },
          { projectId: p.id },
        );
        return { status: 201, body: await detail(c, p) };
      }),
  });

  const get = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/projects/:projectId',
    summary: 'A project with its states and guests',
    tags: ['projects'],
    params: projectParams,
    response: projectDetail,
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => ({
        body: await detail(c, await requireProject(c, a, params.projectId)),
      })),
  });

  const update = route({
    method: 'PATCH',
    path: '/api/workspaces/:workspaceId/projects/:projectId',
    summary: 'Rename or describe a project (member); archive or restore it (admin)',
    tags: ['projects'],
    params: projectParams,
    body: s.object({
      name: s.optional(s.string({ min: 1, max: 200 })),
      description: s.optional(s.string({ max: 10_000 })),
      archived: s.optional(s.boolean()),
      // [PCODE-115 | S15 | v0.1.0] the version fingerprints carry (admin)
      version: s.optional(s.string({ pattern: /^\d{1,4}\.\d{1,4}\.\d{1,6}$/ })),
      // [PCODE-102 | S15 | v0.1.0] admins change the loop rules; fields left out stay as they are
      loopRules: s.optional(
        s.object({
          reviewBeforeDone: s.optional(s.boolean()),
          autoTestState: s.optional(s.boolean()),
          unguardedPaths: s.optional(s.array(s.string({ min: 1, max: 200 }), { max: 100 })),
        }),
      ),
      // [PCODE-328 | S15 | v0.1.0] the cost centre (admin)
      costCentre: s.optional(s.string({ max: 60 })),
    }),
    response: projectDetail,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const p = await requireProject(c, a, params.projectId);
        const changes: Record<string, { from: unknown; to: unknown }> = {};
        if (body.loopRules !== undefined && !atLeast(a.role, 'admin'))
          throw new HttpError(403, 'forbidden', 'Only an admin changes the loop rules');
        // [PCODE-115 | S15 | v0.1.0] the version, by an admin
        if (body.version !== undefined) {
          if (!atLeast(a.role, 'admin'))
            throw new HttpError(403, 'forbidden', 'Only an admin changes the version');
          const before = (await detail(c, p)).version;
          if (before !== body.version) {
            await c.query('UPDATE projects SET version = $2 WHERE id = $1', [p.id, body.version]);
            changes['version'] = { from: before, to: body.version };
          }
        }
        if (body.loopRules !== undefined) {
          const before = (await detail(c, p)).loopRules;
          const after = { ...before, ...body.loopRules };
          if (JSON.stringify(after) !== JSON.stringify(before)) {
            await c.query('UPDATE projects SET loop_rules = $2 WHERE id = $1', [
              p.id,
              JSON.stringify(after),
            ]);
            changes['loopRules'] = { from: before, to: after };
          }
        }
        // [PCODE-328 | S15 | v0.1.0] the cost centre, by an admin
        if (body.costCentre !== undefined) {
          if (!atLeast(a.role, 'admin'))
            throw new HttpError(403, 'forbidden', 'Only an admin sets the cost centre');
          const before = (await detail(c, p)).costCentre;
          const after = body.costCentre.trim();
          if (before !== after) {
            await c.query('UPDATE projects SET cost_centre = $2 WHERE id = $1', [p.id, after]);
            changes['costCentre'] = { from: before, to: after };
          }
        }
        // [PCODE-359 | S15 | v0.1.0] restoring an archived project needs room for it
        if (body.archived === false && p.archived_at !== null)
          await requireProjectRoom(c, a.workspaceId);
        if (body.archived !== undefined && !atLeast(a.role, 'admin'))
          throw new HttpError(403, 'forbidden', 'Only an admin archives or restores a project');
        const next = { ...p };
        if (body.name !== undefined && body.name.trim() !== p.name) {
          changes['name'] = { from: p.name, to: body.name.trim() };
          next.name = body.name.trim();
        }
        if (body.description !== undefined && body.description !== p.description) {
          changes['description'] = { from: p.description, to: body.description };
          next.description = body.description;
        }
        if (body.archived !== undefined && body.archived !== (p.archived_at !== null)) {
          changes['archived'] = { from: p.archived_at !== null, to: body.archived };
        }
        if (Object.keys(changes).length === 0) return { body: await detail(c, p) };
        const row = (
          await c.query<ProjectRow>(
            `UPDATE projects SET name = $2, description = $3,
               archived_at = CASE WHEN $4::boolean IS NULL THEN archived_at WHEN $4 THEN coalesce(archived_at, now()) ELSE NULL END
             WHERE id = $1 RETURNING ${PROJECT_COLUMNS}`,
            [p.id, next.name, next.description, body.archived ?? null],
          )
        ).rows[0];
        if (!row) throw new Error('project update returned nothing');
        await recordEvent(
          c,
          a.workspaceId,
          {
            actor: actorOf(a),
            verb: 'updated',
            object: { type: 'project', id: p.id, label: row.key + ' ' + row.name },
            parent: { type: 'workspace', id: a.workspaceId },
            changes,
          },
          { projectId: p.id },
        );
        return { body: await detail(c, row) };
      }),
  });

  async function guestTarget(c: PoolClient, userId: string): Promise<{ name: string }> {
    const m = (
      await c.query<{ role: string; name: string }>(
        'SELECT m.role, u.name FROM workspace_members m JOIN users u ON u.id = m.user_id WHERE m.user_id = $1',
        [userId],
      )
    ).rows[0];
    if (!m) throw new HttpError(404, 'not_found', 'Member not found');
    if (m.role !== 'guest')
      throw new HttpError(
        409,
        'conflict',
        'Only guests are invited to single projects; members see every project',
      );
    return m;
  }

  const inviteGuest = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/projects/:projectId/guests',
    summary: 'Let a guest of the workspace see this project (admin)',
    tags: ['projects'],
    params: projectParams,
    body: s.object({ userId: uuid }),
    response: projectDetail,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        // [PCODE-351 | S15 | v0.1.0] an admin, or the lead of this project
        await requireProjectAdmin(c, a, params.projectId);
        const p = await requireProject(c, a, params.projectId);
        const g = await guestTarget(c, body.userId);
        const added = await c.query(
          'INSERT INTO project_guests (workspace_id, project_id, user_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
          [a.workspaceId, p.id, body.userId],
        );
        if (added.rowCount) {
          await recordEvent(
            c,
            a.workspaceId,
            {
              actor: actorOf(a),
              verb: 'assigned',
              object: { type: 'member', id: body.userId, label: g.name },
              parent: { type: 'project', id: p.id },
            },
            { projectId: p.id },
          );
        }
        return { body: await detail(c, p) };
      }),
  });

  const removeGuest = route({
    method: 'DELETE',
    path: '/api/workspaces/:workspaceId/projects/:projectId/guests/:userId',
    summary: 'Stop a guest from seeing this project (admin)',
    tags: ['projects'],
    params: s.object({ workspaceId: uuid, projectId: uuid, userId: uuid }),
    response: projectDetail,
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        // [PCODE-351 | S15 | v0.1.0] an admin, or the lead of this project
        await requireProjectAdmin(c, a, params.projectId);
        const p = await requireProject(c, a, params.projectId);
        const gone = await c.query(
          'DELETE FROM project_guests WHERE project_id = $1 AND user_id = $2',
          [p.id, params.userId],
        );
        if (gone.rowCount) {
          await recordEvent(
            c,
            a.workspaceId,
            {
              actor: actorOf(a),
              verb: 'deleted',
              object: { type: 'member', id: params.userId },
              parent: { type: 'project', id: p.id },
            },
            { projectId: p.id },
          );
        }
        return { body: await detail(c, p) };
      }),
  });

  return [list, create, get, update, inviteGuest, removeGuest];
}
