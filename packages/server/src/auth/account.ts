// ── [PCODE-339 | S15 | v0.1.0] T34.1d Portal magic-link sign-in and passwordless invitations, MFA required per client ──
// ── [PCODE-237 | S15 | v0.1.0] T23.4 Email as a channel: own SMTP sender, password reset, invitations, digests ──
// ── [PCODE-190 | S15 | v0.1.0] Commit leftovers of B4.5–B6.1: classic pages removed, invite session with request ──
// ── [PCODE-163 | S15 | v0.1.0] B1.2 Roles, clients and portal sign-in on the server ──
// ── [PCODE-115 | S15 | v0.1.0] Add settings and user management: profile, password, tokens, members, invitations, project settings ──
// ── [PCODE-148 | S15 | v0.1.0] Add signed licence keys with seats, features and expiry ──
//    Why:  what a person changes about themselves (their name, their password) and how someone new joins a
//          workspace: by an invitation link an admin created. A password change ends every other session,
//          so a password that leaked stops working everywhere at once. Accepting an invitation either
//          creates the account (name and password, no workspace of its own) or adds the signed-in account
//          whose email the invitation names; the link works once and for 7 days.
import { queueMail } from '../mail/outbox.js'; // [PCODE-237 | S15 | v0.1.0]
import type { MailConfig } from '../mail/smtp.js';
import { invitationMail } from '../mail/templates.js';
import { checkSeat } from '../licence/licence.js';
import { createHash, randomBytes } from 'node:crypto';
import type { Pool } from 'pg';
import { inSystem, inWorkspace } from '../db/pool.js';
import { recordEvent } from '../events/outbox.js';
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s } from '../http/schema.js';
import { actorOf, asMember, requireUser } from '../api/access.js';
import { PASSWORD_MAX, PASSWORD_MIN, hashPassword, verifyPassword } from './password.js';
import { createSession, sessionCookie, sessionFromCookies } from './sessions.js';

const sha256 = (v: string): string => createHash('sha256').update(v).digest('hex');
const uuid = s.string({ format: 'uuid' });
const INVITE_DAYS = 7;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

const invitationOut = s.object({
  id: s.string(),
  email: s.string(),
  role: s.string(),
  invitedBy: s.nullable(s.string()),
  createdAt: s.string(),
  expiresAt: s.string(),
});
interface InvitationRow {
  id: string;
  email: string;
  role: string;
  invited_by_name: string | null;
  created_at: Date;
  expires_at: Date;
}
const invitationJson = (r: InvitationRow) => ({
  id: r.id,
  email: r.email,
  role: r.role,
  invitedBy: r.invited_by_name,
  createdAt: r.created_at.toISOString(),
  expiresAt: r.expires_at.toISOString(),
});

