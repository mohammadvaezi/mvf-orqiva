// ── [PCODE-248 | S15 | v0.1.0] T25.3 Custom roles, role conditions and project roles enforced ──
// ── [PCODE-196 | S15 | v0.1.0] B8.4 VS Code: ideation interview, and presence per file and block (workspace switch, off by default) ──
// ── [PCODE-188 | S15 | v0.1.0] B7.4 Incidents and on-call live: alerts, incidents with timeline and roles, suspect deploys and rollback, status updates, rotations and escalation, postmortems, SLOs ──
// ── [PCODE-163 | S15 | v0.1.0] B1.2 Roles, clients and portal sign-in on the server ──
// ── [PCODE-92 | S15 | v0.1.0] Add workspaces, projects, members and roles to the API ──
// ── [PCODE-148 | S15 | v0.1.0] Add signed licence keys with seats, features and expiry ──
//    Why:  workspaces and their members. Roles: owner > admin > member > guest. Admins manage members;
//          only an owner makes or unmakes owners, and the last owner can neither leave nor be demoted, so
//          a workspace is never left without someone who can manage it. Every change is an activity event.
import { checkSeat } from '../licence/licence.js';
import type { Pool, PoolClient } from 'pg';
import { createWorkspace } from '../auth/routes.js';
import { inSystem } from '../db/pool.js';
import { recordEvent } from '../events/outbox.js';
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s, type Infer } from '../http/schema.js';
import {
  ROLES,
  actorOf,
  asMember,
  atLeast,
  requireUser,
  type Access,
  type Role,
} from './access.js';

const uuid = s.string({ format: 'uuid' });
const wsParams = s.object({ workspaceId: uuid });
const memberParams = s.object({ workspaceId: uuid, userId: uuid });
// [PCODE-163 | S15 | v0.1.0] every role, including tester, designer, billing and auditor
const roleSchema = s.enum(ROLES);

const workspaceOut = s.object({
  id: s.string(),
  slug: s.string(),
  name: s.string(),
  role: s.string(),
  memberCount: s.number({ integer: true }),
  presenceEnabled: s.boolean(),
  // [PCODE-196 | S15 | v0.1.0] presence also says which file (VS Code); off by default
  presenceFiles: s.boolean(),
});
const memberOut = s.object({
  userId: s.string(),
  email: s.string(),
  name: s.string(),
  role: s.string(),
  joinedAt: s.string(),
  // [PCODE-188 | S15 | v0.1.0] service accounts (CI, runners) take no on-call turns or roles
  service: s.boolean(),
});

interface MemberRow {
  user_id: string;
  email: string;
  name: string;
  role: Role;
  created_at: Date;
  is_service: boolean;
}
const memberJson = (
  m: MemberRow,
): {
  userId: string;
  email: string;
  name: string;
  role: string;
  joinedAt: string;
  service: boolean;
} => ({
  userId: m.user_id,
  email: m.email,
  name: m.name,
  role: m.role,
  joinedAt: m.created_at.toISOString(),
  service: m.is_service,
});

const MEMBER_SELECT =
  'SELECT m.user_id, u.email, u.name, m.role, m.created_at, u.is_service FROM workspace_members m JOIN users u ON u.id = m.user_id';

