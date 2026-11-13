// ── [PCODE-363 | S15 | v0.1.0] T35.7e Rate limits shared across cluster nodes ──
// ── [PCODE-362 | S15 | v0.1.0] T35.7d SAML single logout ──
// ── [PCODE-356 | S15 | v0.1.0] T35.5a Translation layer for a German UI, language choice, text extraction ──
// ── [PCODE-339 | S15 | v0.1.0] T34.1d Portal magic-link sign-in and passwordless invitations, MFA required per client ──
// ── [PCODE-324 | S15 | v0.1.0] T32.8a Fix pull requests for findings: dependency upgrades and AI fixes ──
// ── [PCODE-322 | S15 | v0.1.0] T32.7a EPSS and known-exploited feeds, CVE alerts against shipped versions ──
// ── [PCODE-240 | S15 | v0.1.0] T24.1 AI provider connections: Anthropic, OpenAI, Azure, Gemini, Bedrock, Grok, fallbacks, prices ──
// ── [PCODE-237 | S15 | v0.1.0] T23.4 Email as a channel: own SMTP sender, password reset, invitations, digests ──
// ── [PCODE-212 | S15 | v0.1.0] T19.1 SAML 2.0 single sign-on per workspace, own XML signature verification with wrapping defences ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-191 | S15 | v0.1.0] B7.6 Client status page with uptime probes, own portal domains with DNS verification and on-demand TLS ──
// ── [PCODE-169 | S15 | v0.1.0] B3.2 Documents and UI kit on the server: page tree, versions, comments, backlinks, templates, knowledge, tokens, components, mockups, assets ──
// ── [PCODE-168 | S15 | v0.1.0] B3.1 Ideation and files on the server: blob store, sources, requirements, questions, risks, assumptions, decisions, glossary, scores, extraction ──
// ── [PCODE-163 | S15 | v0.1.0] B1.2 Roles, clients and portal sign-in on the server ──
// ── [PCODE-151 | S15 | v0.1.0] Make the web app an installable PWA with Web Push ──
// ── [PCODE-88 | S15 | v0.1.0] Implement authentication: email and password, sessions, OIDC login ──
// ── [PCODE-123 | S15 | v0.1.0] Add the ideas inbox and the AI owner interview ──
// ── [PCODE-149 | S15 | v0.1.0] Bill through Stripe without its SDK: checkout, webhooks, licences ──
// ── [PCODE-150 | S15 | v0.1.0] Add the cloud tenant and harden sign-in, rate limits and headers ──
//    Why:  the account endpoints. Sign-up creates the person, their first workspace and an owner membership
//          in one transaction (with its activity events). Login answers the same for an unknown email and a
//          wrong password, in the same time, and slows guessing down. OIDC links a provider identity to a
//          user only through a verified email.
import { TRIAL_DAYS } from '@orqiva/shared';
import { requireSecondFactor, secondFactor } from './twofactor.js';
import { mfaRequired } from './magiclink.js'; // [PCODE-339 | S15 | v0.1.0]
import type { BillingDeps } from '../api/billing.js';
import type { PushDeps } from '../push/dispatch.js';
import type { ProviderFor } from '../agents/runner.js';
import { randomBytes } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Pool, PoolClient } from 'pg';
import { inSystem } from '../db/pool.js';
import { recordEvent } from '../events/outbox.js';
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s } from '../http/schema.js';
import { OidcClient, OidcError, pkcePair } from './oidc.js';
import {
  DUMMY_HASH,
  PASSWORD_MAX,
  PASSWORD_MIN,
  hashPassword,
  verifyPassword,
} from './password.js';
import { SharedRateLimiter, type Limiter } from './ratelimit.js'; // [PCODE-363 | S15 | v0.1.0]
import {
  clearedCookie,
  createSession,
  currentUser,
  deleteSession,
  sessionCookie,
} from './sessions.js';

import type { MailConfig } from '../mail/smtp.js'; // [PCODE-237 | S15 | v0.1.0]

