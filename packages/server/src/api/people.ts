// ── [PCODE-248 | S15 | v0.1.0] T25.3 Custom roles, role conditions and project roles enforced ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-182 | S15 | v0.1.0] B5.3 People live: members, teams, roles, sign-in rules and sessions, access reviews, access checker, offboarding ──
//    Why:  the People section of the approved design. Everyone with their role, teams, projects, second
//          factor and last activity; teams; custom roles built on a base role; the workspace's sign-in
//          rules; access reviews that certify who keeps what; a checker that explains why a person can or
//          cannot see a project or task; and offboarding that hands over work, revokes the person's tokens
//          for this workspace and suspends the membership, freeing the seat while history keeps the name.
import {
  conditionsProblem,
  conditionText,
  ROLE_PERMISSIONS,
  ROLES,
  roleHas,
  type RoleCondition,
} from '@orqiva/shared';
import type { Pool, PoolClient } from 'pg';
import { inSystem } from '../db/pool.js';
import { recordEvent } from '../events/outbox.js';
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s } from '../http/schema.js';
import { checkSeat, entitlement } from '../licence/licence.js';
import {
  actorOf,
  asMember,
  atLeast,
  customRoleAllows,
  hasSecondFactor,
  requireProject,
  type Access,
} from './access.js';

const uuid = s.string({ format: 'uuid' });
const wsParams = s.object({ workspaceId: uuid });
const memberParams = s.object({ workspaceId: uuid, userId: uuid });
const STALE_DAYS = 30;

const personOut = s.object({
  userId: s.string(),
  name: s.string(),
  email: s.string(),
  role: s.string(),
  customRoleId: s.nullable(s.string()),
  customRoleName: s.nullable(s.string()),
  teams: s.array(s.string()),
  projects: s.number({ integer: true }),
  clientName: s.nullable(s.string()),
  isService: s.boolean(),
  secondFactor: s.boolean(),
  lastActiveAt: s.nullable(s.string()),
  stale: s.boolean(),
  suspendedAt: s.nullable(s.string()),
  takesSeat: s.boolean(),
  joinedAt: s.string(),
});

interface MemberRow {
  user_id: string;
  name: string;
  email: string;
  role: string;
  custom_role_id: string | null;
  custom_role_name: string | null;
  teams: string[] | null;
  projects: string;
  client_name: string | null;
  is_service: boolean;
  suspended_at: Date | null;
  created_at: Date;
}

async function peopleOf(pool: Pool, c: PoolClient, onlyUser?: string) {
  const rows = (
    await c.query<MemberRow>(
      `SELECT m.user_id, u.name, u.email, m.role, m.custom_role_id, r.name AS custom_role_name,
              (SELECT array_agg(t.name ORDER BY t.name) FROM team_members tm JOIN teams t ON t.id = tm.team_id WHERE tm.user_id = m.user_id) AS teams,
              CASE WHEN m.role = 'guest'
                   THEN (SELECT count(*) FROM projects p WHERE p.archived_at IS NULL AND guest_sees_project(p.id, m.user_id))
                   ELSE (SELECT count(*) FROM projects p WHERE p.archived_at IS NULL) END AS projects,
              (SELECT cl.name FROM client_contacts cc JOIN clients cl ON cl.id = cc.client_id WHERE cc.user_id = m.user_id LIMIT 1) AS client_name,
              u.is_service, m.suspended_at, m.created_at
         FROM workspace_members m JOIN users u ON u.id = m.user_id LEFT JOIN roles r ON r.id = m.custom_role_id
        WHERE ($1::uuid IS NULL OR m.user_id = $1)
        ORDER BY m.suspended_at NULLS FIRST, u.is_service, u.name`,
      [onlyUser ?? null],
    )
  ).rows;
  const ids = rows.map((r) => r.user_id);
  const sys = await inSystem(pool, async (sc) => ({
    active: (
      await sc.query<{ user_id: string; at: Date | null }>(
        `SELECT u.id AS user_id, greatest((SELECT max(last_seen_at) FROM sessions s WHERE s.user_id = u.id),
                                          (SELECT max(last_used_at) FROM api_tokens t WHERE t.user_id = u.id)) AS at
           FROM users u WHERE u.id = ANY($1::uuid[])`,
        [ids],
      )
    ).rows,
    mfa: (
      await sc.query<{ user_id: string }>(
        'SELECT user_id FROM user_totp WHERE enabled_at IS NOT NULL AND user_id = ANY($1::uuid[])',
        [ids],
      )
    ).rows.map((r) => r.user_id),
  }));
  return rows.map((r) => {
    const at = sys.active.find((x) => x.user_id === r.user_id)?.at ?? null;
    return {
      userId: r.user_id,
      name: r.name,
      email: r.is_service ? '' : r.email,
      role: r.role,
      customRoleId: r.custom_role_id,
      customRoleName: r.custom_role_name,
      teams: r.teams ?? [],
      projects: Number(r.projects),
      clientName: r.client_name,
      isService: r.is_service,
      secondFactor: sys.mfa.includes(r.user_id),
      lastActiveAt: at?.toISOString() ?? null,
      stale:
        !r.suspended_at &&
        !r.is_service &&
        Date.now() - (at ?? r.created_at).getTime() > STALE_DAYS * 86_400_000,
      suspendedAt: r.suspended_at?.toISOString() ?? null,
      takesSeat: !r.suspended_at && !r.is_service && !r.client_name,
      joinedAt: r.created_at.toISOString(),
    };
  });
}

