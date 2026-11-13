// ── [PCODE-341 | S15 | v0.1.0] T34.2b Public status pages per client and environment; incident update templates ──
// ── [PCODE-339 | S15 | v0.1.0] T34.1d Portal magic-link sign-in and passwordless invitations, MFA required per client ──
// ── [PCODE-237 | S15 | v0.1.0] T23.4 Email as a channel: own SMTP sender, password reset, invitations, digests ──
// ── [PCODE-185 | S15 | v0.1.0] B7.1 Client requests live: portal requests, threads with internal notes, response times, change requests with impact and signature, ratings ──
// ── [PCODE-163 | S15 | v0.1.0] B1.2 Roles, clients and portal sign-in on the server ──
//    Why:  clients as the team manages them: create and change a client (its own portal domain, branding,
//          language, what it is shown), assign projects to it, and make people its contacts in a portal
//          role. A contact who has no account yet gets an invitation; accepting it makes them the client's
//          contact. A contact sees only their own client (row-level security). The portal's sign-in page
//          asks which client a domain belongs to, so it can show the client's logo and colours.
// ── [PCODE-343 | S15 | v0.1.0] T34.3a Hour budgets with alerts, time reports by person, sprint and task, DATEV export ──
import { queueMail } from '../mail/outbox.js'; // [PCODE-237 | S15 | v0.1.0]
import type { MailConfig } from '../mail/smtp.js';
import { invitationMail } from '../mail/templates.js';
import { createHash, randomBytes } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { inSystem } from '../db/pool.js';
import { recordEvent } from '../events/outbox.js';
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s } from '../http/schema.js';
import { actorOf, asMember, type Access } from './access.js';

const uuid = s.string({ format: 'uuid' });
const sha256 = (v: string): string => createHash('sha256').update(v).digest('hex');
const PORTAL_ROLES = [
  'sponsor',
  'approver',
  'product_owner',
  'tester',
  'requester',
  'viewer',
] as const;
const DOMAIN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
const INVITE_DAYS = 14;

const clientOut = s.object({
  id: s.string(),
  name: s.string(),
  shortName: s.string(),
  ownerId: s.nullable(s.string()),
  ownerName: s.nullable(s.string()),
  portalDomain: s.nullable(s.string()),
  domainVerified: s.boolean(),
  language: s.string(),
  shares: s.anyObject(),
  branding: s.anyObject(),
  projects: s.array(s.object({ id: s.string(), key: s.string(), name: s.string() })),
  contacts: s.number({ integer: true }),
  createdAt: s.string(),
  // [PCODE-185 | S15 | v0.1.0] requests, response times, satisfaction, portal use
  openRequests: s.number({ integer: true }),
  lateRequests: s.number({ integer: true }),
  satisfaction: s.nullable(s.number()),
  lastPortalVisit: s.nullable(s.string()),
  responseHours: s.anyObject(),
  requireMfa: s.boolean(), // [PCODE-339 | S15 | v0.1.0]
  statusPublic: s.boolean(), // [PCODE-341 | S15 | v0.1.0]
  statusSlug: s.nullable(s.string()),
  datevAccount: s.nullable(s.string()), // [PCODE-343 | S15 | v0.1.0]
});

interface ClientRow {
  id: string;
  name: string;
  short_name: string;
  owner_id: string | null;
  owner_name: string | null;
  portal_domain: string | null;
  domain_verified_at: Date | null;
  language: string;
  shares: Record<string, unknown>;
  branding: Record<string, unknown>;
  projects: { id: string; key: string; name: string }[] | null;
  contacts: string;
  created_at: Date;
  open_requests: string; // [PCODE-185 | S15 | v0.1.0]
  late_requests: string;
  satisfaction: string | null;
  response_hours: Record<string, number>;
  require_mfa: boolean; // [PCODE-339 | S15 | v0.1.0]
  status_public: boolean; // [PCODE-341 | S15 | v0.1.0]
  status_slug: string | null;
  datev_account: string | null; // [PCODE-343 | S15 | v0.1.0]
}