export interface AuthDeps {
  pool: Pool;
  /** Secure cookies: on unless the server is reached over plain http (local development) */
  secureCookies: boolean;
  /** [PCODE-212 | S15 | v0.1.0] where people reach the server: SAML addresses are built from it */
  publicUrl?: string;
  oidc?: OidcClient;
  /** injectable for tests */
  limiter?: Limiter;
  /** [PCODE-362 | S15 | v0.1.0] where signing out continues (the SAML provider's logout), if anywhere */
  logoutRedirect?: (req: IncomingMessage) => Promise<string | null>;
  /** [PCODE-123 | S15 | v0.1.0] the model behind one-answer agent calls (interview, proposal); tests script it */
  models?: ProviderFor;
  /** [PCODE-240 | S15 | v0.1.0] how the AI connections reach their providers; tests give recorded answers */
  aiFetch?: typeof fetch;
  /** [PCODE-149 | S15 | v0.1.0] Stripe calls and settings; tests give a fake */
  billing?: BillingDeps;
  /** [PCODE-151 | S15 | v0.1.0] Web Push: the contact the push services see, and fakes for tests */
  push?: PushDeps & { subject?: string };
  /** [PCODE-168 | S15 | v0.1.0] where the blob store keeps uploaded bytes */
  dataDir?: string;
  /** [PCODE-169 | S15 | v0.1.0] the documents' link check; tests let it reach the test server */
  linkCheck?: { allowPrivate?: boolean };
  /** [PCODE-191 | S15 | v0.1.0] DNS lookups for portal domains (tests fake them) */
  status?: { resolveTxt?: (name: string) => Promise<string[][]> };
  /** [PCODE-237 | S15 | v0.1.0] the mail server; null or absent: this server sends no mail */
  mail?: MailConfig | null;
  /** [PCODE-322 | S15 | v0.1.0] where the vulnerability feeds are read; tests give recorded answers */
  vulnFeeds?: import('../security/feeds.js').FeedDeps;
  /** [PCODE-324 | S15 | v0.1.0] how fix pull requests reach the Git hosts; tests give a stand-in */
  hostFetch?: typeof fetch;
}

const userSchema = s.object({ id: s.string(), email: s.string(), name: s.string() });
const workspaceSchema = s.object({
  id: s.string(),
  slug: s.string(),
  name: s.string(),
  role: s.string(),
  // [PCODE-163 | S15 | v0.1.0] set when the person sees this workspace as a client's contact (the portal)
  client: s.nullable(
    s.object({
      id: s.string(),
      name: s.string(),
      portalRoles: s.array(s.string()),
      language: s.optional(s.string()), // [PCODE-356 | S15 | v0.1.0] the language the client is spoken to in
    }),
  ),
});
const redirect = s.object({ redirect: s.string() });

const normaliseEmail = (e: string): string => e.trim().toLowerCase();

const unauthorized = (): HttpError =>
  new HttpError(401, 'unauthorized', 'Email or password is wrong');

function slugify(name: string): string {
  const base = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return (base.length >= 2 ? base : 'workspace') + '-' + randomBytes(3).toString('hex');
}

/** Creates a workspace owned by `userId`, with its activity events, inside the caller's system transaction. */
// [PCODE-92 | S15 | v0.1.0] also used by POST /api/workspaces
export async function createWorkspace(
  c: PoolClient,
  userId: string,
  userName: string,
  name: string,
  // [PCODE-150 | S15 | v0.1.0] days of trial for a workspace made in the cloud; none elsewhere
  trialDays = 0,
): Promise<{ id: string; slug: string; name: string; role: string }> {
  const ws = (
    await c.query<{ id: string; slug: string; name: string }>(
      `INSERT INTO workspaces (slug, name, trial_ends_at)
       VALUES ($1, $2, CASE WHEN $3::int > 0 THEN now() + make_interval(days => $3::int) END) RETURNING id, slug, name`,
      [slugify(name), name, trialDays],
    )
  ).rows[0];
  if (!ws) throw new Error('workspace insert returned nothing');
  await c.query(
    "INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'owner')",
    [ws.id, userId],
  );
  const actor = { kind: 'user' as const, id: userId, name: userName };
  await recordEvent(c, ws.id, {
    actor,
    verb: 'created',
    object: { type: 'workspace', id: ws.id, label: ws.name },
  });
  await recordEvent(c, ws.id, {
    actor,
    verb: 'created',
    object: { type: 'member', id: userId, label: userName },
    parent: { type: 'workspace', id: ws.id },
  });
  return { ...ws, role: 'owner' };
}

