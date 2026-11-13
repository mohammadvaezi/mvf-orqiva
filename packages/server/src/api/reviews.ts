// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-145 | S15 | v0.1.0] Add the review stage and the Reviewer agent ──
//    Why:  the review stage. The Reviewer agent reads what a task has (description, criteria and their ticks,
//          tests and their latest results, open findings, commits and the code written for it) and writes
//          a review with a recommendation; that is a note. A person decides: approved or changes requested.
//          G3's "Code review approved" is met when every task finished in the current sprint has a person's
//          approval as its latest review decision.
import type { Actor } from '@orqiva/shared';
import type { Pool, PoolClient } from 'pg';
import { askAgent } from '../agents/oneshot.js';
import { MODE_REVIEW } from '../agents/provider.js';
import type { ProviderFor } from '../agents/runner.js';
import { inWorkspace } from '../db/pool.js';
import { recordEvent } from '../events/outbox.js';
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s, type Infer } from '../http/schema.js';
import { actorOf, asMember, requireProject, requireUser, type Access } from './access.js';

const uuid = s.string({ format: 'uuid' });

export const REVIEW_PROMPT =
  MODE_REVIEW +
  ' Review this task before it counts as done. Start with one line "RECOMMEND: approve" or ' +
  '"RECOMMEND: changes", then say in a few sentences what is missing or risky: criteria not met, tests ' +
  'missing or failing, open findings, code that does not match the task. Your review is advice; a person decides.';

export const reviewOut = s.object({
  id: s.string(),
  kind: s.string(),
  decision: s.nullable(s.string()),
  recommendation: s.nullable(s.string()),
  body: s.string(),
  runId: s.nullable(s.string()),
  author: s.nullable(s.string()),
  createdAt: s.string(),
});

interface ReviewRow {
  id: string;
  kind: string;
  decision: string | null;
  recommendation: string | null;
  body: string;
  run_id: string | null;
  author_name: string | null;
  created_at: Date;
}

const reviewJson = (r: ReviewRow): Infer<typeof reviewOut> => ({
  id: r.id,
  kind: r.kind,
  decision: r.decision,
  recommendation: r.recommendation,
  body: r.body,
  runId: r.run_id,
  author: r.author_name,
  createdAt: r.created_at.toISOString(),
});

const listOf = async (c: PoolClient, itemId: string): Promise<ReviewRow[]> =>
  (
    await c.query<ReviewRow>(
      `SELECT r.*, u.name AS author_name FROM item_reviews r LEFT JOIN users u ON u.id = r.author_id
        WHERE r.item_id = $1 ORDER BY r.created_at DESC`,
      [itemId],
    )
  ).rows;

interface ItemHead {
  id: string;
  project_id: string;
  ref: string;
  title: string;
  description: string;
}

async function visibleItem(c: PoolClient, a: Access, itemId: string): Promise<ItemHead> {
  const it = (
    await c.query<ItemHead>(
      `SELECT i.id, i.project_id, p.key || '-' || i.sequence AS ref, i.title, i.description
         FROM items i JOIN projects p ON p.id = i.project_id WHERE i.id = $1`,
      [itemId],
    )
  ).rows[0];
  if (!it) throw new HttpError(404, 'not_found', 'Item not found');
  try {
    await requireProject(c, a, it.project_id);
  } catch {
    throw new HttpError(404, 'not_found', 'Item not found');
  }
  return it;
}

