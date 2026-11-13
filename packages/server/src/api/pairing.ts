// ── [PCODE-363 | S15 | v0.1.0] T35.7e Rate limits shared across cluster nodes ──
// ── [PCODE-224 | S15 | v0.1.0] T21.1 Phone sign-in by pairing code, device tokens, QR code in the web app ──
//    Why:  the phone's sign-in. A member makes a pairing code in the web app (a new one replaces their
//          earlier unused codes); the phone redeems it once, within 10 minutes, for a personal token bound
//          to the workspace with read and write scopes, named after the device. The phone never sees a
//          password, so SSO and MFA keep working as they are. Redeeming is public, so failures are
//          rate-limited per address; the token shows in the access-token list and is revoked there.
import { createHash, randomInt } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Pool } from 'pg';
import {
  normalizePairingCode,
  PAIRING_ALPHABET,
  PAIRING_CODE_LENGTH,
  PAIRING_MINUTES,
} from '@orqiva/shared';
import { SharedRateLimiter, type Limiter } from '../auth/ratelimit.js'; // [PCODE-363 | S15 | v0.1.0]
import { createApiToken } from '../auth/sessions.js';
import { inSystem } from '../db/pool.js';
import { recordEvent } from '../events/outbox.js';
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s } from '../http/schema.js';
import { asMember } from './access.js';

/** The scopes a phone's token holds: it reads and writes, nothing broader. */
export const DEVICE_SCOPES = ['read', 'write'];

const sha256 = (v: string): string => createHash('sha256').update(v).digest('hex');
const clientIp = (req: IncomingMessage): string => req.socket.remoteAddress ?? 'unknown';

function newCode(): string {
  let code = '';
  for (let i = 0; i < PAIRING_CODE_LENGTH; i++)
    code += PAIRING_ALPHABET.charAt(randomInt(PAIRING_ALPHABET.length));
  return code;
}

export function pairingRoutes(pool: Pool, deps: { limiter?: Limiter } = {}): Route[] {
  const limiter = deps.limiter ?? new SharedRateLimiter(pool, 'pairing', 10, 15 * 60_000); // [PCODE-363 | S15 | v0.1.0]

  const create = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/devices/pairing',
    summary:
      'A pairing code for signing in on a phone: 10 minutes, once; replaces your earlier unused codes (member)',
    tags: ['tokens'],
    params: s.object({ workspaceId: s.string({ format: 'uuid' }) }),
    response: s.object({ code: s.string(), expiresAt: s.string(), minutes: s.number() }),
    status: 201,
    handler: async ({ params, req }) => {
      const { a, policy } = await asMember(
        pool,
        req,
        params.workspaceId,
        'member',
        async (c, acc) => ({
          a: acc,
          policy: (
            await c.query<{ max_days_personal: number; require_expiry: boolean }>(
              'SELECT max_days_personal, require_expiry FROM token_policies',
            )
          ).rows[0] ?? { max_days_personal: 90, require_expiry: true },
        }),
      );
      const code = newCode();
      const expires = new Date(Date.now() + PAIRING_MINUTES * 60_000);
      const tokenExpires = policy.require_expiry
        ? new Date(Date.now() + policy.max_days_personal * 86_400_000)
        : null;
      await inSystem(pool, async (c) => {
        await c.query(
          'DELETE FROM device_pairings WHERE user_id = $1 AND workspace_id = $2 AND used_at IS NULL',
          [a.user.id, a.workspaceId],
        );
        await c.query(
          `INSERT INTO device_pairings (workspace_id, user_id, code_hash, expires_at, token_expires_at)
           VALUES ($1, $2, $3, $4, $5)`,
          [a.workspaceId, a.user.id, sha256(code), expires, tokenExpires],
        );
      });
      return {
        status: 201,
        body: { code, expiresAt: expires.toISOString(), minutes: PAIRING_MINUTES },
      };
    },
  });

  const redeem = route({
    method: 'POST',
    path: '/auth/devices/pair',
    summary:
      'Redeem a pairing code for a device token bound to its workspace (public, rate-limited)',
    tags: ['auth'],
    body: s.object({
      code: s.string({ min: 1, max: 20 }),
      device: s.string({ min: 1, max: 60 }),
    }),
    response: s.object({
      token: s.string(),
      tokenId: s.string(),
      expiresAt: s.nullable(s.string()),
      workspace: s.object({ id: s.string(), name: s.string() }),
      user: s.object({ id: s.string(), name: s.string(), email: s.string() }),
    }),
    handler: async ({ body, req }) => {
      const key = 'pair:' + clientIp(req);
      if (!(await limiter.allowed(key)))
        throw new HttpError(
          429,
          'too_many_requests',
          'Too many pairing attempts from this address; try again in a quarter of an hour',
        );
      const code = normalizePairingCode(body.code);
      const device = body.device.trim().replace(/\s+/g, ' ');
      if (!device) throw new HttpError(400, 'invalid_request', 'Name the device');
      // claims the code in one statement, so two phones racing for it cannot both win
      const claimed = code
        ? await inSystem(
            pool,
            async (c) =>
              (
                await c.query<{
                  id: string;
                  workspace_id: string;
                  user_id: string;
                  token_expires_at: Date | null;
                }>(
                  `UPDATE device_pairings SET used_at = now(), device = $2
                   WHERE code_hash = $1 AND used_at IS NULL AND expires_at > now()
                     AND EXISTS (SELECT 1 FROM workspace_members m
                                 WHERE m.workspace_id = device_pairings.workspace_id
                                   AND m.user_id = device_pairings.user_id)
                   RETURNING id, workspace_id, user_id, token_expires_at`,
                  [sha256(code), device],
                )
              ).rows[0],
          )
        : undefined;
      if (!claimed) {
        await limiter.fail(key);
        throw new HttpError(
          400,
          'invalid_request',
          'This code is not valid: it may be mistyped, used or older than 10 minutes',
        );
      }
      const name = 'Phone: ' + device;
      const t = await createApiToken(pool, claimed.user_id, name, {
        kind: 'personal',
        workspaceId: claimed.workspace_id,
        scopes: DEVICE_SCOPES,
        expiresAt: claimed.token_expires_at,
      });
      const who = await inSystem(pool, async (c) => {
        await c.query('UPDATE device_pairings SET token_id = $2 WHERE id = $1', [claimed.id, t.id]);
        return (
          await c.query<{ ws_name: string; name: string; email: string }>(
            `SELECT w.name AS ws_name, u.name, u.email FROM workspaces w, users u
             WHERE w.id = $1 AND u.id = $2`,
            [claimed.workspace_id, claimed.user_id],
          )
        ).rows[0];
      });
      if (!who) throw new HttpError(400, 'invalid_request', 'This code is not valid any more');
      await inSystem(pool, (c) =>
        recordEvent(c, claimed.workspace_id, {
          actor: { kind: 'user', id: claimed.user_id, name: who.name },
          verb: 'created',
          object: { type: 'member', id: claimed.user_id, label: who.name },
          changes: { token: { from: null, to: name } },
        }),
      );
      return {
        body: {
          token: t.token,
          tokenId: t.id,
          expiresAt: claimed.token_expires_at?.toISOString() ?? null,
          workspace: { id: claimed.workspace_id, name: who.ws_name },
          user: { id: claimed.user_id, name: who.name, email: who.email },
        },
      };
    },
  });

  return [create, redeem];
}