export function peopleRoutes(pool: Pool): Route[] {
  const people = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/people',
    summary:
      'Everyone in the workspace with role, teams, projects, second factor, last activity and seat; open invitations (member)',
    tags: ['people'],
    params: wsParams,
    response: s.object({
      people: s.array(personOut),
      seats: s.object({ used: s.number({ integer: true }), total: s.number({ integer: true }) }),
      invitations: s.array(
        s.object({ id: s.string(), email: s.string(), role: s.string(), expiresAt: s.string() }),
      ),
    }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const e = await entitlement(c, a.workspaceId);
        const inv = (
          await c.query<{ id: string; email: string; role: string; expires_at: Date }>(
            'SELECT id, email, role, expires_at FROM invitations WHERE accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now() ORDER BY created_at DESC',
          )
        ).rows;
        return {
          body: {
            people: await peopleOf(pool, c),
            seats: { used: e.used, total: e.seats },
            invitations: atLeast(a.role, 'admin')
              ? inv.map((i) => ({
                  id: i.id,
                  email: i.email,
                  role: i.role,
                  expiresAt: i.expires_at.toISOString(),
                }))
              : [],
          },
        };
      }),
  });

  // ── teams ──
  const teamOut = s.object({
    id: s.string(),
    name: s.string(),
    parentId: s.nullable(s.string()),
    members: s.array(s.object({ userId: s.string(), name: s.string(), lead: s.boolean() })),
  });
  const teamsOf = async (c: PoolClient) => {
    const teams = (
      await c.query<{ id: string; name: string; parent_id: string | null }>(
        'SELECT id, name, parent_id FROM teams ORDER BY name',
      )
    ).rows;
    const members = (
      await c.query<{ team_id: string; user_id: string; name: string; is_lead: boolean }>(
        'SELECT tm.team_id, tm.user_id, u.name, tm.is_lead FROM team_members tm JOIN users u ON u.id = tm.user_id ORDER BY u.name',
      )
    ).rows;
    return teams.map((t) => ({
      id: t.id,
      name: t.name,
      parentId: t.parent_id,
      members: members
        .filter((m) => m.team_id === t.id)
        .map((m) => ({ userId: m.user_id, name: m.name, lead: m.is_lead })),
    }));
  };
  const teams = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/teams',
    summary: 'The teams with their members and leads (member)',
    tags: ['people'],
    params: wsParams,
    response: s.array(teamOut),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c) => ({ body: await teamsOf(c) })),
  });
  const saveTeam = route({
    method: 'PUT',
    path: '/api/workspaces/:workspaceId/teams',
    summary: 'Make or change a team: name, parent, members and leads (admin)',
    tags: ['people'],
    params: wsParams,
    body: s.object({
      id: s.optional(uuid),
      name: s.string({ min: 1, max: 80 }),
      parentId: s.optional(s.nullable(uuid)),
      memberIds: s.array(uuid, { max: 500 }),
      leadIds: s.optional(s.array(uuid, { max: 50 })),
    }),
    response: s.array(teamOut),
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'admin', async (c, a) => {
        const known = new Set(
          (
            await c.query<{ user_id: string }>(
              'SELECT user_id FROM workspace_members WHERE user_id = ANY($1::uuid[])',
              [body.memberIds],
            )
          ).rows.map((r) => r.user_id),
        );
        if (known.size !== new Set(body.memberIds).size)
          throw new HttpError(
            400,
            'invalid_request',
            'Every team member is a member of the workspace',
            [{ path: 'body.memberIds', message: 'names someone outside the workspace' }],
          );
        if (body.parentId && body.parentId === body.id)
          throw new HttpError(400, 'invalid_request', 'A team is not its own parent', [
            { path: 'body.parentId', message: 'is the team itself' },
          ]);
        let id = body.id;
        try {
          if (id) {
            const r = await c.query('UPDATE teams SET name = $2, parent_id = $3 WHERE id = $1', [
              id,
              body.name.trim(),
              body.parentId ?? null,
            ]);
            if (!r.rowCount) throw new HttpError(404, 'not_found', 'Team not found');
          } else
            id = (
              await c.query<{ id: string }>(
                'INSERT INTO teams (workspace_id, name, parent_id) VALUES ($1, $2, $3) RETURNING id',
                [a.workspaceId, body.name.trim(), body.parentId ?? null],
              )
            ).rows[0]?.id;
        } catch (e) {
          if (e instanceof Error && 'code' in e && (e as { code?: string }).code === '23505')
            throw new HttpError(409, 'conflict', 'A team with this name exists already');
          throw e;
        }
        await c.query('DELETE FROM team_members WHERE team_id = $1', [id]);
        for (const u of new Set(body.memberIds))
          await c.query(
            'INSERT INTO team_members (workspace_id, team_id, user_id, is_lead) VALUES ($1, $2, $3, $4)',
            [a.workspaceId, id, u, (body.leadIds ?? []).includes(u)],
          );
        return { body: await teamsOf(c) };
      }),
  });
  const removeTeam = route({
    method: 'DELETE',
    path: '/api/workspaces/:workspaceId/teams/:teamId',
    summary: 'Remove a team; its people stay in the workspace (admin)',
    tags: ['people'],
    params: s.object({ workspaceId: uuid, teamId: uuid }),
    response: s.array(teamOut),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'admin', async (c) => {
        await c.query('DELETE FROM teams WHERE id = $1', [params.teamId]);
        return { body: await teamsOf(c) };
      }),
  });

  // ── roles ──
  const roleOut = s.object({
    id: s.string(),
    name: s.string(),
    baseRole: s.string(),
    permissions: s.array(s.string()),
    members: s.number({ integer: true }),
    // [PCODE-248 | S15 | v0.1.0] when a permission holds: {"ship": {"weekdays": [1,2,3,4,5], "hours": [8, 18]}}
    conditions: s.anyObject(),
  });
  const customRoles = async (c: PoolClient) =>
    (
      await c.query<{
        id: string;
        name: string;
        base_role: string;
        permissions: string[];
        conditions: Record<string, unknown>;
        n: string;
      }>(
        'SELECT r.id, r.name, r.base_role, r.permissions, r.conditions, (SELECT count(*) FROM workspace_members m WHERE m.custom_role_id = r.id) AS n FROM roles r ORDER BY r.name',
      )
    ).rows.map((r) => ({
      id: r.id,
      name: r.name,
      baseRole: r.base_role,
      permissions: r.permissions,
      conditions: r.conditions,
      members: Number(r.n),
    }));
  const roles = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/roles',
    summary: 'What each built-in role may do, and the workspace’s custom roles (member)',
    tags: ['people'],
    params: wsParams,
    response: s.object({
      builtIn: s.array(
        s.object({ key: s.string(), label: s.string(), roles: s.array(s.string()) }),
      ),
      custom: s.array(roleOut),
    }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c) => ({
        body: {
          builtIn: ROLE_PERMISSIONS.map((p) => ({
            key: p.key,
            label: p.label,
            roles: [...p.roles],
          })),
          custom: await customRoles(c),
        },
      })),
  });
  const addRole = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/roles',
    summary: 'A custom role: a name on a base role, with the permissions it keeps (admin)',
    tags: ['people'],
    params: wsParams,
    body: s.object({
      name: s.string({ min: 1, max: 60 }),
      baseRole: s.enum(['admin', 'member', 'tester', 'designer', 'billing', 'auditor', 'guest']),
      permissions: s.optional(s.array(s.string({ max: 40 }), { max: 30 })),
    }),
    response: s.array(roleOut),
    status: 201,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'admin', async (c, a) => {
        const perms =
          body.permissions ??
          ROLE_PERMISSIONS.filter((p) => roleHas(body.baseRole, p.key)).map((p) => p.key);
        const beyond = perms.filter((p) => !roleHas(body.baseRole, p));
        if (beyond.length)
          throw new HttpError(
            400,
            'invalid_request',
            'A custom role keeps or narrows its base role; ' +
              body.baseRole +
              ' cannot ' +
              beyond.join(', '),
            [{ path: 'body.permissions', message: 'goes beyond the base role' }],
          );
        try {
          await c.query(
            'INSERT INTO roles (workspace_id, name, base_role, permissions) VALUES ($1, $2, $3, $4)',
            [a.workspaceId, body.name.trim(), body.baseRole, perms],
          );
        } catch (e) {
          if (e instanceof Error && (e as { code?: string }).code === '23505')
            throw new HttpError(409, 'conflict', 'A role with this name exists already');
          throw e;
        }
        return { status: 201, body: await customRoles(c) };
      }),
  });
  // [PCODE-248 | S15 | v0.1.0] a custom role's permissions and the conditions they hold under
  const changeRole = route({
    method: 'PATCH',
    path: '/api/workspaces/:workspaceId/roles/:roleId',
    summary: 'Change a custom role: name, permissions within its base role, conditions (admin)',
    tags: ['people'],
    params: s.object({ workspaceId: uuid, roleId: uuid }),
    body: s.object({
      name: s.optional(s.string({ min: 1, max: 60 })),
      permissions: s.optional(s.array(s.string({ max: 40 }), { max: 30 })),
      conditions: s.optional(s.anyObject()),
    }),
    response: s.array(roleOut),
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'admin', async (c, a) => {
        const r = (
          await c.query<{ name: string; base_role: string; permissions: string[] }>(
            'SELECT name, base_role, permissions FROM roles WHERE id = $1',
            [params.roleId],
          )
        ).rows[0];
        if (!r) throw new HttpError(404, 'not_found', 'Role not found');
        const beyond = (body.permissions ?? []).filter((p) => !roleHas(r.base_role, p));
        if (beyond.length)
          throw new HttpError(
            400,
            'invalid_request',
            'A custom role keeps or narrows its base role; ' +
              r.base_role +
              ' cannot ' +
              beyond.join(', '),
            [{ path: 'body.permissions', message: 'goes beyond the base role' }],
          );
        const problem = body.conditions ? conditionsProblem(body.conditions) : null;
        if (problem)
          throw new HttpError(400, 'invalid_request', problem, [
            { path: 'body.conditions', message: problem },
          ]);
        await c.query(
          'UPDATE roles SET name = coalesce($2, name), permissions = coalesce($3, permissions), conditions = coalesce($4, conditions) WHERE id = $1',
          [
            params.roleId,
            body.name?.trim() ?? null,
            body.permissions ?? null,
            body.conditions ? JSON.stringify(body.conditions) : null,
          ],
        );
        await recordEvent(c, a.workspaceId, {
          actor: actorOf(a),
          verb: 'updated',
          object: { type: 'workspace', id: a.workspaceId, label: 'role ' + r.name },
          changes: {
            ...(body.permissions
              ? { permissions: { from: r.permissions, to: body.permissions } }
              : {}),
            ...(body.conditions
              ? {
                  conditions: {
                    from: null,
                    to: Object.entries(body.conditions as Record<string, RoleCondition>)
                      .map(([k, v]) => k + ' ' + conditionText(v))
                      .join('; '),
                  },
                }
              : {}),
          },
        });
        return { body: await customRoles(c) };
      }),
  });

  // [PCODE-248 | S15 | v0.1.0] project roles: a person's role in one project overrides the workspace's there
  const projectMemberOut = s.object({
    userId: s.string(),
    name: s.string(),
    workspaceRole: s.string(),
    role: s.string(),
  });
  const projectMembersOf = async (c: PoolClient, projectId: string) =>
    (
      await c.query<{ user_id: string; name: string; workspace_role: string; role: string }>(
        `SELECT pm.user_id, u.name, m.role AS workspace_role, pm.role FROM project_members pm
         JOIN users u ON u.id = pm.user_id JOIN workspace_members m ON m.user_id = pm.user_id
         WHERE pm.project_id = $1 ORDER BY u.name`,
        [projectId],
      )
    ).rows.map((r) => ({
      userId: r.user_id,
      name: r.name,
      workspaceRole: r.workspace_role,
      role: r.role,
    }));
  const projectParams = s.object({ workspaceId: uuid, projectId: uuid });
  const projectMembers = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/projects/:projectId/members',
    summary: "The project's own roles: lead, member, tester, designer, viewer (member)",
    tags: ['people'],
    params: projectParams,
    response: s.array(projectMemberOut),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        await requireProject(c, a, params.projectId);
        return { body: await projectMembersOf(c, params.projectId) };
      }),
  });
  const setProjectMember = route({
    method: 'PUT',
    path: '/api/workspaces/:workspaceId/projects/:projectId/members/:userId',
    summary: "Set a person's role in one project; it overrides the workspace role there (admin)",
    tags: ['people'],
    params: s.object({ workspaceId: uuid, projectId: uuid, userId: uuid }),
    body: s.object({ role: s.enum(['lead', 'member', 'tester', 'designer', 'viewer']) }),
    response: s.array(projectMemberOut),
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'admin', async (c, a) => {
        const p = await requireProject(c, a, params.projectId);
        const m = (
          await c.query<{ role: string; name: string }>(
            'SELECT m.role, u.name FROM workspace_members m JOIN users u ON u.id = m.user_id WHERE m.user_id = $1',
            [params.userId],
          )
        ).rows[0];
        if (!m) throw new HttpError(404, 'not_found', 'Member not found');
        if (m.role === 'guest')
          throw new HttpError(
            409,
            'conflict',
            'Guests reach a project by invitation; give ' + m.name + ' a member role first',
          );
        const before = (
          await c.query<{ role: string }>(
            'SELECT role FROM project_members WHERE project_id = $1 AND user_id = $2',
            [p.id, params.userId],
          )
        ).rows[0]?.role;
        await c.query(
          `INSERT INTO project_members (workspace_id, project_id, user_id, role) VALUES ($1, $2, $3, $4)
           ON CONFLICT (project_id, user_id) DO UPDATE SET role = $4`,
          [a.workspaceId, p.id, params.userId, body.role],
        );
        await recordEvent(
          c,
          a.workspaceId,
          {
            actor: actorOf(a),
            verb: 'updated',
            object: { type: 'project', id: p.id, label: p.key },
            changes: { projectRole: { from: before ?? null, to: m.name + ': ' + body.role } },
          },
          { projectId: p.id },
        );
        return { body: await projectMembersOf(c, p.id) };
      }),
  });
  const dropProjectMember = route({
    method: 'DELETE',
    path: '/api/workspaces/:workspaceId/projects/:projectId/members/:userId',
    summary: 'Take away a project role; the workspace role counts again (admin)',
    tags: ['people'],
    params: s.object({ workspaceId: uuid, projectId: uuid, userId: uuid }),
    response: s.array(projectMemberOut),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'admin', async (c, a) => {
        const p = await requireProject(c, a, params.projectId);
        const gone = (
          await c.query<{ role: string }>(
            'DELETE FROM project_members WHERE project_id = $1 AND user_id = $2 RETURNING role',
            [p.id, params.userId],
          )
        ).rows[0];
        if (gone)
          await recordEvent(
            c,
            a.workspaceId,
            {
              actor: actorOf(a),
              verb: 'updated',
              object: { type: 'project', id: p.id, label: p.key },
              changes: { projectRole: { from: gone.role, to: null } },
            },
            { projectId: p.id },
          );
        return { body: await projectMembersOf(c, p.id) };
      }),
  });

  const removeRole = route({
    method: 'DELETE',
    path: '/api/workspaces/:workspaceId/roles/:roleId',
    summary: 'Remove a custom role; its people keep their base role (admin)',
    tags: ['people'],
    params: s.object({ workspaceId: uuid, roleId: uuid }),
    response: s.array(roleOut),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'admin', async (c) => {
        await c.query('DELETE FROM roles WHERE id = $1', [params.roleId]);
        return { body: await customRoles(c) };
      }),
  });
  const assignRole = route({
    method: 'PUT',
    path: '/api/workspaces/:workspaceId/members/:userId/custom-role',
    summary: 'Give a member a custom role (they get its base role) or take it away (admin)',
    tags: ['people'],
    params: memberParams,
    body: s.object({ roleId: s.nullable(uuid) }),
    response: personOut,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'admin', async (c) => {
        const m = (
          await c.query<{ role: string }>('SELECT role FROM workspace_members WHERE user_id = $1', [
            params.userId,
          ])
        ).rows[0];
        if (!m) throw new HttpError(404, 'not_found', 'Member not found');
        if (m.role === 'owner')
          throw new HttpError(409, 'conflict', 'An owner keeps the owner role');
        const r = body.roleId
          ? (
              await c.query<{ base_role: string }>('SELECT base_role FROM roles WHERE id = $1', [
                body.roleId,
              ])
            ).rows[0]
          : null;
        if (body.roleId && !r) throw new HttpError(404, 'not_found', 'Role not found');
        await c.query(
          'UPDATE workspace_members SET custom_role_id = $2, role = coalesce($3, role) WHERE user_id = $1',
          [params.userId, body.roleId, r?.base_role ?? null],
        );
        const p = (await peopleOf(pool, c, params.userId))[0];
        if (!p) throw new Error('member vanished');
        return { body: p };
      }),
  });

  // ── sign-in rules ──
  const securityOut = s.object({
    mfaRoles: s.array(s.string()),
    sessionIdleHours: s.nullable(s.number({ integer: true })),
    sessionMaxDays: s.nullable(s.number({ integer: true })),
    oidc: s.boolean(),
  });
  const securityOf = async (c: PoolClient) => {
    const r = (
      await c.query<{
        mfa_roles: string[];
        session_idle_hours: number | null;
        session_max_days: number | null;
      }>('SELECT mfa_roles, session_idle_hours, session_max_days FROM workspace_security')
    ).rows[0];
    return {
      mfaRoles: r?.mfa_roles ?? [],
      sessionIdleHours: r?.session_idle_hours ?? null,
      sessionMaxDays: r?.session_max_days ?? null,
      oidc: Boolean(process.env['ORQIVA_OIDC_ISSUER']),
    };
  };
  const getSecurity = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/sign-in-rules',
    summary: 'Who needs a second factor and how long sessions live (member)',
    tags: ['people'],
    params: wsParams,
    response: securityOut,
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c) => ({
        body: await securityOf(c),
      })),
  });
  const setSecurity = route({
    method: 'PUT',
    path: '/api/workspaces/:workspaceId/sign-in-rules',
    summary:
      'Set who needs a second factor and how long sessions live; never locks out the admin who sets it (admin)',
    tags: ['people'],
    params: wsParams,
    body: s.object({
      mfaRoles: s.array(s.enum([...ROLES]), { max: 8 }),
      sessionIdleHours: s.nullable(s.number({ integer: true, min: 1, max: 720 })),
      sessionMaxDays: s.nullable(s.number({ integer: true, min: 1, max: 365 })),
    }),
    response: securityOut,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'admin', async (c, a) => {
        if (body.mfaRoles.includes(a.role) && !(await hasSecondFactor(pool, a.user.id)))
          throw new HttpError(
            409,
            'conflict',
            'Turn on your own two-step sign-in first; this rule would lock you out',
          );
        await c.query(
          `INSERT INTO workspace_security (workspace_id, mfa_roles, session_idle_hours, session_max_days, updated_at) VALUES ($1, $2, $3, $4, now())
           ON CONFLICT (workspace_id) DO UPDATE SET mfa_roles = $2, session_idle_hours = $3, session_max_days = $4, updated_at = now()`,
          [a.workspaceId, [...new Set(body.mfaRoles)], body.sessionIdleHours, body.sessionMaxDays],
        );
        await recordEvent(c, a.workspaceId, {
          actor: actorOf(a),
          verb: 'updated',
          object: { type: 'workspace', id: a.workspaceId, label: 'sign-in rules' },
          changes: { signIn: { from: null, to: body } },
        });
        return { body: await securityOf(c) };
      }),
  });

  // ── the access checker ──
  const check = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/access-check',
    summary:
      'Why a person can or cannot see a project or a task: every step from membership to sharing (admin)',
    tags: ['people'],
    params: wsParams,
    query: s.object({
      userId: uuid,
      projectId: s.optional(uuid),
      itemId: s.optional(uuid),
      permission: s.optional(s.string({ max: 40 })), // [PCODE-248 | S15 | v0.1.0]
    }),
    response: s.object({
      allowed: s.boolean(),
      steps: s.array(s.object({ ok: s.boolean(), text: s.string() })),
      hint: s.string(),
    }),
    handler: ({ params, query, req }) =>
      asMember(pool, req, params.workspaceId, 'admin', async (c) => {
        const steps: { ok: boolean; text: string }[] = [];
        const done = (allowed: boolean, hint = '') => ({ body: { allowed, steps, hint } });
        const m = (
          await c.query<{
            name: string;
            role: string;
            suspended_at: Date | null;
            client: string | null;
            custom_name: string | null;
            permissions: string[] | null;
            conditions: Record<string, RoleCondition> | null;
          }>(
            `SELECT u.name, m.role, m.suspended_at, (SELECT cl.name FROM client_contacts cc JOIN clients cl ON cl.id = cc.client_id WHERE cc.user_id = m.user_id LIMIT 1) AS client,
                    r.name AS custom_name, r.permissions, r.conditions
             FROM workspace_members m JOIN users u ON u.id = m.user_id LEFT JOIN roles r ON r.id = m.custom_role_id WHERE m.user_id = $1`,
            [query.userId],
          )
        ).rows[0];
        if (!m) {
          steps.push({ ok: false, text: 'This person is not a member of the workspace.' });
          return done(false, 'Invite them first.');
        }
        steps.push({
          ok: true,
          text:
            m.name +
            ' is a member with the ' +
            m.role +
            ' role' +
            (m.client ? ', as a contact of ' + m.client : '') +
            '.',
        });
        if (m.suspended_at) {
          steps.push({
            ok: false,
            text:
              'The membership is suspended since ' +
              m.suspended_at.toISOString().slice(0, 10) +
              '.',
          });
          return done(false, 'Restore the membership to give access back.');
        }
        // [PCODE-248 | S15 | v0.1.0] the custom role, and the permission asked about
        if (m.custom_name)
          steps.push({
            ok: true,
            text:
              'Their custom role ' +
              m.custom_name +
              ' keeps: ' +
              (m.permissions ?? [])
                .map((k) => {
                  const cond = m.conditions?.[k];
                  return k + (cond ? ' (' + conditionText(cond) + ')' : '');
                })
                .join(', ') +
              '.',
          });
        let permitted = true;
        if (query.permission) {
          if (!ROLE_PERMISSIONS.some((p) => p.key === query.permission))
            throw new HttpError(
              400,
              'invalid_request',
              'There is no permission ' + query.permission,
            );
          const label =
            ROLE_PERMISSIONS.find((p) => p.key === query.permission)?.label ?? query.permission;
          if (!roleHas(m.role, query.permission)) {
            steps.push({ ok: false, text: 'The ' + m.role + ' role cannot: ' + label + '.' });
            permitted = false;
          } else if (m.custom_name) {
            const r = await customRoleAllows(
              c,
              params.workspaceId,
              {
                name: m.custom_name,
                permissions: m.permissions ?? [],
                conditions: m.conditions ?? {},
              },
              query.permission,
            );
            steps.push({ ok: r.ok, text: r.text + '.' });
            permitted = r.ok;
          } else steps.push({ ok: true, text: 'The ' + m.role + ' role may: ' + label + '.' });
        }
        let projectId = query.projectId ?? null;
        let itemLabel = '';
        if (query.itemId) {
          const it = (
            await c.query<{ project_id: string; ref: string; title: string }>(
              "SELECT i.project_id, p.key || '-' || i.sequence AS ref, i.title FROM items i JOIN projects p ON p.id = i.project_id WHERE i.id = $1",
              [query.itemId],
            )
          ).rows[0];
          if (!it) throw new HttpError(404, 'not_found', 'Task not found');
          projectId = it.project_id;
          itemLabel = it.ref + ' ' + it.title;
        }
        if (!projectId)
          throw new HttpError(400, 'invalid_request', 'Name a project or a task', [
            { path: 'query', message: 'needs projectId or itemId' },
          ]);
        const p = (
          await c.query<{
            key: string;
            name: string;
            client_id: string | null;
            client: string | null;
            archived: boolean;
            guest: boolean;
            sees: boolean;
          }>(
            `SELECT p.key, p.name, p.client_id, cl.name AS client, p.archived_at IS NOT NULL AS archived,
                  EXISTS (SELECT 1 FROM project_guests g WHERE g.project_id = p.id AND g.user_id = $2) AS guest,
                  guest_sees_project(p.id, $2) AS sees
             FROM projects p LEFT JOIN clients cl ON cl.id = p.client_id WHERE p.id = $1`,
            [projectId, query.userId],
          )
        ).rows[0];
        if (!p) throw new HttpError(404, 'not_found', 'Project not found');
        if (m.role !== 'guest') {
          steps.push({
            ok: true,
            text: 'Every ' + m.role + ' sees every project of the workspace, so ' + p.key + ' too.',
          });
          if (p.archived)
            steps.push({ ok: true, text: p.key + ' is archived: it can be read, not changed.' });
          // [PCODE-248 | S15 | v0.1.0] a project role overrides the workspace role in that project
          const pr = (
            await c.query<{ role: string }>(
              'SELECT role FROM project_members WHERE project_id = $1 AND user_id = $2',
              [projectId, query.userId],
            )
          ).rows[0]?.role;
          if (pr) {
            steps.push({
              ok: true,
              text:
                'In ' +
                p.key +
                ' they are ' +
                pr +
                (pr === 'viewer' ? ': they can read it, not change it.' : '.'),
            });
            if (pr === 'viewer' && query.permission && query.permission !== 'read') {
              steps.push({ ok: false, text: 'A viewer of ' + p.key + ' changes nothing there.' });
              permitted = false;
            }
          }
          if (itemLabel) steps.push({ ok: true, text: itemLabel + ' is in ' + p.key + '.' });
          return done(
            permitted,
            permitted ? '' : "Change their role, the role's permissions or its conditions.",
          );
        }
        if (p.guest)
          steps.push({ ok: true, text: 'They were invited to ' + p.key + ' as a guest.' });
        else if (m.client && p.client === m.client)
          steps.push({
            ok: true,
            text: p.key + ' belongs to ' + m.client + ', whose contact they are.',
          });
        else {
          steps.push({
            ok: false,
            text:
              'Guests see only projects they are invited to' +
              (m.client ? ' or projects of ' + m.client : '') +
              '; ' +
              p.key +
              (p.client ? ' belongs to ' + p.client : ' belongs to no client') +
              '.',
          });
          return done(
            false,
            'Invite them to ' + p.key + ' as a guest, or link the project to their client.',
          );
        }
        if (itemLabel)
          steps.push({
            ok: true,
            text:
              itemLabel +
              ' is in ' +
              p.key +
              (m.client ? '; clients see the tasks shared with them in the portal' : '') +
              '.',
          });
        return done(p.sees && permitted);
      }),
  });

  // ── access reviews ──
  const reviewOut = s.object({
    id: s.string(),
    title: s.string(),
    dueOn: s.nullable(s.string()),
    createdAt: s.string(),
    closedAt: s.nullable(s.string()),
    items: s.array(
      s.object({
        userId: s.string(),
        name: s.string(),
        role: s.string(),
        decision: s.nullable(s.string()),
        note: s.string(),
        decidedBy: s.nullable(s.string()),
      }),
    ),
  });
  const reviewsOf = async (c: PoolClient) => {
    const list = (
      await c.query<{
        id: string;
        title: string;
        due_on: string | null;
        created_at: Date;
        closed_at: Date | null;
      }>(
        'SELECT id, title, due_on::text AS due_on, created_at, closed_at FROM access_reviews ORDER BY created_at DESC LIMIT 10',
      )
    ).rows;
    const items = (
      await c.query<{
        review_id: string;
        user_id: string;
        name: string;
        role: string;
        decision: string | null;
        note: string;
        by: string | null;
      }>(
        'SELECT i.review_id, i.user_id, u.name, i.role, i.decision, i.note, d.name AS by FROM access_review_items i JOIN users u ON u.id = i.user_id LEFT JOIN users d ON d.id = i.decided_by WHERE i.review_id = ANY($1::uuid[]) ORDER BY u.name',
        [list.map((r) => r.id)],
      )
    ).rows;
    return list.map((r) => ({
      id: r.id,
      title: r.title,
      dueOn: r.due_on,
      createdAt: r.created_at.toISOString(),
      closedAt: r.closed_at?.toISOString() ?? null,
      items: items
        .filter((i) => i.review_id === r.id)
        .map((i) => ({
          userId: i.user_id,
          name: i.name,
          role: i.role,
          decision: i.decision,
          note: i.note,
          decidedBy: i.by,
        })),
    }));
  };
  const reviews = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/access-reviews',
    summary: 'The latest access reviews with each person’s decision (admin)',
    tags: ['people'],
    params: wsParams,
    response: s.array(reviewOut),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'admin', async (c) => ({ body: await reviewsOf(c) })),
  });
  const startReview = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/access-reviews',
    summary: 'Start an access review of everyone who is not suspended (admin)',
    tags: ['people'],
    params: wsParams,
    body: s.object({
      title: s.string({ min: 1, max: 120 }),
      dueOn: s.optional(s.string({ pattern: /^\d{4}-\d{2}-\d{2}$/ })),
    }),
    response: s.array(reviewOut),
    status: 201,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'admin', async (c, a) => {
        if ((await c.query('SELECT 1 FROM access_reviews WHERE closed_at IS NULL')).rowCount)
          throw new HttpError(409, 'conflict', 'Finish the open review first');
        const id = (
          await c.query<{ id: string }>(
            'INSERT INTO access_reviews (workspace_id, title, due_on, created_by) VALUES ($1, $2, $3, $4) RETURNING id',
            [a.workspaceId, body.title.trim(), body.dueOn ?? null, a.user.id],
          )
        ).rows[0]?.id;
        await c.query(
          'INSERT INTO access_review_items (workspace_id, review_id, user_id, role) SELECT $1, $2, user_id, role FROM workspace_members WHERE suspended_at IS NULL',
          [a.workspaceId, id],
        );
        return { status: 201, body: await reviewsOf(c) };
      }),
  });
  const decide = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/access-reviews/:reviewId/items/:userId',
    summary:
      'Certify a person’s access: keep, change or remove, with a note; the review closes when everyone is decided (admin)',
    tags: ['people'],
    params: s.object({ workspaceId: uuid, reviewId: uuid, userId: uuid }),
    body: s.object({
      decision: s.enum(['keep', 'change', 'remove']),
      note: s.optional(s.string({ max: 500 })),
    }),
    response: s.array(reviewOut),
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'admin', async (c, a) => {
        const r = await c.query(
          'UPDATE access_review_items i SET decision = $3, note = $4, decided_by = $5, decided_at = now() FROM access_reviews r WHERE r.id = i.review_id AND r.closed_at IS NULL AND i.review_id = $1 AND i.user_id = $2',
          [params.reviewId, params.userId, body.decision, (body.note ?? '').trim(), a.user.id],
        );
        if (!r.rowCount) throw new HttpError(404, 'not_found', 'Not part of an open review');
        await c.query(
          'UPDATE access_reviews SET closed_at = now() WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM access_review_items WHERE review_id = $1 AND decision IS NULL)',
          [params.reviewId],
        );
        return { body: await reviewsOf(c) };
      }),
  });

  // ── offboarding ──
  const offboard = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/members/:userId/offboard',
    summary:
      'Hand over a person’s open tasks and agents, revoke their tokens for this workspace and suspend the membership (admin)',
    tags: ['people'],
    params: memberParams,
    body: s.object({ handoverTo: s.nullable(uuid), revokeTokens: s.boolean() }),
    response: s.object({
      tasks: s.number({ integer: true }),
      agents: s.number({ integer: true }),
      tokens: s.number({ integer: true }),
      person: personOut,
    }),
    handler: async ({ params, body, req }) => {
      const out = await asMember(pool, req, params.workspaceId, 'admin', async (c, a: Access) => {
        if (params.userId === a.user.id)
          throw new HttpError(409, 'conflict', 'Someone else offboards you');
        const m = (
          await c.query<{ role: string; name: string; suspended_at: Date | null }>(
            'SELECT m.role, u.name, m.suspended_at FROM workspace_members m JOIN users u ON u.id = m.user_id WHERE m.user_id = $1',
            [params.userId],
          )
        ).rows[0];
        if (!m) throw new HttpError(404, 'not_found', 'Member not found');
        if (m.suspended_at) throw new HttpError(409, 'conflict', m.name + ' is suspended already');
        if (m.role === 'owner' && a.role !== 'owner')
          throw new HttpError(403, 'forbidden', 'Only an owner offboards an owner');
        if (
          m.role === 'owner' &&
          !Number(
            (
              await c.query<{ n: string }>(
                "SELECT count(*) AS n FROM workspace_members WHERE role = 'owner' AND suspended_at IS NULL AND user_id <> $1",
                [params.userId],
              )
            ).rows[0]?.n,
          )
        )
          throw new HttpError(409, 'conflict', 'A workspace needs at least one owner');
        if (body.handoverTo) {
          const to = (
            await c.query<{ role: string; suspended_at: Date | null }>(
              'SELECT role, suspended_at FROM workspace_members WHERE user_id = $1',
              [body.handoverTo],
            )
          ).rows[0];
          if (!to || to.suspended_at || to.role === 'guest' || body.handoverTo === params.userId)
            throw new HttpError(400, 'invalid_request', 'Hand over to another active team member', [
              { path: 'body.handoverTo', message: 'is not an active team member' },
            ]);
        }
        const tasks =
          (
            await c.query(
              `UPDATE items i SET assignee_id = $2 FROM project_states st
              WHERE st.id = i.state_id AND i.assignee_id = $1 AND st.grp NOT IN ('completed', 'cancelled')`,
              [params.userId, body.handoverTo],
            )
          ).rowCount ?? 0;
        const agents =
          (
            await c.query('UPDATE agents SET owner_id = $2 WHERE owner_id = $1', [
              params.userId,
              body.handoverTo,
            ])
          ).rowCount ?? 0;
        await c.query(
          'UPDATE workspace_members SET suspended_at = now(), suspended_by = $2 WHERE user_id = $1',
          [params.userId, a.user.id],
        );
        await recordEvent(c, a.workspaceId, {
          actor: actorOf(a),
          verb: 'updated',
          object: { type: 'member', id: params.userId, label: m.name },
          parent: { type: 'workspace', id: a.workspaceId },
          changes: {
            suspended: { from: false, to: true },
            handover: { from: null, to: { tasks, agents } },
          },
        });
        return { tasks, agents, workspaceId: a.workspaceId };
      });
      const tokens = body.revokeTokens
        ? await inSystem(
            pool,
            async (c) =>
              (
                await c.query(
                  'UPDATE api_tokens SET revoked_at = now() WHERE user_id = $1 AND workspace_id = $2 AND revoked_at IS NULL',
                  [params.userId, out.workspaceId],
                )
              ).rowCount ?? 0,
          )
        : 0;
      const person = await asMember(
        pool,
        req,
        params.workspaceId,
        'admin',
        async (c) => (await peopleOf(pool, c, params.userId))[0],
      );
      if (!person) throw new Error('member vanished');
      return { body: { tasks: out.tasks, agents: out.agents, tokens, person } };
    },
  });
  const restore = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/members/:userId/restore',
    summary: 'Give a suspended person their membership back, if a seat is free (admin)',
    tags: ['people'],
    params: memberParams,
    response: personOut,
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'admin', async (c, a) => {
        const m = (
          await c.query<{ suspended_at: Date | null }>(
            'SELECT suspended_at FROM workspace_members WHERE user_id = $1',
            [params.userId],
          )
        ).rows[0];
        if (!m) throw new HttpError(404, 'not_found', 'Member not found');
        if (!m.suspended_at)
          throw new HttpError(409, 'conflict', 'This membership is not suspended');
        await checkSeat(c, a.workspaceId);
        await c.query(
          'UPDATE workspace_members SET suspended_at = NULL, suspended_by = NULL WHERE user_id = $1',
          [params.userId],
        );
        const p = (await peopleOf(pool, c, params.userId))[0];
        if (!p) throw new Error('member vanished');
        return { body: p };
      }),
  });

  return [
    people,
    teams,
    saveTeam,
    removeTeam,
    roles,
    addRole,
    removeRole,
    changeRole,
    assignRole,
    projectMembers,
    setProjectMember,
    dropProjectMember,
    getSecurity,
    setSecurity,
    check,
    reviews,
    startReview,
    decide,
    offboard,
    restore,
  ];
}
