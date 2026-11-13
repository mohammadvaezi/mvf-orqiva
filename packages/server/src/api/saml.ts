// ── [PCODE-362 | S15 | v0.1.0] T35.7d SAML single logout ──
// ── [PCODE-361 | S15 | v0.1.0] T35.7c SAML encrypted assertions ──
// ── [PCODE-213 | S15 | v0.1.0] T19.2 SCIM 2.0 provisioning (users, role groups, suspend on deactivate) and identity settings (SAML, SCIM tokens) ──
// ── [PCODE-212 | S15 | v0.1.0] T19.1 SAML 2.0 single sign-on per workspace, own XML signature verification with wrapping defences ──
//    Why:  the workspace side of SAML: an admin connects the identity provider and hands its admins our
//          metadata; people start at /auth/saml/<workspace>/start and come back signed in. A person is
//          found by their SAML identity, else by email when its domain is one the connection vouches for
//          (anything else would let a provider claim accounts it does not own), and is created and added
//          to the workspace with the default role on first sign-in, within the licence's seats.
import {
  createPrivateKey,
  generateKeyPairSync,
  X509Certificate,
  type KeyObject,
} from 'node:crypto'; // [PCODE-361 | S15 | v0.1.0]
import type { IncomingMessage } from 'node:http'; // [PCODE-362 | S15 | v0.1.0]
import type { Pool } from 'pg';
import {
  authnRequestUrl,
  newRequestId,
  normaliseCertificate,
  logoutRequestXml,
  logoutResponseXml,
  readLogoutRequest,
  readRedirect,
  SamlError,
  signedRedirect,
  spMetadata,
  verifyResponse,
} from '../auth/saml.js';
import { clearedCookie, createSession, sessionCookie, sessionSaml } from '../auth/sessions.js'; // [PCODE-362 | S15 | v0.1.0]
import { selfSignedCertificate } from '../auth/x509.js'; // [PCODE-361 | S15 | v0.1.0]
import { open, seal, serverKey } from '../agents/secrets.js'; // [PCODE-361 | S15 | v0.1.0]
import { inSystem } from '../db/pool.js';
import { recordEvent } from '../events/outbox.js';
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s } from '../http/schema.js';
import { checkSeat, requireFeature } from '../licence/licence.js';
import { asMember } from './access.js';

const uuid = s.string({ format: 'uuid' });
const ROLES = ['member', 'tester', 'designer', 'auditor', 'billing', 'guest'] as const;

interface ConnRow {
  idp_entity_id: string;
  sso_url: string;
  certificate: string;
  domains: string[];
  default_role: string;
  enabled: boolean;
  updated_at: Date;
  slo_url: string | null; // [PCODE-362 | S15 | v0.1.0]
}

// [PCODE-361 | S15 | v0.1.0] the workspace's own key for encrypted assertions, made on first use; null without a
// server key (ORQIVA_SECRET_KEY) or for a workspace that does not exist
const spKeyOf = (pool: Pool, ws: string): Promise<{ key: KeyObject; certificate: string } | null> =>
  inSystem(pool, async (c) => {
    let secret: Buffer;
    try {
      secret = serverKey();
    } catch {
      return null;
    }
    const read = async () =>
      (
        await c.query<{ private_key: string; certificate: string }>(
          'SELECT private_key, certificate FROM saml_sp_keys WHERE workspace_id = $1',
          [ws],
        )
      ).rows[0];
    let row = await read();
    if (!row) {
      if (!(await c.query('SELECT 1 FROM workspaces WHERE id = $1', [ws])).rowCount) return null;
      const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
      const certificate = selfSignedCertificate({
        commonName: 'Orqiva SAML ' + ws,
        privateKey,
        publicKey,
        days: 3650,
      });
      await c.query(
        'INSERT INTO saml_sp_keys (workspace_id, private_key, certificate) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
        [
          ws,
          seal(privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), secret),
          certificate,
        ],
      );
      row = await read();
    }
    if (!row) return null;
    try {
      return {
        key: createPrivateKey(open(row.private_key, secret)),
        certificate: row.certificate,
      };
    } catch {
      return null;
    }
  });

export interface SamlDeps {
  pool: Pool;
  publicUrl: string;
  secureCookies: boolean;
}

