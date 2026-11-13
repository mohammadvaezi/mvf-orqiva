// ── [PCODE-363 | S15 | v0.1.0] T35.7e Rate limits shared across cluster nodes ──
// ── [PCODE-237 | S15 | v0.1.0] T23.4 Email as a channel: own SMTP sender, password reset, invitations, digests ──
//    Why:  what people do with email. An admin sees whether this server sends mail, the last mails of the
//          workspace and why one failed, and sends a test mail to themselves. Someone who forgot their
//          password asks for a link (the answer never says whether the address has an account); the link
//          works once, for an hour. Without mail, an admin makes the link and hands it over, but only for
//          someone whose every workspace they administer: an admin of one workspace never takes over an
//          account that also belongs to another. A new password ends every session of that account.
import { createHash, randomBytes } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Pool } from 'pg';
import { PASSWORD_MAX, PASSWORD_MIN, hashPassword } from '../auth/password.js';
import { SharedRateLimiter, type Limiter } from '../auth/ratelimit.js'; // [PCODE-363 | S15 | v0.1.0]
import { inSystem } from '../db/pool.js';
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s } from '../http/schema.js';
import { queueMail } from '../mail/outbox.js';
import type { MailConfig } from '../mail/smtp.js';
import { resetMail, testMail } from '../mail/templates.js';
import { asMember, atLeast } from './access.js';

const uuid = s.string({ format: 'uuid' });
const sha256 = (v: string): string => createHash('sha256').update(v).digest('hex');
const clientIp = (req: IncomingMessage): string => req.socket.remoteAddress ?? 'unknown';
const RESET_MINUTES = 60;

export interface MailDeps {
  mail?: MailConfig | null;
  publicUrl?: string;
  limiter?: Limiter;
}

/** Whether this server sends mail; flows that would mail offer their link without it. */
export const mailOn = (d: MailDeps): boolean => Boolean(d.mail);

