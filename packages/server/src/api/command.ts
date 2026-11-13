// ── [PCODE-414 | S15 | v0.1.0] T37 high: Command center under 1 s at 100 projects ──
// ── [PCODE-359 | S15 | v0.1.0] T35.7a Plan contents enforced ──
// ── [PCODE-210 | S15 | v0.1.0] T18.2 Command center screen: lanes with people and agents, heatmap, alerts, 24 h replay slider (design preview and live) ──
// ── [PCODE-209 | S15 | v0.1.0] T18.1 Portfolio on the server: health, risk heatmap, gates, cards in progress with people and agents, alerts, 24 h replay ──
//    Why:  the command center shows every project of the workspace on one screen: where it stands in its
//          lifecycle, how healthy it is and why, which cards are moving and who (people and agents) is on
//          them, and what is alarming. One call reads it all with a fixed number of set-based queries,
//          however many projects there are. The last 24 hours come back as a compact replay, so the screen
//          can show how the portfolio looked at any minute of the day.
import { healthOf, heatOf, HEAT_KEYS, type PortfolioFacts } from '@orqiva/shared';
import type { Pool, PoolClient } from 'pg';
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s, type Infer } from '../http/schema.js';
import { usdEurNow } from '../lib/money.js';
import { asMember, type Access } from './access.js';
import { lifecycleStates } from './lifecycle.js';
import { requireFeature } from '../licence/licence.js'; // [PCODE-359 | S15 | v0.1.0]

const uuid = s.string({ format: 'uuid' });
const ws = s.object({ workspaceId: uuid });
export const REPLAY_HOURS = 24;
export const REPLAY_LIMIT = 5000;

interface Proj {
  id: string;
  key: string;
  name: string;
  client_name: string | null;
}

/** Rows of a per-project query as a map. */
async function byProject<T extends { project_id: string }>(
  c: PoolClient,
  sql: string,
  ids: string[],
): Promise<Map<string, T>> {
  const rows = (await c.query<T>(sql, [ids])).rows;
  return new Map(rows.map((r) => [r.project_id, r]));
}

/** The projects the caller may see, not archived. */
async function visibleProjects(c: PoolClient, a: Access): Promise<Proj[]> {
  return (
    await c.query<Proj>(
      `SELECT p.id, p.key, p.name, cl.name AS client_name FROM projects p LEFT JOIN clients cl ON cl.id = p.client_id
        WHERE p.archived_at IS NULL AND ($1 <> 'guest' OR guest_sees_project(p.id, $2)) ORDER BY p.key`,
      [a.role, a.user.id],
    )
  ).rows;
}

const cellOut = s.object({ level: s.string(), note: s.string() });
const cardOut = s.object({
  id: s.string(),
  ref: s.string(),
  title: s.string(),
  state: s.string(),
  assignee: s.nullable(s.object({ id: s.string(), name: s.string() })),
  agents: s.array(s.object({ name: s.string(), status: s.string() })),
  updatedAt: s.string(),
});
const projectOut = s.object({
  id: s.string(),
  key: s.string(),
  name: s.string(),
  client: s.nullable(s.string()),
  phase: s.nullable(s.string()),
  gates: s.array(s.object({ key: s.string(), name: s.string(), status: s.string() })),
  health: s.string(),
  reasons: s.array(s.string()),
  heat: s.object({
    delivery: cellOut,
    quality: cellOut,
    security: cellOut,
    operations: cellOut,
    budget: cellOut,
  }),
  counts: s.object({
    open: s.number({ integer: true }),
    inProgress: s.number({ integer: true }),
    doneThisWeek: s.number({ integer: true }),
  }),
  cards: s.array(cardOut),
});
const alertOut = s.object({
  id: s.string(),
  projectId: s.nullable(s.string()),
  projectKey: s.nullable(s.string()),
  source: s.string(),
  severity: s.string(),
  title: s.string(),
  count: s.number({ integer: true }),
  firstAt: s.string(),
  lastAt: s.string(),
});

interface AlertRow {
  id: string;
  project_id: string | null;
  project_key: string | null;
  source: string;
  severity: string;
  title: string;
  count: number;
  first_at: Date;
  last_at: Date;
}
const ALERTS = `SELECT al.id, al.project_id, p.key AS project_key, al.source, al.severity, al.title, al.count, al.first_at, al.last_at
  FROM alerts al LEFT JOIN projects p ON p.id = al.project_id
 WHERE al.status = 'open' AND (al.project_id IS NULL OR al.project_id = ANY($1::uuid[]))
 ORDER BY al.severity, al.last_at DESC LIMIT 100`;