export function accountRoutes(deps: {
  pool: Pool;
  secureCookies: boolean;
  /** [PCODE-237 | S15 | v0.1.0] with a mail server, invitations are mailed too */
  mail?: MailConfig | null;
  publicUrl?: string;
}): Route[] {
  const { pool, secureCookies } = deps;

  const rename = route({
    method: 'PATCH',
    path: '/auth/me',
    summary: 'Change your own name',
    tags: ['auth'],
    body: s.object({ name: s.string({ min: 1, max: 200 }) }),
    response: s.object({ id: s.string(), email: s.string(), name: s.string() }),
    handler: async ({ body, req }) => {
      const me = await requireUser(pool, req);
      const name = body.name.trim();
      if (!name)
        throw new HttpError(400, 'invalid_request', 'A name is needed', [
          { path: 'body.name', message: 'is empty' },
        ]);
      await inSystem(pool, (c) =>
        c.query('UPDATE users SET name = $2 WHERE id = $1', [me.id, name]),
      );
      return { body: { id: me.id, email: me.email, name } };
    },
  });

  const password = route({
    method: 'POST',
    path: '/auth/password',
    summary: 'Change your password; every other session is signed out',
    tags: ['auth'],
    body: s.object({
      current: s.string({ max: PASSWORD_MAX }),
      next: s.string({ min: PASSWORD_MIN, max: PASSWORD_MAX }),
    }),
    response: s.object({ ok: s.literal(true), signedOut: s.number({ integer: true }) }),
    handler: async ({ body, req }) => {
      const me = await requireUser(pool, req);
      const stored = await inSystem(
        pool,
        async (c) =>
          (
            await c.query<{ password_hash: string | null }>(
              'SELECT password_hash FROM users WHERE id = $1',
              [me.id],
            )
          ).rows[0]?.password_hash,
      );
      if (!stored || !(await verifyPassword(body.current, stored)))
        throw new HttpError(400, 'invalid_request', 'The current password is not right', [
          { path: 'body.current', message: 'is not right' },
        ]);
      const hash = await hashPassword(body.next);
      const cookie = sessionFromCookies(req.headers.cookie) ?? '';
      const signedOut = await inSystem(pool, async (c) => {
        await c.query('UPDATE users SET password_hash = $2 WHERE id = $1', [me.id, hash]);
        const r = await c.query('DELETE FROM sessions WHERE user_id = $1 AND token_hash <> $2', [
          me.id,
          sha256(cookie),
        ]);
        return r.rowCount ?? 0;
      });
      return { body: { ok: true as const, signedOut } };
    },
  });

  const invite = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/invitations',
    summary: 'Invite someone by email with a role; the link is in this answer only (admin)',
    tags: ['members'],
    params: s.object({ workspaceId: uuid }),
    body: s.object({
      email: s.string({ format: 'email', max: 254 }),
      // [PCODE-163 | S15 | v0.1.0] the new roles; client contacts are invited from Clients
      role: s.enum(['admin', 'member', 'tester', 'designer', 'billing', 'auditor', 'guest']),
    }),
    response: s.object({ invitation: invitationOut, token: s.string(), mailed: s.boolean() }),
    status: 201,
    handler: async ({ params, body, req }) => {
      const out = await asMember(pool, req, params.workspaceId, 'admin', async (c, a) => {
        const email = body.email.trim().toLowerCase();
        const member = (
          await c.query(
            `SELECT 1 FROM workspace_members m JOIN users u ON u.id = m.user_id
             WHERE m.workspace_id = $1 AND lower(u.email) = $2`,
            [a.workspaceId, email],
          )
        ).rowCount;
        if (member) throw new HttpError(409, 'conflict', email + ' is already a member');
        // [PCODE-148 | S15 | v0.1.0] no invitation that could not be accepted
        await checkSeat(c, a.workspaceId);
        // a new invitation replaces an open one for the same address
        await c.query(
          'UPDATE invitations SET revoked_at = now() WHERE lower(email) = $1 AND accepted_at IS NULL AND revoked_at IS NULL',
          [email],
        );
        const token = randomBytes(32).toString('base64url');
        const row = (
          await c.query<InvitationRow>(
            `INSERT INTO invitations (workspace_id, email, role, token_hash, invited_by, expires_at)
             VALUES ($1, $2, $3, $4, $5, now() + interval '${String(INVITE_DAYS)} days')
             RETURNING id, email, role, $6::text AS invited_by_name, created_at, expires_at`,
            [a.workspaceId, email, body.role, sha256(token), a.user.id, a.user.name],
          )
        ).rows[0];
        if (!row) throw new Error('invitation insert returned nothing');
        await recordEvent(c, a.workspaceId, {
          actor: actorOf(a),
          verb: 'created',
          object: { type: 'member', id: row.id, label: email },
          parent: { type: 'workspace', id: a.workspaceId },
          changes: { invited: { from: null, to: body.role } },
        });
        const ws =
          (await c.query<{ name: string }>('SELECT name FROM workspaces')).rows[0]?.name ?? '';
        return { invitation: invitationJson(row), token, email, ws, inviter: a.user.name };
      });
      // [PCODE-237 | S15 | v0.1.0] mailed too when this server sends mail; the link stays in the answer
      const mailed = Boolean(deps.mail);
      if (mailed)
        await inSystem(pool, (c) =>
          queueMail(c, {
            ...invitationMail({
              workspace: out.ws,
              inviter: out.inviter,
              url: (deps.publicUrl ?? '').replace(/\/$/, '') + '/invite/' + out.token,
            }),
            to: out.email,
            kind: 'invitation',
            workspaceId: params.workspaceId,
          }),
        );
      return { status: 201, body: { invitation: out.invitation, token: out.token, mailed } };
    },
  });

  const pending = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/invitations',
    summary: 'Open invitations, newest first (admin)',
    tags: ['members'],
    params: s.object({ workspaceId: uuid }),
    response: s.array(invitationOut),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'admin', async (c) => ({
        body: (
          await c.query<InvitationRow>(
            `SELECT i.id, i.email, i.role, u.name AS invited_by_name, i.created_at, i.expires_at
             FROM invitations i LEFT JOIN users u ON u.id = i.invited_by
             WHERE i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now()
             ORDER BY i.created_at DESC`,
          )
        ).rows.map(invitationJson),
      })),
  });

  const revoke = route({
    method: 'DELETE',
    path: '/api/workspaces/:workspaceId/invitations/:invitationId',
    summary: 'Withdraw an invitation; its link stops working (admin)',
    tags: ['members'],
    params: s.object({ workspaceId: uuid, invitationId: uuid }),
    response: s.object({ ok: s.literal(true) }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'admin', async (c) => {
        const r = await c.query(
          'UPDATE invitations SET revoked_at = now() WHERE id = $1 AND accepted_at IS NULL AND revoked_at IS NULL',
          [params.invitationId],
        );
        if (!r.rowCount) throw new HttpError(404, 'not_found', 'Invitation not found');
        return { body: { ok: true as const } };
      }),
  });

  interface Open {
    id: string;
    workspace_id: string;
    workspace_name: string;
    email: string;
    role: string;
    invited_by_name: string | null;
    expires_at: Date;
    accepted_at: Date | null;
    revoked_at: Date | null;
    // [PCODE-163 | S15 | v0.1.0] an invitation to become a client's contact
    client_id: string | null;
    portal_role: string | null;
  }
  const lookup = async (token: string): Promise<Open> => {
    if (!TOKEN.test(token)) throw new HttpError(404, 'not_found', 'This invitation does not exist');
    const row = await inSystem(
      pool,
      async (c) =>
        (
          await c.query<Open>(
            `SELECT i.id, i.workspace_id, w.name AS workspace_name, i.email, i.role, u.name AS invited_by_name,
                  i.expires_at, i.accepted_at, i.revoked_at, i.client_id, i.portal_role
           FROM invitations i JOIN workspaces w ON w.id = i.workspace_id
           LEFT JOIN users u ON u.id = i.invited_by
           WHERE i.token_hash = $1`,
            [sha256(token)],
          )
        ).rows[0],
    );
    if (!row) throw new HttpError(404, 'not_found', 'This invitation does not exist');
    if (row.accepted_at) throw new HttpError(410, 'gone', 'This invitation has been used');
    if (row.revoked_at) throw new HttpError(410, 'gone', 'This invitation was withdrawn');
    if (row.expires_at.getTime() < Date.now())
      throw new HttpError(410, 'gone', 'This invitation has expired; ask for a new one');
    return row;
  };

  const show = route({
    method: 'GET',
    path: '/auth/invitations/:token',
    summary: 'What an invitation link is for (no sign-in needed)',
    tags: ['auth'],
    params: s.object({ token: s.string({ max: 100 }) }),
    response: s.object({
      workspaceName: s.string(),
      email: s.string(),
      role: s.string(),
      invitedBy: s.nullable(s.string()),
      expiresAt: s.string(),
      accountExists: s.boolean(),
      forClient: s.boolean(), // [PCODE-339 | S15 | v0.1.0] may join without a password
    }),
    handler: async ({ params }) => {
      const inv = await lookup(params.token);
      const exists = await inSystem(pool, async (c) =>
        Boolean(
          (await c.query('SELECT 1 FROM users WHERE lower(email) = $1', [inv.email])).rowCount,
        ),
      );
      return {
        body: {
          workspaceName: inv.workspace_name,
          email: inv.email,
          role: inv.role,
          invitedBy: inv.invited_by_name,
          expiresAt: inv.expires_at.toISOString(),
          accountExists: exists,
          forClient: Boolean(inv.client_id),
        },
      };
    },
  });

  const accept = route({
    method: 'POST',
    path: '/auth/invitations/:token/accept',
    summary:
      'Join with an invitation: as a new account (name, password), or as the signed-in account it names',
    tags: ['auth'],
    params: s.object({ token: s.string({ max: 100 }) }),
    body: s.object({
      name: s.optional(s.string({ min: 1, max: 200 })),
      password: s.optional(s.string({ min: PASSWORD_MIN, max: PASSWORD_MAX })),
    }),
    response: s.object({ workspaceId: s.string(), created: s.boolean() }),
    handler: async ({ params, body, req }) => {
      const inv = await lookup(params.token);
      const signedIn = await requireUser(pool, req).catch(() => null);
      let userId: string;
      let userName: string;
      let created = false;
      if (signedIn) {
        if (signedIn.email.toLowerCase() !== inv.email)
          throw new HttpError(
            403,
            'forbidden',
            'This invitation is for ' + inv.email + '; sign in with that account',
          );
        userId = signedIn.id;
        userName = signedIn.name;
      } else {
        const exists = await inSystem(pool, async (c) =>
          Boolean(
            (await c.query('SELECT 1 FROM users WHERE lower(email) = $1', [inv.email])).rowCount,
          ),
        );
        if (exists)
          throw new HttpError(
            401,
            'unauthorized',
            'An account for ' + inv.email + ' exists; sign in first, then accept',
          );
        // [PCODE-339 | S15 | v0.1.0] a client's contact may join without a password and sign in by link
        const passwordless = Boolean(inv.client_id) && !body.password;
        if (!body.name?.trim() || (!body.password && !passwordless))
          throw new HttpError(400, 'invalid_request', 'Choose a name and a password', [
            ...(!body.name?.trim() ? [{ path: 'body.name', message: 'is needed' }] : []),
            ...(!body.password && !passwordless
              ? [{ path: 'body.password', message: 'is needed' }]
              : []),
          ]);
        const hash = body.password ? await hashPassword(body.password) : null;
        const user = await inSystem(
          pool,
          async (c) =>
            (
              await c.query<{ id: string; name: string }>(
                'INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3) RETURNING id, name',
                [inv.email, body.name?.trim() ?? '', hash],
              )
            ).rows[0],
        );
        if (!user) throw new Error('user insert returned nothing');
        userId = user.id;
        userName = user.name;
        created = true;
      }
      await inSystem(pool, async (c) => {
        // single use: whoever marks it first joins; a second try finds it taken
        const taken = await c.query(
          'UPDATE invitations SET accepted_at = now(), accepted_by = $2 WHERE id = $1 AND accepted_at IS NULL AND revoked_at IS NULL',
          [inv.id, userId],
        );
        if (!taken.rowCount) throw new HttpError(410, 'gone', 'This invitation has been used');
        // [PCODE-148 | S15 | v0.1.0] seats can fill up between the invitation and the answer
        // [PCODE-163 | S15 | v0.1.0] a client's contact takes no seat
        if (!inv.client_id) await checkSeat(c, inv.workspace_id);
        await c.query(
          'INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
          [inv.workspace_id, userId, inv.role],
        );
        // [PCODE-163 | S15 | v0.1.0] a client's invitation makes them that client's contact in its portal role
        if (inv.client_id && inv.portal_role)
          await c.query(
            'INSERT INTO client_contacts (workspace_id, client_id, user_id, portal_role) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
            [inv.workspace_id, inv.client_id, userId, inv.portal_role],
          );
      });
      await inWorkspace(pool, inv.workspace_id, (c) =>
        recordEvent(c, inv.workspace_id, {
          actor: { kind: 'user', id: userId, name: userName },
          verb: 'created',
          object: { type: 'member', id: userId, label: userName },
          parent: { type: 'workspace', id: inv.workspace_id },
          changes: { role: { from: null, to: inv.role } },
        }),
      );
      const headers: Record<string, string> = {};
      if (created)
        // [PCODE-190 | S15 | v0.1.0] the session knows its device (B5.3)
        headers['set-cookie'] = sessionCookie(
          await createSession(pool, userId, req),
          secureCookies,
        );
      return { body: { workspaceId: inv.workspace_id, created }, headers };
    },
  });

  return [rename, password, invite, pending, revoke, show, accept];
}
