// ── [PCODE-362 | S15 | v0.1.0] T35.7d SAML single logout ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-182 | S15 | v0.1.0] B5.3 People live: members, teams, roles, sign-in rules and sessions, access reviews, access checker, offboarding ──
// ── [PCODE-181 | S15 | v0.1.0] B5.2 Tokens and costs live: AI spend, budgets, prices, provider keys per project, access tokens with scopes, policy, leak revocation ──
// ── [PCODE-88 | S15 | v0.1.0] Implement authentication: email and password, sessions, OIDC login ──
// ── [PCODE-102 | S15 | v0.1.0] Port the engine's loop to the server: sync, start, status, note, done ──
//    Why:  a session is 32 random bytes in an HttpOnly cookie; the database keeps only its SHA-256, so a
//          stolen backup holds no session that works. Logging out deletes the row, which revokes it at once.
import { ipAllowed, TOKEN_PREFIX, TOKEN_SHAPE, type TokenKind } from '@orqiva/shared';
import { createHash, randomBytes } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Pool } from 'pg';
import { inSystem } from '../db/pool.js';

// [PCODE-192 | S15 | v0.1.0] new sign-ins get orq_session; a pe_session from before still counts
export const SESSION_COOKIE = 'orq_session';
export const LEGACY_SESSION_COOKIE = 'pe_session';

/** The session token a request carries, under the new or the old cookie name. */
export const sessionFromCookies = (header: string | undefined): string | undefined => {
  const all = parseCookies(header);
  return all[SESSION_COOKIE] ?? all[LEGACY_SESSION_COOKIE];
};
export const SESSION_DAYS = 30;

export interface SessionUser {
  id: string;
  email: string;
  name: string;
}

// [PCODE-181 | S15 | v0.1.0] what a request's token may do: its workspace, scopes and kind
export interface TokenAccess {
  id: string;
  kind: string;
  workspaceId: string | null;
  scopes: string[];
}
const tokens = new WeakMap<IncomingMessage, TokenAccess>();
/** The token a request came with, or undefined for a browser session. */
export const tokenOf = (req: IncomingMessage): TokenAccess | undefined => tokens.get(req);
const addressOf = (req: IncomingMessage): string => req.socket.remoteAddress ?? '';

const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    if (name) out[name] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
}

export function sessionCookie(token: string, secure: boolean): string {
  return [
    SESSION_COOKIE + '=' + token,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=' + String(SESSION_DAYS * 24 * 3600),
    ...(secure ? ['Secure'] : []),
  ].join('; ');
}

export function clearedCookie(secure: boolean): string {
  return [
    SESSION_COOKIE + '=',
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
    ...(secure ? ['Secure'] : []),
  ].join('; ');
}

/** Creates a session and returns the token for the cookie (the only time it exists in clear). */
/** [PCODE-362 | S15 | v0.1.0] who a SAML provider said the session's person was, for single logout */
export interface SessionSaml {
  workspaceId: string;
  nameId: string;
  nameIdFormat: string;
  sessionIndex: string | null;
}

export async function createSession(
  pool: Pool,
  userId: string,
  // [PCODE-182 | S15 | v0.1.0] the device and address, so people can see their sessions
  req?: IncomingMessage,
  saml?: SessionSaml, // [PCODE-362 | S15 | v0.1.0]
): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await inSystem(pool, (c) =>
    c.query(
      `INSERT INTO sessions (user_id, token_hash, expires_at, user_agent, ip,
         saml_workspace_id, saml_name_id, saml_name_id_format, saml_session_index)
       VALUES ($1, $2, now() + make_interval(days => $3), $4, $5, $6, $7, $8, $9)`,
      [
        userId,
        sha256(token),
        SESSION_DAYS,
        (req?.headers['user-agent'] ?? '').slice(0, 300),
        req ? addressOf(req).slice(0, 60) : '',
        saml?.workspaceId ?? null,
        saml?.nameId ?? null,
        saml?.nameIdFormat ?? null,
        saml?.sessionIndex ?? null,
      ],
    ),
  );
  return token;
}

/** [PCODE-362 | S15 | v0.1.0] The SAML side of the request's session, when it began with SAML. */
export async function sessionSaml(pool: Pool, req: IncomingMessage): Promise<SessionSaml | null> {
  const token = sessionFromCookies(req.headers.cookie);
  if (!token) return null;
  const row = (
    await inSystem(pool, (c) =>
      c.query<{
        saml_workspace_id: string | null;
        saml_name_id: string | null;
        saml_name_id_format: string | null;
        saml_session_index: string | null;
      }>(
        'SELECT saml_workspace_id, saml_name_id, saml_name_id_format, saml_session_index FROM sessions WHERE token_hash = $1',
        [sha256(token)],
      ),
    )
  ).rows[0];
  if (!row?.saml_workspace_id || !row.saml_name_id) return null;
  return {
    workspaceId: row.saml_workspace_id,
    nameId: row.saml_name_id,
    nameIdFormat: row.saml_name_id_format ?? '',
    sessionIndex: row.saml_session_index,
  };
}

// [PCODE-182 | S15 | v0.1.0] the session a request came with: when it began and when it was last used before
export interface SessionAccess {
  id: string;
  createdAt: Date;
  lastSeenBefore: Date;
}
const sessionsOfReq = new WeakMap<IncomingMessage, SessionAccess>();
export const sessionOf = (req: IncomingMessage): SessionAccess | undefined =>
  sessionsOfReq.get(req);

