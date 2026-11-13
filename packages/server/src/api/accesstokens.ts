// ── [PCODE-224 | S15 | v0.1.0] T21.1 Phone sign-in by pairing code, device tokens, QR code in the web app ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-181 | S15 | v0.1.0] B5.2 Tokens and costs live: AI spend, budgets, prices, provider keys per project, access tokens with scopes, policy, leak revocation ──
//    Why:  the access half of Tokens and costs: every token that can reach the workspace. People make
//          tokens bound to the workspace with scopes and an expiry the policy allows; broad scopes wait for
//          an admin; service accounts and runners get tokens of their own; a token rotates with a day of
//          overlap or is revoked at once. Admins see every token, its last use (time, address, count) and
//          the leaks that revoked one.
import { BROAD_SCOPES, isIpRule, TOKEN_SCOPES, type TokenKind } from '@orqiva/shared';
import { randomBytes } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { createApiToken } from '../auth/sessions.js';
import { inSystem } from '../db/pool.js';
import { recordEvent } from '../events/outbox.js';
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s } from '../http/schema.js';
import { actorOf, asMember, atLeast, type Access } from './access.js';

const uuid = s.string({ format: 'uuid' });
const wsParams = s.object({ workspaceId: uuid });
const tokenParams = s.object({ workspaceId: uuid, tokenId: uuid });
const STALE_DAYS = 60;

interface Policy {
  max_days_personal: number;
  max_days_service: number;
  require_expiry: boolean;
  approve_broad_scopes: boolean;
  ip_allow: string[];
  revoke_unused_days: number | null;
}
const DEFAULT_POLICY: Policy = {
  max_days_personal: 90,
  max_days_service: 365,
  require_expiry: true,
  approve_broad_scopes: true,
  ip_allow: [],
  revoke_unused_days: null,
};
const policyOf = async (c: PoolClient): Promise<Policy> =>
  (await c.query<Policy>('SELECT * FROM token_policies')).rows[0] ?? DEFAULT_POLICY;

const tokenOut = s.object({
  id: s.string(),
  name: s.string(),
  kind: s.string(),
  ownerId: s.string(),
  ownerName: s.string(),
  isService: s.boolean(),
  boundToWorkspace: s.boolean(),
  scopes: s.array(s.string()),
  state: s.string(),
  createdAt: s.string(),
  expiresAt: s.nullable(s.string()),
  lastUsedAt: s.nullable(s.string()),
  lastUsedIp: s.nullable(s.string()),
  useCount: s.number({ integer: true }),
  revokedAt: s.nullable(s.string()),
  stale: s.boolean(),
  mine: s.boolean(),
});
interface TokenRow {
  id: string;
  name: string;
  kind: string;
  user_id: string;
  owner_name: string;
  is_service: boolean;
  workspace_id: string | null;
  scopes: string[];
  state: string;
  created_at: Date;
  expires_at: Date | null;
  last_used_at: Date | null;
  last_used_ip: string | null;
  use_count: string;
  revoked_at: Date | null;
}
const tokenJson = (t: TokenRow, me: string) => ({
  id: t.id,
  name: t.name,
  kind: t.kind,
  ownerId: t.user_id,
  ownerName: t.owner_name,
  isService: t.is_service,
  boundToWorkspace: t.workspace_id !== null,
  scopes: t.scopes,
  state: t.state,
  createdAt: t.created_at.toISOString(),
  expiresAt: t.expires_at?.toISOString() ?? null,
  lastUsedAt: t.last_used_at?.toISOString() ?? null,
  lastUsedIp: t.last_used_ip,
  useCount: Number(t.use_count),
  revokedAt: t.revoked_at?.toISOString() ?? null,
  stale:
    !t.revoked_at &&
    Date.now() - (t.last_used_at ?? t.created_at).getTime() > STALE_DAYS * 86_400_000,
  mine: t.user_id === me,
});
const TOKEN_SELECT = `SELECT t.id, t.name, t.kind, t.user_id, u.name AS owner_name, u.is_service, t.workspace_id, t.scopes, t.state, t.created_at, t.expires_at,
                             t.last_used_at, t.last_used_ip, t.use_count, t.revoked_at
                        FROM api_tokens t JOIN users u ON u.id = t.user_id`;

