// ── [PCODE-213 | S15 | v0.1.0] T19.2 SCIM 2.0 provisioning (users, role groups, suspend on deactivate) and identity settings (SAML, SCIM tokens) ──
//    Why:  a company's directory decides who works in its workspace. Its identity provider talks SCIM 2.0
//          (RFC 7643/7644) to /scim/v2 with a SCIM token: it creates people (found by email when they
//          exist), changes them, deactivates them (the membership is suspended and their tokens for the
//          workspace revoked, as offboarding does) and removes them. Groups are the workspace roles, so
//          adding someone to the "admin" group makes them an admin. Errors come back the SCIM way.
import { createHash, randomBytes } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Pool, PoolClient } from 'pg';
import { inSystem } from '../db/pool.js';
import { recordEvent } from '../events/outbox.js';
import { HttpError } from '../http/errors.js';
import { route, type Reply, type Route } from '../http/router.js';
import { s } from '../http/schema.js';
import { checkSeat, requireFeature } from '../licence/licence.js';
import { asMember } from './access.js';

const USER = 'urn:ietf:params:scim:schemas:core:2.0:User';
const GROUP = 'urn:ietf:params:scim:schemas:core:2.0:Group';
const LIST = 'urn:ietf:params:scim:api:messages:2.0:ListResponse';
const ERROR = 'urn:ietf:params:scim:api:messages:2.0:Error';
const PATCH = 'urn:ietf:params:scim:api:messages:2.0:PatchOp';
/** the roles a directory may give through groups; owner stays with people */
export const SCIM_ROLES = [
  'admin',
  'member',
  'tester',
  'designer',
  'billing',
  'auditor',
  'guest',
] as const;
const CT = { 'content-type': 'application/scim+json' };
const hash = (t: string): string => createHash('sha256').update(t).digest('hex');

class ScimError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly scimType?: string,
  ) {
    super(message);
  }
}

interface Ctx {
  c: PoolClient;
  ws: string;
  base: string;
}

/** The workspace of a SCIM token (Bearer), or a 401. */
async function workspaceOf(pool: Pool, req: IncomingMessage): Promise<string> {
  const token = /^Bearer (orq_scim_[A-Za-z0-9_-]{43})$/.exec(req.headers.authorization ?? '')?.[1];
  if (!token) throw new ScimError(401, 'Send the SCIM token as Bearer');
  const ws = await inSystem(
    pool,
    async (c) =>
      (
        await c.query<{ workspace_id: string }>(
          'UPDATE scim_tokens SET last_used_at = now() WHERE token_hash = $1 AND revoked_at IS NULL RETURNING workspace_id',
          [hash(token)],
        )
      ).rows[0]?.workspace_id,
  );
  if (!ws) throw new ScimError(401, 'The SCIM token is not valid');
  return ws;
}

interface UserRow {
  id: string;
  email: string;
  name: string;
  role: string;
  suspended_at: Date | null;
  external_id: string | null;
  joined_at: Date;
}
const USERS = `SELECT u.id, u.email, u.name, m.role, m.suspended_at, l.external_id, m.created_at AS joined_at
  FROM workspace_members m JOIN users u ON u.id = m.user_id
  LEFT JOIN scim_links l ON l.workspace_id = m.workspace_id AND l.user_id = m.user_id
 WHERE m.workspace_id = $1`;

const userJson = (x: Ctx, r: UserRow) => {
  const [given = '', ...rest] = r.name.split(' ');
  return {
    schemas: [USER],
    id: r.id,
    ...(r.external_id ? { externalId: r.external_id } : {}),
    userName: r.email,
    name: { formatted: r.name, givenName: given, familyName: rest.join(' ') },
    displayName: r.name,
    emails: [{ value: r.email, primary: true, type: 'work' }],
    active: r.suspended_at === null,
    groups: [{ value: r.role, display: r.role }],
    meta: {
      resourceType: 'User',
      created: r.joined_at.toISOString(),
      location: x.base + '/Users/' + r.id,
    },
  };
};

const userOf = async (x: Ctx, id: string): Promise<UserRow> => {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new ScimError(404, 'No such user');
  const r = (await x.c.query<UserRow>(USERS + ' AND u.id = $2', [x.ws, id])).rows[0];
  if (!r) throw new ScimError(404, 'No such user');
  return r;
};

