// ── [PCODE-359 | S15 | v0.1.0] T35.7a Plan contents enforced ──
// ── [PCODE-193 | S15 | v0.1.0] B8.1 VS Code on the Orqiva server: task panel with comments, inbox and approvals, timer, CodeLens without Plane ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-182 | S15 | v0.1.0] B5.3 People live: members, teams, roles, sign-in rules and sessions, access reviews, access checker, offboarding ──
// ── [PCODE-163 | S15 | v0.1.0] B1.2 Roles, clients and portal sign-in on the server ──
// ── [PCODE-148 | S15 | v0.1.0] Add signed licence keys with seats, features and expiry ──
// ── [PCODE-150 | S15 | v0.1.0] Add the cloud tenant and harden sign-in, rate limits and headers ──
// ── [PCODE-149 | S15 | v0.1.0] Bill through Stripe without its SDK: checkout, webhooks, licences ──
//    Why:  licences are checked offline: the token's Ed25519 signature against the public key built into
//          the server, then its content. A workspace's entitlement comes from its own licence, else from
//          ORQIVA_LICENCE (one licence for a self-hosted install), else the free plan; it decides
//          whether another member may join, and says why not when the answer is no.
import { createPrivateKey, createPublicKey, sign, verify, type KeyObject } from 'node:crypto';
import {
  entitlementOf,
  LICENCE_PUBLIC_KEY,
  licenceProblems,
  mayAddMember,
  planOfFeature,
  PREFIX,
  splitLicence,
  TEAM_PROJECTS,
  type Entitlement,
  type Licence,
} from '@orqiva/shared';
import type { PoolClient } from 'pg';
import { HttpError } from '../http/errors.js';

let publicKey: KeyObject = createPublicKey(LICENCE_PUBLIC_KEY);

/** Tests sign with a key of their own; nothing else calls this. */
export function useLicenceKeyForTests(pem: string): void {
  publicKey = createPublicKey(pem);
}

/** The licence inside a token, if its signature and content are sound. */
export function verifyLicence(token: string): { licence: Licence } | { problem: string } {
  const parts = splitLicence(token);
  if (!parts) return { problem: 'This is not an Orqiva licence (it should start with PE1.)' };
  const payload = Buffer.from(parts.payload, 'base64url');
  let ok = false;
  try {
    ok = verify(null, payload, publicKey, Buffer.from(parts.signature, 'base64url'));
  } catch {
    ok = false;
  }
  if (!ok)
    return {
      problem: 'The licence’s signature does not match; it was changed or not issued by us',
    };
  let content: unknown;
  try {
    content = JSON.parse(payload.toString('utf8'));
  } catch {
    return { problem: 'The licence cannot be read' };
  }
  const problems = licenceProblems(content);
  if (problems.length) return { problem: 'The licence is incomplete: ' + problems.join('; ') };
  return { licence: content as Licence };
}

/** The workspace's entitlement now: its licence (or the install's), its members, the date. */
export async function entitlement(
  c: PoolClient,
  workspaceId: string,
  now = new Date(),
): Promise<Entitlement & { source: 'workspace' | 'install' | 'none' }> {
  const own = (
    await c.query<{ token: string }>(
      'SELECT token FROM workspace_licences WHERE workspace_id = $1',
      [workspaceId],
    )
  ).rows[0]?.token;
  const install = process.env['ORQIVA_LICENCE'];
  const token = own ?? install;
  const verified = token ? verifyLicence(token) : null;
  const licence = verified && 'licence' in verified ? verified.licence : null;
  const members = Number(
    (
      await c.query<{ n: string }>(
        // [PCODE-163 | S15 | v0.1.0] client contacts use the portal for free; they take no seat
        `SELECT count(*) AS n FROM workspace_members m WHERE m.workspace_id = $1
           AND NOT EXISTS (SELECT 1 FROM client_contacts cc WHERE cc.workspace_id = $1 AND cc.user_id = m.user_id)
           -- [PCODE-182 | S15 | v0.1.0] suspended people and service accounts take no seat
           AND m.suspended_at IS NULL AND NOT EXISTS (SELECT 1 FROM users su WHERE su.id = m.user_id AND su.is_service)`,
        [workspaceId],
      )
    ).rows[0]?.n ?? 0,
  );
  // [PCODE-150 | S15 | v0.1.0] a cloud workspace's trial, while no licence is installed
  const trial =
    (
      await c.query<{ trial_ends_at: Date | null }>(
        'SELECT trial_ends_at FROM workspaces WHERE id = $1',
        [workspaceId],
      )
    ).rows[0]?.trial_ends_at ?? null;
  return {
    ...entitlementOf(licence, members, now, trial),
    source: licence ? (own ? 'workspace' : 'install') : 'none',
  };
}

/** Refuses with the reason when another member may not join the workspace. */
export async function checkSeat(c: PoolClient, workspaceId: string): Promise<void> {
  const e = await entitlement(c, workspaceId);
  if (!mayAddMember(e))
    throw new HttpError(
      409,
      'conflict',
      e.problem ||
        'All ' +
          String(e.seats) +
          ' seats are taken' +
          (e.plan === 'free'
            ? ' (free plan); add a licence for more'
            : '; add seats to the licence'),
    );
}

// ── [PCODE-219 | S15 | v0.1.0] the plan rules that were only on paper: a feature needs a licence that carries it ──
/** Refuses with the reason when the workspace's licence does not include `feature` (e.g. "sso"). */
export async function requireFeature(
  c: PoolClient,
  workspaceId: string,
  feature: string,
  what: string,
): Promise<void> {
  const e = await entitlement(c, workspaceId);
  if (!e.features.includes(feature))
    throw new HttpError(
      403,
      'forbidden',
      what +
        // [PCODE-359 | S15 | v0.1.0] the plan that holds it
        ' is part of the ' +
        planOfFeature(feature) +
        ' plan. Install a licence that includes it (Settings → Plan and billing)' +
        (e.status === 'expired' ? '; the current licence has expired' : ''),
    );
}

// [PCODE-359 | S15 | v0.1.0] the Team plan's project limit
/** Refuses another active project when the plan holds only TEAM_PROJECTS of them. */
export async function requireProjectRoom(c: PoolClient, workspaceId: string): Promise<void> {
  const e = await entitlement(c, workspaceId);
  if (e.features.includes('projects-unlimited')) return;
  const n = Number(
    (
      await c.query<{ n: string }>(
        'SELECT count(*) AS n FROM projects WHERE workspace_id = $1 AND archived_at IS NULL',
        [workspaceId],
      )
    ).rows[0]?.n ?? 0,
  );
  if (n >= TEAM_PROJECTS)
    throw new HttpError(
      403,
      'forbidden',
      'The Team plan holds ' +
        String(TEAM_PROJECTS) +
        ' active projects. Archive one, or move to the Business plan for any number (Settings → Plan and billing)',
    );
}

/** [PCODE-149 | S15 | v0.1.0] Signs a licence on the vendor's billing server, with the key from its file. */
export function signLicence(licence: Licence, privateKeyPem: string): string {
  const problems = licenceProblems(licence);
  if (problems.length) throw new Error('The licence is incomplete: ' + problems.join('; '));
  const payload = Buffer.from(JSON.stringify(licence), 'utf8');
  return (
    PREFIX +
    payload.toString('base64url') +
    '.' +
    sign(null, payload, createPrivateKey(privateKeyPem)).toString('base64url')
  );
}