async function workspacesOf(
  pool: Pool,
  userId: string,
): Promise<
  {
    id: string;
    slug: string;
    name: string;
    role: string;
    client: { id: string; name: string; portalRoles: string[]; language: string } | null;
  }[]
> {
  return inSystem(pool, async (c) =>
    (
      await c.query<{
        id: string;
        slug: string;
        name: string;
        role: string;
        client_id: string | null;
        client_name: string | null;
        roles: string[] | null;
        client_language: string | null; // [PCODE-356 | S15 | v0.1.0]
      }>(
        // [PCODE-163 | S15 | v0.1.0] and the client, when they are a client's contact there
        `SELECT w.id, w.slug, w.name, m.role, cl.id AS client_id, cl.name AS client_name, cl.language AS client_language,
                (SELECT array_agg(cc.portal_role ORDER BY cc.portal_role) FROM client_contacts cc WHERE cc.user_id = m.user_id AND cc.client_id = cl.id) AS roles
         FROM workspace_members m JOIN workspaces w ON w.id = m.workspace_id
         LEFT JOIN LATERAL (SELECT c2.id, c2.name, c2.language FROM client_contacts x JOIN clients c2 ON c2.id = x.client_id
                            WHERE x.user_id = m.user_id AND x.workspace_id = w.id LIMIT 1) cl ON true
         -- [PCODE-182 | S15 | v0.1.0] not where the membership is suspended
         WHERE m.user_id = $1 AND m.suspended_at IS NULL ORDER BY w.created_at`,
        [userId],
      )
    ).rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      name: r.name,
      role: r.role,
      client: r.client_id
        ? {
            id: r.client_id,
            name: r.client_name ?? '',
            portalRoles: r.roles ?? [],
            language: r.client_language ?? 'en',
          }
        : null,
    })),
  );
}

const clientIp = (req: IncomingMessage): string => req.socket.remoteAddress ?? 'unknown';