export function samlRoutes(deps: SamlDeps): Route[] {
  const { pool } = deps;
  const base = deps.publicUrl.replace(/\/$/, '');
  const spOf = (ws: string) => ({
    entityId: base + '/auth/saml/' + ws,
    acsUrl: base + '/auth/saml/' + ws + '/acs',
    sloUrl: base + '/auth/saml/' + ws + '/slo', // [PCODE-362 | S15 | v0.1.0]
  });
  const connection = (ws: string): Promise<ConnRow | undefined> =>
    inSystem(
      pool,
      async (c) =>
        (await c.query<ConnRow>('SELECT * FROM saml_connections WHERE workspace_id = $1', [ws]))
          .rows[0],
    );
  const settingsOut = s.object({
    spEntityId: s.string(),
    acsUrl: s.string(),
    metadataUrl: s.string(),
    startUrl: s.string(),
    connection: s.nullable(
      s.object({
        idpEntityId: s.string(),
        ssoUrl: s.string(),
        certificateSubject: s.string(),
        domains: s.array(s.string()),
        defaultRole: s.string(),
        enabled: s.boolean(),
        updatedAt: s.string(),
        sloUrl: s.nullable(s.string()), // [PCODE-362 | S15 | v0.1.0]
      }),
    ),
    sloUrl: s.string(), // [PCODE-362 | S15 | v0.1.0] our logout address
  });
  const settingsJson = (ws: string, r: ConnRow | undefined) => {
    let subject = '';
    if (r)
      try {
        subject = new X509Certificate(r.certificate).subject;
      } catch {
        subject = 'unreadable';
      }
    return {
      spEntityId: spOf(ws).entityId,
      acsUrl: spOf(ws).acsUrl,
      metadataUrl: base + '/auth/saml/' + ws + '/metadata',
      startUrl: base + '/auth/saml/' + ws + '/start',
      sloUrl: spOf(ws).sloUrl,
      connection: r
        ? {
            idpEntityId: r.idp_entity_id,
            ssoUrl: r.sso_url,
            certificateSubject: subject,
            domains: r.domains,
            defaultRole: r.default_role,
            enabled: r.enabled,
            updatedAt: r.updated_at.toISOString(),
            sloUrl: r.slo_url,
          }
        : null,
    };
  };

  const get = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/saml',
    summary: 'The workspace’s SAML connection, and what to give the identity provider (admin)',
    tags: ['auth'],
    params: s.object({ workspaceId: uuid }),
    response: settingsOut,
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'admin', async (c) => {
        const r = (
          await c.query<ConnRow>('SELECT * FROM saml_connections WHERE workspace_id = $1', [
            params.workspaceId,
          ])
        ).rows[0];
        return { body: settingsJson(params.workspaceId, r) };
      }),
  });

  const put = route({
    method: 'PUT',
    path: '/api/workspaces/:workspaceId/saml',
    summary:
      'Connect (or change) the identity provider: entity ID, sign-in URL, certificate, domains, default role (admin)',
    tags: ['auth'],
    params: s.object({ workspaceId: uuid }),
    body: s.object({
      idpEntityId: s.string({ min: 1, max: 500 }),
      ssoUrl: s.string({ min: 9, max: 1000 }),
      // [PCODE-213 | S15 | v0.1.0] left out: the certificate already stored stays
      certificate: s.optional(s.string({ min: 100, max: 20000 })),
      domains: s.array(s.string({ min: 3, max: 253 }), { max: 50 }),
      defaultRole: s.enum(ROLES),
      enabled: s.boolean(),
      // [PCODE-362 | S15 | v0.1.0] the provider's single logout address (HTTP-Redirect); null or empty: none
      sloUrl: s.optional(s.nullable(s.string({ max: 1000 }))),
    }),
    response: settingsOut,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'admin', async (c, a) => {
        // [PCODE-219 | S15 | v0.1.0] switching SAML on needs the feature; switching it off never does
        if (body.enabled) await requireFeature(c, a.workspaceId, 'sso', 'SAML single sign-on');
        if (!/^https:\/\/[^\s]+$/.test(body.ssoUrl))
          throw new HttpError(400, 'invalid_request', 'The sign-in URL must be https', [
            { path: 'body.ssoUrl', message: 'is not an https URL' },
          ]);
        let pem: string;
        const stored = (
          await c.query<{ certificate: string }>(
            'SELECT certificate FROM saml_connections WHERE workspace_id = $1',
            [params.workspaceId],
          )
        ).rows[0]?.certificate;
        if (!body.certificate && !stored)
          throw new HttpError(
            400,
            'invalid_request',
            'Paste the identity provider’s signing certificate',
            [{ path: 'body.certificate', message: 'is required for a new connection' }],
          );
        try {
          pem = body.certificate ? normaliseCertificate(body.certificate) : (stored ?? '');
        } catch (e) {
          throw new HttpError(
            400,
            'invalid_request',
            e instanceof Error ? e.message : 'Bad certificate',
            [{ path: 'body.certificate', message: 'is not a certificate' }],
          );
        }
        const sloUrl = body.sloUrl?.trim() ?? '';
        if (sloUrl && !/^https:\/\/[^\s]+$/.test(sloUrl))
          throw new HttpError(400, 'invalid_request', 'The logout URL must be https', [
            { path: 'body.sloUrl', message: 'is not an https URL' },
          ]);
        const domains = [
          ...new Set(body.domains.map((d) => d.trim().toLowerCase().replace(/^@/, ''))),
        ];
        if (domains.some((d) => !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d)))
          throw new HttpError(400, 'invalid_request', 'A domain looks like example.com', [
            { path: 'body.domains', message: 'has a bad domain' },
          ]);
        await c.query(
          `INSERT INTO saml_connections (workspace_id, idp_entity_id, sso_url, certificate, domains, default_role, enabled, updated_by, updated_at, slo_url)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now(), $9)
           ON CONFLICT (workspace_id) DO UPDATE SET idp_entity_id = $2, sso_url = $3, certificate = $4, domains = $5, default_role = $6,
             enabled = $7, updated_by = $8, updated_at = now(), slo_url = $9`,
          [
            params.workspaceId,
            body.idpEntityId.trim(),
            body.ssoUrl,
            pem,
            domains,
            body.defaultRole,
            body.enabled,
            a.user.id,
            sloUrl || null,
          ],
        );
        await recordEvent(c, a.workspaceId, {
          actor: { kind: 'user', id: a.user.id, name: a.user.name },
          verb: 'updated',
          object: { type: 'workspace', id: a.workspaceId },
          changes: {
            saml: {
              from: null,
              to: body.enabled ? 'connected to ' + body.idpEntityId.trim() : 'switched off',
            },
          },
        });
        const r = (
          await c.query<ConnRow>('SELECT * FROM saml_connections WHERE workspace_id = $1', [
            params.workspaceId,
          ])
        ).rows[0];
        return { body: settingsJson(params.workspaceId, r) };
      }),
  });

  const metadata = route({
    method: 'GET',
    path: '/auth/saml/:workspaceId/metadata',
    summary:
      'Our service provider metadata for this workspace (for the identity provider’s admins)',
    tags: ['auth'],
    params: s.object({ workspaceId: uuid }),
    response: s.anyObject(),
    handler: async ({ params }) => ({
      body: {},
      file: {
        data: Buffer.from(
          // [PCODE-361 | S15 | v0.1.0] with the certificate to encrypt assertions to
          spMetadata(
            spOf(params.workspaceId),
            (await spKeyOf(pool, params.workspaceId))?.certificate,
          ),
        ),
        contentType: 'application/samlmetadata+xml',
        name: 'orqiva-sp.xml',
        inline: true,
      },
    }),
  });

  const start = route({
    method: 'GET',
    path: '/auth/saml/:workspaceId/start',
    summary: 'Sign in through the workspace’s identity provider: redirects there',
    tags: ['auth'],
    params: s.object({ workspaceId: uuid }),
    response: s.object({ redirect: s.string() }),
    status: 302,
    handler: async ({ params }) => {
      const conn = await connection(params.workspaceId);
      if (!conn?.enabled)
        throw new HttpError(404, 'not_found', 'This workspace has no single sign-on');
      const id = newRequestId();
      await inSystem(pool, async (c) => {
        await c.query("DELETE FROM saml_requests WHERE created_at < now() - interval '10 minutes'");
        await c.query('INSERT INTO saml_requests (id, workspace_id) VALUES ($1, $2)', [
          id,
          params.workspaceId,
        ]);
      });
      const url = authnRequestUrl(
        spOf(params.workspaceId),
        { entityId: conn.idp_entity_id, ssoUrl: conn.sso_url, certificate: conn.certificate },
        id,
        params.workspaceId,
      );
      return { status: 302, body: { redirect: url }, headers: { location: url } };
    },
  });

  const acs = route({
    method: 'POST',
    path: '/auth/saml/:workspaceId/acs',
    summary: 'The identity provider posts its signed response here; signs the person in',
    tags: ['auth'],
    params: s.object({ workspaceId: uuid }),
    form: true,
    body: s.object({
      SAMLResponse: s.string({ min: 1, max: 1_000_000 }),
      RelayState: s.optional(s.string({ max: 200 })),
    }),
    response: s.object({ redirect: s.string() }),
    status: 302,
    handler: async ({ params, body, req }) => {
      const ws = params.workspaceId;
      const conn = await connection(ws);
      if (!conn?.enabled)
        throw new HttpError(404, 'not_found', 'This workspace has no single sign-on');
      // which request does it answer? read InResponseTo before trusting anything else, then use it once
      const inResponseTo = /InResponseTo="(_[0-9a-f]{40})"/.exec(
        Buffer.from(body.SAMLResponse, 'base64').toString('utf8').slice(0, 20_000),
      )?.[1];
      const known = inResponseTo
        ? await inSystem(
            pool,
            async (c) =>
              (
                await c.query(
                  "DELETE FROM saml_requests WHERE id = $1 AND workspace_id = $2 AND created_at > now() - interval '10 minutes'",
                  [inResponseTo, ws],
                )
              ).rowCount,
          )
        : 0;
      if (!known || !inResponseTo)
        throw new HttpError(
          401,
          'unauthorized',
          'This sign-in has expired or was already used; start again',
        );
      let who;
      try {
        who = verifyResponse(body.SAMLResponse, {
          sp: spOf(ws),
          idp: {
            entityId: conn.idp_entity_id,
            ssoUrl: conn.sso_url,
            certificate: conn.certificate,
          },
          requestId: inResponseTo,
          // [PCODE-361 | S15 | v0.1.0] our key, only when the assertion is encrypted
          spKey: Buffer.from(body.SAMLResponse, 'base64').includes('EncryptedAssertion')
            ? ((await spKeyOf(pool, ws))?.key ?? null)
            : null,
        });
      } catch (e) {
        if (e instanceof SamlError) throw new HttpError(401, 'unauthorized', e.message);
        throw e;
      }
      const identity = who;
      const userId = await inSystem(pool, async (c) => {
        const linked = (
          await c.query<{ user_id: string }>(
            'SELECT user_id FROM saml_identities WHERE workspace_id = $1 AND name_id = $2',
            [ws, identity.nameId],
          )
        ).rows[0];
        let uid = linked?.user_id;
        if (!uid) {
          const email = identity.email;
          const domain = email?.split('@')[1] ?? '';
          if (!email || !conn.domains.includes(domain))
            throw new HttpError(
              403,
              'forbidden',
              'This identity provider does not vouch for ' +
                (email ?? 'this person') +
                ' (its email domains: ' +
                conn.domains.join(', ') +
                ')',
            );
          uid = (await c.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [email]))
            .rows[0]?.id;
          if (!uid)
            uid = (
              await c.query<{ id: string }>(
                'INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id',
                [email, identity.name ?? email.split('@')[0] ?? email],
              )
            ).rows[0]?.id;
          if (!uid) throw new Error('user insert returned nothing');
          await c.query(
            'INSERT INTO saml_identities (workspace_id, name_id, user_id) VALUES ($1, $2, $3)',
            [ws, identity.nameId, uid],
          );
        }
        const member = (
          await c.query(
            'SELECT 1 FROM workspace_members WHERE workspace_id = $1 AND user_id = $2',
            [ws, uid],
          )
        ).rowCount;
        if (!member) {
          await checkSeat(c, ws);
          await c.query(
            'INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, $3)',
            [ws, uid, conn.default_role],
          );
        }
        return uid;
      });
      // [PCODE-362 | S15 | v0.1.0] remembered for single logout
      const token = await createSession(pool, userId, req, {
        workspaceId: ws,
        nameId: identity.nameId,
        nameIdFormat: identity.nameIdFormat,
        sessionIndex: identity.sessionIndex,
      });
      return {
        status: 302,
        body: { redirect: '/' },
        headers: { location: '/', 'set-cookie': sessionCookie(token, deps.secureCookies) },
      };
    },
  });

  // [PCODE-362 | S15 | v0.1.0] the provider's logout request (end those sessions, answer it) or its answer to ours
  const slo = route({
    method: 'GET',
    path: '/auth/saml/:workspaceId/slo',
    summary:
      'Single logout from the identity provider (HTTP-Redirect): a signed LogoutRequest or LogoutResponse',
    tags: ['auth'],
    params: s.object({ workspaceId: uuid }),
    query: s.object({
      SAMLRequest: s.optional(s.string({ max: 20_000 })),
      SAMLResponse: s.optional(s.string({ max: 20_000 })),
      RelayState: s.optional(s.string({ max: 1000 })),
      SigAlg: s.optional(s.string({ max: 200 })),
      Signature: s.optional(s.string({ max: 2000 })),
    }),
    response: s.object({ redirect: s.string() }),
    status: 302,
    handler: async ({ params, req }) => {
      const ws = params.workspaceId;
      const conn = await connection(ws);
      if (!conn?.enabled)
        throw new HttpError(404, 'not_found', 'This workspace has no single sign-on');
      const idpConfig = {
        entityId: conn.idp_entity_id,
        ssoUrl: conn.sso_url,
        certificate: conn.certificate,
      };
      let read;
      try {
        read = readRedirect((req.url ?? '').split('?')[1] ?? '', conn.certificate);
      } catch (e) {
        if (e instanceof SamlError) throw new HttpError(400, 'invalid_request', e.message);
        throw e;
      }
      const done = (location: string) => ({
        status: 302,
        body: { redirect: location },
        headers: { location, 'set-cookie': clearedCookie(deps.secureCookies) },
      });
      if (read.kind === 'SAMLResponse') {
        // the answer to our request: the person is already signed out here
        if (read.message.local !== 'LogoutResponse')
          throw new HttpError(400, 'invalid_request', 'This is not a logout response');
        return done('/login');
      }
      let who;
      try {
        who = readLogoutRequest(read.message, idpConfig);
      } catch (e) {
        if (e instanceof SamlError) throw new HttpError(400, 'invalid_request', e.message);
        throw e;
      }
      const request = who;
      await inSystem(pool, (c) =>
        c.query(
          `DELETE FROM sessions WHERE saml_workspace_id = $1 AND saml_name_id = $2
             AND (cardinality($3::text[]) = 0 OR saml_session_index = ANY($3::text[]))`,
          [ws, request.nameId, request.sessionIndexes],
        ),
      );
      const key = await spKeyOf(pool, ws);
      if (!conn.slo_url || !key) return done('/login');
      return done(
        signedRedirect(
          conn.slo_url,
          'SAMLResponse',
          logoutResponseXml(spOf(ws), conn.slo_url, newRequestId(), request.id),
          read.relayState,
          key.key,
        ),
      );
    },
  });

  return [get, put, metadata, start, acs, slo];
}

