// ── [PCODE-363 | S15 | v0.1.0] T35.7e Rate limits shared across cluster nodes ──
// ── [PCODE-339 | S15 | v0.1.0] T34.1d Portal magic-link sign-in and passwordless invitations, MFA required per client ──
//    Why:  a client contact should not need yet another password: a link by email signs them in, once
//          and within 15 minutes, and the answer to asking for one never tells whether the address has an
//          account. Where a client requires a second factor, a contact without one sets up the
//          authenticator app right there, before the first session; with one, its code is asked for.
import { createHash, randomBytes } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { open, seal, SecretKeyMissing } from '../agents/secrets.js';
import { inSystem } from '../db/pool.js';
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s } from '../http/schema.js';
import { queueMail } from '../mail/outbox.js';
import { signInLinkMail } from '../mail/templates.js';
import { SharedRateLimiter } from './ratelimit.js'; // [PCODE-363 | S15 | v0.1.0]
import { createSession, sessionCookie } from './sessions.js';
import { matchTotp, newTotpSecret, otpauthUri, recoveryCodes, base32Encode } from './totp.js';
import { requireSecondFactor, secondFactor } from './twofactor.js';

const sha256 = (v: string): string => createHash('sha256').update(v).digest('hex');
export const LINK_MINUTES = 15;

/** Whether one of the clients this person is a contact of requires a second factor. */
export async function mfaRequired(c: PoolClient, userId: string): Promise<boolean> {
  return Boolean(
    (
      await c.query(
        `SELECT 1 FROM client_contacts cc JOIN clients cl ON cl.id = cc.client_id
          WHERE cc.user_id = $1 AND cl.require_mfa AND cl.archived_at IS NULL LIMIT 1`,
        [userId],
      )
    ).rowCount,
  );
}

