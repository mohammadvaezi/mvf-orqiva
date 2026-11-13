// ── [PCODE-150 | S15 | v0.1.0] Add the cloud tenant and harden sign-in, rate limits and headers ──
//    Why:  turning the second factor on and off, and the one check every password sign-in passes through
//          (the web login and the API-token exchange alike): with TOTP on, a password alone is not enough;
//          a code from the app or one unused recovery code is.
import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { open, seal, SecretKeyMissing } from '../agents/secrets.js';
import { inSystem } from '../db/pool.js';
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s } from '../http/schema.js';
import { DUMMY_HASH, verifyPassword } from './password.js';
import { currentUser } from './sessions.js';
import { matchTotp, newTotpSecret, otpauthUri, recoveryCodes, base32Encode } from './totp.js';

const sha256 = (v: string): string => createHash('sha256').update(v).digest('hex');
const normal = (code: string): string => code.trim().toLowerCase().replace(/\s/g, '');

/** Whether a password sign-in may go ahead: no second factor, or a right code or recovery code. */
export async function secondFactor(
  c: PoolClient,
  userId: string,
  code: string | undefined,
  recovery: string | undefined,
  now = new Date(),
): Promise<'none' | 'ok' | 'missing' | 'wrong'> {
  const t = (
    await c.query<{ secret_ciphertext: string; last_step: string | null }>(
      'SELECT secret_ciphertext, last_step FROM user_totp WHERE user_id = $1 AND enabled_at IS NOT NULL',
      [userId],
    )
  ).rows[0];
  if (!t) return 'none';
  if (code) {
    const step = matchTotp(
      Buffer.from(open(t.secret_ciphertext), 'base64'),
      code,
      now,
      t.last_step === null ? null : Number(t.last_step),
    );
    if (step === null) return 'wrong';
    await c.query('UPDATE user_totp SET last_step = $2 WHERE user_id = $1', [userId, step]);
    return 'ok';
  }
  if (recovery) {
    const used = await c.query(
      'UPDATE user_recovery_codes SET used_at = now() WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL',
      [userId, sha256(normal(recovery))],
    );
    return used.rowCount ? 'ok' : 'wrong';
  }
  return 'missing';
}

/** Turns the answer of secondFactor into the error a client understands. */
export function requireSecondFactor(result: 'none' | 'ok' | 'missing' | 'wrong'): void {
  if (result === 'missing')
    throw new HttpError(401, 'unauthorized', 'Enter the code from your authenticator app', [
      { path: 'body.code', message: 'is required for this account' },
    ]);
  if (result === 'wrong')
    throw new HttpError(401, 'unauthorized', 'That code is not right; try the newest one');
}