const alertJson = (r: AlertRow) => ({
  id: r.id,
  projectId: r.project_id,
  projectKey: r.project_key,
  source: r.source,
  severity: r.severity,
  title: r.title,
  count: r.count,
  firstAt: r.first_at.toISOString(),
  lastAt: r.last_at.toISOString(),
});

/** Everything the command center shows, for the projects the caller may see. */
export async function portfolio(
  c: PoolClient,
  a: Access,
): Promise<{
  projects: Infer<typeof projectOut>[];
  alerts: Infer<typeof alertOut>[];
  at: string;
  startedStates: string[];
}> {
  const projects = await visibleProjects(c, a);
  const ids = projects.map((p) => p.id);
  if (!ids.length)
    return { projects: [], alerts: [], at: new Date().toISOString(), startedStates: [] };
  const counts = await byProject<{
    project_id: string;
    open: string;
    started: string;
    done_week: string;
    overdue: string;
  }>(
    c,
    `SELECT i.project_id,
            count(*) FILTER (WHERE st.grp IN ('backlog', 'unstarted', 'started')) AS open,
            count(*) FILTER (WHERE st.grp = 'started') AS started,
            count(*) FILTER (WHERE st.grp = 'completed' AND i.completed_at > now() - interval '7 days') AS done_week,
            count(*) FILTER (WHERE st.grp IN ('backlog', 'unstarted', 'started') AND i.due_date < (now() AT TIME ZONE 'Europe/Berlin')::date) AS overdue
       FROM items i JOIN project_states st ON st.id = i.state_id WHERE i.project_id = ANY($1::uuid[]) GROUP BY i.project_id`,
    ids,
  );
  const sprints = await byProject<{
    project_id: string;
    total: string;
    done: string;
    share: string;
  }>(
    c,
    `SELECT s.project_id, count(i.id) AS total,
            count(i.id) FILTER (WHERE st.grp IN ('completed', 'cancelled')) AS done,
            CASE WHEN s.start_date IS NULL OR s.end_date IS NULL OR s.end_date <= s.start_date THEN 0
                 ELSE greatest(0, least(1, (current_date - s.start_date)::numeric / (s.end_date - s.start_date))) END AS share
       FROM sprints s LEFT JOIN items i ON i.sprint_id = s.id LEFT JOIN project_states st ON st.id = i.state_id
      WHERE s.project_id = ANY($1::uuid[]) AND s.status = 'active' GROUP BY s.id`,
    ids,
  );
  const tests = await byProject<{ project_id: string; failed: string }>(
    c,
    `SELECT DISTINCT ON (r.project_id) r.project_id,
            (SELECT count(*) FROM test_results x WHERE x.run_id = r.id AND x.status = 'failed') AS failed
       FROM test_runs r WHERE r.project_id = ANY($1::uuid[]) AND r.status = 'done'
      ORDER BY r.project_id, r.finished_at DESC NULLS LAST`,
    ids,
  );
  const findings = await byProject<{ project_id: string; critical: string; high: string }>(
    c,
    `SELECT project_id, count(*) FILTER (WHERE severity = 'critical') AS critical, count(*) FILTER (WHERE severity = 'high') AS high
       FROM findings WHERE project_id = ANY($1::uuid[]) AND status = 'open' GROUP BY project_id`,
    ids,
  );
  const incidents = await byProject<{ project_id: string; serious: string; other: string }>(
    c,
    `SELECT project_id, count(*) FILTER (WHERE severity IN ('sev1', 'sev2')) AS serious,
            count(*) FILTER (WHERE severity IN ('sev3', 'sev4')) AS other
       FROM incidents WHERE project_id = ANY($1::uuid[]) AND state <> 'resolved' GROUP BY project_id`,
    ids,
  );
  const deploys = await byProject<{ project_id: string; failed: string }>(
    c,
    `SELECT project_id, count(*) AS failed FROM deploy_runs
      WHERE project_id = ANY($1::uuid[]) AND status = 'failed' AND finished_at > now() - interval '24 hours' GROUP BY project_id`,
    ids,
  );
  const spend = await byProject<{ project_id: string; micros: string; budget: string }>(
    c,
    `SELECT b.scope_id AS project_id, b.amount_cents AS budget,
            coalesce((SELECT sum(r.cost_micros) FROM agent_runs r WHERE r.project_id = b.scope_id
                       AND r.created_at >= date_trunc('month', now())), 0) AS micros
       FROM budgets b WHERE b.scope_type = 'project' AND b.scope_id = ANY($1::uuid[]) AND b.measure IN ('ai', 'total') AND b.period = 'month'`,
    ids,
  );
  const usdEur = spend.size ? await usdEurNow(c) : 1;
  const cards = (
    await c.query<{
      id: string;
      project_id: string;
      ref: string;
      title: string;
      state: string;
      assignee_id: string | null;
      assignee_name: string | null;
      updated_at: Date;
    }>(
      `SELECT i.id, i.project_id, p.key || '-' || i.sequence AS ref, i.title, st.name AS state, i.assignee_id, u.name AS assignee_name, i.updated_at
         FROM items i JOIN projects p ON p.id = i.project_id JOIN project_states st ON st.id = i.state_id
         LEFT JOIN users u ON u.id = i.assignee_id
        WHERE i.project_id = ANY($1::uuid[]) AND st.grp = 'started' ORDER BY i.updated_at DESC`,
      [ids],
    )
  ).rows;
  const agents = (
    await c.query<{ item_id: string; name: string; status: string }>(
      `SELECT r.item_id, ag.name, r.status FROM agent_runs r JOIN agents ag ON ag.id = r.agent_id
        WHERE r.project_id = ANY($1::uuid[]) AND r.item_id IS NOT NULL AND r.status IN ('queued', 'running', 'waiting')`,
      [ids],
    )
  ).rows;
  // [PCODE-414 | S15 | v0.1.0] every project's lifecycle in one go
  const lifecycles = await lifecycleStates(
    c,
    projects.map((p) => p.id),
  );
  const out = [];
  for (const p of projects) {
    const n = counts.get(p.id);
    const sp = sprints.get(p.id);
    const t = tests.get(p.id);
    const f = findings.get(p.id);
    const inc = incidents.get(p.id);
    const sb = spend.get(p.id);
    const facts: PortfolioFacts = {
      overdue: Number(n?.overdue ?? 0),
      sprint: sp
        ? { total: Number(sp.total), done: Number(sp.done), dayShare: Number(sp.share) }
        : null,
      failedTests: t ? Number(t.failed) : null,
      criticalFindings: Number(f?.critical ?? 0),
      highFindings: Number(f?.high ?? 0),
      seriousIncidents: Number(inc?.serious ?? 0),
      otherIncidents: Number(inc?.other ?? 0),
      failedDeploys24h: Number(deploys.get(p.id)?.failed ?? 0),
      budgetUsed: sb ? ((Number(sb.micros) / 10_000) * usdEur) / Number(sb.budget) : null,
    };
    const heat = heatOf(facts);
    const life = lifecycles.get(p.id) ?? null;
    out.push({
      id: p.id,
      key: p.key,
      name: p.name,
      client: p.client_name,
      phase: life ? (life.phases.find((x) => x.key === life.currentPhase)?.name ?? null) : null,
      gates: life
        ? life.phases.flatMap((x) =>
            x.gate ? [{ key: x.gate.key, name: x.gate.name, status: x.gate.status }] : [],
          )
        : [],
      ...healthOf(heat),
      heat,
      counts: {
        open: Number(n?.open ?? 0),
        inProgress: Number(n?.started ?? 0),
        doneThisWeek: Number(n?.done_week ?? 0),
      },
      cards: cards
        .filter((x) => x.project_id === p.id)
        .slice(0, 30)
        .map((x) => ({
          id: x.id,
          ref: x.ref,
          title: x.title,
          state: x.state,
          assignee:
            x.assignee_id && x.assignee_name ? { id: x.assignee_id, name: x.assignee_name } : null,
          agents: agents
            .filter((g) => g.item_id === x.id)
            .map((g) => ({ name: g.name, status: g.status })),
          updatedAt: x.updated_at.toISOString(),
        })),
    });
  }
  const alerts = (await c.query<AlertRow>(ALERTS, [ids])).rows.map(alertJson);
  // [PCODE-210 | S15 | v0.1.0] the names of the states that count as in progress, for the replay
  const startedStates = (
    await c.query<{ name: string }>(
      "SELECT DISTINCT name FROM project_states WHERE project_id = ANY($1::uuid[]) AND grp = 'started' ORDER BY name",
      [ids],
    )
  ).rows.map((r) => r.name);
  return { projects: out, alerts, at: new Date().toISOString(), startedStates };
}