const str = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim() : undefined;
const obj = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};

/** Email and name from a SCIM User. */
function identity(body: Record<string, unknown>): {
  email: string;
  name: string;
  externalId: string | undefined;
  active: boolean;
} {
  const emails = Array.isArray(body['emails']) ? (body['emails'] as unknown[]).map(obj) : [];
  const email = (
    str(body['userName']) ??
    str(emails.find((e) => e['primary'] === true)?.['value']) ??
    str(emails[0]?.['value']) ??
    ''
  ).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new ScimError(400, 'userName must be an email address', 'invalidValue');
  const n = obj(body['name']);
  const name =
    str(body['displayName']) ??
    str(n['formatted']) ??
    ([str(n['givenName']), str(n['familyName'])].filter(Boolean).join(' ') ||
      email.split('@')[0] ||
      email);
  return {
    email,
    name: name.slice(0, 120),
    externalId: str(body['externalId'])?.slice(0, 300),
    active: body['active'] !== false,
  };
}

/** Suspends or lifts a membership; suspending revokes the person's tokens for the workspace. */
async function setActive(x: Ctx, userId: string, active: boolean): Promise<void> {
  const r = await x.c.query(
    active
      ? 'UPDATE workspace_members SET suspended_at = NULL, suspended_by = NULL WHERE workspace_id = $1 AND user_id = $2 AND suspended_at IS NOT NULL'
      : 'UPDATE workspace_members SET suspended_at = now() WHERE workspace_id = $1 AND user_id = $2 AND suspended_at IS NULL',
    [x.ws, userId],
  );
  if (!r.rowCount) return;
  if (!active)
    await x.c.query(
      'UPDATE api_tokens SET revoked_at = now() WHERE user_id = $1 AND workspace_id = $2 AND revoked_at IS NULL',
      [userId, x.ws],
    );
  await recordEvent(x.c, x.ws, {
    actor: { kind: 'integration', id: 'scim', name: 'Directory (SCIM)' },
    verb: 'updated',
    object: { type: 'member', id: userId },
    parent: { type: 'workspace', id: x.ws },
    changes: { suspended: { from: active, to: !active } },
  });
}

async function setRole(x: Ctx, userId: string, role: string): Promise<void> {
  const cur = (
    await x.c.query<{ role: string }>(
      'SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2',
      [x.ws, userId],
    )
  ).rows[0];
  if (!cur) throw new ScimError(404, 'No such user');
  if (cur.role === 'owner')
    throw new ScimError(400, 'The owner’s role is not changed by the directory', 'mutability');
  if (cur.role === role) return;
  await x.c.query(
    'UPDATE workspace_members SET role = $3 WHERE workspace_id = $1 AND user_id = $2',
    [x.ws, userId, role],
  );
  await recordEvent(x.c, x.ws, {
    actor: { kind: 'integration', id: 'scim', name: 'Directory (SCIM)' },
    verb: 'updated',
    object: { type: 'member', id: userId },
    parent: { type: 'workspace', id: x.ws },
    changes: { role: { from: cur.role, to: role } },
  });
}

/** filter=userName eq "a@b.c" (the one filter identity providers send to look someone up). */
function filterEmail(filter: string | undefined): string | null | undefined {
  if (!filter) return undefined;
  const m = /^\s*(userName|emails(?:\.value)?)\s+eq\s+"([^"]*)"\s*$/i.exec(filter);
  if (!m) throw new ScimError(400, 'Only userName eq "…" filters are supported', 'invalidFilter');
  return (m[2] ?? '').toLowerCase();
}