export function workspaceRoutes(pool: Pool): Route[] {
  const create = route({
    method: 'POST',
    path: '/api/workspaces',
    summary: 'Create a workspace; the creator becomes its owner',
    tags: ['workspaces'],
    body: s.object({ name: s.string({ min: 1, max: 200 }) }),
    response: workspaceOut,
    status: 201,
    handler: async ({ body, req }) => {
      const user = await requireUser(pool, req);
      const ws = await inSystem(pool, (c) =>
        createWorkspace(c, user.id, user.name, body.name.trim()),
      );
      return {
        status: 201,
        body: { ...ws, memberCount: 1, presenceEnabled: true, presenceFiles: false },
      };
    },
  });

  /** The workspace as its caller sees it. */
  async function describe(c: PoolClient, a: Access): Promise<Infer<typeof workspaceOut>> {
    const row = (
      await c.query<{
        id: string;
        slug: string;
        name: string;
        presence_enabled: boolean;
        presence_files: boolean;
        n: string;
      }>(
        'SELECT w.id, w.slug, w.name, w.presence_enabled, w.presence_files, (SELECT count(*) FROM workspace_members) AS n FROM workspaces w',
      )
    ).rows[0];
    if (!row) throw new HttpError(404, 'not_found', 'Workspace not found');
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      role: a.role,
      memberCount: Number(row.n),
      presenceEnabled: row.presence_enabled,
      presenceFiles: row.presence_files,
    };
  }

  const get = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId',
    summary: 'A workspace and the caller’s role in it',
    tags: ['workspaces'],
    params: wsParams,
    response: workspaceOut,
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => ({
        body: await describe(c, a),
      })),
  });

  const update = route({
    method: 'PATCH',
    path: '/api/workspaces/:workspaceId',
    summary:
      'Rename a workspace, or switch presence (and whether it names files) on or off (admin)',
    tags: ['workspaces'],
    params: wsParams,
    // [PCODE-101 | S15 | v0.1.0] presence can be switched off for the whole workspace
    body: s.object({
      name: s.optional(s.string({ min: 1, max: 200 })),
      presenceEnabled: s.optional(s.boolean()),
      presenceFiles: s.optional(s.boolean()), // [PCODE-196 | S15 | v0.1.0]
    }),
    response: workspaceOut,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'admin', async (c, a) => {
        const before = await describe(c, a);
        const changes: Record<string, { from: unknown; to: unknown }> = {};
        const name = body.name?.trim() ?? before.name;
        if (name !== before.name) changes['name'] = { from: before.name, to: name };
        const presence = body.presenceEnabled ?? before.presenceEnabled;
        if (presence !== before.presenceEnabled)
          changes['presenceEnabled'] = { from: before.presenceEnabled, to: presence };
        const files = body.presenceFiles ?? before.presenceFiles; // [PCODE-196 | S15 | v0.1.0]
        if (files !== before.presenceFiles)
          changes['presenceFiles'] = { from: before.presenceFiles, to: files };
        if (Object.keys(changes).length === 0) return { body: before };
        await c.query(
          'UPDATE workspaces SET name = $1, presence_enabled = $2, presence_files = $3',
          [name, presence, files],
        );
        await recordEvent(c, a.workspaceId, {
          actor: actorOf(a),
          verb: 'updated',
          object: { type: 'workspace', id: a.workspaceId, label: name },
          changes,
        });
        return { body: await describe(c, a) };
      }),
  });

  const members = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/members',
    summary: 'The people of a workspace and their roles',
    tags: ['members'],
    params: wsParams,
    response: s.array(memberOut),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c) => ({
        body: (await c.query<MemberRow>(MEMBER_SELECT + ' ORDER BY m.created_at')).rows.map(
          memberJson,
        ),
      })),
  });

  const addMember = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/members',
    summary: 'Add a person who already has an account (admin; owners only by an owner)',
    tags: ['members'],
    params: wsParams,
    body: s.object({ email: s.string({ format: 'email', max: 254 }), role: roleSchema }),
    response: memberOut,
    status: 201,
    handler: async ({ params, body, req }) => {
      const email = body.email.trim().toLowerCase();
      // people are global: finding an account by email is a system lookup, the membership is workspace data
      const target = await inSystem(
        pool,
        async (c) =>
          (await c.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [email])).rows[0],
      );
      return asMember(pool, req, params.workspaceId, 'admin', async (c, a) => {
        if (body.role === 'owner' && a.role !== 'owner')
          throw new HttpError(403, 'forbidden', 'Only an owner can add an owner');
        if (!target)
          throw new HttpError(
            404,
            'not_found',
            'No account uses this email yet; invitations by email come in a later release',
          );
        const exists = await c.query('SELECT 1 FROM workspace_members WHERE user_id = $1', [
          target.id,
        ]);
        if (exists.rowCount)
          throw new HttpError(409, 'conflict', 'This person is already a member');
        // [PCODE-148 | S15 | v0.1.0] a seat must be free
        await checkSeat(c, a.workspaceId);
        await c.query(
          'INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, $3)',
          [a.workspaceId, target.id, body.role],
        );
        const m = (await c.query<MemberRow>(MEMBER_SELECT + ' WHERE m.user_id = $1', [target.id]))
          .rows[0];
        if (!m) throw new Error('member insert returned nothing');
        await recordEvent(c, a.workspaceId, {
          actor: actorOf(a),
          verb: 'created',
          object: { type: 'member', id: m.user_id, label: m.name },
          parent: { type: 'workspace', id: a.workspaceId },
          changes: { role: { from: null, to: m.role } },
        });
        return { status: 201, body: memberJson(m) };
      });
    },
  });

  async function ownersLeft(
    c: Parameters<Parameters<typeof asMember>[4]>[0],
    exceptUserId: string,
  ): Promise<number> {
    return Number(
      (
        await c.query<{ n: string }>(
          "SELECT count(*) AS n FROM workspace_members WHERE role = 'owner' AND user_id <> $1",
          [exceptUserId],
        )
      ).rows[0]?.n,
    );
  }

  const changeRole = route({
    method: 'PATCH',
    path: '/api/workspaces/:workspaceId/members/:userId',
    summary: 'Change a member’s role (admin; owners only by an owner; never the last owner)',
    tags: ['members'],
    params: memberParams,
    body: s.object({ role: roleSchema }),
    response: memberOut,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'admin', async (c, a) => {
        const m = (
          await c.query<MemberRow>(MEMBER_SELECT + ' WHERE m.user_id = $1', [params.userId])
        ).rows[0];
        if (!m) throw new HttpError(404, 'not_found', 'Member not found');
        if ((m.role === 'owner' || body.role === 'owner') && a.role !== 'owner')
          throw new HttpError(403, 'forbidden', 'Only an owner can make or unmake an owner');
        if (m.role === 'owner' && body.role !== 'owner' && (await ownersLeft(c, m.user_id)) === 0) {
          throw new HttpError(
            409,
            'conflict',
            'A workspace needs at least one owner; make someone else owner first',
          );
        }
        if (m.role === body.role) return { body: memberJson(m) };
        // [PCODE-248 | S15 | v0.1.0] a role given directly replaces a custom role, which belongs to its base role
        await c.query(
          'UPDATE workspace_members SET role = $1, custom_role_id = NULL WHERE user_id = $2',
          [body.role, m.user_id],
        );
        await recordEvent(c, a.workspaceId, {
          actor: actorOf(a),
          verb: 'updated',
          object: { type: 'member', id: m.user_id, label: m.name },
          parent: { type: 'workspace', id: a.workspaceId },
          changes: { role: { from: m.role, to: body.role } },
        });
        return { body: memberJson({ ...m, role: body.role }) };
      }),
  });

  const removeMember = route({
    method: 'DELETE',
    path: '/api/workspaces/:workspaceId/members/:userId',
    summary: 'Remove a member (admin), or leave the workspace yourself; never the last owner',
    tags: ['members'],
    params: memberParams,
    response: s.object({ ok: s.literal(true) }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        const self = params.userId === a.user.id;
        if (!self && !atLeast(a.role, 'admin'))
          throw new HttpError(403, 'forbidden', 'Only an admin removes other members');
        const m = (
          await c.query<MemberRow>(MEMBER_SELECT + ' WHERE m.user_id = $1', [params.userId])
        ).rows[0];
        if (!m) throw new HttpError(404, 'not_found', 'Member not found');
        if (m.role === 'owner' && !self && a.role !== 'owner')
          throw new HttpError(403, 'forbidden', 'Only an owner removes an owner');
        if (m.role === 'owner' && (await ownersLeft(c, m.user_id)) === 0) {
          throw new HttpError(
            409,
            'conflict',
            'A workspace needs at least one owner; make someone else owner first',
          );
        }
        await c.query('DELETE FROM project_guests WHERE user_id = $1', [m.user_id]);
        await c.query('DELETE FROM workspace_members WHERE user_id = $1', [m.user_id]);
        await recordEvent(c, a.workspaceId, {
          actor: actorOf(a),
          verb: 'deleted',
          object: { type: 'member', id: m.user_id, label: m.name },
          parent: { type: 'workspace', id: a.workspaceId },
        });
        return { body: { ok: true as const } };
      }),
  });

  return [create, get, update, members, addMember, changeRole, removeMember];
}
