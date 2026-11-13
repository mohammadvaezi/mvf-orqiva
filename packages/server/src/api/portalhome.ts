// ── [PCODE-338 | S15 | v0.1.0] T34.1c Meeting notes and actions into tasks; the team's client overview with health, revenue, activity and people ──
// ── [PCODE-336 | S15 | v0.1.0] T34.1a Portal home with health, milestone, release and budget; release deliverables and demos; client sign-off per release; files on acceptance results ──
//    Why:  the first thing a client sees: how each project stands (delivery, quality, running; never the
//          team's own security or AI figures), the next milestone, the latest release and the budget where
//          it is shared. And on the team's side, what a release delivers: links and demo recordings, and
//          the client's sign-off.
import {
  healthOf,
  heatOf,
  usdMicrosToCents,
  type HeatCell,
  type HeatKey,
  type PortfolioFacts,
} from '@orqiva/shared';
import type { Pool, PoolClient } from 'pg';
import { recordEvent } from '../events/outbox.js';
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s } from '../http/schema.js';
import { rateNow } from '../lib/money.js';
import { actorOf, asMember, requireProject } from './access.js';
import { portalScope, type PortalCtx } from './portal.js';

const uuid = s.string({ format: 'uuid' });
/** What a client sees of a project's heat. */
export const CLIENT_HEAT: readonly HeatKey[] = ['delivery', 'quality', 'operations'];

const dayText = (d: Date | null): string | null =>
  d ? new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10) : null;

/** Per project: delivery, quality and operations, as the command center reads them. */
export async function clientHealth(
  c: PoolClient,
  ids: string[],
): Promise<Map<string, { health: string; reasons: string[] }>> {
  const one = async <T extends { project_id: string }>(sql: string) =>
    new Map((await c.query<T>(sql, [ids])).rows.map((r) => [r.project_id, r]));
  const counts = await one<{ project_id: string; overdue: string }>(
    `SELECT i.project_id,
            count(*) FILTER (WHERE st.grp IN ('backlog', 'unstarted', 'started') AND i.due_date < (now() AT TIME ZONE 'Europe/Berlin')::date) AS overdue
       FROM items i JOIN project_states st ON st.id = i.state_id WHERE i.project_id = ANY($1::uuid[]) GROUP BY i.project_id`,
  );
  const sprints = await one<{ project_id: string; total: string; done: string; share: string }>(
    `SELECT s.project_id, count(i.id) AS total,
            count(i.id) FILTER (WHERE st.grp IN ('completed', 'cancelled')) AS done,
            CASE WHEN s.start_date IS NULL OR s.end_date IS NULL OR s.end_date <= s.start_date THEN 0
                 ELSE greatest(0, least(1, (current_date - s.start_date)::numeric / (s.end_date - s.start_date))) END AS share
       FROM sprints s LEFT JOIN items i ON i.sprint_id = s.id LEFT JOIN project_states st ON st.id = i.state_id
      WHERE s.project_id = ANY($1::uuid[]) AND s.status = 'active' GROUP BY s.id`,
  );
  const tests = await one<{ project_id: string; failed: string }>(
    `SELECT DISTINCT ON (r.project_id) r.project_id,
            (SELECT count(*) FROM test_results x WHERE x.run_id = r.id AND x.status = 'failed') AS failed
       FROM test_runs r WHERE r.project_id = ANY($1::uuid[]) AND r.status = 'done'
      ORDER BY r.project_id, r.finished_at DESC NULLS LAST`,
  );
  const incidents = await one<{ project_id: string; serious: string; other: string }>(
    `SELECT project_id, count(*) FILTER (WHERE severity IN ('sev1', 'sev2')) AS serious,
            count(*) FILTER (WHERE severity IN ('sev3', 'sev4')) AS other
       FROM incidents WHERE project_id = ANY($1::uuid[]) AND state <> 'resolved' GROUP BY project_id`,
  );
  const deploys = await one<{ project_id: string; failed: string }>(
    `SELECT project_id, count(*) AS failed FROM deploy_runs
      WHERE project_id = ANY($1::uuid[]) AND status = 'failed' AND finished_at > now() - interval '24 hours' GROUP BY project_id`,
  );
  const out = new Map<string, { health: string; reasons: string[] }>();
  for (const id of ids) {
    const sp = sprints.get(id);
    const facts: PortfolioFacts = {
      overdue: Number(counts.get(id)?.overdue ?? 0),
      sprint: sp
        ? { total: Number(sp.total), done: Number(sp.done), dayShare: Number(sp.share) }
        : null,
      failedTests: tests.has(id) ? Number(tests.get(id)?.failed) : null,
      criticalFindings: 0,
      highFindings: 0,
      seriousIncidents: Number(incidents.get(id)?.serious ?? 0),
      otherIncidents: Number(incidents.get(id)?.other ?? 0),
      failedDeploys24h: Number(deploys.get(id)?.failed ?? 0),
      budgetUsed: null,
    };
    const heat = heatOf(facts);
    const none: HeatCell = { level: 'none', note: '' };
    out.set(
      id,
      healthOf({
        delivery: heat.delivery,
        quality: heat.quality,
        operations: heat.operations,
        security: none,
        budget: none,
      }),
    );
  }
  return out;
}

