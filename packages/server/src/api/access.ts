// ── [PCODE-351 | S15 | v0.1.0] T35.3b Settings for teams and projects in the screen, project leads as project admins, budget warnings at 50/80/100 % ──
// ── [PCODE-348 | S15 | v0.1.0] T35.2a Integrations hub; email-in for replies to messages and ideas by email ──
// ── [PCODE-248 | S15 | v0.1.0] T25.3 Custom roles, role conditions and project roles enforced ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-182 | S15 | v0.1.0] B5.3 People live: members, teams, roles, sign-in rules and sessions, access reviews, access checker, offboarding ──
// ── [PCODE-181 | S15 | v0.1.0] B5.2 Tokens and costs live: AI spend, budgets, prices, provider keys per project, access tokens with scopes, policy, leak revocation ──
// ── [PCODE-163 | S15 | v0.1.0] B1.2 Roles, clients and portal sign-in on the server ──
// ── [PCODE-92 | S15 | v0.1.0] Add workspaces, projects, members and roles to the API ──
//    Why:  the one door into workspace data. It finds the signed-in person, opens a transaction pinned to
//          the workspace (row-level security does the rest), and checks their role. A workspace they do not
//          belong to answers 404, not 403, so its existence is not revealed. Guests pass only into the
//          projects they were invited to.
import type { IncomingMessage } from 'node:http';
import {
  conditionHolds,
  conditionText,
  permissionFor,
  ROLE_PERMISSIONS,
  scopeAllows,
  wallClock,
  type Actor,
  type RoleCondition,
} from '@orqiva/shared';
import type { Pool, PoolClient } from 'pg';
// [PCODE-181 | S15 | v0.1.0] the token a request came with
import { currentUser, sessionOf, tokenOf, type SessionUser } from '../auth/sessions.js';
import { inSystem, inWorkspace } from '../db/pool.js';
import { HttpError } from '../http/errors.js';
import { workspaceTimeZone } from './timezone.js'; // [PCODE-248 | S15 | v0.1.0]

// [PCODE-163 | S15 | v0.1.0] testers and designers work as members; auditors and billing read everything
// (they are not guests, so they see every project) and change nothing that needs a member
export type Role =
  'guest' | 'auditor' | 'billing' | 'member' | 'tester' | 'designer' | 'admin' | 'owner';
export const ROLES = [
  'guest',
  'auditor',
  'billing',
  'member',
  'tester',
  'designer',
  'admin',
  'owner',
] as const;
const RANK: Record<Role, number> = {
  guest: 0,
  auditor: 1,
  billing: 1,
  member: 2,
  tester: 2,
  designer: 2,
  admin: 3,
  owner: 4,
};

export const atLeast = (role: Role, min: Role): boolean => RANK[role] >= RANK[min];

export interface Access {
  user: SessionUser;
  workspaceId: string;
  role: Role;
  /** [PCODE-163 | S15 | v0.1.0] set for a client contact: the transaction runs in that client's scope */
  clientId?: string;
  /** [PCODE-248 | S15 | v0.1.0] the request changes something: a project's viewer may not */
  writes?: boolean;
  /** why the request is refused after all, found while it ran (a viewer's project); it is rolled back */
  blocked?: string;
}

/**
 * [PCODE-248 | S15 | v0.1.0] A custom role decides beyond its base role: the request's permission must be one the role
 * keeps, and a condition on it (weekdays, hours in the workspace's time zone) must hold now.
 */
export async function customRoleAllows(
  c: PoolClient,
  workspaceId: string,
  role: { name: string; permissions: string[]; conditions: Record<string, RoleCondition> },
  permission: string,
  now: Date = new Date(),
): Promise<{ ok: boolean; text: string }> {
  const label = ROLE_PERMISSIONS.find((p) => p.key === permission)?.label ?? permission;
  if (!role.permissions.includes(permission))
    return { ok: false, text: 'The role ' + role.name + ' does not allow this: ' + label };
  const cond = role.conditions[permission];
  if (!cond) return { ok: true, text: 'The role ' + role.name + ' allows: ' + label };
  const zone = await workspaceTimeZone(c, workspaceId);
  const w = wallClock(now, zone);
  const when = conditionText(cond) + ' (' + zone + ')';
  return conditionHolds(cond, w.weekday || 7, w.hour)
    ? {
        ok: true,
        text: 'The role ' + role.name + ' allows "' + label + '" ' + when + ', which is now',
      }
    : { ok: false, text: 'The role ' + role.name + ' allows "' + label + '" only ' + when };
}

export async function requireUser(pool: Pool, req: IncomingMessage): Promise<SessionUser> {
  const user = await currentUser(pool, req);
  if (!user) throw new HttpError(401, 'unauthorized', 'Sign in first');
  return user;
}

export const workspaceNotFound = (): HttpError =>
  new HttpError(404, 'not_found', 'Workspace not found');