export function magicLinkRoutes(deps: {
  pool: Pool;
  secureCookies: boolean;
  publicUrl?: string;
}): Route[] {
  const { pool } = deps;
  // [PCODE-363 | S15 | v0.1.0] counted for the whole cluster
  const perEmail = new SharedRateLimiter(pool, 'link-email', 5, 15 * 60_000);
  const perIp = new SharedRateLimiter(pool, 'link-ip', 20, 15 * 60_000);
  const perToken = new SharedRateLimiter(pool, 'link-token', 10, 15 * 60_000);
  const userOut = s.object({ id: s.string(), email: s.string(), name: s.string() });

  const ask = route({
    method: 'POST',
    path: '/auth/link',
    summary:
      'Email a sign-in link to a client contact; the answer is the same whether or not the address has an account',
    tags: ['auth'],
    body: s.object({ email: s.string({ format: 'email', max: 254 }) }),
    response: s.object({ ok: s.literal(true) }),
    status: 202,
    handler: async ({ body, req }) => {
      const email = body.email.trim().toLowerCase();
      const ip = req.socket.remoteAddress ?? 'unknown';
      if (!(await perEmail.allowed(email)) || !(await perIp.allowed(ip)))
        throw new HttpError(
          429,
          'too_many_requests',
          'Too many links asked for; wait a few minutes',
        );
      await perEmail.fail(email);
      await perIp.fail(ip);
      await inSystem(pool, async (c) => {
        const u = (
          await c.query<{ id: string; name: string }>(
            `SELECT u.id, u.name FROM users u
              WHERE lower(u.email) = $1 AND EXISTS (SELECT 1 FROM client_contacts cc WHERE cc.user_id = u.id)`,
            [email],
          )
        ).rows[0];
        // only a client's contacts sign in this way; the team keeps its password or single sign-on
        if (!u) return;
        const token = randomBytes(32).toString('base64url');
        await c.query(
          `INSERT INTO login_links (user_id, token_hash, kind, expires_at)
           VALUES ($1, $2, 'signin', now() + make_interval(mins => $3))`,
          [u.id, sha256(token), LINK_MINUTES],
        );
        await queueMail(c, {
          kind: 'signin',
          to: email,
          ...signInLinkMail({
            name: u.name,
            url: (deps.publicUrl ?? '').replace(/\/$/, '') + '/sign-in/link?token=' + token,
            minutes: LINK_MINUTES,
          }),
        });
      });
      return { status: 202, body: { ok: true as const } };
    },
  });

  const consume = route({
    method: 'POST',
    path: '/auth/link/consume',
    summary:
      'Sign in with an emailed link: with the code when the account has a second factor; or set one up first when the client requires it',
    tags: ['auth'],
    body: s.object({
      token: s.string({ min: 20, max: 100 }),
      code: s.optional(s.string({ max: 20 })),
      recoveryCode: s.optional(s.string({ max: 40 })),
    }),
    response: s.object({
      user: s.nullable(userOut),
      enrol: s.nullable(s.object({ token: s.string(), secret: s.string(), uri: s.string() })),
    }),
    handler: async ({ body, req }) => {
      if (!(await perToken.allowed(sha256(body.token))))
        throw new HttpError(
          429,
          'too_many_requests',
          'Too many tries with this link; ask for a new one',
        );
      const link = await inSystem(
        pool,
        async (c) =>
          (
            await c.query<{ id: string; user_id: string; email: string; name: string }>(
              `SELECT l.id, l.user_id, u.email, u.name FROM login_links l JOIN users u ON u.id = l.user_id
              WHERE l.token_hash = $1 AND l.kind = 'signin' AND l.used_at IS NULL AND l.expires_at > now()`,
              [sha256(body.token)],
            )
          ).rows[0],
      );
      if (!link)
        throw new HttpError(
          410,
          'gone',
          'This link has been used or has run out; ask for a new one',
        );
      const next = await inSystem(pool, async (c) => {
        const factor = await secondFactor(c, link.user_id, body.code, body.recoveryCode);
        if (factor === 'wrong') await perToken.fail(sha256(body.token));
        requireSecondFactor(factor);
        // a required second factor the account lacks is set up before the first session
        if (factor === 'none' && (await mfaRequired(c, link.user_id))) {
          const secret = newTotpSecret();
          let sealed: string;
          try {
            sealed = seal(secret.toString('base64'));
          } catch (e) {
            if (e instanceof SecretKeyMissing) throw new HttpError(409, 'conflict', e.message);
            throw e;
          }
          await c.query(
            `INSERT INTO user_totp (user_id, secret_ciphertext) VALUES ($1, $2)
             ON CONFLICT (user_id) DO UPDATE SET secret_ciphertext = $2, enabled_at = NULL, last_step = NULL, created_at = now()`,
            [link.user_id, sealed],
          );
          const enrol = randomBytes(32).toString('base64url');
          await c.query(
            `INSERT INTO login_links (user_id, token_hash, kind, expires_at) VALUES ($1, $2, 'enrol', now() + interval '10 minutes')`,
            [link.user_id, sha256(enrol)],
          );
          await c.query('UPDATE login_links SET used_at = now() WHERE id = $1', [link.id]);
          return {
            enrol: {
              token: enrol,
              secret: base32Encode(secret),
              uri: otpauthUri(secret, link.email),
            },
          };
        }
        const taken = await c.query(
          'UPDATE login_links SET used_at = now() WHERE id = $1 AND used_at IS NULL',
          [link.id],
        );
        if (!taken.rowCount)
          throw new HttpError(410, 'gone', 'This link has been used; ask for a new one');
        return { enrol: null };
      });
      if (next.enrol) return { body: { user: null, enrol: next.enrol } };
      const token = await createSession(pool, link.user_id, req);
      return {
        body: { user: { id: link.user_id, email: link.email, name: link.name }, enrol: null },
        headers: { 'set-cookie': sessionCookie(token, deps.secureCookies) },
      };
    },
  });

  const enrol = route({
    method: 'POST',
    path: '/auth/link/enrol',
    summary:
      'Finish the second factor a client requires with a first code from the app; answers recovery codes, shown only now, and signs in',
    tags: ['auth'],
    body: s.object({ token: s.string({ min: 20, max: 100 }), code: s.string({ min: 6, max: 10 }) }),
    response: s.object({ user: userOut, recoveryCodes: s.array(s.string()) }),
    handler: async ({ body, req }) => {
      if (!(await perToken.allowed(sha256(body.token))))
        throw new HttpError(429, 'too_many_requests', 'Too many tries; sign in with a new link');
      const out = await inSystem(pool, async (c) => {
        const link = (
          await c.query<{
            id: string;
            user_id: string;
            email: string;
            name: string;
            secret: string | null;
          }>(
            `SELECT l.id, l.user_id, u.email, u.name, t.secret_ciphertext AS secret
               FROM login_links l JOIN users u ON u.id = l.user_id LEFT JOIN user_totp t ON t.user_id = l.user_id
              WHERE l.token_hash = $1 AND l.kind = 'enrol' AND l.used_at IS NULL AND l.expires_at > now()`,
            [sha256(body.token)],
          )
        ).rows[0];
        if (!link?.secret)
          throw new HttpError(410, 'gone', 'This setup has run out; sign in with a new link');
        const step = matchTotp(
          Buffer.from(open(link.secret), 'base64'),
          body.code,
          new Date(),
          null,
        );
        if (step === null) {
          await perToken.fail(sha256(body.token));
          throw new HttpError(
            400,
            'invalid_request',
            'That code is not right; check the app’s clock and try the newest one',
          );
        }
        await c.query(
          'UPDATE user_totp SET enabled_at = now(), last_step = $2 WHERE user_id = $1',
          [link.user_id, step],
        );
        await c.query('DELETE FROM user_recovery_codes WHERE user_id = $1', [link.user_id]);
        const codes = recoveryCodes();
        for (const code of codes)
          await c.query('INSERT INTO user_recovery_codes (user_id, code_hash) VALUES ($1, $2)', [
            link.user_id,
            sha256(code.trim().toLowerCase().replace(/\s/g, '')),
          ]);
        await c.query('UPDATE login_links SET used_at = now() WHERE id = $1', [link.id]);
        return { user: { id: link.user_id, email: link.email, name: link.name }, codes };
      });
      const token = await createSession(pool, out.user.id, req);
      return {
        body: { user: out.user, recoveryCodes: out.codes },
        headers: { 'set-cookie': sessionCookie(token, deps.secureCookies) },
      };
    },
  });

  return [ask, consume, enrol];
}
