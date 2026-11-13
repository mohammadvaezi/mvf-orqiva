// ── [PCODE-163 | S15 | v0.1.0] B1.2 Roles, clients and portal sign-in on the server ──
// ── [PCODE-113 | S15 | v0.1.0] Rebuild the web app shell: sidebar, top bar, page layout, design refresh ──
//    Why:  "My work": everything open that is assigned to me, across every project I can see, in progress
//          first. One request for the page, instead of one per project.
import type { Pool } from 'pg';
import { route, type Route } from '../http/router.js';
import { s } from '../http/schema.js';
import { asMember } from './access.js';

const uuid = s.string({ format: 'uuid' });

export function myWorkRoutes(pool: Pool): Route[] {
  const mine = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/my-work',
    summary: 'The open items assigned to the caller, across the projects they can see',
    tags: ['items'],
    params: s.object({ workspaceId: uuid }),
    response: s.array(
      s.object({
        id: s.string(),
        ref: s.string(),
        title: s.string(),
        projectId: s.string(),
        projectKey: s.string(),
        projectName: s.string(),
        state: s.string(),
        stateGroup: s.string(),
        stateColor: s.string(),
        sprint: s.nullable(s.string()),
        updatedAt: s.string(),
      }),
    ),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        const rows = (
          await c.query<{
            id: string;
            ref: string;
            title: string;
            project_id: string;
            key: string;
            name: string;
            state: string;
            grp: string;
            color: string;
            sprint: string | null;
            updated_at: Date;
          }>(
            `SELECT i.id, p.key || '-' || i.sequence AS ref, i.title, p.id AS project_id, p.key, p.name,
                    st.name AS state, st.grp, st.color, sp.name AS sprint, i.updated_at
             FROM items i
             JOIN projects p ON p.id = i.project_id AND p.archived_at IS NULL
             JOIN project_states st ON st.id = i.state_id
             LEFT JOIN sprints sp ON sp.id = i.sprint_id
             WHERE i.assignee_id = $1 AND st.grp IN ('backlog', 'unstarted', 'started')
               AND ($2 <> 'guest' OR guest_sees_project(p.id, $1))
             ORDER BY CASE st.grp WHEN 'started' THEN 0 WHEN 'unstarted' THEN 1 ELSE 2 END, i.updated_at DESC
             LIMIT 200`,
            [a.user.id, a.role],
          )
        ).rows;
        return {
          body: rows.map((r) => ({
            id: r.id,
            ref: r.ref,
            title: r.title,
            projectId: r.project_id,
            projectKey: r.key,
            projectName: r.name,
            state: r.state,
            stateGroup: r.grp,
            stateColor: r.color,
            sprint: r.sprint,
            updatedAt: r.updated_at.toISOString(),
          })),
        };
      }),
  });
  return [mine];
}