/** Runs fn inside the workspace as its member, if their role is at least `min`. */
/**
 * [PCODE-182 | S15 | v0.1.0] The workspace's sign-in rules: a second factor for the roles that need one,
 * and how long a browser session may be idle or live at all.
 */
async function signInRules(
  pool: Pool,
  c: PoolClient,
  req: IncomingMessage,
  userId: string,
  role: Role,
): Promise<void> {
  const rules = (
    await c.query<{
      mfa_roles: string[];
      session_idle_hours: number | null;
      session_max_days: number | null;
    }>('SELECT mfa_roles, session_idle_hours, session_max_days FROM workspace_security')
  ).rows[0];
  if (!rules) return;
  const session = sessionOf(req);
  if (
    session &&
    rules.session_max_days &&
    Date.now() - session.createdAt.getTime() > rules.session_max_days * 86_400_000
  )
    throw new HttpError(
      401,
      'unauthorized',
      'This workspace asks you to sign in again every ' + String(rules.session_max_days) + ' days',
    );
  if (
    session &&
    rules.session_idle_hours &&
    Date.now() - session.lastSeenBefore.getTime() > rules.session_idle_hours * 3_600_000
  )
    throw new HttpError(
      401,
      'unauthorized',
      'You were away too long for this workspace; sign in again',
    );
  if (rules.mfa_roles.includes(role) && !(await hasSecondFactor(pool, userId)))
    throw new HttpError(
      403,
      'second_factor_required',
      'This workspace needs two-step sign-in for your role; set it up under your account',
    );
}

/** Whether a person has turned on two-step sign-in (the table is outside every workspace). */
export async function hasSecondFactor(pool: Pool, userId: string): Promise<boolean> {
  return inSystem(pool, async (c) =>
    Boolean(
      (
        await c.query('SELECT 1 FROM user_totp WHERE user_id = $1 AND enabled_at IS NOT NULL', [
          userId,
        ])
      ).rowCount,
    ),
  );
}

export async function asMember<T>(
  pool: Pool,
  req: IncomingMessage,
  workspaceId: string,
  min: Role,
  fn: (c: PoolClient, access: Access) => Promise<T>,
): Promise<T> {
  const user = await requireUser(pool, req);
  // [PCODE-181 | S15 | v0.1.0] a token bound to another workspace does not reach this one; scopes narrow it
  const token = tokenOf(req);
  if (token?.workspaceId && token.workspaceId !== workspaceId) throw workspaceNotFound();
  if (token && !scopeAllows(token.scopes, req.method ?? 'GET', atLeast(min, 'admin')))
    throw new HttpError(
      403,
      'forbidden',
      'This token’s scopes (' + token.scopes.join(', ') + ') do not allow this',
    );
  return inWorkspace(pool, workspaceId, async (c) => {
    let access: Access;
    // [PCODE-182 | S15 | v0.1.0] a suspended membership reaches nothing
    const member = (
      await c.query<{
        role: Role;
        suspended_at: Date | null;
        custom_name: string | null;
        permissions: string[] | null;
        conditions: Record<string, RoleCondition> | null;
      }>(
        // [PCODE-248 | S15 | v0.1.0] with the custom role, if the member has one
        `SELECT m.role, m.suspended_at, r.name AS custom_name, r.permissions, r.conditions
         FROM workspace_members m LEFT JOIN roles r ON r.id = m.custom_role_id WHERE m.user_id = $1`,
        [user.id],
      )
    ).rows[0];
    const role = member && !member.suspended_at ? member.role : undefined;
    if (!role) throw workspaceNotFound();
    await signInRules(pool, c, req, user.id, role);
    if (!atLeast(role, min))
      throw new HttpError(
        403,
        'forbidden',
        'This needs the ' + min + ' role or higher; you are ' + role,
      );
    // [PCODE-248 | S15 | v0.1.0] the custom role narrows what the base role allows
    const method = req.method ?? 'GET';
    const path = new URL(req.url ?? '/', 'http://x').pathname;
    const permission = permissionFor(method, path, min);
    if (member?.custom_name && permission) {
      const ok = await customRoleAllows(
        c,
        workspaceId,
        {
          name: member.custom_name,
          permissions: member.permissions ?? [],
          conditions: member.conditions ?? {},
        },
        permission,
      );
      if (!ok.ok) throw new HttpError(403, 'forbidden', ok.text);
    }
    const writes = !['GET', 'HEAD'].includes(method.toUpperCase()) && permission !== null;
    // [PCODE-163 | S15 | v0.1.0] a client contact sees the workspace only as their client: row-level
    // security narrows every query of this transaction to that client (0032_clients.sql)
    if (role === 'guest') {
      const clientId = (
        await c.query<{ client_id: string }>(
          'SELECT client_id FROM client_contacts WHERE user_id = $1 LIMIT 1',
          [user.id],
        )
      ).rows[0]?.client_id;
      if (clientId) {
        await c.query("SELECT set_config('app.client_id', $1, true)", [clientId]);
        return refuseBlocked(
          await fn(c, (access = { user, workspaceId, role, clientId, writes })),
          access,
        );
      }
    }
    access = { user, workspaceId, role, writes };
    return refuseBlocked(await fn(c, access), access);
  });
}