export function authRoutes(deps: AuthDeps): Route[] {
  const { pool, secureCookies } = deps;
  // [PCODE-363 | S15 | v0.1.0] counted for the whole cluster
  const limiter = deps.limiter ?? new SharedRateLimiter(pool, 'sign-in', 10, 15 * 60_000);

  const signup = route({
    method: 'POST',
    path: '/auth/signup',
    summary: 'Create an account and its first workspace, and sign in',
    tags: ['auth'],
    body: s.object({
      email: s.string({ format: 'email', max: 254 }),
      name: s.string({ min: 1, max: 200 }),
      password: s.string({ min: PASSWORD_MIN, max: PASSWORD_MAX }),
      workspaceName: s.string({ min: 1, max: 200 }),
    }),
    response: s.object({ user: userSchema, workspace: workspaceSchema }),
    status: 201,
    handler: async ({ body, req }) => {
      const email = normaliseEmail(body.email);
      const hash = await hashPassword(body.password);
      const created = await inSystem(pool, async (c) => {
        const exists = await c.query('SELECT 1 FROM users WHERE email = $1', [email]);
        if (exists.rowCount)
          throw new HttpError(
            409,
            'conflict',
            'An account with this email exists; sign in instead',
          );
        const user = (
          await c.query<{ id: string; email: string; name: string }>(
            'INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3) RETURNING id, email, name',
            [email, body.name.trim(), hash],
          )
        ).rows[0];
        if (!user) throw new Error('user insert returned nothing');
        // [PCODE-150 | S15 | v0.1.0] in the cloud, a new account's workspace starts on a trial
        const workspace = await createWorkspace(
          c,
          user.id,
          user.name,
          body.workspaceName.trim(),
          process.env['ORQIVA_MODE'] === 'cloud' ? TRIAL_DAYS : 0,
        );
        // [PCODE-163 | S15 | v0.1.0] the founder is in the team, not a client
        return { user, workspace: { ...workspace, client: null } };
      });
      const token = await createSession(pool, created.user.id, req);
      return {
        status: 201,
        body: created,
        headers: { 'set-cookie': sessionCookie(token, secureCookies) },
      };
    },
  });

  const login = route({
    method: 'POST',
    path: '/auth/login',
    summary: 'Sign in with email and password',
    tags: ['auth'],
    body: s.object({
      email: s.string({ max: 254 }),
      password: s.string({ max: PASSWORD_MAX }),
      // [PCODE-150 | S15 | v0.1.0] the second factor, when the account has one
      code: s.optional(s.string({ max: 20 })),
      recoveryCode: s.optional(s.string({ max: 40 })),
    }),
    response: s.object({ user: userSchema }),
    handler: async ({ body, req }) => {
      const email = normaliseEmail(body.email);
      const keys = ['email:' + email, 'ip:' + clientIp(req)];
      let allowed = true;
      for (const k of keys) if (!(await limiter.allowed(k))) allowed = false;
      if (!allowed) {
        throw new HttpError(
          429,
          'too_many_requests',
          'Too many attempts; wait a few minutes and try again',
        );
      }
      const user = await inSystem(
        pool,
        async (c) =>
          (
            await c.query<{
              id: string;
              email: string;
              name: string;
              password_hash: string | null;
            }>('SELECT id, email, name, password_hash FROM users WHERE email = $1', [email])
          ).rows[0],
      );
      // an unknown email costs the same scrypt as a known one, so timing does not reveal accounts
      const valid = await verifyPassword(body.password, user?.password_hash ?? DUMMY_HASH);
      if (!user || !user.password_hash || !valid) {
        for (const k of keys) await limiter.fail(k);
        throw unauthorized();
      }
      // [PCODE-150 | S15 | v0.1.0] a password alone is not enough when the second factor is on
      const factor = await inSystem(pool, (c) =>
        secondFactor(c, user.id, body.code, body.recoveryCode),
      );
      if (factor === 'wrong') for (const k of keys) await limiter.fail(k);
      requireSecondFactor(factor);
      // [PCODE-339 | S15 | v0.1.0] a client that requires a second factor: it is set up through the sign-in link
      if (factor === 'none' && (await inSystem(pool, (c) => mfaRequired(c, user.id))))
        throw new HttpError(
          401,
          'unauthorized',
          'Your client requires a second factor: ask for a sign-in link to set it up',
        );
      await limiter.reset('email:' + email);
      const token = await createSession(pool, user.id, req);
      return {
        body: { user: { id: user.id, email: user.email, name: user.name } },
        headers: { 'set-cookie': sessionCookie(token, secureCookies) },
      };
    },
  });

  const logout = route({
    method: 'POST',
    path: '/auth/logout',
    summary: 'Sign out: the session stops working at once',
    tags: ['auth'],
    // [PCODE-362 | S15 | v0.1.0] and, after SAML, where to tell the identity provider
    response: s.object({ ok: s.literal(true), redirect: s.optional(s.string()) }),
    handler: async ({ req }) => {
      const redirect = deps.logoutRedirect ? await deps.logoutRedirect(req) : null;
      await deleteSession(pool, req);
      return {
        body: { ok: true as const, ...(redirect ? { redirect } : {}) },
        headers: { 'set-cookie': clearedCookie(secureCookies) },
      };
    },
  });

  const me = route({
    method: 'GET',
    path: '/auth/me',
    summary: 'The signed-in user and their workspaces',
    tags: ['auth'],
    response: s.object({ user: userSchema, workspaces: s.array(workspaceSchema) }),
    handler: async ({ req }) => {
      const user = await currentUser(pool, req);
      if (!user) throw new HttpError(401, 'unauthorized', 'Not signed in');
      return { body: { user, workspaces: await workspacesOf(pool, user.id) } };
    },
  });

  // [PCODE-90 | S15 | v0.1.0] the sign-in screen offers company login only when it is configured
  const providers = route({
    method: 'GET',
    path: '/auth/providers',
    summary: 'Which ways of signing in this server offers',
    tags: ['auth'],
    response: s.object({ password: s.literal(true), oidc: s.boolean() }),
    handler: () => ({ body: { password: true as const, oidc: deps.oidc !== undefined } }),
  });

  const routes = [signup, login, logout, me, providers];
  const oidc = deps.oidc;
  if (!oidc) return routes;

  const oidcStart = route({
    method: 'GET',
    path: '/auth/oidc/start',
    summary: 'Start a company login: redirects to the identity provider',
    tags: ['auth'],
    response: redirect,
    status: 302,
    handler: async () => {
      const state = randomBytes(24).toString('base64url');
      const nonce = randomBytes(24).toString('base64url');
      const { verifier, challenge } = pkcePair();
      await inSystem(pool, async (c) => {
        await c.query(
          "DELETE FROM oidc_login_states WHERE created_at < now() - interval '10 minutes'",
        );
        await c.query(
          'INSERT INTO oidc_login_states (state, code_verifier, nonce) VALUES ($1, $2, $3)',
          [state, verifier, nonce],
        );
      });
      const url = await oidc.authorizeUrl(state, nonce, challenge);
      return { status: 302, body: { redirect: url }, headers: { location: url } };
    },
  });

  const oidcCallback = route({
    method: 'GET',
    path: '/auth/oidc/callback',
    summary: 'The identity provider returns here; signs the user in and redirects to the app',
    tags: ['auth'],
    query: s.object({
      code: s.optional(s.string({ max: 4096 })),
      state: s.optional(s.string({ max: 256 })),
      error: s.optional(s.string({ max: 256 })),
      error_description: s.optional(s.string({ max: 1024 })),
      session_state: s.optional(s.string({ max: 1024 })),
      iss: s.optional(s.string({ max: 1024 })),
    }),
    response: redirect,
    status: 302,
    handler: async ({ query, req }) => {
      if (query.error)
        throw new HttpError(
          401,
          'unauthorized',
          'The identity provider refused the login: ' + query.error,
        );
      if (!query.code || !query.state)
        throw new HttpError(400, 'invalid_request', 'The callback needs code and state');
      const { code, state } = query;
      const pending = await inSystem(
        pool,
        async (c) =>
          (
            await c.query<{ code_verifier: string; nonce: string }>(
              "DELETE FROM oidc_login_states WHERE state = $1 AND created_at > now() - interval '10 minutes' RETURNING code_verifier, nonce",
              [state],
            )
          ).rows[0],
      );
      if (!pending)
        throw new HttpError(
          401,
          'unauthorized',
          'This login has expired or was already used; start again',
        );
      let claims;
      try {
        claims = await oidc.finish(code, pending.code_verifier, pending.nonce);
      } catch (err) {
        if (err instanceof OidcError) throw new HttpError(401, 'unauthorized', err.message);
        throw err;
      }
      const verified = claims;
      const userId = await inSystem(pool, async (c) => {
        const linked = (
          await c.query<{ user_id: string }>(
            'SELECT user_id FROM oidc_identities WHERE issuer = $1 AND subject = $2',
            [verified.iss, verified.sub],
          )
        ).rows[0];
        if (linked) return linked.user_id;
        // linking by email only when the provider vouches for it: anything else would allow account takeover
        if (!verified.email || verified.email_verified !== true) {
          throw new HttpError(
            403,
            'forbidden',
            'The identity provider did not confirm this email address',
          );
        }
        const email = normaliseEmail(verified.email);
        let user = (
          await c.query<{ id: string; name: string }>(
            'SELECT id, name FROM users WHERE email = $1',
            [email],
          )
        ).rows[0];
        if (!user) {
          const name = verified.name?.trim() || email.split('@')[0] || email;
          user = (
            await c.query<{ id: string; name: string }>(
              'INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id, name',
              [email, name],
            )
          ).rows[0];
          if (!user) throw new Error('user insert returned nothing');
          await createWorkspace(c, user.id, user.name, user.name + "'s workspace");
        }
        await c.query(
          'INSERT INTO oidc_identities (user_id, issuer, subject) VALUES ($1, $2, $3)',
          [user.id, verified.iss, verified.sub],
        );
        return user.id;
      });
      const token = await createSession(pool, userId, req);
      return {
        status: 302,
        body: { redirect: '/' },
        headers: { location: '/', 'set-cookie': sessionCookie(token, secureCookies) },
      };
    },
  });

  return [...routes, oidcStart, oidcCallback];
}