/** The client's budget: people's billable hours and AI, against the budget, and where it heads. */
async function clientBudget(c: PoolClient, ctx: PortalCtx) {
  const budget = (
    await c.query<{ amount_cents: string }>(
      "SELECT amount_cents FROM budgets WHERE scope_type = 'client' AND scope_id = $1 AND measure IN ('total', 'time') ORDER BY created_at DESC LIMIT 1",
      [ctx.clientId],
    )
  ).rows[0];
  const time = (
    await c.query<{ cents: string; recent: string }>(
      `SELECT coalesce(sum(e.minutes * e.rate_cents / 60.0), 0) AS cents,
              coalesce(sum(e.minutes * e.rate_cents / 60.0) FILTER (WHERE e.day > current_date - 30), 0) AS recent
         FROM time_entries e WHERE e.billable AND e.rate_cents IS NOT NULL AND e.project_id = ANY($1::uuid[])`,
      [ctx.projectIds],
    )
  ).rows[0];
  const ai = (
    await c.query<{ micros: string; recent: string }>(
      `SELECT coalesce(sum(cost_micros * coalesce(usd_eur, $2::real)), 0) AS micros,
              coalesce(sum(cost_micros * coalesce(usd_eur, $2::real)) FILTER (WHERE created_at > now() - interval '30 days'), 0) AS recent
         FROM agent_runs WHERE project_id = ANY($1::uuid[])`,
      [ctx.projectIds, (await rateNow(c)).usdEur],
    )
  ).rows[0];
  const used = Math.round(Number(time?.cents ?? 0)) + usdMicrosToCents(Number(ai?.micros ?? 0), 1);
  const perDay = (Number(time?.recent ?? 0) + usdMicrosToCents(Number(ai?.recent ?? 0), 1)) / 30;
  const last = (
    await c.query<{ last: string | null }>(
      `SELECT max(due_date)::text AS last FROM items WHERE project_id = ANY($1::uuid[]) AND kind IN ('epic', 'milestone')`,
      [ctx.projectIds],
    )
  ).rows[0]?.last;
  const days = last ? Math.max(0, (Date.parse(last) - Date.now()) / 86_400_000) : 0;
  return {
    budgetCents: budget ? Number(budget.amount_cents) : null,
    usedCents: used,
    forecastCents: last ? Math.round(used + perDay * days) : null,
  };
}

const deliverableOut = s.object({
  id: s.string(),
  kind: s.enum(['link', 'demo']),
  title: s.string(),
  url: s.string(),
  fileId: s.nullable(s.string()),
  fileName: s.nullable(s.string()),
  mime: s.nullable(s.string()),
});
interface DeliverableRow {
  id: string;
  kind: 'link' | 'demo';
  title: string;
  url: string;
  file_id: string | null;
  file_name: string | null;
  mime: string | null;
}
export interface Deliverable {
  id: string;
  kind: 'link' | 'demo';
  title: string;
  url: string;
  fileId: string | null;
  fileName: string | null;
  mime: string | null;
}
export interface SignOff {
  decision: 'approved' | 'declined';
  signedName: string;
  note: string;
  at: string;
}
export const DELIVERABLE_SELECT = `SELECT d.id, d.kind, d.title, d.url, d.file_id, f.name AS file_name, f.mime
  FROM release_deliverables d LEFT JOIN files f ON f.id = d.file_id AND f.deleted_at IS NULL`;