export function scimRoutes(pool: Pool, publicUrl: string): Route[] {
  const base = publicUrl.replace(/\/$/, '') + '/scim/v2';
  /** Runs a SCIM handler in the token's workspace; any failure becomes a SCIM error. */
  const scim = async (
    req: IncomingMessage,
    fn: (x: Ctx) => Promise<{ status?: number; body: Record<string, unknown> }>,
  ): Promise<Reply<Record<string, unknown>>> => {
    try {
      const ws = await workspaceOf(pool, req);
      // system mode: every query here names the token's workspace, and people (users) are created across workspaces
      const out = await inSystem(pool, (c) => fn({ c, ws, base }));
      return { status: out.status ?? 200, body: out.body, headers: CT };
    } catch (e) {
      const st = e instanceof ScimError ? e.status : e instanceof HttpError ? e.status : 500;
      if (st === 500) throw e;
      return {
        status: st,
        body: {
          schemas: [ERROR],
          status: String(st),
          detail: e instanceof Error ? e.message : 'error',
          ...(e instanceof ScimError && e.scimType ? { scimType: e.scimType } : {}),
        },
        headers: CT,
      };
    }
  };
  const any = s.anyObject();
  const idParams = s.object({ id: s.string({ min: 1, max: 80 }) });
  const listQuery = s.object({
    filter: s.optional(s.string({ max: 500 })),
    startIndex: s.optional(s.string({ max: 10 })),
    count: s.optional(s.string({ max: 10 })),
  });

  const spConfig = route({
    method: 'GET',
    path: '/scim/v2/ServiceProviderConfig',
    summary: 'SCIM: what this service provider supports',
    tags: ['scim'],
    response: any,
    handler: () => ({
      headers: CT,
      body: {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig'],
        patch: { supported: true },
        bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
        filter: { supported: true, maxResults: 200 },
        changePassword: { supported: false },
        sort: { supported: false },
        etag: { supported: false },
        authenticationSchemes: [
          {
            type: 'oauthbearertoken',
            name: 'SCIM token',
            description: 'A token made in Settings, Identity',
          },
        ],
      },
    }),
  });

  const resourceTypes = route({
    method: 'GET',
    path: '/scim/v2/ResourceTypes',
    summary: 'SCIM: the resource types (User, Group)',
    tags: ['scim'],
    response: any,
    handler: () => ({
      headers: CT,
      body: {
        schemas: [LIST],
        totalResults: 2,
        Resources: [
          {
            schemas: ['urn:ietf:params:scim:schemas:core:2.0:ResourceType'],
            id: 'User',
            name: 'User',
            endpoint: '/Users',
            schema: USER,
          },
          {
            schemas: ['urn:ietf:params:scim:schemas:core:2.0:ResourceType'],
            id: 'Group',
            name: 'Group',
            endpoint: '/Groups',
            schema: GROUP,
          },
        ],
      },
    }),
  });

  const schemas = route({
    method: 'GET',
    path: '/scim/v2/Schemas',
    summary: 'SCIM: the schemas used',
    tags: ['scim'],
    response: any,
    handler: () => ({
      headers: CT,
      body: {
        schemas: [LIST],
        totalResults: 2,
        Resources: [
          {
            id: USER,
            name: 'User',
            description: 'A person of the workspace; userName is the email',
          },
          { id: GROUP, name: 'Group', description: 'A workspace role' },
        ],
      },
    }),
  });

  const listUsers = route({
    method: 'GET',
    path: '/scim/v2/Users',
    summary: 'SCIM: the people of the workspace (filter userName eq)',
    tags: ['scim'],
    query: listQuery,
    response: any,
    handler: ({ query, req }) =>
      scim(req, async (x) => {
        const email = filterEmail(query.filter);
        const start = Math.max(1, Number(query.startIndex ?? 1) || 1);
        const count = Math.min(200, Math.max(0, Number(query.count ?? 100) || 100));
        const rows = (
          await x.c.query<UserRow>(
            USERS + (email === undefined ? '' : ' AND u.email = $2') + ' ORDER BY m.created_at',
            email === undefined ? [x.ws] : [x.ws, email],
          )
        ).rows;
        return {
          body: {
            schemas: [LIST],
            totalResults: rows.length,
            startIndex: start,
            itemsPerPage: Math.min(count, Math.max(0, rows.length - start + 1)),
            Resources: rows.slice(start - 1, start - 1 + count).map((r) => userJson(x, r)),
          },
        };
      }),
  });

  const getUser = route({
    method: 'GET',
    path: '/scim/v2/Users/:id',
    summary: 'SCIM: one person',
    tags: ['scim'],
    params: idParams,
    response: any,
    handler: ({ params, req }) =>
      scim(req, async (x) => ({ body: userJson(x, await userOf(x, params.id)) })),
  });

  const createUser = route({
    method: 'POST',
    path: '/scim/v2/Users',
    summary: 'SCIM: add a person to the workspace (found by email when they exist)',
    tags: ['scim'],
    body: any,
    response: any,
    status: 201,
    handler: ({ body, req }) =>
      scim(req, async (x) => {
        const who = identity(body);
        let uid = (
          await x.c.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [who.email])
        ).rows[0]?.id;
        if (
          uid &&
          (
            await x.c.query(
              'SELECT 1 FROM workspace_members WHERE workspace_id = $1 AND user_id = $2',
              [x.ws, uid],
            )
          ).rowCount
        )
          throw new ScimError(409, who.email + ' is already in the workspace', 'uniqueness');
        if (!uid)
          uid = (
            await x.c.query<{ id: string }>(
              'INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id',
              [who.email, who.name],
            )
          ).rows[0]?.id;
        if (!uid) throw new Error('user insert returned nothing');
        await checkSeat(x.c, x.ws);
        await x.c.query(
          "INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'member')",
          [x.ws, uid],
        );
        await x.c.query(
          'INSERT INTO scim_links (workspace_id, user_id, external_id) VALUES ($1, $2, $3) ON CONFLICT (workspace_id, user_id) DO UPDATE SET external_id = $3, updated_at = now()',
          [x.ws, uid, who.externalId ?? ''],
        );
        await recordEvent(x.c, x.ws, {
          actor: { kind: 'integration', id: 'scim', name: 'Directory (SCIM)' },
          verb: 'created',
          object: { type: 'member', id: uid, label: who.name },
          parent: { type: 'workspace', id: x.ws },
          changes: { role: { from: null, to: 'member' } },
        });
        if (!who.active) await setActive(x, uid, false);
        return { status: 201, body: userJson(x, await userOf(x, uid)) };
      }),
  });

  const replaceUser = route({
    method: 'PUT',
    path: '/scim/v2/Users/:id',
    summary: 'SCIM: replace a person (name, external ID, active)',
    tags: ['scim'],
    params: idParams,
    body: any,
    response: any,
    handler: ({ params, body, req }) =>
      scim(req, async (x) => {
        const cur = await userOf(x, params.id);
        const who = identity(body);
        if (who.email !== cur.email)
          throw new ScimError(400, 'userName (the email) cannot change here', 'mutability');
        await x.c.query('UPDATE users SET name = $2 WHERE id = $1', [cur.id, who.name]);
        await x.c.query(
          'INSERT INTO scim_links (workspace_id, user_id, external_id) VALUES ($1, $2, $3) ON CONFLICT (workspace_id, user_id) DO UPDATE SET external_id = $3, updated_at = now()',
          [x.ws, cur.id, who.externalId ?? ''],
        );
        await setActive(x, cur.id, who.active);
        return { body: userJson(x, await userOf(x, cur.id)) };
      }),
  });

  const patchUser = route({
    method: 'PATCH',
    path: '/scim/v2/Users/:id',
    summary: 'SCIM: change a person (active, name) with PatchOp',
    tags: ['scim'],
    params: idParams,
    body: any,
    response: any,
    handler: ({ params, body, req }) =>
      scim(req, async (x) => {
        const cur = await userOf(x, params.id);
        if (!(Array.isArray(body['schemas']) && (body['schemas'] as unknown[]).includes(PATCH)))
          throw new ScimError(400, 'Send a PatchOp', 'invalidSyntax');
        const ops = Array.isArray(body['Operations'])
          ? (body['Operations'] as unknown[]).map(obj)
          : [];
        for (const op of ops) {
          const kind = (str(op['op']) ?? '').toLowerCase();
          if (kind !== 'replace' && kind !== 'add')
            throw new ScimError(400, 'Only add and replace are supported', 'invalidSyntax');
          const path = str(op['path'])?.toLowerCase();
          // without a path the value is an object of attributes (Entra ID sends that)
          const values: Record<string, unknown> = path
            ? { [path]: op['value'] }
            : Object.fromEntries(
                Object.entries(obj(op['value'])).map(([k, v]) => [k.toLowerCase(), v]),
              );
          for (const [k, v] of Object.entries(values)) {
            if (k === 'active')
              await setActive(x, cur.id, v === true || v === 'True' || v === 'true');
            else if (k === 'displayname' || k === 'name.formatted') {
              const n = str(v);
              if (n)
                await x.c.query('UPDATE users SET name = $2 WHERE id = $1', [
                  cur.id,
                  n.slice(0, 120),
                ]);
            } else if (k === 'externalid')
              await x.c.query(
                'INSERT INTO scim_links (workspace_id, user_id, external_id) VALUES ($1, $2, $3) ON CONFLICT (workspace_id, user_id) DO UPDATE SET external_id = $3, updated_at = now()',
                [x.ws, cur.id, (str(v) ?? '').slice(0, 300)],
              );
            // other attributes (title, phone numbers…) are not kept
          }
        }
        return { body: userJson(x, await userOf(x, cur.id)) };
      }),
  });

  const deleteUser = route({
    method: 'DELETE',
    path: '/scim/v2/Users/:id',
    summary: 'SCIM: take a person out of the workspace (their account stays)',
    tags: ['scim'],
    params: idParams,
    response: any,
    status: 204,
    handler: ({ params, req }) =>
      scim(req, async (x) => {
        const cur = await userOf(x, params.id);
        if (cur.role === 'owner')
          throw new ScimError(400, 'The owner is not removed by the directory', 'mutability');
        await setActive(x, cur.id, false);
        await x.c.query('DELETE FROM workspace_members WHERE workspace_id = $1 AND user_id = $2', [
          x.ws,
          cur.id,
        ]);
        await x.c.query('DELETE FROM scim_links WHERE workspace_id = $1 AND user_id = $2', [
          x.ws,
          cur.id,
        ]);
        return { status: 204, body: {} };
      }),
  });

  const groupJson = async (x: Ctx, role: string) => {
    const members = (
      await x.c.query<UserRow>(USERS + ' AND m.role = $2 ORDER BY u.email', [x.ws, role])
    ).rows;
    return {
      schemas: [GROUP],
      id: role,
      displayName: role,
      members: members.map((m) => ({ value: m.id, display: m.email })),
      meta: { resourceType: 'Group', location: x.base + '/Groups/' + role },
    };
  };
  const roleOf = (id: string): string => {
    if (!(SCIM_ROLES as readonly string[]).includes(id))
      throw new ScimError(
        404,
        'No such group (the groups are the roles: ' + SCIM_ROLES.join(', ') + ')',
      );
    return id;
  };

  const listGroups = route({
    method: 'GET',
    path: '/scim/v2/Groups',
    summary: 'SCIM: the groups, which are the workspace roles',
    tags: ['scim'],
    query: listQuery,
    response: any,
    handler: ({ query, req }) =>
      scim(req, async (x) => {
        const m = query.filter ? /^\s*displayName\s+eq\s+"([^"]*)"\s*$/i.exec(query.filter) : null;
        if (query.filter && !m)
          throw new ScimError(
            400,
            'Only displayName eq "…" filters are supported',
            'invalidFilter',
          );
        const roles = m ? SCIM_ROLES.filter((r) => r === m[1]) : [...SCIM_ROLES];
        const res = [];
        for (const r of roles) res.push(await groupJson(x, r));
        return {
          body: {
            schemas: [LIST],
            totalResults: res.length,
            startIndex: 1,
            itemsPerPage: res.length,
            Resources: res,
          },
        };
      }),
  });

  const getGroup = route({
    method: 'GET',
    path: '/scim/v2/Groups/:id',
    summary: 'SCIM: one group (role) with its members',
    tags: ['scim'],
    params: idParams,
    response: any,
    handler: ({ params, req }) =>
      scim(req, async (x) => ({ body: await groupJson(x, roleOf(params.id)) })),
  });

  const patchGroup = route({
    method: 'PATCH',
    path: '/scim/v2/Groups/:id',
    summary: 'SCIM: add members to a group to give them that role (removing gives member)',
    tags: ['scim'],
    params: idParams,
    body: any,
    response: any,
    handler: ({ params, body, req }) =>
      scim(req, async (x) => {
        const role = roleOf(params.id);
        const ops = Array.isArray(body['Operations'])
          ? (body['Operations'] as unknown[]).map(obj)
          : [];
        for (const op of ops) {
          const kind = (str(op['op']) ?? '').toLowerCase();
          const raw = op['value'];
          const list = (Array.isArray(raw) ? raw : raw ? [raw] : []).map(obj);
          // "remove" with a path like members[value eq "id"]
          const pathId = /members\[value eq "([^"]+)"\]/i.exec(str(op['path']) ?? '')?.[1];
          const ids = [
            ...list.map((v) => str(v['value']) ?? ''),
            ...(pathId ? [pathId] : []),
          ].filter(Boolean);
          for (const id of ids) {
            await userOf(x, id);
            if (kind === 'add' || kind === 'replace') await setRole(x, id, role);
            else if (kind === 'remove') {
              const cur = (
                await x.c.query<{ role: string }>(
                  'SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2',
                  [x.ws, id],
                )
              ).rows[0];
              if (cur?.role === role && role !== 'member') await setRole(x, id, 'member');
            } else throw new ScimError(400, 'Unknown operation ' + kind, 'invalidSyntax');
          }
        }
        return { body: await groupJson(x, role) };
      }),
  });

  // ── the admin side: SCIM tokens ──
  const tokenOut = s.object({
    id: s.string(),
    name: s.string(),
    createdAt: s.string(),
    lastUsedAt: s.nullable(s.string()),
    revokedAt: s.nullable(s.string()),
  });
  const tokens = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/scim/tokens',
    summary: 'The workspace’s SCIM tokens (admin)',
    tags: ['scim'],
    params: s.object({ workspaceId: s.string({ format: 'uuid' }) }),
    response: s.object({ baseUrl: s.string(), tokens: s.array(tokenOut) }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'admin', async (c) => {
        const rows = (
          await c.query<{
            id: string;
            name: string;
            created_at: Date;
            last_used_at: Date | null;
            revoked_at: Date | null;
          }>(
            'SELECT id, name, created_at, last_used_at, revoked_at FROM scim_tokens ORDER BY created_at DESC',
          )
        ).rows;
        return {
          body: {
            baseUrl: base,
            tokens: rows.map((r) => ({
              id: r.id,
              name: r.name,
              createdAt: r.created_at.toISOString(),
              lastUsedAt: r.last_used_at?.toISOString() ?? null,
              revokedAt: r.revoked_at?.toISOString() ?? null,
            })),
          },
        };
      }),
  });

  const createToken = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/scim/tokens',
    summary: 'Make a SCIM token for the identity provider; it is shown once (admin)',
    tags: ['scim'],
    params: s.object({ workspaceId: s.string({ format: 'uuid' }) }),
    body: s.object({ name: s.string({ min: 1, max: 80 }) }),
    response: s.object({ id: s.string(), token: s.string(), baseUrl: s.string() }),
    status: 201,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'admin', async (c, a) => {
        await requireFeature(c, a.workspaceId, 'scim', 'SCIM provisioning'); // [PCODE-219 | S15 | v0.1.0]
        const token = 'orq_scim_' + randomBytes(32).toString('base64url');
        const id = (
          await c.query<{ id: string }>(
            'INSERT INTO scim_tokens (workspace_id, name, token_hash, created_by) VALUES ($1, $2, $3, $4) RETURNING id',
            [a.workspaceId, body.name.trim(), hash(token), a.user.id],
          )
        ).rows[0]?.id;
        if (!id) throw new Error('token insert returned nothing');
        return { status: 201, body: { id, token, baseUrl: base } };
      }),
  });

  const revokeToken = route({
    method: 'DELETE',
    path: '/api/workspaces/:workspaceId/scim/tokens/:tokenId',
    summary: 'Revoke a SCIM token (admin)',
    tags: ['scim'],
    params: s.object({
      workspaceId: s.string({ format: 'uuid' }),
      tokenId: s.string({ format: 'uuid' }),
    }),
    response: s.object({ ok: s.boolean() }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'admin', async (c) => {
        const r = await c.query(
          'UPDATE scim_tokens SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL',
          [params.tokenId],
        );
        if (!r.rowCount) throw new HttpError(404, 'not_found', 'Token not found');
        return { body: { ok: true } };
      }),
  });

  return [
    spConfig,
    resourceTypes,
    schemas,
    listUsers,
    getUser,
    createUser,
    replaceUser,
    patchUser,
    deleteUser,
    listGroups,
    getGroup,
    patchGroup,
    tokens,
    createToken,
    revokeToken,
  ];
}