/**
 * [PCODE-348 | S15 | v0.1.0] Runs fn inside the workspace as one of its members without a request: for what arrives on
 * their behalf by mail. Their role and a client contact's scope apply as in asMember.
 */
export async function asUser<T>(
  pool: Pool,
  userId: string,
  workspaceId: string,
  min: Role,
  fn: (c: PoolClient, access: Access) => Promise<T>,
): Promise<T> {
  return inWorkspace(pool, workspaceId, async (c) => {
    const m = (
      await c.query<{ role: Role; suspended_at: Date | null; email: string; name: string }>(
        `SELECT m.role, m.suspended_at, u.email, u.name FROM workspace_members m JOIN users u ON u.id = m.user_id
          WHERE m.user_id = $1`,
        [userId],
      )
    ).rows[0];
    if (!m || m.suspended_at) throw workspaceNotFound();
    if (!atLeast(m.role, min))
      throw new HttpError(403, 'forbidden', 'This needs the ' + min + ' role or higher');
    const user = { id: userId, email: m.email, name: m.name };
    if (m.role === 'guest') {
      const clientId = (
        await c.query<{ client_id: string }>(
          'SELECT client_id FROM client_contacts WHERE user_id = $1 LIMIT 1',
          [userId],
        )
      ).rows[0]?.client_id;
      if (clientId) {
        await c.query("SELECT set_config('app.client_id', $1, true)", [clientId]);
        return fn(c, { user, workspaceId, role: m.role, clientId, writes: true });
      }
    }
    return fn(c, { user, workspaceId, role: m.role, writes: true });
  });
}

/** [PCODE-351 | S15 | v0.1.0] The project a row belongs to (an environment, a repository connection), if the caller sees it. */
export async function projectOf(
  c: PoolClient,
  table: 'environments' | 'git_connections',
  id: string,
): Promise<string> {
  const p = (
    await c.query<{ project_id: string }>('SELECT project_id FROM ' + table + ' WHERE id = $1', [
      id,
    ])
  ).rows[0]?.project_id;
  if (!p)
    throw new HttpError(
      404,
      'not_found',
      table === 'environments' ? 'Environment not found' : 'Repository not found',
    );
  return p;
}

/** [PCODE-351 | S15 | v0.1.0] Admins, and the lead of the project, run the project's own settings. */
export async function requireProjectAdmin(
  c: PoolClient,
  a: Access,
  projectId: string,
): Promise<void> {
  if (atLeast(a.role, 'admin')) return;
  const lead = (
    await c.query(
      "SELECT 1 FROM project_members WHERE project_id = $1 AND user_id = $2 AND role = 'lead'",
      [projectId, a.user.id],
    )
  ).rowCount;
  if (!lead)
    throw new HttpError(403, 'forbidden', 'This needs an admin or the lead of this project');
}

/** [PCODE-248 | S15 | v0.1.0] The handler's answer, unless something it touched refused the request. */
function refuseBlocked<T>(out: T, access: Access): T {
  if (access.blocked) throw new HttpError(403, 'forbidden', access.blocked);
  return out;
}

export interface ProjectRow {
  id: string;
  key: string;
  name: string;
  description: string;
  archived_at: Date | null;
  created_at: Date;
}

/** The project, if it exists in this workspace and the person may see it (guests: invited only). */
export async function requireProject(
  c: PoolClient,
  access: Access,
  projectId: string,
): Promise<ProjectRow> {
  const row = (
    await c.query<ProjectRow & { project_role: string | null }>(
      `SELECT p.id, p.key, p.name, p.description, p.archived_at, p.created_at,
              (SELECT pm.role FROM project_members pm WHERE pm.project_id = p.id AND pm.user_id = $3) AS project_role
       FROM projects p
       WHERE p.id = $1 AND ($2 <> 'guest' OR guest_sees_project(p.id, $3))`,
      [projectId, access.role, access.user.id],
    )
  ).rows[0];
  if (!row) throw new HttpError(404, 'not_found', 'Project not found');
  // [PCODE-248 | S15 | v0.1.0] a person's role in the project overrides the workspace's there: a viewer only reads
  // the refusal comes after the handler, inside its transaction, so a caller that turns errors into
  // "not found" cannot hide it and nothing the handler wrote is kept
  if (row.project_role === 'viewer' && access.writes)
    access.blocked ??= 'You are a viewer in ' + row.key + ': you can read it, not change it';
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description,
    archived_at: row.archived_at,
    created_at: row.created_at,
  };
}

export const actorOf = (access: Access): Actor => ({
  kind: 'user',
  id: access.user.id,
  name: access.user.name,
});

/** A unique-key violation from PostgreSQL, for turning into a 409. */
export const isUniqueViolation = (err: unknown): boolean =>
  typeof err === 'object' && err !== null && (err as { code?: unknown }).code === '23505';