const CLIENT_SELECT = `SELECT cl.id, cl.name, cl.short_name, cl.owner_id, u.name AS owner_name, cl.portal_domain, cl.domain_verified_at,
    cl.language, cl.shares, cl.branding, cl.created_at, cl.response_hours, cl.require_mfa, cl.status_public, cl.status_slug, cl.datev_account,
    (SELECT json_agg(json_build_object('id', p.id, 'key', p.key, 'name', p.name) ORDER BY p.key)
       FROM projects p WHERE p.client_id = cl.id AND p.archived_at IS NULL) AS projects,
    (SELECT count(DISTINCT cc.user_id) FROM client_contacts cc WHERE cc.client_id = cl.id) AS contacts,
    -- [PCODE-185 | S15 | v0.1.0] open requests, those whose first answer is overdue, the mean of the last five ratings
    (SELECT count(*) FROM client_requests r WHERE r.client_id = cl.id AND r.closed_at IS NULL) AS open_requests,
    (SELECT count(*) FROM client_requests r WHERE r.client_id = cl.id AND r.closed_at IS NULL
        AND r.first_response_at IS NULL AND r.response_due_at < now()) AS late_requests,
    (SELECT round(avg(q.rating), 1) FROM (SELECT rating FROM csat_ratings WHERE client_id = cl.id
        ORDER BY created_at DESC LIMIT 5) q) AS satisfaction
  FROM clients cl LEFT JOIN users u ON u.id = cl.owner_id`;

const clientJson = (r: ClientRow) => ({
  id: r.id,
  name: r.name,
  shortName: r.short_name,
  ownerId: r.owner_id,
  ownerName: r.owner_name,
  portalDomain: r.portal_domain,
  domainVerified: r.domain_verified_at !== null,
  language: r.language,
  shares: r.shares,
  branding: r.branding,
  projects: r.projects ?? [],
  contacts: Number(r.contacts),
  createdAt: r.created_at.toISOString(),
  openRequests: Number(r.open_requests), // [PCODE-185 | S15 | v0.1.0]
  lateRequests: Number(r.late_requests),
  satisfaction: r.satisfaction === null ? null : Number(r.satisfaction),
  lastPortalVisit: null as string | null,
  responseHours: r.response_hours,
  requireMfa: r.require_mfa, // [PCODE-339 | S15 | v0.1.0]
  statusPublic: r.status_public, // [PCODE-341 | S15 | v0.1.0]
  statusSlug: r.status_slug,
  datevAccount: r.datev_account, // [PCODE-343 | S15 | v0.1.0]
});

/** Team members see every client; a contact only their own (row-level security); other guests none. */
function mayList(a: Access): void {
  if (a.role === 'guest' && !a.clientId)
    throw new HttpError(403, 'forbidden', 'Clients are for the team');
}

async function loadClient(c: PoolClient, id: string) {
  const row = (await c.query<ClientRow>(CLIENT_SELECT + ' WHERE cl.id = $1', [id])).rows[0];
  if (!row) throw new HttpError(404, 'not_found', 'Client not found');
  return row;
}

const domainOf = (v: string | null | undefined): string | null => {
  if (v === undefined || v === null || v.trim() === '') return null;
  const d = v.trim().toLowerCase();
  if (!DOMAIN.test(d))
    throw new HttpError(400, 'invalid_request', 'That is not a domain name', [
      { path: 'body.portalDomain', message: 'e.g. projects.example.com' },
    ]);
  return d;
};