export function mailRoutes(pool: Pool, deps: MailDeps = {}): Route[] {
  const limiter = deps.limiter ?? new SharedRateLimiter(pool, 'mail', 5, 15 * 60_000); // [PCODE-363 | S15 | v0.1.0]
  const base = (deps.publicUrl ?? '').replace(/\/$/, '');

  const status = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/mail',
    summary:
      'Whether this server sends mail, how, and the last mails of the workspace with their state (admin)',
    tags: ['notifications'],
    params: s.object({ workspaceId: uuid }),
    response: s.object({
      configured: s.boolean(),
      from: s.nullable(s.string()),
      server: s.nullable(s.string()),
      security: s.nullable(s.string()),
      recent: s.array(
        s.object({
          to: s.string(),
          subject: s.string(),
          kind: s.string(),
          status: s.string(),
          attempts: s.number({ integer: true }),
          error: s.string(),
          createdAt: s.string(),
          sentAt: s.nullable(s.string()),
        }),
      ),
    }),
    handler: async ({ params, req }) => {
      const a = await asMember(pool, req, params.workspaceId, 'admin', (_c, acc) =>
        Promise.resolve(acc),
      );
      const rows = await inSystem(
        pool,
        async (c) =>
          (
            await c.query<{
              to_address: string;
              subject: string;
              kind: string;
              status: string;
              attempts: number;
              last_error: string;
              created_at: Date;
              sent_at: Date | null;
            }>(
              `SELECT to_address, subject, kind, status, attempts, last_error, created_at, sent_at
                 FROM mail_outbox WHERE workspace_id = $1 AND kind <> 'reset'
                ORDER BY created_at DESC LIMIT 20`,
              [a.workspaceId],
            )
          ).rows,
      );
      const m = deps.mail;
      return {
        body: {
          configured: Boolean(m),
          from: m?.from ?? null,
          server: m ? m.host + ':' + String(m.port) : null,
          security: m?.security ?? null,
          recent: rows.map((r) => ({
            to: r.to_address,
            subject: r.subject,
            kind: r.kind,
            status: r.status,
            attempts: r.attempts,
            error: r.last_error,
            createdAt: r.created_at.toISOString(),
            sentAt: r.sent_at?.toISOString() ?? null,
          })),
        },
      };
    },
  });

  const test = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/mail/test',
    summary: 'Send a test mail to yourself (admin)',
    tags: ['notifications'],
    params: s.object({ workspaceId: uuid }),
    response: s.object({ queued: s.boolean(), to: s.string() }),
    status: 202,
    handler: async ({ params, req }) => {
      const a = await asMember(pool, req, params.workspaceId, 'admin', (_c, acc) =>
        Promise.resolve(acc),
      );
      if (!deps.mail)
        throw new HttpError(
          409,
          'conflict',
          'This server sends no mail yet: set ORQIVA_SMTP_HOST and ORQIVA_MAIL_FROM',
        );
      await inSystem(pool, (c) =>
        queueMail(c, {
          ...testMail(a.user.email, deps.mail?.host ?? ''),
          to: a.user.email,
          kind: 'test',
          workspaceId: a.workspaceId,
        }),
      );
      return { status: 202, body: { queued: true, to: a.user.email } };
    },
  });

  const forgot = route({
    method: 'POST',
    path: '/auth/password/forgot',
    summary:
      'Ask for a link to choose a new password; the answer is the same whether the address has an account (public, rate-limited)',
    tags: ['auth'],
    body: s.object({ email: s.string({ format: 'email', max: 254 }) }),
    response: s.object({ ok: s.boolean(), mail: s.boolean() }),
    handler: async ({ body, req }) => {
      const email = body.email.trim().toLowerCase();
      for (const key of ['forgot-ip:' + clientIp(req), 'forgot:' + email])
        if (!(await limiter.allowed(key)))
          throw new HttpError(
            429,
            'too_many_requests',
            'Too many requests; try again in a quarter of an hour',
          );
      await limiter.fail('forgot-ip:' + clientIp(req));
      await limiter.fail('forgot:' + email);
      if (!deps.mail) return { body: { ok: true, mail: false } };
      await inSystem(pool, async (c) => {
        const user = (
          await c.query<{ id: string; name: string; email: string }>(
            'SELECT id, name, email FROM users WHERE lower(email) = $1',
            [email],
          )
        ).rows[0];
        if (!user) return;
        const token = randomBytes(32).toString('base64url');
        await c.query(
          `INSERT INTO password_resets (user_id, token_hash, made_by, expires_at)
           VALUES ($1, $2, 'mail', now() + make_interval(mins => $3))`,
          [user.id, sha256(token), RESET_MINUTES],
        );
        await queueMail(c, {
          ...resetMail({ name: user.name, url: base + '/reset/' + token }),
          to: user.email,
          kind: 'reset',
        });
      });
      return { body: { ok: true, mail: true } };
    },
  });

  const reset = route({
    method: 'POST',
    path: '/auth/password/reset',
    summary: 'Choose a new password with a reset link; every session of the account ends (public)',
    tags: ['auth'],
    body: s.object({
      token: s.string({ min: 20, max: 100 }),
      password: s.string({ min: PASSWORD_MIN, max: PASSWORD_MAX }),
    }),
    response: s.object({ ok: s.boolean() }),
    handler: async ({ body, req }) => {
      const key = 'reset-ip:' + clientIp(req);
      if (!(await limiter.allowed(key)))
        throw new HttpError(429, 'too_many_requests', 'Too many tries; wait a quarter of an hour');
      const hash = await hashPassword(body.password);
      const done = await inSystem(pool, async (c) => {
        const r = (
          await c.query<{ user_id: string }>(
            `UPDATE password_resets SET used_at = now()
              WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now() RETURNING user_id`,
            [sha256(body.token)],
          )
        ).rows[0];
        if (!r) return false;
        await c.query('UPDATE users SET password_hash = $2 WHERE id = $1', [r.user_id, hash]);
        await c.query('DELETE FROM sessions WHERE user_id = $1', [r.user_id]);
        // other open links of the account stop working too
        await c.query(
          'UPDATE password_resets SET used_at = now() WHERE user_id = $1 AND used_at IS NULL',
          [r.user_id],
        );
        return true;
      });
      if (!done) {
        await limiter.fail(key);
        throw new HttpError(
          400,
          'invalid_request',
          'This link does not work any more: it was used or is older than an hour. Ask for a new one.',
        );
      }
      return { body: { ok: true } };
    },
  });

  const adminLink = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/members/:userId/reset-link',
    summary:
      'A one-time link (24 hours) for a member to choose a new password, to hand over in person; only for accounts whose every workspace you administer (admin)',
    tags: ['members'],
    params: s.object({ workspaceId: uuid, userId: uuid }),
    response: s.object({ url: s.string(), expiresAt: s.string() }),
    status: 201,
    handler: async ({ params, req }) => {
      const a = await asMember(pool, req, params.workspaceId, 'admin', (_c, acc) =>
        Promise.resolve(acc),
      );
      if (params.userId === a.user.id)
        throw new HttpError(409, 'conflict', 'Change your own password in your profile');
      const token = randomBytes(32).toString('base64url');
      const expires = await inSystem(pool, async (c) => {
        const memberships = (
          await c.query<{ workspace_id: string; role: string; mine: string | null }>(
            `SELECT m.workspace_id, m.role, me.role AS mine FROM workspace_members m
               LEFT JOIN workspace_members me ON me.workspace_id = m.workspace_id AND me.user_id = $2
              WHERE m.user_id = $1`,
            [params.userId, a.user.id],
          )
        ).rows;
        const here = memberships.find((m) => m.workspace_id === a.workspaceId);
        if (!here) throw new HttpError(404, 'not_found', 'Member not found');
        if (here.role === 'owner' && a.role !== 'owner')
          throw new HttpError(403, 'forbidden', 'Only an owner makes a link for an owner');
        const elsewhere = memberships.filter(
          (m) => !m.mine || !atLeast(m.mine as 'admin', 'admin'),
        );
        if (elsewhere.length)
          throw new HttpError(
            403,
            'forbidden',
            'This person also belongs to a workspace you do not administer; they reset it themselves',
          );
        const row = (
          await c.query<{ expires_at: Date }>(
            `INSERT INTO password_resets (user_id, token_hash, made_by, expires_at)
             VALUES ($1, $2, 'admin', now() + interval '24 hours') RETURNING expires_at`,
            [params.userId, sha256(token)],
          )
        ).rows[0];
        if (!row) throw new Error('reset insert returned nothing');
        return row.expires_at;
      });
      return {
        status: 201,
        body: { url: base + '/reset/' + token, expiresAt: expires.toISOString() },
      };
    },
  });

  return [status, test, forgot, reset, adminLink];
}