function checkScopes(scopes: readonly string[]): void {
  const bad = scopes.filter((x) => !(TOKEN_SCOPES as readonly string[]).includes(x));
  if (bad.length)
    throw new HttpError(400, 'invalid_request', 'Unknown scopes: ' + bad.join(', '), [
      { path: 'body.scopes', message: 'has unknown scopes' },
    ]);
  if (!scopes.length)
    throw new HttpError(400, 'invalid_request', 'A token needs at least one scope', [
      { path: 'body.scopes', message: 'is empty' },
    ]);
}

function expiryOf(days: number | null | undefined, max: number, required: boolean): Date | null {
  if (days === undefined || days === null) {
    if (required) return new Date(Date.now() + max * 86_400_000);
    return null;
  }
  if (days > max)
    throw new HttpError(
      400,
      'invalid_request',
      'The policy allows at most ' + String(max) + ' days',
      [{ path: 'body.expiresInDays', message: 'is longer than the policy allows' }],
    );
  return new Date(Date.now() + days * 86_400_000);
}

/** A token of this workspace (bound to it, or a member's) that the caller may change. */
async function changeable(pool: Pool, a: Access, tokenId: string): Promise<TokenRow> {
  const t = await inSystem(
    pool,
    async (c) => (await c.query<TokenRow>(TOKEN_SELECT + ' WHERE t.id = $1', [tokenId])).rows[0],
  );
  if (!t || (t.workspace_id !== a.workspaceId && t.user_id !== a.user.id))
    throw new HttpError(404, 'not_found', 'Token not found');
  if (t.user_id !== a.user.id && !atLeast(a.role, 'admin'))
    throw new HttpError(403, 'forbidden', 'Only the token’s owner or an admin changes it');
  return t;
}

