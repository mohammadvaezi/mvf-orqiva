// ── [PCODE-363 | S15 | v0.1.0] T35.7e Rate limits shared across cluster nodes ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-102 | S15 | v0.1.0] Port the engine's loop to the server: sync, start, status, note, done ──
// ── [PCODE-150 | S15 | v0.1.0] Add the cloud tenant and harden sign-in, rate limits and headers ──
//    Why:  personal API tokens for tools that are not a browser: the orq CLI and its Claude Code hooks, later
//          the VS Code extension and agents. `orq login` trades email and password for a token once; the token
//          is shown once and kept only as a hash. A person lists and revokes their tokens; a revoked token
//          stops working at once.
import { requireSecondFactor, secondFactor } from './twofactor.js';
import type { Pool } from 'pg';
import { inSystem } from '../db/pool.js';
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s } from '../http/schema.js';
import { DUMMY_HASH, verifyPassword } from './password.js';
import { SharedRateLimiter, type Limiter } from './ratelimit.js'; // [PCODE-363 | S15 | v0.1.0]
import { createApiToken, currentUser } from './sessions.js';

const tokenOut = s.object({
  id: s.string(),
  name: s.string(),
  createdAt: s.string(),
  lastUsedAt: s.nullable(s.string()),
});

export function tokenRoutes(
  pool: Pool,
  limiter: Limiter = new SharedRateLimiter(pool, 'token', 10, 15 * 60_000), // [PCODE-363 | S15 | v0.1.0]
): Route[] {
  const create = route({
    method: 'POST',
    path: '/auth/tokens',
    summary:
      'Create a personal API token, signed in or with email and password; the token is shown once',
    tags: ['auth'],
    body: s.object({
      name: s.string({ min: 1, max: 80 }),
      email: s.optional(s.string({ max: 254 })),
      password: s.optional(s.string({ max: 200 })),
      // [PCODE-150 | S15 | v0.1.0] the second factor, when the account has one
      code: s.optional(s.string({ max: 20 })),
      recoveryCode: s.optional(s.string({ max: 40 })),
    }),
    response: s.object({ id: s.string(), name: s.string(), token: s.string() }),
    status: 201,
    handler: async ({ body, req }) => {
      let userId = (await currentUser(pool, req))?.id;
      if (!userId) {
        if (!body.email || !body.password)
          throw new HttpError(401, 'unauthorized', 'Sign in, or send email and password');
        const email = body.email.trim().toLowerCase();
        const key = 'token:' + email;
        if (!(await limiter.allowed(key)))
          throw new HttpError(
            429,
            'too_many_requests',
            'Too many attempts; wait a few minutes and try again',
          );
        const user = await inSystem(
          pool,
          async (c) =>
            (
              await c.query<{ id: string; password_hash: string | null }>(
                'SELECT id, password_hash FROM users WHERE email = $1',
                [email],
              )
            ).rows[0],
        );
        const ok = await verifyPassword(body.password, user?.password_hash ?? DUMMY_HASH);
        if (!user || !user.password_hash || !ok) {
          await limiter.fail(key);
          throw new HttpError(401, 'unauthorized', 'Email or password is wrong');
        }
        // [PCODE-150 | S15 | v0.1.0] the same second factor as the web sign-in
        const factor = await inSystem(pool, (c) =>
          secondFactor(c, user.id, body.code, body.recoveryCode),
        );
        if (factor === 'wrong') await limiter.fail(key);
        requireSecondFactor(factor);
        userId = user.id;
      }
      const t = await createApiToken(pool, userId, body.name.trim());
      return { status: 201, body: { id: t.id, name: body.name.trim(), token: t.token } };
    },
  });

  const list = route({
    method: 'GET',
    path: '/auth/tokens',
    summary: 'The caller’s personal API tokens (never their values)',
    tags: ['auth'],
    response: s.array(tokenOut),
    handler: async ({ req }) => {
      const user = await currentUser(pool, req);
      if (!user) throw new HttpError(401, 'unauthorized', 'Sign in first');
      const rows = await inSystem(
        pool,
        async (c) =>
          (
            await c.query<{
              id: string;
              name: string;
              created_at: Date;
              last_used_at: Date | null;
            }>(
              'SELECT id, name, created_at, last_used_at FROM api_tokens WHERE user_id = $1 AND revoked_at IS NULL ORDER BY created_at',
              [user.id],
            )
          ).rows,
      );
      return {
        body: rows.map((r) => ({
          id: r.id,
          name: r.name,
          createdAt: r.created_at.toISOString(),
          lastUsedAt: r.last_used_at?.toISOString() ?? null,
        })),
      };
    },
  });

  const revoke = route({
    method: 'DELETE',
    path: '/auth/tokens/:tokenId',
    summary: 'Revoke one of the caller’s tokens; it stops working at once',
    tags: ['auth'],
    params: s.object({ tokenId: s.string({ format: 'uuid' }) }),
    response: s.object({ ok: s.literal(true) }),
    handler: async ({ params, req }) => {
      const user = await currentUser(pool, req);
      if (!user) throw new HttpError(401, 'unauthorized', 'Sign in first');
      const gone = await inSystem(pool, (c) =>
        c.query(
          'UPDATE api_tokens SET revoked_at = now() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL',
          [params.tokenId, user.id],
        ),
      );
      if (!gone.rowCount) throw new HttpError(404, 'not_found', 'Token not found');
      return { body: { ok: true as const } };
    },
  });

  return [create, list, revoke];
}
