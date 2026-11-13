// ── [PCODE-277 | S15 | v0.1.0] T28.6 PRD approval by named approvers, reopen on edit, promote to an epic with stories, client in ideation ──
//    Why:  a PRD is approved by the people named for it: team members who see the project, and contacts of
//          the project's client. Each signs the exact latest version (typed name, the consent statement,
//          the version's SHA-256) in the shared approvals block; every one of them approving makes the idea
//          approved, one request for changes sends it back. A new version voids the earlier decisions, so
//          approval reopens on edit. Promotion is its own step: the approved idea becomes an epic with its
//          stories (scenarios as acceptance criteria) and tasks, and the PRD is frozen. The client takes
//          part through the portal: the PRDs they are to sign, and the questions handed to them.
import type { IncomingMessage } from 'node:http';
import {
  normalProposal,
  prdMarkdown,
  sameName,
  SIGN_CONSENT,
  type ProposalContent,
} from '@orqiva/shared';
import type { Pool, PoolClient } from 'pg';
import { recordEvent } from '../events/outbox.js';
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s, type Infer } from '../http/schema.js';
import { actorOf, asMember, type Access } from './access.js';
import { ideaEvent, visibleIdea, type IdeaRow } from './ideas.js';
import { contactWho, portalScope } from './portal.js';
import { prdBasis, PROPOSAL_SELECT, type ProposalRow } from './proposals.js';
import { proposalHash } from './signing.js';

const uuid = s.string({ format: 'uuid' });
const params = s.object({ workspaceId: uuid, ideaId: uuid });

export type VersionState =
  'draft' | 'in_review' | 'approved' | 'changes_requested' | 'declined' | 'superseded';

interface Approver {
  user_id: string;
  name: string;
  email: string;
  client: boolean;
}

export const approversOf = async (
  c: PoolClient,
  idea: Pick<IdeaRow, 'id' | 'project_id'>,
): Promise<Approver[]> =>
  (
    await c.query<Approver>(
      `SELECT a.user_id, u.name, u.email,
              EXISTS (SELECT 1 FROM client_contacts cc JOIN projects p ON p.client_id = cc.client_id
                       WHERE p.id = $2 AND cc.user_id = a.user_id) AS client
         FROM idea_approvers a JOIN users u ON u.id = a.user_id
        WHERE a.idea_id = $1 ORDER BY a.created_at, u.name`,
      [idea.id, idea.project_id],
    )
  ).rows;

const latestOf = async (c: PoolClient, ideaId: string): Promise<ProposalRow | undefined> =>
  (
    await c.query<ProposalRow>(
      PROPOSAL_SELECT + ' WHERE pr.idea_id = $1 ORDER BY pr.version DESC LIMIT 1',
      [ideaId],
    )
  ).rows[0];

interface DecisionRow {
  approver_id: string;
  decision: 'approved' | 'declined';
  signed_name: string;
  note: string;
  created_at: Date;
}

/** Each approver's latest decision on exactly this version. */
const decisionsOn = async (c: PoolClient, ideaId: string, hash: string): Promise<DecisionRow[]> =>
  (
    await c.query<DecisionRow>(
      `SELECT DISTINCT ON (approver_id) approver_id, decision, signed_name, note, created_at
         FROM approvals WHERE object_type = 'prd' AND object_id = $1 AND version_hash = $2
        ORDER BY approver_id, created_at DESC`,
      [ideaId, hash],
    )
  ).rows;

/** The state of each version: only the latest can be decided on, every older one is superseded. */
export function versionState(
  isLatest: boolean,
  status: string,
  decisions: readonly { decision: string }[],
): VersionState {
  if (!isLatest) return 'superseded';
  if (status === 'approved') return 'approved';
  if (status === 'declined') return 'declined';
  if (decisions.some((d) => d.decision === 'declined')) return 'changes_requested';
  if (status === 'in_review') return 'in_review';
  return 'draft';
}

const reviewOut = s.object({
  status: s.string(),
  version: s.nullable(s.number({ integer: true })),
  approvers: s.array(
    s.object({
      userId: s.string(),
      name: s.string(),
      kind: s.string(),
      decision: s.nullable(s.string()),
      signedName: s.string(),
      note: s.string(),
      at: s.nullable(s.string()),
    }),
  ),
  versions: s.array(s.object({ version: s.number({ integer: true }), state: s.string() })),
  mayDecide: s.boolean(),
  promoted: s.nullable(s.object({ epicId: s.nullable(s.string()), at: s.string() })),
});
type ReviewJson = Infer<typeof reviewOut>;

