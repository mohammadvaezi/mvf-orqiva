// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-163 | S15 | v0.1.0] B1.2 Roles, clients and portal sign-in on the server ──
// ── [PCODE-106 | S15 | v0.1.0] Add the team activity feed panel to VS Code ──
// ── [PCODE-135 | S15 | v0.1.0] Add test cases from acceptance criteria and test runs ──
// ── [PCODE-132 | S15 | v0.1.0] Run deploys through our own runner and stream each step ──
// ── [PCODE-122 | S15 | v0.1.0] Show agents in the web app: agents page, ask from a task, live run view, approvals, card badge ──
//    Why:  a feed opens with what just happened, then follows the live stream. This answers the first part:
//          the newest events the caller may see (a guest only those of the projects they are invited to,
//          exactly as the live gateway filters), oldest first, with the workspace's current sequence so the
//          client can subscribe from there without a gap or a duplicate.
import type { Pool } from 'pg';
import { route, type Route } from '../http/router.js';
import { s } from '../http/schema.js';
import { asMember } from './access.js';

const uuid = s.string({ format: 'uuid' });

export function activityRoutes(pool: Pool): Route[] {
  const recent = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/activity',
    summary:
      'The newest events the caller may see, oldest first, and the sequence to follow on from',
    tags: ['activity'],
    params: s.object({ workspaceId: uuid }),
    query: s.object({
      projectId: s.optional(uuid),
      limit: s.optional(s.string({ pattern: /^\d{1,3}$/ })),
    }),
    response: s.object({ sequence: s.number({ integer: true }), events: s.array(s.anyObject()) }),
    handler: ({ params, query, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        const limit = Math.min(200, Math.max(1, Number(query.limit ?? 50)));
        // the head first: an event landing in between arrives twice (the feed drops the copy), never not at all
        const head = (
          await c.query<{ n: string | null }>(
            'SELECT max(sequence) AS n FROM activity_events WHERE workspace_id = $1',
            [a.workspaceId],
          )
        ).rows[0]?.n;
        const rows = (
          await c.query<{ envelope: Record<string, unknown> }>(
            `SELECT envelope FROM activity_events
             WHERE workspace_id = $1
               -- [PCODE-122 | S15 | v0.1.0] an agent's single steps are for its run page
               AND type <> 'orqiva.agent_run.progressed'
               -- [PCODE-132 | S15 | v0.1.0] and a deploy's
               AND type <> 'orqiva.deploy.progressed'
               -- [PCODE-135 | S15 | v0.1.0] and a test run's
               AND type <> 'orqiva.test_run.progressed'
               AND ($2::text IS NULL OR envelope->>'projectid' = $2)
               AND ($3 <> 'guest' OR envelope->>'projectid' IN (
                     SELECT pr.id::text FROM projects pr WHERE guest_sees_project(pr.id, $4)))
             ORDER BY sequence DESC LIMIT $5`,
            [a.workspaceId, query.projectId ?? null, a.role, a.user.id, limit],
          )
        ).rows;
        return {
          body: { sequence: Number(head ?? 0), events: rows.map((r) => r.envelope).reverse() },
        };
      }),
  });
  return [recent];
}