/** What the reviewer reads about a task, as plain text. */
export async function reviewBrief(c: PoolClient, it: ItemHead): Promise<string> {
  const criteria = (
    await c.query<{ text: string; done: boolean }>(
      'SELECT text, done FROM item_criteria WHERE item_id = $1 ORDER BY position',
      [it.id],
    )
  ).rows;
  const tests = (
    await c.query<{ title: string; status: string | null }>(
      `SELECT tc.title, (SELECT r.status FROM test_results r WHERE r.case_id = tc.id ORDER BY r.at DESC LIMIT 1) AS status
         FROM test_cases tc WHERE tc.item_id = $1 ORDER BY tc.created_at`,
      [it.id],
    )
  ).rows;
  const findings = (
    await c.query<{ severity: string; title: string }>(
      "SELECT severity, title FROM findings WHERE item_id = $1 AND status = 'open'",
      [it.id],
    )
  ).rows;
  const git = (
    await c.query<{ kind: string; ref: string; title: string }>(
      'SELECT kind, ref, title FROM item_git_links WHERE item_id = $1 ORDER BY at DESC LIMIT 20',
      [it.id],
    )
  ).rows;
  const code = (
    await c.query<{ path: string }>(
      'SELECT DISTINCT path FROM item_fingerprints WHERE item_id = $1 ORDER BY path LIMIT 50',
      [it.id],
    )
  ).rows;
  return [
    'Task ' + it.ref + ': ' + it.title,
    ...(it.description ? ['', it.description] : []),
    '',
    'Acceptance criteria:',
    ...(criteria.length
      ? criteria.map((k) => '- [' + (k.done ? 'x' : ' ') + '] ' + k.text)
      : ['(none written)']),
    '',
    'Tests (latest result):',
    ...(tests.length
      ? tests.map((x) => '- ' + x.title + ': ' + (x.status ?? 'not run'))
      : ['(no test cases)']),
    '',
    'Open security findings:',
    ...(findings.length ? findings.map((f) => '- ' + f.severity + ': ' + f.title) : ['(none)']),
    '',
    'Commits and pull requests:',
    ...(git.length
      ? git.map((g) => '- ' + g.kind + ' ' + g.ref + ' ' + g.title)
      : ['(none linked)']),
    '',
    'Files written for it:',
    ...(code.length ? code.map((x) => '- ' + x.path) : ['(none recorded)']),
  ].join('\n');
}

/** The finished tasks of the current sprint and whether each has a person's approval as its latest decision. */
export async function sprintReviews(
  c: PoolClient,
  projectId: string,
): Promise<{ sprint: string | null; done: number; approved: number; missing: string[] }> {
  const sprint = (
    await c.query<{ id: string; name: string }>(
      `SELECT id, name FROM sprints WHERE project_id = $1 AND status IN ('active', 'completed')
        ORDER BY (status = 'active') DESC, completed_at DESC NULLS LAST LIMIT 1`,
      [projectId],
    )
  ).rows[0];
  if (!sprint) return { sprint: null, done: 0, approved: 0, missing: [] };
  const rows = (
    await c.query<{ ref: string; decision: string | null }>(
      `SELECT p.key || '-' || i.sequence AS ref,
              (SELECT r.decision FROM item_reviews r WHERE r.item_id = i.id AND r.kind = 'person' ORDER BY r.created_at DESC LIMIT 1) AS decision
         FROM items i JOIN projects p ON p.id = i.project_id JOIN project_states st ON st.id = i.state_id
        WHERE i.sprint_id = $1 AND st.grp = 'completed' ORDER BY i.sequence`,
      [sprint.id],
    )
  ).rows;
  return {
    sprint: sprint.name,
    done: rows.length,
    approved: rows.filter((r) => r.decision === 'approved').length,
    missing: rows.filter((r) => r.decision !== 'approved').map((r) => r.ref),
  };
}

/** G3's review criterion follows the current sprint's finished tasks. */
export async function syncReviewGate(
  c: PoolClient,
  workspaceId: string,
  actor: Actor,
  projectId: string,
): Promise<void> {
  const r = await sprintReviews(c, projectId);
  const met = r.done > 0 && r.missing.length === 0;
  const evidence = !r.sprint
    ? 'No sprint yet'
    : !r.done
      ? 'Nothing finished in ' + r.sprint + ' yet'
      : met
        ? 'All ' + String(r.done) + ' finished tasks of ' + r.sprint + ' approved in review'
        : String(r.missing.length) +
          ' finished tasks of ' +
          r.sprint +
          ' without an approved review: ' +
          r.missing.slice(0, 5).join(', ');
  const u = await c.query(
    `UPDATE gate_criteria SET met = $3, met_by = NULL, met_at = CASE WHEN $3 THEN now() END, evidence = $2
      WHERE project_id = $1 AND gate_key = 'g3' AND criterion_key = 'review' AND (met <> $3 OR evidence <> $2)`,
    [projectId, evidence, met],
  );
  if (!u.rowCount) return;
  const p = (await c.query<{ key: string }>('SELECT key FROM projects WHERE id = $1', [projectId]))
    .rows[0];
  await recordEvent(
    c,
    workspaceId,
    {
      actor,
      verb: 'updated',
      object: { type: 'gate', id: projectId + ':g3', label: (p?.key ?? '') + ' G3' },
      parent: { type: 'project', id: projectId, label: p?.key ?? '' },
      changes: { criterion: { from: met ? null : 'review', to: met ? 'review' : null } },
    },
    { projectId },
  );
}