interface ReplayRow {
  sequence: string;
  time: Date;
  project_id: string | null;
  object_type: string;
  object_id: string;
  actor_kind: string;
  envelope: {
    data?: {
      verb?: string;
      actor?: { name?: string };
      object?: { label?: string };
      changes?: Record<string, { from?: unknown; to?: unknown }>;
    };
  };
}

export function commandRoutes(pool: Pool): Route[] {
  const get = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/command-center',
    summary:
      'The portfolio: every project with its phase, gates, health and reasons, risk heatmap, counts and cards in progress, and the open alerts',
    tags: ['command'],
    params: ws,
    response: s.object({
      projects: s.array(projectOut),
      alerts: s.array(alertOut),
      at: s.string(),
      startedStates: s.array(s.string()), // [PCODE-210 | S15 | v0.1.0]
    }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        await requireFeature(c, a.workspaceId, 'command-center', 'The command center'); // [PCODE-359 | S15 | v0.1.0]
        return { body: await portfolio(c, a) };
      }),
  });

  const alerts = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/alerts',
    summary: 'The open alerts of the projects the caller may see, most severe first',
    tags: ['incidents'],
    params: ws,
    response: s.array(alertOut),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        const ids = (await visibleProjects(c, a)).map((p) => p.id);
        return { body: (await c.query<AlertRow>(ALERTS, [ids])).rows.map(alertJson) };
      }),
  });

  const replay = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/command-center/replay',
    summary: `What happened in a window of up to ${String(REPLAY_HOURS)} hours (the last day by default), oldest first, compact`,
    tags: ['command'],
    params: ws,
    query: s.object({
      from: s.optional(s.string({ format: 'date-time' })),
      to: s.optional(s.string({ format: 'date-time' })),
    }),
    response: s.object({
      from: s.string(),
      to: s.string(),
      cut: s.boolean(),
      events: s.array(
        s.object({
          sequence: s.number({ integer: true }),
          at: s.string(),
          projectId: s.nullable(s.string()),
          object: s.string(),
          objectId: s.string(),
          label: s.string(),
          verb: s.string(),
          actor: s.string(),
          actorKind: s.string(),
          state: s.nullable(s.object({ from: s.nullable(s.string()), to: s.nullable(s.string()) })),
        }),
      ),
    }),
    handler: ({ params, query, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        await requireFeature(c, a.workspaceId, 'command-center', 'The command center'); // [PCODE-359 | S15 | v0.1.0]
        const to = query.to ? new Date(query.to) : new Date();
        const from = query.from
          ? new Date(query.from)
          : new Date(to.getTime() - REPLAY_HOURS * 3_600_000);
        if (to.getTime() - from.getTime() > REPLAY_HOURS * 3_600_000 + 60_000 || from >= to)
          throw new HttpError(
            400,
            'invalid_request',
            'A replay window is at most 24 hours, from before to',
            [{ path: 'query.from', message: 'is more than 24 hours before to, or after it' }],
          );
        const ids = (await visibleProjects(c, a)).map((p) => p.id);
        const rows = (
          await c.query<ReplayRow>(
            `SELECT sequence, time, project_id, object_type, object_id, actor_kind, envelope FROM activity_events
              WHERE time >= $1 AND time < $2 AND (project_id IS NULL OR project_id = ANY($3::text[]))
              ORDER BY sequence LIMIT $4`,
            [from, to, ids.map(String), REPLAY_LIMIT + 1],
          )
        ).rows;
        const cut = rows.length > REPLAY_LIMIT;
        const text = (v: unknown): string | null =>
          typeof v === 'string' ? v : v === null || v === undefined ? null : JSON.stringify(v);
        return {
          body: {
            from: from.toISOString(),
            to: to.toISOString(),
            cut,
            events: rows.slice(0, REPLAY_LIMIT).map((r) => {
              const d = r.envelope.data ?? {};
              const st = d.changes?.['state'];
              return {
                sequence: Number(r.sequence),
                at: r.time.toISOString(),
                projectId: r.project_id,
                object: r.object_type,
                objectId: r.object_id,
                label: d.object?.label ?? '',
                verb: d.verb ?? '',
                actor: d.actor?.name ?? r.actor_kind,
                actorKind: r.actor_kind,
                state: st ? { from: text(st.from), to: text(st.to) } : null,
              };
            }),
          },
        };
      }),
  });

  return [get, alerts, replay];
}

export { HEAT_KEYS };