export function twoFactorRoutes(pool: Pool): Route[] {
  const signedIn = async (req: Parameters<typeof currentUser>[1]) => {
    const u = await currentUser(pool, req);
    if (!u) throw new HttpError(401, 'unauthorized', 'Sign in first');
    return u;
  };

  const status = route({
    method: 'GET',
    path: '/auth/totp',
    summary: 'Whether the second factor is on, and how many recovery codes are left',
    tags: ['auth'],
    response: s.object({ enabled: s.boolean(), recoveryLeft: s.number({ integer: true }) }),
    handler: async ({ req }) => {
      const u = await signedIn(req);
      return inSystem(pool, async (c) => {
        const t = (
          await c.query<{ enabled_at: Date | null }>(
            'SELECT enabled_at FROM user_totp WHERE user_id = $1',
            [u.id],
          )
        ).rows[0];
        const left = (
          await c.query<{ n: string }>(
            'SELECT count(*) AS n FROM user_recovery_codes WHERE user_id = $1 AND used_at IS NULL',
            [u.id],
          )
        ).rows[0]?.n;
        return { body: { enabled: Boolean(t?.enabled_at), recoveryLeft: Number(left ?? 0) } };
      });
    },
  });

  const setup = route({
    method: 'POST',
    path: '/auth/totp/setup',
    summary:
      'Start turning the second factor on: a new secret for the authenticator app (not active yet)',
    tags: ['auth'],
    response: s.object({ secret: s.string(), uri: s.string() }),
    handler: async ({ req }) => {
      const u = await signedIn(req);
      const secret = newTotpSecret();
      let sealed: string;
      try {
        sealed = seal(secret.toString('base64'));
      } catch (e) {
        if (e instanceof SecretKeyMissing) throw new HttpError(409, 'conflict', e.message);
        throw e;
      }
      await inSystem(pool, async (c) => {
        const on = (
          await c.query('SELECT 1 FROM user_totp WHERE user_id = $1 AND enabled_at IS NOT NULL', [
            u.id,
          ])
        ).rowCount;
        if (on)
          throw new HttpError(
            409,
            'conflict',
            'The second factor is already on; turn it off first to change it',
          );
        await c.query(
          `INSERT INTO user_totp (user_id, secret_ciphertext) VALUES ($1, $2)
           ON CONFLICT (user_id) DO UPDATE SET secret_ciphertext = $2, enabled_at = NULL, last_step = NULL, created_at = now()`,
          [u.id, sealed],
        );
      });
      return { body: { secret: base32Encode(secret), uri: otpauthUri(secret, u.email) } };
    },
  });

  const enable = route({
    method: 'POST',
    path: '/auth/totp/enable',
    summary:
      'Turn the second factor on with a first code; answers ten recovery codes, shown only now',
    tags: ['auth'],
    body: s.object({ code: s.string({ min: 6, max: 10 }) }),
    response: s.object({ recoveryCodes: s.array(s.string()) }),
    handler: async ({ body, req }) => {
      const u = await signedIn(req);
      return inSystem(pool, async (c) => {
        const t = (
          await c.query<{ secret_ciphertext: string; enabled_at: Date | null }>(
            'SELECT secret_ciphertext, enabled_at FROM user_totp WHERE user_id = $1',
            [u.id],
          )
        ).rows[0];
        if (!t) throw new HttpError(409, 'conflict', 'Start with the setup first');
        if (t.enabled_at) throw new HttpError(409, 'conflict', 'The second factor is already on');
        const step = matchTotp(
          Buffer.from(open(t.secret_ciphertext), 'base64'),
          body.code,
          new Date(),
          null,
        );
        if (step === null)
          throw new HttpError(
            400,
            'invalid_request',
            'That code is not right; check the app’s clock and try the newest one',
          );
        await c.query(
          'UPDATE user_totp SET enabled_at = now(), last_step = $2 WHERE user_id = $1',
          [u.id, step],
        );
        await c.query('DELETE FROM user_recovery_codes WHERE user_id = $1', [u.id]);
        const codes = recoveryCodes();
        for (const code of codes)
          await c.query('INSERT INTO user_recovery_codes (user_id, code_hash) VALUES ($1, $2)', [
            u.id,
            sha256(normal(code)),
          ]);
        return { body: { recoveryCodes: codes } };
      });
    },
  });

  const disable = route({
    method: 'POST',
    path: '/auth/totp/disable',
    summary: 'Turn the second factor off; needs the password',
    tags: ['auth'],
    body: s.object({ password: s.string({ max: 200 }) }),
    response: s.object({ enabled: s.boolean() }),
    handler: async ({ body, req }) => {
      const u = await signedIn(req);
      return inSystem(pool, async (c) => {
        const hash = (
          await c.query<{ password_hash: string | null }>(
            'SELECT password_hash FROM users WHERE id = $1',
            [u.id],
          )
        ).rows[0]?.password_hash;
        if (!(await verifyPassword(body.password, hash ?? DUMMY_HASH)) || !hash)
          throw new HttpError(401, 'unauthorized', 'The password is wrong');
        await c.query('DELETE FROM user_totp WHERE user_id = $1', [u.id]);
        await c.query('DELETE FROM user_recovery_codes WHERE user_id = $1', [u.id]);
        return { body: { enabled: false } };
      });
    },
  });

  return [status, setup, enable, disable];
}
