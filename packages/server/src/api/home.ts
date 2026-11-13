// ── [PCODE-347 | S15 | v0.1.0] T35.1b Homes for developers and testers with widgets the person chooses ──
//    Why:  one call fills a person's home: which kind of home it is (a developer's, a tester's or a lead's,
//          from their role and the projects they test), the widgets they chose or the preset's, and what
//          each widget shows, only from the projects the person may see.
import { homeLayout, localDay, type HomePersona, type HomeWidget } from '@orqiva/shared';
import type { Pool, PoolClient } from 'pg';
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s } from '../http/schema.js';
import { asMember, type Access } from './access.js';

const uuid = s.string({ format: 'uuid' });

/** A lead's home for owners and admins, a tester's for whoever tests a project, else a developer's. */
async function personaOf(c: PoolClient, a: Access): Promise<HomePersona> {
  if (a.role === 'owner' || a.role === 'admin') return 'lead';
  const tests = (
    await c.query("SELECT 1 FROM project_members WHERE user_id = $1 AND role = 'tester' LIMIT 1", [
      a.user.id,
    ])
  ).rowCount;
  return tests ? 'tester' : 'developer';
}

/** What one widget shows. */
async function widgetData(c: PoolClient, a: Access, w: HomeWidget): Promise<unknown> {
  const me = a.user.id;
  switch (w) {
    case 'my-tasks':
      return (
        await c.query(
          `SELECT i.id, p.key || '-' || i.sequence AS ref, i.title, st.name AS state, st.grp AS "group"
             FROM items i JOIN projects p ON p.id = i.project_id JOIN project_states st ON st.id = i.state_id
            WHERE i.assignee_id = $1 AND st.grp NOT IN ('completed', 'cancelled') AND p.archived_at IS NULL
            ORDER BY (st.grp = 'started') DESC, i.updated_at DESC LIMIT 8`,
          [me],
        )
      ).rows;
    case 'reviews':
      return (
        await c.query(
          `SELECT pr.id, p.key AS "projectKey", pr.project_id AS "projectId", pr.number, pr.title, pr.author, pr.draft
             FROM pull_requests pr JOIN projects p ON p.id = pr.project_id
            WHERE pr.state = 'open' AND NOT pr.draft AND p.archived_at IS NULL
            ORDER BY pr.updated_at DESC LIMIT 6`,
        )
      ).rows;
    case 'my-runs':
      return (
        await c.query(
          `SELECT r.id, left(r.instruction, 120) AS instruction, r.status, ag.name AS agent
             FROM agent_runs r JOIN agents ag ON ag.id = r.agent_id
            WHERE r.requested_by = $1 ORDER BY r.created_at DESC LIMIT 6`,
          [me],
        )
      ).rows;
    case 'deploys':
      return (
        await c.query(
          `SELECT d.id, p.key AS "projectKey", e.name AS environment, d.status, d.ref, d.created_at AS at
             FROM deploy_runs d JOIN projects p ON p.id = d.project_id JOIN environments e ON e.id = d.environment_id
            ORDER BY d.created_at DESC LIMIT 6`,
        )
      ).rows;
    case 'my-tests':
      return (
        await c.query(
          `SELECT t.id, t.name, p.key AS "projectKey",
                  count(*) FILTER (WHERE r.assignee_id = $1) AS mine,
                  count(*) FILTER (WHERE r.assignee_id = $1 AND r.status IN ('failed', 'blocked')) AS failing
             FROM test_runs t JOIN projects p ON p.id = t.project_id LEFT JOIN test_results r ON r.run_id = t.id
            WHERE t.status = 'running' AND (t.started_by = $1 OR r.assignee_id = $1)
            GROUP BY t.id, p.key ORDER BY t.started_at DESC LIMIT 6`,
          [me],
        )
      ).rows.map((r: { mine: string; failing: string }) => ({
        ...r,
        mine: Number(r.mine),
        failing: Number(r.failing),
      }));
    case 'failing-tests':
      return (
        await c.query(
          `SELECT DISTINCT ON (r.case_id) r.case_id AS "caseId", tc.title, r.status, t.id AS "runId", t.name AS run, r.at
             FROM test_results r JOIN test_runs t ON t.id = r.run_id JOIN test_cases tc ON tc.id = r.case_id
            WHERE r.at > now() - interval '14 days'
            ORDER BY r.case_id, r.at DESC`,
        )
      ).rows
        .filter((r: { status: string }) => r.status === 'failed' || r.status === 'blocked')
        .slice(0, 8);
    case 'bugs-to-verify':
      return (
        await c.query(
          `SELECT i.id, p.key || '-' || i.sequence AS ref, i.title, st.name AS state
             FROM items i JOIN projects p ON p.id = i.project_id JOIN project_states st ON st.id = i.state_id
            WHERE i.kind = 'bug' AND st.grp = 'started' AND (st.name ILIKE '%test%' OR st.name ILIKE '%review%' OR st.name ILIKE '%verif%')
              AND p.archived_at IS NULL
            ORDER BY i.updated_at DESC LIMIT 8`,
        )
      ).rows;
    case 'time-today': {
      const r = (
        await c.query<{ minutes: string; running: boolean }>(
          `SELECT coalesce(sum(minutes), 0) AS minutes, bool_or(started_at IS NOT NULL AND ended_at IS NULL) AS running
             FROM time_entries WHERE user_id = $1 AND day = $2`,
          [me, localDay(new Date())],
        )
      ).rows[0];
      return { minutes: Number(r?.minutes ?? 0), running: r?.running ?? false };
    }
    case 'incidents':
      return (
        await c.query(
          `SELECT x.id, 'INC-' || x.number AS ref, x.title, x.severity, x.state, p.key AS "projectKey"
             FROM incidents x LEFT JOIN projects p ON p.id = x.project_id
            WHERE x.resolved_at IS NULL ORDER BY x.severity, x.declared_at DESC LIMIT 6`,
        )
      ).rows;
  }
}

export function homeRoutes(pool: Pool): Route[] {
  const home = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/home',
    summary: 'A person’s home: the kind of home, their widgets and what each one shows',
    tags: ['home'],
    params: s.object({ workspaceId: uuid }),
    query: s.object({ persona: s.optional(s.enum(['developer', 'tester', 'lead'])) }),
    response: s.anyObject(),
    handler: ({ params, query, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        if (a.clientId) throw new HttpError(403, 'forbidden', 'The portal has its own home');
        const persona = query.persona ?? (await personaOf(c, a));
        const saved = (
          await c.query<{ value: unknown }>(
            "SELECT value FROM settings WHERE key = 'home.widgets' AND scope_type = 'user' AND scope_id = $1",
            [a.user.id],
          )
        ).rows[0]?.value;
        const widgets = homeLayout(query.persona ? null : saved, persona);
        const data: Record<string, unknown> = {};
        for (const w of widgets) data[w] = await widgetData(c, a, w);
        return {
          body: {
            persona,
            custom: !query.persona && Array.isArray(saved) && saved.length > 0,
            widgets,
            data,
          },
        };
      }),
  });
  return [home];
}