/** The signed-in user of a request, or null. Touches last_seen_at at most once a minute. */
export async function currentUser(pool: Pool, req: IncomingMessage): Promise<SessionUser | null> {
  // [PCODE-102 | S15 | v0.1.0] tools that are not a browser send a personal API token instead of the cookie
  const bearer = /^Bearer (\S+)$/.exec(req.headers.authorization ?? '')?.[1];
  if (bearer && TOKEN_SHAPE.test(bearer)) {
    const found = await tokenUser(pool, bearer, addressOf(req));
    if (found) tokens.set(req, found.token);
    return found?.user ?? null;
  }
  const token = sessionFromCookies(req.headers.cookie);
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  return inSystem(pool, async (c) => {
    const row = (
      await c.query<SessionUser & { session_id: string; created_at: Date; before: Date }>(
        `WITH old AS (SELECT id, last_seen_at FROM sessions WHERE token_hash = $1)
         UPDATE sessions s SET last_seen_at = CASE WHEN s.last_seen_at < now() - interval '1 minute' THEN now() ELSE s.last_seen_at END
         FROM users u, old WHERE s.user_id = u.id AND s.id = old.id AND s.expires_at > now()
         RETURNING s.id AS session_id, u.id, u.email, u.name, s.created_at, old.last_seen_at AS before`,
        [sha256(token)],
      )
    ).rows[0];
    if (row)
      sessionsOfReq.set(req, {
        id: row.session_id,
        createdAt: row.created_at,
        lastSeenBefore: row.before,
      });
    return row ? { id: row.id, email: row.email, name: row.name } : null;
  });
}

/**
 * [PCODE-102 | S15 | v0.1.0] The person a personal API token belongs to, if it is valid.
 * [PCODE-181 | S15 | v0.1.0] A token waiting for approval does not work; a token bound to a workspace
 * works only from the addresses its policy allows. Every use counts, with the address it came from.
 */
async function tokenUser(
  pool: Pool,
  token: string,
  ip: string,
): Promise<{ user: SessionUser; token: TokenAccess } | null> {
  return inSystem(pool, async (c) => {
    const row = (
      await c.query<
        SessionUser & {
          token_id: string;
          kind: string;
          workspace_id: string | null;
          scopes: string[];
          allow: string[] | null;
        }
      >(
        `SELECT u.id, u.email, u.name, t.id AS token_id, t.kind, t.workspace_id, t.scopes, p.ip_allow AS allow
           FROM api_tokens t JOIN users u ON u.id = t.user_id LEFT JOIN token_policies p ON p.workspace_id = t.workspace_id
          WHERE t.token_hash = $1 AND t.revoked_at IS NULL AND t.state = 'active' AND (t.expires_at IS NULL OR t.expires_at > now())
            AND (p.revoke_unused_days IS NULL OR coalesce(t.last_used_at, t.created_at) > now() - make_interval(days => p.revoke_unused_days))`,
        [sha256(token)],
      )
    ).rows[0];
    if (!row) return null;
    if (row.allow && !ipAllowed(ip, row.allow)) return null;
    await c.query(
      `UPDATE api_tokens SET use_count = use_count + 1, last_used_ip = $2,
              last_used_at = CASE WHEN last_used_at IS NULL OR last_used_at < now() - interval '1 minute' THEN now() ELSE last_used_at END
        WHERE id = $1`,
      [row.token_id, ip.slice(0, 60)],
    );
    return {
      user: { id: row.id, email: row.email, name: row.name },
      token: {
        id: row.token_id,
        kind: row.kind,
        workspaceId: row.workspace_id,
        scopes: row.scopes,
      },
    };
  });
}

/** [PCODE-102 | S15 | v0.1.0] A new personal API token; the clear value exists only in the answer. */
export async function createApiToken(
  pool: Pool,
  userId: string,
  name: string,
  // [PCODE-181 | S15 | v0.1.0] kind, workspace, scopes, expiry and whether it waits for an admin
  opts: {
    kind?: TokenKind;
    workspaceId?: string | null;
    scopes?: string[];
    expiresAt?: Date | null;
    pending?: boolean;
    createdBy?: string;
  } = {},
): Promise<{ id: string; token: string }> {
  const kind = opts.kind ?? 'personal';
  const token = TOKEN_PREFIX[kind] + randomBytes(32).toString('base64url');
  const id = await inSystem(
    pool,
    async (c) =>
      (
        await c.query<{ id: string }>(
          `INSERT INTO api_tokens (user_id, name, token_hash, kind, workspace_id, scopes, expires_at, state, created_by, prefix)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
          [
            userId,
            name,
            sha256(token),
            kind,
            opts.workspaceId ?? null,
            opts.scopes ?? [],
            opts.expiresAt ?? null,
            opts.pending ? 'pending' : 'active',
            opts.createdBy ?? userId,
            TOKEN_PREFIX[kind],
          ],
        )
      ).rows[0]?.id,
  );
  if (!id) throw new Error('token insert returned nothing');
  return { id, token };
}

export async function deleteSession(pool: Pool, req: IncomingMessage): Promise<void> {
  const token = sessionFromCookies(req.headers.cookie);
  if (!token) return;
  await inSystem(pool, (c) =>
    c.query('DELETE FROM sessions WHERE token_hash = $1', [sha256(token)]),
  );
}