export function accessTokenRoutes(pool: Pool): Route[] {
  const list = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/access-tokens',
    summary:
      'Tokens that reach the workspace: your own; admins see everyone’s, service accounts and runners (member)',
    tags: ['tokens'],
    params: wsParams,
    query: s.object({ revoked: s.optional(s.enum(['1'])) }),
    response: s.array(tokenOut),
    handler: async ({ params, query, req }) => {
      const a = await asMember(pool, req, params.workspaceId, 'member', (_c, acc) =>
        Promise.resolve(acc),
      );
      const all = atLeast(a.role, 'admin');
      const rows = await inSystem(
        pool,
        async (c) =>
          (
            await c.query<TokenRow>(
              TOKEN_SELECT +
                ` WHERE (t.workspace_id = $1 OR (t.workspace_id IS NULL AND t.user_id IN (SELECT user_id FROM workspace_members WHERE workspace_id = $1)))
                 AND ($2 OR t.user_id = $3) AND ($4 OR t.revoked_at IS NULL)
               ORDER BY t.revoked_at NULLS FIRST, t.state DESC, t.created_at DESC LIMIT 500`,
              [a.workspaceId, all, a.user.id, query.revoked === '1'],
            )
          ).rows,
      );
      return { body: rows.map((t) => tokenJson(t, a.user.id)) };
    },
  });

  const create = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/access-tokens',
    summary:
      'A personal token bound to this workspace, with scopes and an expiry the policy allows; shown once (member)',
    tags: ['tokens'],
    params: wsParams,
    body: s.object({
      name: s.string({ min: 1, max: 80 }),
      scopes: s.array(s.string({ max: 20 }), { max: 10 }),
      expiresInDays: s.optional(s.nullable(s.number({ integer: true, min: 1, max: 730 }))),
    }),
    response: s.object({ id: s.string(), token: s.string(), state: s.string() }),
    status: 201,
    handler: async ({ params, body, req }) => {
      const { a, policy } = await asMember(
        pool,
        req,
        params.workspaceId,
        'member',
        async (c, acc) => ({ a: acc, policy: await policyOf(c) }),
      );
      checkScopes(body.scopes);
      const expires = expiryOf(body.expiresInDays, policy.max_days_personal, policy.require_expiry);
      const broad = body.scopes.some((x) => (BROAD_SCOPES as readonly string[]).includes(x));
      if (body.scopes.includes('admin') && !atLeast(a.role, 'admin'))
        throw new HttpError(403, 'forbidden', 'Only an admin can hold the admin scope');
      const pending = broad && policy.approve_broad_scopes && !atLeast(a.role, 'admin');
      const t = await createApiToken(pool, a.user.id, body.name.trim(), {
        kind: 'personal',
        workspaceId: a.workspaceId,
        scopes: [...new Set(body.scopes)],
        expiresAt: expires,
        pending,
      });
      return {
        status: 201,
        body: { id: t.id, token: t.token, state: pending ? 'pending' : 'active' },
      };
    },
  });

  const service = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/service-accounts',
    summary:
      'A service account (a user that is not a person) or a runner, with a role and its first token; shown once (admin)',
    tags: ['tokens'],
    params: wsParams,
    body: s.object({
      name: s.string({ min: 1, max: 80 }),
      kind: s.enum(['service', 'runner']),
      role: s.enum(['member', 'tester', 'auditor', 'guest']),
      scopes: s.array(s.string({ max: 20 }), { max: 10 }),
      expiresInDays: s.optional(s.nullable(s.number({ integer: true, min: 1, max: 730 }))),
    }),
    response: s.object({ userId: s.string(), id: s.string(), token: s.string() }),
    status: 201,
    handler: async ({ params, body, req }) => {
      const { a, policy } = await asMember(
        pool,
        req,
        params.workspaceId,
        'admin',
        async (c, acc) => ({ a: acc, policy: await policyOf(c) }),
      );
      checkScopes(body.scopes);
      if (body.scopes.includes('admin'))
        throw new HttpError(
          400,
          'invalid_request',
          'A service account cannot hold the admin scope',
          [{ path: 'body.scopes', message: 'has admin' }],
        );
      const expires = expiryOf(body.expiresInDays, policy.max_days_service, policy.require_expiry);
      const userId = await inSystem(pool, async (c) => {
        const id = (
          await c.query<{ id: string }>(
            'INSERT INTO users (email, name, is_service) VALUES ($1, $2, true) RETURNING id',
            [
              body.kind + '-' + randomBytes(6).toString('hex') + '@service.orqiva.invalid',
              body.name.trim(),
            ],
          )
        ).rows[0]?.id;
        if (!id) throw new Error('service user insert returned nothing');
        await c.query(
          'INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, $3)',
          [a.workspaceId, id, body.role],
        );
        return id;
      });
      const t = await createApiToken(pool, userId, body.name.trim(), {
        kind: body.kind as TokenKind,
        workspaceId: a.workspaceId,
        scopes: [...new Set(body.scopes)],
        expiresAt: expires,
        createdBy: a.user.id,
      });
      return { status: 201, body: { userId, id: t.id, token: t.token } };
    },
  });

  const approve = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/access-tokens/:tokenId/approve',
    summary: 'Let a token with broad scopes work (admin)',
    tags: ['tokens'],
    params: tokenParams,
    response: tokenOut,
    handler: async ({ params, req }) => {
      const a = await asMember(pool, req, params.workspaceId, 'admin', (_c, acc) =>
        Promise.resolve(acc),
      );
      const t = await changeable(pool, a, params.tokenId);
      if (t.user_id === a.user.id)
        throw new HttpError(409, 'conflict', 'Another admin approves your token');
      const row = await inSystem(pool, async (c) => {
        await c.query(
          "UPDATE api_tokens SET state = 'active', approved_by = $2 WHERE id = $1 AND state = 'pending'",
          [t.id, a.user.id],
        );
        return (await c.query<TokenRow>(TOKEN_SELECT + ' WHERE t.id = $1', [t.id])).rows[0];
      });
      if (!row) throw new HttpError(404, 'not_found', 'Token not found');
      return { body: tokenJson(row, a.user.id) };
    },
  });

  const revoke = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/access-tokens/:tokenId/revoke',
    summary: 'Stop a token at once (its owner, or an admin for the workspace’s tokens)',
    tags: ['tokens'],
    params: tokenParams,
    response: tokenOut,
    handler: async ({ params, req }) => {
      const a = await asMember(pool, req, params.workspaceId, 'member', (_c, acc) =>
        Promise.resolve(acc),
      );
      const t = await changeable(pool, a, params.tokenId);
      if (t.workspace_id === null && t.user_id !== a.user.id)
        throw new HttpError(
          403,
          'forbidden',
          'This token reaches all of its owner’s workspaces; only the owner revokes it',
        );
      // [PCODE-224 | S15 | v0.1.0] the event goes in with the revocation: a token that revokes itself (a
      // phone signing out) no longer signs in for a second step
      const row = await inSystem(pool, async (c) => {
        await c.query(
          'UPDATE api_tokens SET revoked_at = coalesce(revoked_at, now()) WHERE id = $1',
          [t.id],
        );
        await recordEvent(c, a.workspaceId, {
          actor: actorOf(a),
          verb: 'deleted',
          object: { type: 'member', id: t.user_id, label: t.owner_name },
          changes: { token: { from: t.name, to: null } },
        });
        return (await c.query<TokenRow>(TOKEN_SELECT + ' WHERE t.id = $1', [t.id])).rows[0];
      });
      if (!row) throw new HttpError(404, 'not_found', 'Token not found');
      return { body: tokenJson(row, a.user.id) };
    },
  });

  const rotate = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/access-tokens/:tokenId/rotate',
    summary:
      'A new token with the same name, kind and scopes; the old one keeps working for one more day; shown once',
    tags: ['tokens'],
    params: tokenParams,
    response: s.object({ id: s.string(), token: s.string() }),
    status: 201,
    handler: async ({ params, req }) => {
      const { a, policy } = await asMember(
        pool,
        req,
        params.workspaceId,
        'member',
        async (c, acc) => ({ a: acc, policy: await policyOf(c) }),
      );
      const t = await changeable(pool, a, params.tokenId);
      if (t.revoked_at)
        throw new HttpError(409, 'conflict', 'A revoked token is not rotated; make a new one');
      if (t.workspace_id !== a.workspaceId)
        throw new HttpError(409, 'conflict', 'Only tokens bound to this workspace rotate here');
      const max = t.kind === 'personal' ? policy.max_days_personal : policy.max_days_service;
      const fresh = await createApiToken(pool, t.user_id, t.name, {
        kind: t.kind as TokenKind,
        workspaceId: t.workspace_id,
        scopes: t.scopes,
        expiresAt: new Date(Date.now() + max * 86_400_000),
        createdBy: a.user.id,
      });
      await inSystem(pool, (c) =>
        c.query(
          "UPDATE api_tokens SET expires_at = least(coalesce(expires_at, 'infinity'), now() + interval '1 day') WHERE id = $1",
          [t.id],
        ),
      );
      return { status: 201, body: fresh };
    },
  });

  const policyOut = s.object({
    maxDaysPersonal: s.number({ integer: true }),
    maxDaysService: s.number({ integer: true }),
    requireExpiry: s.boolean(),
    approveBroadScopes: s.boolean(),
    ipAllow: s.array(s.string()),
    revokeUnusedDays: s.nullable(s.number({ integer: true })),
  });
  const policyJson = (p: Policy) => ({
    maxDaysPersonal: p.max_days_personal,
    maxDaysService: p.max_days_service,
    requireExpiry: p.require_expiry,
    approveBroadScopes: p.approve_broad_scopes,
    ipAllow: p.ip_allow,
    revokeUnusedDays: p.revoke_unused_days,
  });
  const getPolicy = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/token-policy',
    summary: 'The workspace’s token policy (member)',
    tags: ['tokens'],
    params: wsParams,
    response: policyOut,
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c) => ({
        body: policyJson(await policyOf(c)),
      })),
  });
  const setPolicy = route({
    method: 'PUT',
    path: '/api/workspaces/:workspaceId/token-policy',
    summary:
      'Set the token policy: lifetimes, expiry, approval of broad scopes, IP allow-list, unused tokens (admin)',
    tags: ['tokens'],
    params: wsParams,
    body: s.object({
      maxDaysPersonal: s.number({ integer: true, min: 1, max: 730 }),
      maxDaysService: s.number({ integer: true, min: 1, max: 730 }),
      requireExpiry: s.boolean(),
      approveBroadScopes: s.boolean(),
      ipAllow: s.array(s.string({ max: 50 }), { max: 50 }),
      revokeUnusedDays: s.nullable(s.number({ integer: true, min: 7, max: 730 })),
    }),
    response: policyOut,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'admin', async (c, a) => {
        const bad = body.ipAllow.filter((r) => !isIpRule(r.trim()));
        if (bad.length)
          throw new HttpError(
            400,
            'invalid_request',
            'Not an address or range: ' + bad.join(', '),
            [{ path: 'body.ipAllow', message: 'has entries that are not addresses' }],
          );
        await c.query(
          `INSERT INTO token_policies (workspace_id, max_days_personal, max_days_service, require_expiry, approve_broad_scopes, ip_allow, revoke_unused_days, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, now())
           ON CONFLICT (workspace_id) DO UPDATE SET max_days_personal = $2, max_days_service = $3, require_expiry = $4, approve_broad_scopes = $5, ip_allow = $6, revoke_unused_days = $7, updated_at = now()`,
          [
            a.workspaceId,
            body.maxDaysPersonal,
            body.maxDaysService,
            body.requireExpiry,
            body.approveBroadScopes,
            body.ipAllow.map((r) => r.trim()),
            body.revokeUnusedDays,
          ],
        );
        return { body: policyJson(await policyOf(c)) };
      }),
  });

  const leaks = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/token-leaks',
    summary: 'Tokens found where others can read them, and when they were revoked (admin)',
    tags: ['tokens'],
    params: wsParams,
    response: s.array(
      s.object({
        id: s.string(),
        tokenName: s.string(),
        ownerName: s.nullable(s.string()),
        foundIn: s.string(),
        location: s.string(),
        foundAt: s.string(),
        revokedAt: s.nullable(s.string()),
      }),
    ),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'admin', async (c) => {
        const rows = (
          await c.query<{
            id: string;
            token_name: string;
            owner: string | null;
            found_in: string;
            location: string;
            found_at: Date;
            revoked_at: Date | null;
          }>(
            'SELECT l.id, l.token_name, u.name AS owner, l.found_in, l.location, l.found_at, l.revoked_at FROM token_leaks l LEFT JOIN users u ON u.id = l.user_id ORDER BY l.found_at DESC LIMIT 200',
          )
        ).rows;
        return {
          body: rows.map((r) => ({
            id: r.id,
            tokenName: r.token_name,
            ownerName: r.owner,
            foundIn: r.found_in,
            location: r.location,
            foundAt: r.found_at.toISOString(),
            revokedAt: r.revoked_at?.toISOString() ?? null,
          })),
        };
      }),
  });

  return [list, create, service, approve, revoke, rotate, getPolicy, setPolicy, leaks];
}