export async function reviewOf(c: PoolClient, userId: string, idea: IdeaRow): Promise<ReviewJson> {
  const approvers = await approversOf(c, idea);
  const versions = (
    await c.query<{ version: number }>(
      'SELECT version FROM proposals WHERE idea_id = $1 ORDER BY version DESC',
      [idea.id],
    )
  ).rows;
  const latest = await latestOf(c, idea.id);
  const decisions = latest
    ? await decisionsOn(c, idea.id, proposalHash(idea.title, latest.version, latest.content))
    : [];
  const mine = decisions.find((d) => d.approver_id === userId);
  return {
    status: idea.status,
    version: latest?.version ?? null,
    approvers: approvers.map((a) => {
      const d = decisions.find((x) => x.approver_id === a.user_id);
      return {
        userId: a.user_id,
        name: a.name,
        kind: a.client ? 'client' : 'team',
        decision: d ? (d.decision === 'approved' ? 'approved' : 'changes') : null,
        signedName: d?.signed_name ?? '',
        note: d?.note ?? '',
        at: d ? d.created_at.toISOString() : null,
      };
    }),
    versions: versions.map((v, i) => ({
      version: v.version,
      state: versionState(i === 0, idea.status, decisions),
    })),
    mayDecide:
      idea.status === 'in_review' &&
      approvers.some((a) => a.user_id === userId) &&
      (!mine || mine.decision === 'declined'),
    promoted: idea.promoted_at
      ? { epicId: idea.epic_id, at: idea.promoted_at.toISOString() }
      : null,
  };
}

/** May this person approve the idea: a member who sees the project, or a contact of its client. */
async function eligible(c: PoolClient, projectId: string, userId: string): Promise<boolean> {
  const r = await c.query(
    `SELECT 1 FROM workspace_members m WHERE m.user_id = $1 AND (m.role NOT IN ('guest', 'billing') OR guest_sees_project($2, $1))
     UNION ALL
     SELECT 1 FROM client_contacts cc JOIN projects p ON p.client_id = cc.client_id WHERE p.id = $2 AND cc.user_id = $1`,
    [userId, projectId],
  );
  return Boolean(r.rowCount);
}