export function clientRoutes(
  pool: Pool,
  // [PCODE-237 | S15 | v0.1.0] with a mail server, a contact's invitation is mailed too
  deps: { mail?: MailConfig | null; publicUrl?: string } = {},
): Route[] {
  const list = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/clients',
    summary: 'The clients of the workspace (a client contact sees only their own)',
    tags: ['clients'],
    params: s.object({ workspaceId: uuid }),
    response: s.array(clientOut),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        mayList(a);
        const rows = (
          await c.query<ClientRow>(CLIENT_SELECT + ' WHERE cl.archived_at IS NULL ORDER BY cl.name')
        ).rows;
        const body = rows.map(clientJson);
        // [PCODE-185 | S15 | v0.1.0] the team sees when a client's contacts last used the portal (sessions are system data)
        if (!a.clientId && body.length) {
          const seen = await inSystem(
            pool,
            async (sc) =>
              (
                await sc.query<{ client_id: string; at: Date }>(
                  `SELECT cc.client_id, max(se.last_seen_at) AS at FROM client_contacts cc
                   JOIN sessions se ON se.user_id = cc.user_id
                  WHERE cc.client_id = ANY($1::uuid[]) GROUP BY cc.client_id`,
                  [body.map((x) => x.id)],
                )
              ).rows,
          );
          for (const x of body)
            x.lastPortalVisit = seen.find((v) => v.client_id === x.id)?.at.toISOString() ?? null;
        }
        return { body };
      }),
  });

  const create = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/clients',
    summary: 'Add a client (admin)',
    tags: ['clients'],
    params: s.object({ workspaceId: uuid }),
    body: s.object({
      name: s.string({ min: 1, max: 200 }),
      shortName: s.optional(s.string({ min: 1, max: 40 })),
      ownerId: s.optional(uuid),
      portalDomain: s.optional(s.string({ max: 253 })),
      language: s.optional(s.enum(['en', 'de'])),
    }),
    response: clientOut,
    status: 201,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'admin', async (c, a) => {
        const name = body.name.trim();
        const dup = (await c.query('SELECT 1 FROM clients WHERE lower(name) = lower($1)', [name]))
          .rowCount;
        if (dup) throw new HttpError(409, 'conflict', 'A client named ' + name + ' exists');
        const domain = domainOf(body.portalDomain);
        if (domain) {
          const taken = await inSystem(
            pool,
            async (sc) =>
              (await sc.query('SELECT 1 FROM clients WHERE portal_domain = $1', [domain])).rowCount,
          );
          if (taken) throw new HttpError(409, 'conflict', domain + ' is used by another portal');
        }
        const id = (
          await c.query<{ id: string }>(
            'INSERT INTO clients (workspace_id, name, short_name, owner_id, portal_domain, language) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
            [
              a.workspaceId,
              name,
              (body.shortName ?? name.split(/\s+/)[0] ?? name).slice(0, 40),
              body.ownerId ?? a.user.id,
              domain,
              body.language ?? 'en',
            ],
          )
        ).rows[0]?.id;
        if (!id) throw new Error('client insert returned nothing');
        await recordEvent(c, a.workspaceId, {
          actor: actorOf(a),
          verb: 'created',
          object: { type: 'client', id, label: name },
        });
        return { status: 201, body: clientJson(await loadClient(c, id)) };
      }),
  });

  const update = route({
    method: 'PATCH',
    path: '/api/workspaces/:workspaceId/clients/:clientId',
    summary:
      'Change a client: name, owner, portal domain, language, branding, what it is shown (admin)',
    tags: ['clients'],
    params: s.object({ workspaceId: uuid, clientId: uuid }),
    body: s.object({
      name: s.optional(s.string({ min: 1, max: 200 })),
      shortName: s.optional(s.string({ min: 1, max: 40 })),
      ownerId: s.optional(s.nullable(uuid)),
      portalDomain: s.optional(s.nullable(s.string({ max: 253 }))),
      language: s.optional(s.enum(['en', 'de'])),
      branding: s.optional(s.anyObject()),
      shares: s.optional(s.anyObject()),
      // [PCODE-339 | S15 | v0.1.0] its contacts must use a second factor
      requireMfa: s.optional(s.boolean()),
    }),
    response: clientOut,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'admin', async (c, a) => {
        const before = await loadClient(c, params.clientId);
        if (body.requireMfa !== undefined)
          await c.query('UPDATE clients SET require_mfa = $2 WHERE id = $1', [
            params.clientId,
            body.requireMfa,
          ]);
        if (body.shares && !Object.values(body.shares).every((v) => typeof v === 'boolean'))
          throw new HttpError(400, 'invalid_request', 'Shares are switches: true or false', [
            { path: 'body.shares', message: 'only true or false values' },
          ]);
        const domain =
          body.portalDomain === undefined ? before.portal_domain : domainOf(body.portalDomain);
        if (domain && domain !== before.portal_domain) {
          const taken = await inSystem(
            pool,
            async (sc) =>
              (await sc.query('SELECT 1 FROM clients WHERE portal_domain = $1', [domain])).rowCount,
          );
          if (taken) throw new HttpError(409, 'conflict', domain + ' is used by another portal');
        }
        await c.query(
          `UPDATE clients SET name = $2, short_name = $3, owner_id = $4, portal_domain = $5,
             domain_verified_at = CASE WHEN $5 IS DISTINCT FROM portal_domain THEN NULL ELSE domain_verified_at END,
             language = $6, branding = $7, shares = $8 WHERE id = $1`,
          [
            params.clientId,
            body.name?.trim() ?? before.name,
            body.shortName ?? before.short_name,
            body.ownerId === undefined ? before.owner_id : body.ownerId,
            domain,
            body.language ?? before.language,
            JSON.stringify(body.branding ?? before.branding),
            JSON.stringify({ ...before.shares, ...(body.shares ?? {}) }),
          ],
        );
        const after = await loadClient(c, params.clientId);
        await recordEvent(c, a.workspaceId, {
          actor: actorOf(a),
          verb: 'updated',
          object: { type: 'client', id: after.id, label: after.name },
          changes: Object.fromEntries(
            Object.keys(body).map((k) => [
              k,
              { from: null, to: (body as Record<string, unknown>)[k] },
            ]),
          ),
        });
        return { body: clientJson(after) };
      }),
  });

  const assign = route({
    method: 'PUT',
    path: '/api/workspaces/:workspaceId/projects/:projectId/client',
    summary: 'Assign a project to a client, or to none (admin)',
    tags: ['clients'],
    params: s.object({ workspaceId: uuid, projectId: uuid }),
    body: s.object({ clientId: s.nullable(uuid) }),
    response: s.object({ projectId: s.string(), clientId: s.nullable(s.string()) }),
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'admin', async (c, a) => {
        if (body.clientId) await loadClient(c, body.clientId);
        const r = await c.query<{ key: string }>(
          'UPDATE projects SET client_id = $2 WHERE id = $1 RETURNING key',
          [params.projectId, body.clientId],
        );
        const key = r.rows[0]?.key;
        if (!key) throw new HttpError(404, 'not_found', 'Project not found');
        await recordEvent(
          c,
          a.workspaceId,
          {
            actor: actorOf(a),
            verb: 'updated',
            object: { type: 'project', id: params.projectId, label: key },
            changes: { client: { from: null, to: body.clientId } },
          },
          { projectId: params.projectId },
        );
        return { body: { projectId: params.projectId, clientId: body.clientId } };
      }),
  });

  const contactOut = s.object({
    userId: s.string(),
    name: s.string(),
    email: s.string(),
    portalRoles: s.array(s.string()),
  });

  const contacts = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/clients/:clientId/contacts',
    summary: 'The contacts of a client and their portal roles',
    tags: ['clients'],
    params: s.object({ workspaceId: uuid, clientId: uuid }),
    response: s.array(contactOut),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        mayList(a);
        await loadClient(c, params.clientId);
        const rows = (
          await c.query<{ user_id: string; name: string; email: string; roles: string[] }>(
            `SELECT cc.user_id, u.name, u.email, array_agg(cc.portal_role ORDER BY cc.portal_role) AS roles
             FROM client_contacts cc JOIN users u ON u.id = cc.user_id WHERE cc.client_id = $1
             GROUP BY cc.user_id, u.name, u.email ORDER BY u.name`,
            [params.clientId],
          )
        ).rows;
        return {
          body: rows.map((r) => ({
            userId: r.user_id,
            name: r.name,
            email: r.email,
            portalRoles: r.roles,
          })),
        };
      }),
  });

  const addContact = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/clients/:clientId/contacts',
    summary:
      'Make someone a contact of the client in a portal role; without an account they get an invitation (admin)',
    tags: ['clients'],
    params: s.object({ workspaceId: uuid, clientId: uuid }),
    body: s.object({
      email: s.string({ format: 'email', max: 254 }),
      portalRole: s.enum(PORTAL_ROLES),
    }),
    response: s.object({
      contact: s.nullable(contactOut),
      invitation: s.nullable(
        s.object({
          id: s.string(),
          email: s.string(),
          token: s.string(),
          expiresAt: s.string(),
          mailed: s.boolean(), // [PCODE-237 | S15 | v0.1.0]
        }),
      ),
    }),
    status: 201,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'admin', async (c, a) => {
        const client = await loadClient(c, params.clientId);
        const email = body.email.trim().toLowerCase();
        const member = (
          await c.query<{ user_id: string; role: string; name: string }>(
            'SELECT m.user_id, m.role, u.name FROM workspace_members m JOIN users u ON u.id = m.user_id WHERE lower(u.email) = $1',
            [email],
          )
        ).rows[0];
        if (member && member.role !== 'guest')
          throw new HttpError(
            409,
            'conflict',
            email + ' is in the team; a client contact is a separate account',
          );
        if (member) {
          const other = (
            await c.query('SELECT 1 FROM client_contacts WHERE user_id = $1 AND client_id <> $2', [
              member.user_id,
              client.id,
            ])
          ).rowCount;
          if (other)
            throw new HttpError(409, 'conflict', email + ' is already a contact of another client');
          await c.query(
            'INSERT INTO client_contacts (workspace_id, client_id, user_id, portal_role) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
            [a.workspaceId, client.id, member.user_id, body.portalRole],
          );
          await recordEvent(c, a.workspaceId, {
            actor: actorOf(a),
            verb: 'updated',
            object: { type: 'client', id: client.id, label: client.name },
            changes: {
              contact: { from: null, to: { userId: member.user_id, portalRole: body.portalRole } },
            },
          });
          const roles = (
            await c.query<{ portal_role: string }>(
              'SELECT portal_role FROM client_contacts WHERE client_id = $1 AND user_id = $2 ORDER BY portal_role',
              [client.id, member.user_id],
            )
          ).rows.map((r) => r.portal_role);
          return {
            status: 201,
            body: {
              contact: { userId: member.user_id, name: member.name, email, portalRoles: roles },
              invitation: null,
            },
          };
        }
        // no account in this workspace yet: an invitation that makes them the contact when accepted
        await c.query(
          'UPDATE invitations SET revoked_at = now() WHERE lower(email) = $1 AND accepted_at IS NULL AND revoked_at IS NULL',
          [email],
        );
        const token = randomBytes(32).toString('base64url');
        const inv = (
          await c.query<{ id: string; expires_at: Date }>(
            `INSERT INTO invitations (workspace_id, email, role, token_hash, invited_by, expires_at, client_id, portal_role)
             VALUES ($1, $2, 'guest', $3, $4, now() + interval '${String(INVITE_DAYS)} days', $5, $6) RETURNING id, expires_at`,
            [a.workspaceId, email, sha256(token), a.user.id, client.id, body.portalRole],
          )
        ).rows[0];
        if (!inv) throw new Error('invitation insert returned nothing');
        // [PCODE-237 | S15 | v0.1.0] the invitation by mail, when this server sends mail
        const mailed = Boolean(deps.mail);
        if (mailed) {
          const ws =
            (await c.query<{ name: string }>('SELECT name FROM workspaces')).rows[0]?.name ?? '';
          const url = (deps.publicUrl ?? '').replace(/\/$/, '') + '/invite/' + token;
          await inSystem(pool, (sc) =>
            queueMail(sc, {
              ...invitationMail({ workspace: ws, inviter: a.user.name, url, client: client.name }),
              to: email,
              kind: 'invitation',
              workspaceId: a.workspaceId,
            }),
          );
        }
        await recordEvent(c, a.workspaceId, {
          actor: actorOf(a),
          verb: 'created',
          object: { type: 'member', id: inv.id, label: email },
          parent: { type: 'client', id: client.id, label: client.name },
          changes: {
            invited: { from: null, to: 'contact of ' + client.name + ' (' + body.portalRole + ')' },
          },
        });
        return {
          status: 201,
          body: {
            contact: null,
            invitation: {
              id: inv.id,
              email,
              token,
              expiresAt: inv.expires_at.toISOString(),
              mailed,
            },
          },
        };
      }),
  });

  const removeContact = route({
    method: 'DELETE',
    path: '/api/workspaces/:workspaceId/clients/:clientId/contacts/:userId',
    summary: 'Remove a contact from a client; they no longer see its projects (admin)',
    tags: ['clients'],
    params: s.object({ workspaceId: uuid, clientId: uuid, userId: uuid }),
    response: s.object({ removed: s.boolean() }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'admin', async (c, a) => {
        const r = await c.query(
          'DELETE FROM client_contacts WHERE client_id = $1 AND user_id = $2',
          [params.clientId, params.userId],
        );
        if (r.rowCount)
          await recordEvent(c, a.workspaceId, {
            actor: actorOf(a),
            verb: 'updated',
            object: { type: 'client', id: params.clientId },
            changes: { contact: { from: { userId: params.userId }, to: null } },
          });
        return { body: { removed: Boolean(r.rowCount) } };
      }),
  });

  const branding = route({
    method: 'GET',
    path: '/api/portal/branding',
    summary: 'The client a portal domain belongs to, for its sign-in page (no sign-in needed)',
    tags: ['clients'],
    response: s.object({
      clientName: s.string(),
      workspaceName: s.string(),
      language: s.string(),
      branding: s.anyObject(),
    }),
    handler: async ({ req }) => {
      const host = (req.headers.host ?? '').split(':')[0]?.toLowerCase() ?? '';
      const row = await inSystem(
        pool,
        async (c) =>
          (
            await c.query<{
              name: string;
              ws: string;
              language: string;
              branding: Record<string, unknown>;
            }>(
              `SELECT cl.name, w.name AS ws, cl.language, cl.branding FROM clients cl JOIN workspaces w ON w.id = cl.workspace_id
               WHERE cl.portal_domain = $1 AND cl.archived_at IS NULL`,
              [host],
            )
          ).rows[0],
      );
      if (!row) throw new HttpError(404, 'not_found', 'No client portal at this address');
      return {
        body: {
          clientName: row.name,
          workspaceName: row.ws,
          language: row.language,
          branding: row.branding,
        },
      };
    },
  });

  return [list, create, update, assign, contacts, addContact, removeContact, branding];
}
