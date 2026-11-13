// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-162 | S15 | v0.1.0] B1.1 Live shell server: inbox, notification rules, settings inheritance, shell summary ──
// ── [PCODE-151 | S15 | v0.1.0] Make the web app an installable PWA with Web Push ──
//    Why:  a person's devices and choices: the key a browser subscribes with, adding and removing this
//          device, which of the four notifications they want, and a test message to see that it works.
import type { Pool } from 'pg';
import { SecretKeyMissing } from '../agents/secrets.js';
import { currentUser } from '../auth/sessions.js';
import { inSystem } from '../db/pool.js';
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s } from '../http/schema.js';
import {
  allowedEndpoint,
  deliver,
  PUSH_KINDS,
  startCursors,
  vapidKeys,
  type PushDeps,
  type PushKind,
} from '../push/dispatch.js';
import type { VapidKeys } from '../push/webpush.js';

const prefsSchema = s.object({
  approvals: s.boolean(),
  gates: s.boolean(),
  deploys: s.boolean(),
  mentions: s.boolean(),
});
type Prefs = Record<PushKind, boolean>;

export function pushRoutes(pool: Pool, deps: PushDeps & { subject: string }): Route[] {
  const signedIn = async (req: Parameters<typeof currentUser>[1]) => {
    const u = await currentUser(pool, req);
    if (!u) throw new HttpError(401, 'unauthorized', 'Sign in first');
    return u;
  };
  let keys: Promise<VapidKeys> | null = null;
  const loadKeys = (): Promise<VapidKeys> => {
    keys ??= vapidKeys(pool).catch((e: unknown) => {
      keys = null;
      throw e;
    });
    return keys;
  };
  const publicKey = async (): Promise<string | null> => {
    try {
      return (await loadKeys()).publicKey;
    } catch (e) {
      if (e instanceof SecretKeyMissing) return null;
      throw e;
    }
  };

  const get = route({
    method: 'GET',
    path: '/api/push',
    summary:
      'The key browsers subscribe with (null when the server has no secret key), your devices and choices',
    tags: ['push'],
    response: s.object({
      publicKey: s.nullable(s.string()),
      devices: s.array(
        s.object({
          id: s.string(),
          device: s.string(),
          endpoint: s.string(),
          createdAt: s.string(),
          lastOkAt: s.nullable(s.string()),
        }),
      ),
      preferences: prefsSchema,
    }),
    handler: async ({ req }) => {
      const u = await signedIn(req);
      const key = await publicKey();
      return inSystem(pool, async (c) => {
        const devices = (
          await c.query<{
            id: string;
            device: string;
            endpoint: string;
            created_at: Date;
            last_ok_at: Date | null;
          }>(
            'SELECT id, device, endpoint, created_at, last_ok_at FROM push_subscriptions WHERE user_id = $1 ORDER BY created_at',
            [u.id],
          )
        ).rows;
        // [PCODE-162 | S15 | v0.1.0] phone notifications follow the notification rules: a kind is on unless
        // a rule in one of the person's workspaces leaves the phone out
        const off = (
          await c.query<{ event_kind: string }>(
            "SELECT DISTINCT event_kind FROM notification_rules WHERE user_id = $1 AND NOT ('push' = ANY (channels))",
            [u.id],
          )
        ).rows.map((r) => r.event_kind);
        const p: Prefs = { approvals: true, gates: true, deploys: true, mentions: true };
        for (const k of PUSH_KINDS) p[k] = !off.includes(k);
        return {
          body: {
            publicKey: key,
            devices: devices.map((d) => ({
              id: d.id,
              device: d.device,
              endpoint: d.endpoint,
              createdAt: d.created_at.toISOString(),
              lastOkAt: d.last_ok_at?.toISOString() ?? null,
            })),
            preferences: p,
          },
        };
      });
    },
  });

  const subscribe = route({
    method: 'POST',
    path: '/api/push/subscriptions',
    summary: 'Add this device: the subscription the browser made with our key',
    tags: ['push'],
    body: s.object({
      endpoint: s.string({ max: 2000 }),
      keys: s.object({ p256dh: s.string({ max: 200 }), auth: s.string({ max: 100 }) }),
      device: s.optional(s.string({ max: 200 })),
    }),
    response: s.object({ id: s.string() }),
    status: 201,
    handler: async ({ body, req }) => {
      const u = await signedIn(req);
      let url: URL;
      try {
        url = new URL(body.endpoint);
      } catch {
        throw new HttpError(400, 'invalid_request', 'The endpoint is not an address');
      }
      if (!allowedEndpoint(url, deps))
        throw new HttpError(
          400,
          'invalid_request',
          'That is not a push service this server sends to',
        );
      const p256 = Buffer.from(body.keys.p256dh, 'base64url');
      const auth = Buffer.from(body.keys.auth, 'base64url');
      if (p256.length !== 65 || p256[0] !== 4 || auth.length !== 16)
        throw new HttpError(
          400,
          'invalid_request',
          'The subscription keys are not P-256 and 16 bytes',
        );
      return inSystem(pool, async (c) => {
        // the same browser subscribing again (or after another person used it) becomes this person's
        const id = (
          await c.query<{ id: string }>(
            `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, device) VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (endpoint) DO UPDATE SET user_id = $1, p256dh = $3, auth = $4, device = $5, created_at = now()
             RETURNING id`,
            [u.id, body.endpoint, body.keys.p256dh, body.keys.auth, body.device ?? ''],
          )
        ).rows[0]?.id;
        if (!id) throw new Error('subscription insert returned nothing');
        await startCursors(c, null, u.id);
        return { status: 201, body: { id } };
      });
    },
  });

  const unsubscribe = route({
    method: 'POST',
    path: '/api/push/unsubscribe',
    summary: 'Remove a device, by its subscription address or its id',
    tags: ['push'],
    body: s.object({ endpoint: s.optional(s.string({ max: 2000 })), id: s.optional(s.string()) }),
    response: s.object({ removed: s.number({ integer: true }) }),
    handler: async ({ body, req }) => {
      const u = await signedIn(req);
      if (!body.endpoint && !body.id)
        throw new HttpError(400, 'invalid_request', 'Name the device: endpoint or id');
      return inSystem(pool, async (c) => {
        const r = await c.query(
          `DELETE FROM push_subscriptions WHERE user_id = $1
             AND (endpoint = $2 OR id::text = $3)`,
          [u.id, body.endpoint ?? null, body.id ?? null],
        );
        return { body: { removed: r.rowCount ?? 0 } };
      });
    },
  });

  const setPrefs = route({
    method: 'PUT',
    path: '/api/push/preferences',
    summary: 'Choose which notifications reach your devices',
    tags: ['push'],
    body: prefsSchema,
    response: prefsSchema,
    handler: async ({ body, req }) => {
      const u = await signedIn(req);
      // [PCODE-162 | S15 | v0.1.0] the phone channel of each kind, in every workspace of the person
      await inSystem(pool, async (c) => {
        for (const k of PUSH_KINDS)
          await c.query(
            `INSERT INTO notification_rules (workspace_id, user_id, event_kind, channels)
             SELECT m.workspace_id, $1, $2, CASE WHEN $3 THEN ARRAY['in_app', 'push'] ELSE ARRAY['in_app'] END
             FROM workspace_members m WHERE m.user_id = $1
             ON CONFLICT (workspace_id, user_id, event_kind) DO UPDATE SET channels =
               CASE WHEN $3 THEN array(SELECT DISTINCT unnest(notification_rules.channels || ARRAY['push']))
                    ELSE array_remove(notification_rules.channels, 'push') END`,
            [u.id, k, body[k]],
          );
      });
      const out = {} as Prefs;
      for (const k of PUSH_KINDS) out[k] = body[k];
      return { body: out };
    },
  });

  const test = route({
    method: 'POST',
    path: '/api/push/test',
    summary: 'Send a test notification to all your devices',
    tags: ['push'],
    response: s.object({ sent: s.number({ integer: true }), devices: s.number({ integer: true }) }),
    handler: async ({ req }) => {
      const u = await signedIn(req);
      if (!(await publicKey()))
        throw new HttpError(409, 'conflict', 'Set ORQIVA_SECRET_KEY on the server first');
      const subs = await inSystem(
        pool,
        async (c) =>
          (
            await c.query<{ id: string; endpoint: string; p256dh: string; auth: string }>(
              'SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1',
              [u.id],
            )
          ).rows,
      );
      const sent = await deliver(
        pool,
        subs.map((sub) => ({
          sub,
          payload: {
            title: 'Orqiva notifications work',
            body: 'This device will tell you when something needs you.',
            url: '/settings/notifications',
            tag: 'test',
          },
        })),
        { ...deps, keys: loadKeys },
      );
      return { body: { sent, devices: subs.length } };
    },
  });

  return [get, subscribe, unsubscribe, setPrefs, test];
}