/** One approver's signed decision on the latest version; the idea moves when it settles. */
export async function decide(
  c: PoolClient,
  a: Access,
  idea: IdeaRow,
  body: {
    version: number;
    decision: 'approve' | 'changes';
    name: string;
    consent: boolean;
    note?: string | undefined;
  },
  req: IncomingMessage,
): Promise<void> {
  await c.query('SELECT 1 FROM ideas WHERE id = $1 FOR UPDATE', [idea.id]);
  if (idea.status !== 'in_review')
    throw new HttpError(409, 'conflict', 'This PRD is not in review');
  const approvers = await approversOf(c, idea);
  if (!approvers.some((x) => x.user_id === a.user.id))
    throw new HttpError(403, 'forbidden', 'You are not named as an approver of this PRD');
  const latest = await latestOf(c, idea.id);
  if (!latest) throw new HttpError(409, 'conflict', 'There is no proposal to decide on');
  if (latest.version !== body.version)
    throw new HttpError(
      409,
      'conflict',
      'Version ' + String(latest.version) + ' is the latest; read it and decide on that one',
    );
  if (!body.consent)
    throw new HttpError(400, 'invalid_request', 'Agree to the statement to sign', [
      { path: 'body.consent', message: 'must be true' },
    ]);
  if (!sameName(body.name, a.user.name))
    throw new HttpError(400, 'invalid_request', 'Type your full name as it is on your account', [
      { path: 'body.name', message: 'does not match your account name' },
    ]);
  const note = body.note?.trim() ?? '';
  if (body.decision === 'changes' && !note)
    throw new HttpError(400, 'invalid_request', 'Say what should change', [
      { path: 'body.note', message: 'is required when asking for changes' },
    ]);
  const hash = proposalHash(idea.title, latest.version, latest.content);
  await c.query(
    `INSERT INTO approvals (workspace_id, project_id, object_type, object_id, version_hash, approver_id, decision,
                            signed_name, note, consent_text, ip, user_agent)
     VALUES ($1, $2, 'prd', $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      a.workspaceId,
      idea.project_id,
      idea.id,
      hash,
      a.user.id,
      body.decision === 'approve' ? 'approved' : 'declined',
      body.name.trim(),
      note,
      SIGN_CONSENT,
      req.socket.remoteAddress ?? '',
      (req.headers['user-agent'] ?? '').slice(0, 500),
    ],
  );
  if (body.decision === 'changes') {
    await c.query("UPDATE ideas SET status = 'proposed', updated_at = now() WHERE id = $1", [
      idea.id,
    ]);
    await ideaEvent(c, a, idea, 'updated', {
      status: { from: 'in_review', to: 'proposed' },
      review: { from: latest.version, to: 'changes requested' },
    });
    return;
  }
  const decisions = await decisionsOn(c, idea.id, hash);
  const all = approvers.every((x) =>
    decisions.some((d) => d.approver_id === x.user_id && d.decision === 'approved'),
  );
  if (!all) {
    await ideaEvent(c, a, idea, 'updated', {
      review: { from: latest.version, to: 'approved by ' + a.user.name },
    });
    return;
  }
  await c.query("UPDATE ideas SET status = 'approved', updated_at = now() WHERE id = $1", [
    idea.id,
  ]);
  await ideaEvent(c, a, idea, 'approved', {
    status: { from: 'in_review', to: 'approved' },
    proposalVersion: { from: null, to: latest.version },
  });
}

/** The first state of the project, where new work starts. */
async function firstState(c: PoolClient, projectId: string): Promise<string> {
  const state = (
    await c.query<{ id: string }>(
      'SELECT id FROM project_states WHERE project_id = $1 ORDER BY position LIMIT 1',
      [projectId],
    )
  ).rows[0]?.id;
  if (!state) throw new HttpError(409, 'conflict', 'The project has no states');
  return state;
}

/** A scenario as one acceptance criterion line, within the 500 characters a criterion holds. */
export const criterionOf = (sc: { given: string; when: string; then: string }): string =>
  [sc.given && 'Given ' + sc.given, sc.when && 'when ' + sc.when, 'then ' + sc.then]
    .filter(Boolean)
    .join(', ')
    .replace(/\s*\n\s*/g, '; ')
    .slice(0, 500);

const promotedOut = s.object({
  epic: s.object({ id: s.string(), ref: s.string(), title: s.string() }),
  items: s.array(
    s.object({
      id: s.string(),
      ref: s.string(),
      title: s.string(),
      kind: s.string(),
      estimate: s.nullable(s.number()),
    }),
  ),
});

async function promote(
  c: PoolClient,
  a: Access,
  idea: IdeaRow,
): Promise<Infer<typeof promotedOut>> {
  await c.query('SELECT 1 FROM ideas WHERE id = $1 FOR UPDATE', [idea.id]);
  if (idea.promoted_at) throw new HttpError(409, 'conflict', 'This idea is already promoted');
  if (idea.status !== 'approved')
    throw new HttpError(409, 'conflict', 'Only an approved idea is promoted');
  const latest = await latestOf(c, idea.id);
  if (!latest) throw new HttpError(409, 'conflict', 'There is no proposal');
  const content: ProposalContent = normalProposal(latest.content);
  const basis = await prdBasis(c, idea.id);
  const state = await firstState(c, idea.project_id);
  const ref = idea.project_key + '-I' + String(idea.number);
  const source = 'From idea ' + ref + ', PRD version ' + String(latest.version) + '.';
  const made: Infer<typeof promotedOut>['items'] = [];
  let position = 0;
  const add = async (
    kind: string,
    title: string,
    description: string,
    estimate: number | null,
    parent: string | null,
  ): Promise<{ id: string; ref: string }> => {
    const seq = (
      await c.query<{ seq: number }>(
        'UPDATE projects SET next_item_seq = next_item_seq + 1 WHERE id = $1 RETURNING next_item_seq - 1 AS seq',
        [idea.project_id],
      )
    ).rows[0]?.seq;
    const t = title.trim().slice(0, 255) || 'Untitled';
    const id = (
      await c.query<{ id: string }>(
        `INSERT INTO items (workspace_id, project_id, sequence, title, description, state_id, estimate, created_by, kind, parent_id, rank)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, (SELECT coalesce(max(rank), 0) + 1 FROM items WHERE project_id = $2))
         RETURNING id`,
        [
          a.workspaceId,
          idea.project_id,
          seq,
          t,
          description,
          state,
          estimate,
          a.user.id,
          kind,
          parent,
        ],
      )
    ).rows[0]?.id;
    if (!id) throw new Error('item insert returned nothing');
    position += 1;
    await c.query(
      'INSERT INTO idea_items (workspace_id, idea_id, item_id, position) VALUES ($1, $2, $3, $4)',
      [a.workspaceId, idea.id, id, position],
    );
    const itemRef = idea.project_key + '-' + String(seq);
    await recordEvent(
      c,
      a.workspaceId,
      {
        actor: actorOf(a),
        verb: 'created',
        object: { type: 'item', id, label: itemRef + ' ' + t },
        parent: { type: 'project', id: idea.project_id, label: idea.project_key },
      },
      { projectId: idea.project_id },
    );
    return { id, ref: itemRef };
  };
  const epic = await add('epic', idea.title, content.summary + '\n\n' + source, null, null);
  for (const st of basis.stories) {
    const it = await add(
      'story',
      st.text,
      st.text + '\n\n' + source + ' Story ' + st.code + '.',
      null,
      epic.id,
    );
    let n = 0;
    for (const sc of st.scenarios) {
      n += 1;
      await c.query(
        'INSERT INTO item_criteria (workspace_id, item_id, position, text) VALUES ($1, $2, $3, $4)',
        [a.workspaceId, it.id, n, criterionOf(sc)],
      );
    }
    made.push({
      id: it.id,
      ref: it.ref,
      title: st.text.slice(0, 255),
      kind: 'story',
      estimate: null,
    });
  }
  for (const task of content.tasks) {
    const it = await add(
      'task',
      task.title,
      (task.description ? task.description + '\n\n' : '') + source,
      task.estimate,
      epic.id,
    );
    made.push({ id: it.id, ref: it.ref, title: task.title, kind: 'task', estimate: task.estimate });
  }
  await c.query(
    'UPDATE ideas SET promoted_at = now(), epic_id = $2, updated_at = now() WHERE id = $1',
    [idea.id, epic.id],
  );
  await ideaEvent(c, a, idea, 'updated', {
    promoted: { from: null, to: epic.ref + ' with ' + String(made.length) + ' items' },
  });
  return { epic: { id: epic.id, ref: epic.ref, title: idea.title }, items: made };
}

const decideBody = s.object({
  version: s.number({ integer: true, min: 1 }),
  decision: s.enum(['approve', 'changes']),
  name: s.string({ min: 1, max: 200 }),
  consent: s.boolean(),
  note: s.optional(s.string({ max: 2000 })),
});

export function prdReviewRoutes(pool: Pool): Route[] {
  const review = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/ideas/:ideaId/review',
    summary:
      'The PRD review: named approvers and their decisions on the latest version, version states, promotion',
    tags: ['ideas'],
    params,
    response: reviewOut,
    handler: ({ params: p, req }) =>
      asMember(pool, req, p.workspaceId, 'guest', async (c, a) => {
        const idea = await visibleIdea(c, a, p.ideaId);
        return { body: await reviewOf(c, a.user.id, idea) };
      }),
  });

  const candidates = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/ideas/:ideaId/approver-candidates',
    summary:
      'Who may be named as an approver: members who see the project and contacts of its client',
    tags: ['ideas'],
    params,
    response: s.array(s.object({ userId: s.string(), name: s.string(), kind: s.string() })),
    handler: ({ params: p, req }) =>
      asMember(pool, req, p.workspaceId, 'member', async (c, a) => {
        const idea = await visibleIdea(c, a, p.ideaId);
        const rows = (
          await c.query<{ id: string; name: string; client: boolean }>(
            `SELECT u.id, u.name, false AS client FROM workspace_members m JOIN users u ON u.id = m.user_id
              WHERE m.role NOT IN ('guest', 'billing') AND NOT u.is_service
             UNION
             SELECT u.id, u.name, true FROM client_contacts cc JOIN projects p ON p.client_id = cc.client_id
               JOIN users u ON u.id = cc.user_id WHERE p.id = $1
             ORDER BY 3, 2`,
            [idea.project_id],
          )
        ).rows;
        return {
          body: rows.map((r) => ({
            userId: r.id,
            name: r.name,
            kind: r.client ? 'client' : 'team',
          })),
        };
      }),
  });

  const setApprovers = route({
    method: 'PUT',
    path: '/api/workspaces/:workspaceId/ideas/:ideaId/approvers',
    summary:
      'Name the approvers of the PRD; while it is in review, a newly named one is asked too (member)',
    tags: ['ideas'],
    params,
    body: s.object({ userIds: s.array(uuid, { max: 12 }) }),
    response: reviewOut,
    handler: ({ params: p, body, req }) =>
      asMember(pool, req, p.workspaceId, 'member', async (c, a) => {
        const idea = await visibleIdea(c, a, p.ideaId);
        if (idea.promoted_at || idea.status === 'declined')
          throw new HttpError(409, 'conflict', 'This idea is closed');
        const ids = [...new Set(body.userIds)];
        for (const [i, id] of ids.entries())
          if (!(await eligible(c, idea.project_id, id)))
            throw new HttpError(
              400,
              'invalid_request',
              'Only someone who sees the project, or a contact of its client',
              [{ path: 'body.userIds.' + String(i), message: 'cannot approve this PRD' }],
            );
        const before = (await approversOf(c, idea)).map((x) => x.user_id);
        await c.query(
          'DELETE FROM idea_approvers WHERE idea_id = $1 AND NOT (user_id = ANY($2::uuid[]))',
          [idea.id, ids],
        );
        for (const id of ids)
          await c.query(
            'INSERT INTO idea_approvers (workspace_id, idea_id, user_id, added_by) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
            [a.workspaceId, idea.id, id, a.user.id],
          );
        const added = ids.filter((x) => !before.includes(x));
        if (idea.status === 'in_review' && added.length)
          await ideaEvent(c, a, idea, 'updated', {
            review: { from: null, to: 'requested' },
            approvers: { from: null, to: added },
          });
        // dropping the last one who had not decided may settle the review
        if (idea.status === 'in_review' && ids.length) {
          const latest = await latestOf(c, idea.id);
          if (latest) {
            const d = await decisionsOn(
              c,
              idea.id,
              proposalHash(idea.title, latest.version, latest.content),
            );
            if (ids.every((x) => d.some((y) => y.approver_id === x && y.decision === 'approved'))) {
              await c.query(
                "UPDATE ideas SET status = 'approved', updated_at = now() WHERE id = $1",
                [idea.id],
              );
              await ideaEvent(c, a, idea, 'approved', {
                status: { from: 'in_review', to: 'approved' },
              });
            }
          }
        }
        return { body: await reviewOf(c, a.user.id, await visibleIdea(c, a, idea.id)) };
      }),
  });

  const request = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/ideas/:ideaId/review',
    summary:
      'Put the latest PRD version in review: every named approver is asked to sign it (member)',
    tags: ['ideas'],
    params,
    response: reviewOut,
    handler: ({ params: p, req }) =>
      asMember(pool, req, p.workspaceId, 'member', async (c, a) => {
        const idea = await visibleIdea(c, a, p.ideaId);
        await c.query('SELECT 1 FROM ideas WHERE id = $1 FOR UPDATE', [idea.id]);
        if (idea.status !== 'proposed' && idea.status !== 'in_review')
          throw new HttpError(
            409,
            'conflict',
            idea.status === 'approved' || idea.status === 'declined'
              ? 'This idea is already ' + idea.status
              : 'There is no proposal to review yet',
          );
        const approvers = await approversOf(c, idea);
        if (!approvers.length)
          throw new HttpError(409, 'conflict', 'Name at least one approver first');
        const latest = await latestOf(c, idea.id);
        if (!latest) throw new HttpError(409, 'conflict', 'There is no proposal to review yet');
        await c.query("UPDATE ideas SET status = 'in_review', updated_at = now() WHERE id = $1", [
          idea.id,
        ]);
        await ideaEvent(c, a, idea, 'updated', {
          ...(idea.status !== 'in_review'
            ? { status: { from: idea.status, to: 'in_review' } }
            : {}),
          review: { from: latest.version, to: 'requested' },
          approvers: { from: null, to: approvers.map((x) => x.user_id) },
        });
        return { body: await reviewOf(c, a.user.id, await visibleIdea(c, a, idea.id)) };
      }),
  });

  const decision = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/ideas/:ideaId/review/decide',
    summary:
      'A named approver approves the latest version or asks for changes, with an electronic signature (approver)',
    tags: ['ideas'],
    params,
    body: decideBody,
    response: reviewOut,
    handler: ({ params: p, body, req }) =>
      asMember(pool, req, p.workspaceId, 'guest', async (c, a) => {
        const idea = await visibleIdea(c, a, p.ideaId);
        await decide(c, a, idea, body, req);
        return { body: await reviewOf(c, a.user.id, await visibleIdea(c, a, idea.id)) };
      }),
  });

  const promoteRoute = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/ideas/:ideaId/promote',
    summary:
      'Turn the approved idea into an epic with its stories (scenarios as acceptance criteria) and the proposal’s tasks (member)',
    tags: ['ideas'],
    params,
    response: promotedOut,
    status: 201,
    handler: ({ params: p, req }) =>
      asMember(pool, req, p.workspaceId, 'member', async (c, a) => {
        const idea = await visibleIdea(c, a, p.ideaId);
        return { status: 201, body: await promote(c, a, idea) };
      }),
  });

  // ── the client's part, in the portal ──
  const portalPrds = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/portal/prds',
    summary:
      'The PRDs the contact is named to approve, with the latest version to read and their decision',
    tags: ['portal'],
    params: s.object({ workspaceId: uuid }),
    query: s.object({ clientId: s.optional(uuid) }),
    response: s.array(
      s.object({
        ideaId: s.string(),
        ref: s.string(),
        title: s.string(),
        status: s.string(),
        version: s.number({ integer: true }),
        markdown: s.string(),
        mayDecide: s.boolean(),
        myDecision: s.nullable(s.string()),
        approvers: s.array(s.object({ name: s.string(), decision: s.nullable(s.string()) })),
      }),
    ),
    handler: ({ params: p, query, req }) =>
      portalScope(pool, req, p.workspaceId, query.clientId, async (c, ctx) => {
        const ideas = (
          await c.query<IdeaRow>(
            `SELECT i.*, p.key AS project_key, NULL::text AS created_by_name, 0 AS message_count
               FROM ideas i JOIN projects p ON p.id = i.project_id
              WHERE i.project_id = ANY($1::uuid[]) AND i.status IN ('in_review', 'approved', 'proposed')
                AND EXISTS (SELECT 1 FROM idea_approvers a WHERE a.idea_id = i.id AND ($2::uuid IS NULL OR a.user_id = $2))
              ORDER BY i.updated_at DESC LIMIT 30`,
            [ctx.projectIds, ctx.asTeam ? null : ctx.access.user.id],
          )
        ).rows;
        const out = [];
        for (const idea of ideas) {
          const latest = await latestOf(c, idea.id);
          if (!latest) continue;
          const rv = await reviewOf(c, ctx.access.user.id, idea);
          const basis = await prdBasis(c, idea.id);
          const ref = idea.project_key + '-I' + String(idea.number);
          out.push({
            ideaId: idea.id,
            ref,
            title: idea.title,
            status: idea.status,
            version: latest.version,
            markdown: prdMarkdown({
              ref,
              title: idea.title,
              kind: idea.kind,
              version: latest.version,
              status: idea.status,
              author: '',
              date: latest.created_at.toISOString().slice(0, 10),
              content: normalProposal(latest.content),
              estimate: { points: latest.estimate_points, days: latest.estimate_days },
              refs: basis.refs,
              stories: basis.stories,
            }),
            mayDecide: !ctx.asTeam && rv.mayDecide,
            myDecision: rv.approvers.find((x) => x.userId === ctx.access.user.id)?.decision ?? null,
            approvers: rv.approvers.map((x) => ({ name: x.name, decision: x.decision })),
          });
        }
        return { body: out };
      }),
  });

  const portalDecide = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/portal/prds/:ideaId/decision',
    summary: 'The contact approves the PRD or asks for changes, with an electronic signature',
    tags: ['portal'],
    params,
    body: decideBody,
    response: s.object({ status: s.string() }),
    handler: ({ params: p, body, req }) =>
      portalScope(pool, req, p.workspaceId, undefined, async (c, ctx) => {
        contactWho(ctx, () => true, 'Contacts decide on the PRDs they are named for');
        const idea = (
          await c.query<IdeaRow>(
            `SELECT i.*, p.key AS project_key, NULL::text AS created_by_name, 0 AS message_count
               FROM ideas i JOIN projects p ON p.id = i.project_id WHERE i.id = $1 AND i.project_id = ANY($2::uuid[])`,
            [p.ideaId, ctx.projectIds],
          )
        ).rows[0];
        if (!idea) throw new HttpError(404, 'not_found', 'Idea not found');
        await decide(c, ctx.access, idea, body, req);
        const now = (
          await c.query<{ status: string }>('SELECT status FROM ideas WHERE id = $1', [idea.id])
        ).rows[0];
        return { body: { status: now?.status ?? idea.status } };
      }),
  });

  const portalQuestions = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/portal/questions',
    summary: 'The open questions of ideas the team handed to the contact',
    tags: ['portal'],
    params: s.object({ workspaceId: uuid }),
    query: s.object({ clientId: s.optional(uuid) }),
    response: s.array(
      s.object({
        id: s.string(),
        text: s.string(),
        ideaRef: s.string(),
        ideaTitle: s.string(),
        dueDate: s.nullable(s.string()),
        askedBy: s.nullable(s.string()),
      }),
    ),
    handler: ({ params: p, query, req }) =>
      portalScope(pool, req, p.workspaceId, query.clientId, async (c, ctx) => {
        const rows = (
          await c.query<{
            id: string;
            text: string;
            ref: string;
            title: string;
            due: string | null;
            asked_by: string | null;
          }>(
            `SELECT q.id, q.text, p.key || '-I' || i.number AS ref, i.title, q.due_date::text AS due, u.name AS asked_by
               FROM idea_questions q JOIN ideas i ON i.id = q.idea_id JOIN projects p ON p.id = i.project_id
               LEFT JOIN users u ON u.id = q.created_by
              WHERE q.status = 'open' AND i.project_id = ANY($1::uuid[])
                AND ($2::uuid IS NULL OR q.owner_id = $2) AND ($2::uuid IS NOT NULL OR q.owner_id IN
                    (SELECT cc.user_id FROM client_contacts cc WHERE cc.client_id = $3))
              ORDER BY q.due_date NULLS LAST, q.created_at`,
            [ctx.projectIds, ctx.asTeam ? null : ctx.access.user.id, ctx.clientId],
          )
        ).rows;
        return {
          body: rows.map((r) => ({
            id: r.id,
            text: r.text,
            ideaRef: r.ref,
            ideaTitle: r.title,
            dueDate: r.due,
            askedBy: r.asked_by,
          })),
        };
      }),
  });

  const portalAnswer = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/portal/questions/:questionId/answer',
    summary: 'The contact answers a question handed to them; the idea’s team sees it at once',
    tags: ['portal'],
    params: s.object({ workspaceId: uuid, questionId: uuid }),
    body: s.object({ answer: s.string({ min: 1, max: 8000 }) }),
    response: s.object({ answered: s.boolean() }),
    handler: ({ params: p, body, req }) =>
      portalScope(pool, req, p.workspaceId, undefined, async (c, ctx) => {
        contactWho(ctx, () => true, 'Contacts answer the questions handed to them');
        const q = (
          await c.query<{ idea_id: string }>(
            `SELECT q.idea_id FROM idea_questions q JOIN ideas i ON i.id = q.idea_id
              WHERE q.id = $1 AND q.owner_id = $2 AND q.status = 'open' AND i.project_id = ANY($3::uuid[])`,
            [p.questionId, ctx.access.user.id, ctx.projectIds],
          )
        ).rows[0];
        if (!q) throw new HttpError(404, 'not_found', 'Question not found');
        await c.query(
          `UPDATE idea_questions SET answer = $2, status = 'answered', answered_at = now() WHERE id = $1`,
          [p.questionId, body.answer.trim()],
        );
        const idea = (
          await c.query<IdeaRow>(
            `SELECT i.*, p.key AS project_key, NULL::text AS created_by_name, 0 AS message_count
               FROM ideas i JOIN projects p ON p.id = i.project_id WHERE i.id = $1`,
            [q.idea_id],
          )
        ).rows[0];
        if (idea) {
          await c.query('UPDATE ideas SET last_activity_at = now() WHERE id = $1', [idea.id]);
          await ideaEvent(c, ctx.access, idea, 'updated', {
            question: { from: null, to: 'answered' },
          });
        }
        return { body: { answered: true } };
      }),
  });

  return [
    review,
    candidates,
    setApprovers,
    request,
    decision,
    promoteRoute,
    portalPrds,
    portalDecide,
    portalQuestions,
    portalAnswer,
  ];
}