// [PCODE-362 | S15 | v0.1.0]
/** Where signing out continues for a session that began with SAML: the provider's logout address with
 *  our signed LogoutRequest. Null when the session did not, or the provider has no logout address. */
export function samlLogoutRedirect(
  pool: Pool,
  publicUrl: string,
): (req: IncomingMessage) => Promise<string | null> {
  const base = publicUrl.replace(/\/$/, '');
  return async (req) => {
    const saml = await sessionSaml(pool, req);
    if (!saml) return null;
    const conn = (
      await inSystem(pool, (c) =>
        c.query<{ slo_url: string | null; enabled: boolean }>(
          'SELECT slo_url, enabled FROM saml_connections WHERE workspace_id = $1',
          [saml.workspaceId],
        ),
      )
    ).rows[0];
    if (!conn?.enabled || !conn.slo_url) return null;
    const key = await spKeyOf(pool, saml.workspaceId);
    if (!key) return null;
    const sp = {
      entityId: base + '/auth/saml/' + saml.workspaceId,
      acsUrl: base + '/auth/saml/' + saml.workspaceId + '/acs',
    };
    return signedRedirect(
      conn.slo_url,
      'SAMLRequest',
      logoutRequestXml(sp, conn.slo_url, newRequestId(), saml),
      null,
      key.key,
    );
  };
}
