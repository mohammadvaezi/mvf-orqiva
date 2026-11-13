// ── [PCODE-315 | S15 | v0.1.0] T32.3a Cypress and Allure import, defects in the trace, leakage and burndown ──
//    Why:  how good a release's testing was. Caught: the bugs its test runs found (filed from a result).
//          Escaped: bugs of the project written after it shipped and before the next release of the same
//          component, which no test had found. Leakage is the share that escaped. The burndown shows the
//          release's planned cases worked down day by day.
import { defectLeakage, testBurndown } from '@orqiva/shared';
import type { Pool, PoolClient } from 'pg';
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s } from '../http/schema.js';
import { asMember, requireProject } from './access.js';

const uuid = s.string({ format: 'uuid' });

interface ReleaseRow {
  id: string;
  project_id: string;
  version: string;
  component: string | null;
  state: string;
  released_at: Date | null;
  created_at: Date;
}

/** The bugs a release's runs found, and the ones found after it shipped that no test had found. */
async function bugsOf(c: PoolClient, r: ReleaseRow): Promise<{ caught: number; escaped: number }> {
  const caught = (
    await c.query<{ n: string }>(
      `SELECT count(DISTINCT x.item) AS n FROM (
         SELECT res.defect_item_id AS item FROM test_results res JOIN test_runs t ON t.id = res.run_id
          WHERE t.release_id = $1 AND res.defect_item_id IS NOT NULL
         UNION
         SELECT (e.value->>'defect')::uuid FROM test_runs t CROSS JOIN LATERAL jsonb_each(t.reopened) e
          WHERE t.release_id = $1) x`,
      [r.id],
    )
  ).rows[0]?.n;
  if (!r.released_at) return { caught: Number(caught ?? 0), escaped: 0 };
  // the dates compared in the database: a release's time read into JavaScript loses its microseconds
  const escaped = (
    await c.query<{ n: string }>(
      `SELECT count(*) AS n FROM releases r JOIN items i ON i.project_id = r.project_id
        WHERE r.id = $1 AND i.kind = 'bug' AND i.created_at > r.released_at
          AND i.created_at < coalesce((SELECT min(o.released_at) FROM releases o
                WHERE o.project_id = r.project_id AND o.id <> r.id AND o.released_at > r.released_at
                  AND o.component IS NOT DISTINCT FROM r.component), now())
          AND NOT EXISTS (SELECT 1 FROM test_results res WHERE res.defect_item_id = i.id)
          AND NOT EXISTS (SELECT 1 FROM test_runs t CROSS JOIN LATERAL jsonb_each(t.reopened) e
                WHERE t.project_id = r.project_id AND e.value->>'defect' = i.id::text)`,
      [r.id],
    )
  ).rows[0]?.n;
  return { caught: Number(caught ?? 0), escaped: Number(escaped ?? 0) };
}

export function testQualityRoutes(pool: Pool): Route[] {
  const quality = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/projects/:projectId/test-quality',
    summary:
      'Per recent release: its test runs, the bugs they caught, the bugs found after it shipped, and the defect leakage',
    tags: ['tests'],
    params: s.object({ workspaceId: uuid, projectId: uuid }),
    response: s.object({
      releases: s.array(
        s.object({
          id: s.string(),
          version: s.string(),
          component: s.nullable(s.string()),
          state: s.string(),
          releasedAt: s.nullable(s.string()),
          runs: s.number({ integer: true }),
          caught: s.number({ integer: true }),
          escaped: s.number({ integer: true }),
          /** percent of the release's bugs found after it shipped; null without bugs */
          leakage: s.nullable(s.number()),
        }),
      ),
    }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        const p = await requireProject(c, a, params.projectId);
        const rows = (
          await c.query<ReleaseRow & { runs: string }>(
            `SELECT r.id, r.project_id, r.version, r.component, r.state, r.released_at, r.created_at,
                    (SELECT count(*) FROM test_runs t WHERE t.release_id = r.id) AS runs
               FROM releases r WHERE r.project_id = $1
              ORDER BY coalesce(r.released_at, r.created_at) DESC LIMIT 12`,
            [p.id],
          )
        ).rows;
        const releases = [];
        for (const r of rows) {
          const b = await bugsOf(c, r);
          releases.push({
            id: r.id,
            version: r.version,
            component: r.component,
            state: r.state,
            releasedAt: r.released_at?.toISOString() ?? null,
            runs: Number(r.runs),
            ...b,
            // nothing has leaked before the release ships
            leakage: r.released_at ? defectLeakage(b.caught, b.escaped) : null,
          });
        }
        return { body: { releases } };
      }),
  });

  const burndown = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/releases/:releaseId/test-burndown',
    summary:
      'A release’s planned test cases worked down day by day: still to run, passed and failed at the end of each day',
    tags: ['tests'],
    params: s.object({ workspaceId: uuid, releaseId: uuid }),
    response: s.object({
      version: s.string(),
      planned: s.number({ integer: true }),
      days: s.array(
        s.object({
          day: s.string(),
          remaining: s.number({ integer: true }),
          passed: s.number({ integer: true }),
          failed: s.number({ integer: true }),
        }),
      ),
    }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        const r = (
          await c.query<ReleaseRow>('SELECT * FROM releases WHERE id = $1', [params.releaseId])
        ).rows[0];
        if (!r) throw new HttpError(404, 'not_found', 'Release not found');
        await requireProject(c, a, r.project_id);
        const runs = (
          await c.query<{ id: string; planned_case_ids: string[]; started_at: Date }>(
            'SELECT id, planned_case_ids, started_at FROM test_runs WHERE release_id = $1',
            [r.id],
          )
        ).rows;
        const results = (
          await c.query<{ case_id: string; status: string; at: Date }>(
            'SELECT case_id, status, at FROM test_results WHERE run_id = ANY($1::uuid[])',
            [runs.map((x) => x.id)],
          )
        ).rows;
        const planned = [
          ...new Set([
            ...runs.flatMap((x) => x.planned_case_ids),
            ...results.map((x) => x.case_id),
          ]),
        ];
        const from = runs.reduce<Date | null>(
          (m, x) => (!m || x.started_at < m ? x.started_at : m),
          null,
        );
        const to = r.released_at ?? new Date();
        return {
          body: {
            version: r.version,
            planned: planned.length,
            days: from
              ? testBurndown(
                  planned,
                  results.map((x) => ({
                    caseId: x.case_id,
                    status: x.status,
                    at: x.at.toISOString(),
                  })),
                  from.toISOString(),
                  (to > from ? to : from).toISOString(),
                )
              : [],
          },
        };
      }),
  });

  return [quality, burndown];
}