export const deliverableJson = (d: DeliverableRow): Deliverable => ({
  id: d.id,
  kind: d.kind,
  title: d.title,
  url: d.url,
  fileId: d.file_id,
  fileName: d.file_name,
  mime: d.mime,
});
export async function deliverablesOf(c: PoolClient, releaseId: string): Promise<Deliverable[]> {
  return (
    await c.query<DeliverableRow>(
      DELIVERABLE_SELECT + ' WHERE d.release_id = $1 ORDER BY d.created_at',
      [releaseId],
    )
  ).rows.map(deliverableJson);
}

/** The client's latest decision on a release, if any. */
export async function releaseSignOff(c: PoolClient, releaseId: string): Promise<SignOff | null> {
  const r = (
    await c.query<{ decision: string; signed_name: string; note: string; created_at: Date }>(
      `SELECT decision, signed_name, note, created_at FROM approvals
        WHERE object_type = 'release' AND object_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [releaseId],
    )
  ).rows[0];
  return r
    ? {
        decision: r.decision as 'approved' | 'declined',
        signedName: r.signed_name,
        note: r.note,
        at: r.created_at.toISOString(),
      }
    : null;
}
export const signOffOut = s.nullable(
  s.object({
    decision: s.enum(['approved', 'declined']),
    signedName: s.string(),
    note: s.string(),
    at: s.string(),
  }),
);

export function portalHomeRoutes(pool: Pool): Route[] {
  const home = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/portal/home',
    summary:
      'The portal home: each project’s health, next milestone and latest release, and the budget where it is shared',
    tags: ['portal'],
    params: s.object({ workspaceId: uuid }),
    query: s.object({ clientId: s.optional(uuid) }),
    response: s.object({
      projects: s.array(
        s.object({
          id: s.string(),
          key: s.string(),
          name: s.string(),
          health: s.enum(['on-track', 'at-risk', 'critical']),
          reasons: s.array(s.string()),
          nextMilestone: s.nullable(s.object({ title: s.string(), due: s.string() })),
          latestRelease: s.nullable(
            s.object({
              id: s.string(),
              version: s.string(),
              name: s.string(),
              state: s.string(),
              at: s.nullable(s.string()),
            }),
          ),
        }),
      ),
      budget: s.nullable(
        s.object({
          budgetCents: s.nullable(s.number({ integer: true })),
          usedCents: s.number({ integer: true }),
          forecastCents: s.nullable(s.number({ integer: true })),
        }),
      ),
    }),
    handler: ({ params, query, req }) =>
      portalScope(pool, req, params.workspaceId, query.clientId, async (c, ctx) => {
        const health = await clientHealth(c, ctx.projectIds);
        const milestones = new Map(
          (
            await c.query<{ project_id: string; title: string; due_date: Date }>(
              `SELECT DISTINCT ON (i.project_id) i.project_id, i.title, i.due_date
                 FROM items i JOIN project_states st ON st.id = i.state_id
                WHERE i.project_id = ANY($1::uuid[]) AND i.kind = 'milestone' AND i.due_date IS NOT NULL
                  AND st.grp NOT IN ('completed', 'cancelled')
                ORDER BY i.project_id, i.due_date`,
              [ctx.projectIds],
            )
          ).rows.map((r) => [r.project_id, r]),
        );
        const releases = new Map(
          ctx.shares['release_notes'] === false
            ? []
            : (
                await c.query<{
                  project_id: string;
                  id: string;
                  version: string;
                  name: string;
                  state: string;
                  released_at: Date | null;
                }>(
                  `SELECT DISTINCT ON (r.project_id) r.project_id, r.id, r.version, r.name, r.state, r.released_at
                     FROM releases r WHERE r.project_id = ANY($1::uuid[]) AND r.notes_client <> ''
                      AND r.state IN ('frozen', 'released')
                    ORDER BY r.project_id, coalesce(r.released_at, r.freeze_at, r.created_at) DESC`,
                  [ctx.projectIds],
                )
              ).rows.map((r) => [r.project_id, r]),
        );
        return {
          body: {
            projects: ctx.projects.map((p) => {
              const h = health.get(p.id) ?? { health: 'on-track', reasons: [] };
              const m = milestones.get(p.id);
              const r = releases.get(p.id);
              return {
                id: p.id,
                key: p.key,
                name: p.name,
                health: h.health as 'on-track' | 'at-risk' | 'critical',
                reasons: h.reasons,
                nextMilestone: m ? { title: m.title, due: dayText(m.due_date) ?? '' } : null,
                latestRelease: r
                  ? {
                      id: r.id,
                      version: r.version,
                      name: r.name,
                      state: r.state === 'released' ? 'released' : 'candidate',
                      at: r.released_at?.toISOString() ?? null,
                    }
                  : null,
              };
            }),
            budget: ctx.shares['budget'] === false ? null : await clientBudget(c, ctx),
          },
        };
      }),
  });

  const releaseParams = s.object({ workspaceId: uuid, releaseId: uuid });
  const releaseOf = async (c: PoolClient, a: Parameters<typeof requireProject>[1], id: string) => {
    const r = (
      await c.query<{ id: string; project_id: string; version: string }>(
        'SELECT id, project_id, version FROM releases WHERE id = $1',
        [id],
      )
    ).rows[0];
    if (!r) throw new HttpError(404, 'not_found', 'Release not found');
    await requireProject(c, a, r.project_id);
    return r;
  };

  const list = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/releases/:releaseId/deliverables',
    summary: 'What a release delivers to the client (links and demos), and the client’s sign-off',
    tags: ['releases'],
    params: releaseParams,
    response: s.object({ deliverables: s.array(deliverableOut), signOff: signOffOut }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const r = await releaseOf(c, a, params.releaseId);
        return {
          body: {
            deliverables: await deliverablesOf(c, r.id),
            signOff: await releaseSignOff(c, r.id),
          },
        };
      }),
  });

  const add = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/releases/:releaseId/deliverables',
    summary: 'Add a link or a demo recording (a video file or a link) to a release (member)',
    tags: ['releases'],
    params: releaseParams,
    body: s.object({
      kind: s.enum(['link', 'demo']),
      title: s.string({ min: 1, max: 200 }),
      url: s.optional(s.string({ max: 1000 })),
      fileId: s.optional(uuid),
    }),
    response: deliverableOut,
    status: 201,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const r = await releaseOf(c, a, params.releaseId);
        const url = body.url?.trim() ?? '';
        if (url && !/^https?:\/\//.test(url))
          throw new HttpError(400, 'invalid_request', 'A link starts with https://', [
            { path: 'body.url', message: 'is not a web address' },
          ]);
        if (!url && !body.fileId)
          throw new HttpError(400, 'invalid_request', 'Give a link or a file', [
            { path: 'body.url', message: 'or a file is required' },
          ]);
        if (body.fileId) {
          const f = (
            await c.query(
              'UPDATE files SET client_visible = true WHERE id = $1 AND deleted_at IS NULL',
              [body.fileId],
            )
          ).rowCount;
          if (!f)
            throw new HttpError(400, 'invalid_request', 'The file is missing', [
              { path: 'body.fileId', message: 'must be a file you uploaded' },
            ]);
        }
        const id = (
          await c.query<{ id: string }>(
            `INSERT INTO release_deliverables (workspace_id, project_id, release_id, kind, title, url, file_id, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
            [
              a.workspaceId,
              r.project_id,
              r.id,
              body.kind,
              body.title.trim(),
              url,
              body.fileId ?? null,
              a.user.id,
            ],
          )
        ).rows[0]?.id;
        await recordEvent(
          c,
          a.workspaceId,
          {
            actor: actorOf(a),
            verb: 'updated',
            object: { type: 'release', id: r.id, label: r.version },
            changes: { deliverables: { from: null, to: body.title.trim() } },
          },
          { projectId: r.project_id },
        );
        const d = (await c.query<DeliverableRow>(DELIVERABLE_SELECT + ' WHERE d.id = $1', [id]))
          .rows[0];
        if (!d) throw new Error('deliverable vanished');
        return { status: 201, body: deliverableJson(d) };
      }),
  });

  const remove = route({
    method: 'DELETE',
    path: '/api/workspaces/:workspaceId/releases/:releaseId/deliverables/:deliverableId',
    summary: 'Take a deliverable off a release (member)',
    tags: ['releases'],
    params: s.object({ workspaceId: uuid, releaseId: uuid, deliverableId: uuid }),
    response: s.object({ removed: s.boolean() }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const r = await releaseOf(c, a, params.releaseId);
        const gone = await c.query(
          'DELETE FROM release_deliverables WHERE id = $1 AND release_id = $2',
          [params.deliverableId, r.id],
        );
        return { body: { removed: Boolean(gone.rowCount) } };
      }),
  });

  return [home, list, add, remove];
}
