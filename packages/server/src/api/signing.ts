// ── [PCODE-277 | S15 | v0.1.0] T28.6 PRD approval by named approvers, reopen on edit, promote to an epic with stories, client in ideation ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-125 | S15 | v0.1.0] Approve proposals with an electronic signature and turn them into a plan ──
//    Why:  the fourth stage, the owner's go / no-go. Only the workspace owner signs, only the latest version,
//          by typing their own name and agreeing to the stated text. The signature keeps a SHA-256 of the
//          exact version signed. Approval creates the proposal's tasks in the project backlog, in one
//          transaction with the signature, so a plan exists exactly when an approval does.
import { createHash } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { canonicalJson, sameName, SIGN_CONSENT, type ProposalContent } from '@orqiva/shared';
import type { Pool, PoolClient } from 'pg';
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s, type Infer } from '../http/schema.js';
import { asMember, isUniqueViolation, type Access } from './access.js';
import { ideaEvent, ideaJson, ideaOut, visibleIdea } from './ideas.js';
import { PROPOSAL_SELECT, type ProposalRow } from './proposals.js';

const uuid = s.string({ format: 'uuid' });
const params = s.object({ workspaceId: uuid, ideaId: uuid });

/** The fingerprint of what is signed: the idea's title, the version and its content. */
export function proposalHash(title: string, version: number, content: ProposalContent): string {
  return createHash('sha256').update(canonicalJson({ title, version, content })).digest('hex');
}

const signatureOut = s.object({
  id: s.string(),
  decision: s.string(),
  version: s.number({ integer: true }),
  typedName: s.string(),
  signer: s.string(),
  signerEmail: s.string(),
  consent: s.string(),
  contentSha256: s.string(),
  note: s.string(),
  signedAt: s.string(),
});
const planItemOut = s.object({
  id: s.string(),
  ref: s.string(),
  title: s.string(),
  estimate: s.nullable(s.number()),
});
const decisionOut = s.object({
  idea: ideaOut,
  signatures: s.array(signatureOut),
  plan: s.array(planItemOut),
});

interface SignatureRow {
  id: string;
  decision: string;
  version: number;
  typed_name: string;
  account_name: string;
  account_email: string;
  consent_text: string;
  content_sha256: string;
  note: string;
  signed_at: Date;
}

async function decision(
  c: PoolClient,
  a: Access,
  ideaId: string,
): Promise<Infer<typeof decisionOut>> {
  const idea = await visibleIdea(c, a, ideaId);
  const signatures = (
    await c.query<SignatureRow>(
      `SELECT s.*, p.version FROM proposal_signatures s JOIN proposals p ON p.id = s.proposal_id
        WHERE s.idea_id = $1 ORDER BY s.signed_at DESC`,
      [idea.id],
    )
  ).rows;
  const plan = (
    await c.query<{ id: string; ref: string; title: string; estimate: number | null }>(
      `SELECT i.id, p.key || '-' || i.sequence AS ref, i.title, i.estimate
         FROM idea_items x JOIN items i ON i.id = x.item_id JOIN projects p ON p.id = i.project_id
        WHERE x.idea_id = $1 ORDER BY x.position`,
      [idea.id],
    )
  ).rows;
  return {
    idea: ideaJson(idea),
    signatures: signatures.map((r) => ({
      id: r.id,
      decision: r.decision,
      version: r.version,
      typedName: r.typed_name,
      signer: r.account_name,
      signerEmail: r.account_email,
      consent: r.consent_text,
      contentSha256: r.content_sha256,
      note: r.note,
      signedAt: r.signed_at.toISOString(),
    })),
    plan,
  };
}

const clientIp = (req: IncomingMessage): string => req.socket.remoteAddress ?? '';

