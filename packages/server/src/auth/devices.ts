// ── [PCODE-182 | S15 | v0.1.0] B5.3 People live: members, teams, roles, sign-in rules and sessions, access reviews, access checker, offboarding ──
//    Why:  a person sees where they are signed in (browser and device, address, when last seen) and ends a
//          session they do not recognise, or every session but the one in hand.
import type { Pool } from 'pg';
import { inSystem } from '../db/pool.js';
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s } from '../http/schema.js';
import { currentUser, sessionOf } from './sessions.js';

const sessionOut = s.object({
  id: s.string(),
  device: s.string(),
  ip: s.string(),
  createdAt: s.string(),
  lastSeenAt: s.string(),
  current: s.boolean(),
});

/** "Edge on Windows" from a user agent; good enough to recognise a device. */
export function deviceOf(ua: string): string {
  if (!ua) return 'Unknown device';
  if (/vscode|Code\//i.test(ua)) return 'VS Code';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Firefox\//.test(ua)
      ? 'Firefox'
      : /Chrome\//.test(ua)
        ? 'Chrome'
        : /Safari\//.test(ua)
          ? 'Safari'
          : /node|undici|curl/i.test(ua)
            ? 'A program'
            : 'A browser';
  const os = /iPhone|iPad/.test(ua)
    ? 'iPhone'
    : /Android/.test(ua)
      ? 'Android'
      : /Windows/.test(ua)
        ? 'Windows'
        : /Mac OS X|Macintosh/.test(ua)
          ? 'macOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : '';
  return browser + (os ? ' on ' + os : '');
}

export function deviceRoutes(pool: Pool): Route[] {
  const me = async (req: Parameters<typeof currentUser>[1]): Promise<string> => {
    const u = await currentUser(pool, req);
    if (!u) throw new HttpError(401, 'unauthorized', 'Sign in first');
    return u.id;
  };
  const list = route({
    method: 'GET',
    path: '/auth/sessions',
    summary: 'Where you are signed in',
    tags: ['auth'],
    response: s.array(sessionOut),
    handler: async ({ req }) => {
      const userId = await me(req);
      const current = sessionOf(req)?.id;
      const rows = await inSystem(
        pool,
        async (c) =>
          (
            await c.query<{
              id: string;
              user_agent: string;
              ip: string;
              created_at: Date;
              last_seen_at: Date;
            }>(
              'SELECT id, user_agent, ip, created_at, last_seen_at FROM sessions WHERE user_id = $1 AND expires_at > now() ORDER BY last_seen_at DESC',
              [userId],
            )
          ).rows,
      );
      return {
        body: rows.map((r) => ({
          id: r.id,
          device: deviceOf(r.user_agent),
          ip: r.ip,
          createdAt: r.created_at.toISOString(),
          lastSeenAt: r.last_seen_at.toISOString(),
          current: r.id === current,
        })),
      };
    },
  });
  const end = route({
    method: 'DELETE',
    path: '/auth/sessions/:sessionId',
    summary: 'End one of your sessions',
    tags: ['auth'],
    params: s.object({ sessionId: s.string({ format: 'uuid' }) }),
    response: s.object({ ended: s.number({ integer: true }) }),
    handler: async ({ params, req }) => {
      const userId = await me(req);
      const n = await inSystem(
        pool,
        async (c) =>
          (
            await c.query('DELETE FROM sessions WHERE id = $1 AND user_id = $2', [
              params.sessionId,
              userId,
            ])
          ).rowCount ?? 0,
      );
      return { body: { ended: n } };
    },
  });
  const others = route({
    method: 'POST',
    path: '/auth/sessions/end-others',
    summary: 'End every session but this one',
    tags: ['auth'],
    response: s.object({ ended: s.number({ integer: true }) }),
    handler: async ({ req }) => {
      const userId = await me(req);
      const current = sessionOf(req)?.id ?? null;
      const n = await inSystem(
        pool,
        async (c) =>
          (
            await c.query(
              'DELETE FROM sessions WHERE user_id = $1 AND ($2::uuid IS NULL OR id <> $2)',
              [userId, current],
            )
          ).rowCount ?? 0,
      );
      return { body: { ended: n } };
    },
  });
  return [list, end, others];
}