export function reviewRoutes(pool: Pool, models: ProviderFor): Route[] {
  const list = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/items/:itemId/reviews',
    summary: 'The task’s reviews, newest first',
    tags: ['reviews'],
    params: s.object({ workspaceId: uuid, itemId: uuid }),
    response: s.array(reviewOut),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        const it = await visibleItem(c, a, params.itemId);
        return { body: (await listOf(c, it.id)).map(reviewJson) };
      }),
  });

  const decide = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/items/:itemId/reviews',
    summary: 'Approve the task or request changes, with a note (member)',
    tags: ['reviews'],
    params: s.object({ workspaceId: uuid, itemId: uuid }),
    body: s.object({
      decision: s.enum(['approved', 'changes_requested']),
      note: s.optional(s.string({ max: 20_000 })),
    }),
    response: s.array(reviewOut),
    status: 201,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const it = await visibleItem(c, a, params.itemId);
        if (body.decision === 'changes_requested' && !body.note?.trim())
          throw new HttpError(400, 'invalid_request', 'Say what should change', [
            { path: 'body.note', message: 'is required' },
          ]);
        await c.query(
          "INSERT INTO item_reviews (workspace_id, item_id, kind, decision, body, author_id) VALUES ($1, $2, 'person', $3, $4, $5)",
          [a.workspaceId, it.id, body.decision, body.note?.trim() ?? '', a.user.id],
        );
        await recordEvent(
          c,
          a.workspaceId,
          {
            actor: actorOf(a),
            verb: body.decision === 'approved' ? 'approved' : 'rejected',
            object: { type: 'item', id: it.id, label: it.ref + ' ' + it.title },
            changes: { review: { from: null, to: body.decision } },
          },
          { projectId: it.project_id },
        );
        await syncReviewGate(c, a.workspaceId, actorOf(a), it.project_id);
        return { status: 201, body: (await listOf(c, it.id)).map(reviewJson) };
      }),
  });

  const agent = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/items/:itemId/reviews/agent',
    summary: 'The Reviewer agent reviews the task and recommends; a person still decides (member)',
    tags: ['reviews'],
    params: s.object({ workspaceId: uuid, itemId: uuid }),
    response: s.array(reviewOut),
    status: 201,
    handler: async ({ params, req }) => {
      const before = await asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const it = await visibleItem(c, a, params.itemId);
        return { it, brief: await reviewBrief(c, it) };
      });
      const user = await requireUser(pool, req);
      const asked = await askAgent(pool, models, {
        workspaceId: params.workspaceId,
        projectId: before.it.project_id,
        agentKey: 'reviewer',
        requestedBy: user.id,
        instruction: 'Review ' + before.it.ref,
        system: REVIEW_PROMPT,
        messages: [{ role: 'user', content: [{ type: 'text', text: before.brief }] }],
      });
      const rec = /RECOMMEND:\s*(approve|changes)/i.exec(asked.text)?.[1]?.toLowerCase() ?? null;
      const text = asked.text.replace(/^\s*RECOMMEND:\s*(approve|changes)\s*/i, '').trim();
      return inWorkspace(pool, params.workspaceId, async (c) => {
        await c.query(
          "INSERT INTO item_reviews (workspace_id, item_id, kind, recommendation, body, run_id) VALUES ($1, $2, 'agent', $3, $4, $5)",
          [params.workspaceId, before.it.id, rec, text.slice(0, 20_000), asked.runId],
        );
        return { status: 201, body: (await listOf(c, before.it.id)).map(reviewJson) };
      });
    },
  });

  return [list, decide, agent];
}