export function signingRoutes(pool: Pool): Route[] {
  const get = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/ideas/:ideaId/decision',
    summary: 'The signatures on the idea’s proposal and the tasks its approval created',
    tags: ['ideas'],
    params,
    response: decisionOut,
    handler: ({ params: p, req }) =>
      asMember(pool, req, p.workspaceId, 'guest', async (c, a) => ({
        body: await decision(c, a, p.ideaId),
      })),
  });

  const sign = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/ideas/:ideaId/sign',
    summary:
      'The owner approves or declines the latest proposal version with an electronic signature, when no approvers are named; promotion then creates the epic (owner)',
    tags: ['ideas'],
    params,
    body: s.object({
      version: s.number({ integer: true, min: 1 }),
      decision: s.enum(['approve', 'decline']),
      name: s.string({ min: 1, max: 200 }),
      consent: s.boolean(),
      note: s.optional(s.string({ max: 2000 })),
    }),
    response: decisionOut,
    handler: ({ params: p, body, req }) =>
      asMember(pool, req, p.workspaceId, 'owner', async (c, a) => {
        const idea = await visibleIdea(c, a, p.ideaId);
        await c.query('SELECT 1 FROM ideas WHERE id = $1 FOR UPDATE', [idea.id]);
        // [PCODE-277 | S15 | v0.1.0] named approvers decide in the review; the owner signs alone only without them
        const named = (
          await c.query('SELECT 1 FROM idea_approvers WHERE idea_id = $1 LIMIT 1', [idea.id])
        ).rowCount;
        if (named)
          throw new HttpError(
            409,
            'conflict',
            'This PRD has named approvers: they decide in its review',
          );
        if (idea.status !== 'proposed')
          throw new HttpError(
            409,
            'conflict',
            idea.status === 'approved' || idea.status === 'declined'
              ? 'This idea is already ' + idea.status
              : 'There is no proposal to sign yet',
          );
        const latest = (
          await c.query<ProposalRow>(
            PROPOSAL_SELECT + ' WHERE pr.idea_id = $1 ORDER BY pr.version DESC LIMIT 1',
            [idea.id],
          )
        ).rows[0];
        if (!latest) throw new HttpError(409, 'conflict', 'There is no proposal to sign yet');
        if (latest.version !== body.version)
          throw new HttpError(
            409,
            'conflict',
            'Version ' + String(latest.version) + ' is the latest; read it and sign that one',
          );
        if (!body.consent)
          throw new HttpError(400, 'invalid_request', 'Agree to the statement to sign', [
            { path: 'body.consent', message: 'must be true' },
          ]);
        if (!sameName(body.name, a.user.name))
          throw new HttpError(
            400,
            'invalid_request',
            'Type your full name as it is on your account',
            [{ path: 'body.name', message: 'does not match your account name' }],
          );
        const approved = body.decision === 'approve';
        try {
          await c.query(
            `INSERT INTO proposal_signatures (workspace_id, idea_id, proposal_id, decision, signer_id, typed_name, account_name,
                                              account_email, consent_text, content_sha256, note, ip, user_agent)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
            [
              a.workspaceId,
              idea.id,
              latest.id,
              approved ? 'approved' : 'declined',
              a.user.id,
              body.name.trim(),
              a.user.name,
              a.user.email,
              SIGN_CONSENT,
              proposalHash(idea.title, latest.version, latest.content),
              body.note?.trim() ?? '',
              clientIp(req),
              (req.headers['user-agent'] ?? '').slice(0, 500),
            ],
          );
        } catch (e) {
          if (isUniqueViolation(e))
            throw new HttpError(409, 'conflict', 'This idea is already approved');
          throw e;
        }
        // [PCODE-277 | S15 | v0.1.0] promotion is its own step now: approval creates no tasks
        await c.query('UPDATE ideas SET status = $2, updated_at = now() WHERE id = $1', [
          idea.id,
          approved ? 'approved' : 'declined',
        ]);
        await ideaEvent(c, a, idea, approved ? 'approved' : 'rejected', {
          status: { from: 'proposed', to: approved ? 'approved' : 'declined' },
          proposalVersion: { from: null, to: latest.version },
        });
        return { body: await decision(c, a, idea.id) };
      }),
  });

  return [get, sign];
}
