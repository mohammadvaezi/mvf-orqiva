// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-187 | S15 | v0.1.0] B7.3 Time live: timer from the active task, weekly timesheets with approval and lock, rates, absences, reports per client ──
// ── [PCODE-184 | S15 | v0.1.0] B6.2 Insights live: cycle time, throughput, escaped bugs, AI cost per point, agents vs people for admins, flow, per project, team load ──
//    Why:  how the department works across projects, in one answer: how fast work flows (cycle time,
//          throughput), how reliably it ships (escaped bugs, deploys, change failure), what the agents cost
//          per point, how well sprints are estimated, and who is over-booked in the next two weeks. The
//          split of work between agents and people is for admins only (gate A1); everyone else sees totals.
//          Past weeks are kept as snapshots per project.
import {
  absenceWorkdays,
  loadPercent,
  median,
  sharedWorkdays,
  usdMicrosToCents,
  weekStarts,
} from '@orqiva/shared';
import type { Pool, PoolClient } from 'pg';
import { route, type Route } from '../http/router.js';
import { s } from '../http/schema.js';
import { rateNow } from '../lib/money.js';
import { asMember, atLeast } from './access.js';

const uuid = s.string({ format: 'uuid' });
const num = s.nullable(s.number());

interface Done {
  id: string;
  project_id: string;
  week: string;
  estimate: number | null;
  cycle_days: string | null;
  agent: boolean;
}

async function productionEnvs(c: PoolClient): Promise<Map<string, string>> {
  const rows = (
    await c.query<{ project_id: string; id: string }>(
      `SELECT DISTINCT ON (project_id) project_id, id FROM environments
        ORDER BY project_id, (key IN ('production', 'prod', 'live')) DESC, position DESC, created_at DESC`,
    )
  ).rows;
  return new Map(rows.map((r) => [r.project_id, r.id]));
}

export function insightRoutes(pool: Pool): Route[] {
  const insights = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/insights',
    summary:
      'Engineering figures across projects for a range of weeks; the split of work between agents and people for admins only (member)',
    tags: ['insights'],
    params: s.object({ workspaceId: uuid }),
    query: s.object({ weeks: s.optional(s.string({ pattern: /^\d{1,2}$/ })) }),
    response: s.object({
      weeks: s.array(
        s.object({
          week: s.string(),
          done: s.number({ integer: true }),
          points: s.number({ integer: true }),
          agentDone: s.nullable(s.number({ integer: true })),
          agentPoints: s.nullable(s.number({ integer: true })),
        }),
      ),
      cycleDays: num,
      cycleDaysBefore: num,
      pointsPerWeek: s.number(),
      escapedBugs: s.number({ integer: true }),
      releases: s.number({ integer: true }),
      aiCents: s.number({ integer: true }),
      aiCentsPerPoint: num,
      agents: s.nullable(
        s.object({
          agentPoints: s.number({ integer: true }),
          peoplePoints: s.number({ integer: true }),
          agentCycleDays: num,
          peopleCycleDays: num,
          agentCentsPerPoint: num,
          runsSucceeded: s.number({ integer: true }),
          runsFailed: s.number({ integer: true }),
          declined: s.number({ integer: true }),
        }),
      ),
      flow: s.object({
        wip: s.number({ integer: true }),
        aging: s.number({ integer: true }),
        carried: s.number({ integer: true }),
        reviewHours: num,
        projects: s.number({ integer: true }),
      }),
      projects: s.array(
        s.object({
          id: s.string(),
          key: s.string(),
          cycleDays: num,
          velocity: num,
          accuracy: num,
          deploysPerWeek: num,
          changeFailure: num,
        }),
      ),
      teams: s.array(
        s.object({
          id: s.string(),
          name: s.string(),
          load: s.number({ integer: true }),
          overbooked: s.array(s.object({ name: s.string(), load: s.number({ integer: true }) })),
        }),
      ),
    }),
    handler: ({ params, query, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const admin = atLeast(a.role, 'admin');
        const n = Math.max(2, Math.min(26, Number(query.weeks ?? 8) || 8));
        const weeks = weekStarts(n);
        const from = weeks[0] ?? new Date().toISOString().slice(0, 10);
        const before = new Date(from + 'T00:00:00Z');
        before.setUTCDate(before.getUTCDate() - n * 7);
        const rate = await rateNow(c);
        const done = (
          await c.query<Done>(
            `SELECT i.id, i.project_id, to_char(date_trunc('week', i.completed_at), 'YYYY-MM-DD') AS week, i.estimate,
                    extract(epoch FROM (i.completed_at - i.started_at)) / 86400 AS cycle_days,
                    EXISTS (SELECT 1 FROM agent_runs r WHERE r.item_id = i.id AND r.status = 'succeeded') AS agent
               FROM items i JOIN projects p ON p.id = i.project_id
              WHERE i.completed_at >= $1::date AND p.archived_at IS NULL AND i.kind NOT IN ('epic', 'milestone')`,
            [from],
          )
        ).rows;
        const earlier = (
          await c.query<{ d: string }>(
            `SELECT extract(epoch FROM (completed_at - started_at)) / 86400 AS d FROM items
              WHERE completed_at >= $1 AND completed_at < $2::date AND started_at IS NOT NULL AND kind NOT IN ('epic', 'milestone')`,
            [before, from],
          )
        ).rows.map((r) => Number(r.d));
        const cycles = (list: Done[]) =>
          median(list.filter((d) => d.cycle_days !== null).map((d) => Number(d.cycle_days)));
        const pts = (list: Done[]) => list.reduce((t, d) => t + (d.estimate ?? 0), 0);
        const round1 = (v: number | null) => (v === null ? null : Math.round(v * 10) / 10);
        const points = pts(done);
        const ai = (
          await c.query<{ micros: string; ok: string; failed: string; declined: string }>(
            `SELECT coalesce(sum(cost_micros), 0) AS micros, count(*) FILTER (WHERE status = 'succeeded') AS ok, count(*) FILTER (WHERE status = 'failed') AS failed,
                    (SELECT count(*) FROM agent_steps st JOIN agent_runs x ON x.id = st.run_id WHERE st.kind = 'decision' AND st.content->>'approve' = 'false' AND x.created_at >= $1::date) AS declined
               FROM agent_runs WHERE created_at >= $1::date`,
            [from],
          )
        ).rows[0];
        const aiCents = usdMicrosToCents(Number(ai?.micros ?? 0), rate.usdEur);
        const agentDone = done.filter((d) => d.agent);
        const bugs = (
          await c.query<{ bugs: string; releases: string }>(
            `SELECT (SELECT count(*) FROM items b WHERE b.kind = 'bug' AND b.created_at >= $1::date
                       AND EXISTS (SELECT 1 FROM releases r WHERE r.project_id = b.project_id AND r.state = 'released' AND r.released_at < b.created_at)) AS bugs,
                    (SELECT count(*) FROM releases WHERE state = 'released' AND released_at >= $1::date) AS releases`,
            [from],
          )
        ).rows[0];
        const flow = (
          await c.query<{ wip: string; aging: string; carried: string; projects: string }>(
            `SELECT count(*) FILTER (WHERE s.grp = 'started') AS wip,
                    count(*) FILTER (WHERE s.grp = 'started' AND i.started_at < now() - interval '7 days') AS aging,
                    coalesce(sum(i.carried_count) FILTER (WHERE s.grp NOT IN ('completed', 'cancelled') AND sp.status = 'active'), 0) AS carried,
                    count(DISTINCT i.project_id) FILTER (WHERE s.grp = 'started') AS projects
               FROM items i JOIN project_states s ON s.id = i.state_id LEFT JOIN sprints sp ON sp.id = i.sprint_id`,
          )
        ).rows[0];
        const review = (
          await c.query<{ h: string }>(
            'SELECT extract(epoch FROM (merged_at - opened_at)) / 3600 AS h FROM pull_requests WHERE merged_at >= $1::date',
            [from],
          )
        ).rows.map((r) => Number(r.h));

        // per project
        const projects = (
          await c.query<{ id: string; key: string }>(
            'SELECT id, key FROM projects WHERE archived_at IS NULL ORDER BY key',
          )
        ).rows;
        const sprints = (
          await c.query<{
            project_id: string;
            snapshot: { itemId: string; estimate: number | null }[] | null;
            completed_at: Date | null;
            done: string;
          }>(
            `SELECT sp.project_id, sp.scope_snapshot AS snapshot, sp.completed_at,
                    (SELECT coalesce(sum(i.estimate), 0) FROM items i WHERE i.sprint_id = sp.id AND i.completed_at IS NOT NULL AND i.completed_at <= coalesce(sp.completed_at, now())) AS done
               FROM sprints sp WHERE sp.status = 'completed' AND sp.completed_at >= $1::date ORDER BY sp.completed_at`,
            [before],
          )
        ).rows;
        const envs = await productionEnvs(c);
        const deploys = (
          await c.query<{ environment_id: string; status: string }>(
            "SELECT environment_id, status FROM deploy_runs WHERE created_at >= $1::date AND status IN ('succeeded', 'failed')",
            [from],
          )
        ).rows;
        const perProject = projects.map((p) => {
          const mine = done.filter((d) => d.project_id === p.id);
          const sp = sprints.filter((x) => x.project_id === p.id).slice(-3);
          const planned = sp.map((x) =>
            (x.snapshot ?? []).reduce((t, i) => t + (i.estimate ?? 0), 0),
          );
          const accuracy =
            sp.length && planned.some((x) => x > 0)
              ? Math.min(
                  1,
                  sp.reduce((t, x) => t + Number(x.done), 0) /
                    Math.max(
                      1,
                      planned.reduce((a, b) => a + b, 0),
                    ),
                )
              : null;
          const env = envs.get(p.id);
          const dep = deploys.filter((d) => d.environment_id === env);
          return {
            id: p.id,
            key: p.key,
            cycleDays: round1(cycles(mine)),
            velocity: sp.length
              ? Math.round(sp.reduce((t, x) => t + Number(x.done), 0) / sp.length)
              : null,
            accuracy: accuracy === null ? null : Math.round(accuracy * 100) / 100,
            deploysPerWeek: env ? Math.round((dep.length / n) * 10) / 10 : null,
            changeFailure: dep.length
              ? Math.round((dep.filter((d) => d.status === 'failed').length / dep.length) * 100) /
                100
              : null,
          };
        });

        // team load for the next two weeks, from planned tasks and capacity
        const today = new Date().toISOString().slice(0, 10);
        const end = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);
        const capacityDays = sharedWorkdays(today, end, today, end) || 10;
        const people = (
          await c.query<{
            user_id: string;
            name: string;
            capacity: string | null;
            team_id: string | null;
            team: string | null;
          }>(
            `SELECT m.user_id, u.name, mp.capacity_hours_week AS capacity, tm.team_id, t.name AS team
               FROM workspace_members m JOIN users u ON u.id = m.user_id
               LEFT JOIN member_profiles mp ON mp.user_id = m.user_id
               LEFT JOIN team_members tm ON tm.user_id = m.user_id LEFT JOIN teams t ON t.id = tm.team_id
              WHERE m.suspended_at IS NULL AND m.role NOT IN ('guest', 'auditor', 'billing')`,
          )
        ).rows;
        const tasks = (
          await c.query<{ assignee_id: string; start_date: string; due_date: string }>(
            `SELECT i.assignee_id, i.start_date::text AS start_date, coalesce(i.due_date, i.start_date + coalesce(i.duration_days, 1) - 1)::text AS due_date
               FROM items i JOIN project_states s ON s.id = i.state_id
              WHERE i.assignee_id IS NOT NULL AND i.start_date IS NOT NULL AND s.grp NOT IN ('completed', 'cancelled')
                AND i.start_date < $2::date AND coalesce(i.due_date, i.start_date) >= $1::date`,
            [today, end],
          )
        ).rows;
        // [PCODE-187 | S15 | v0.1.0] approved absences take workdays from a person's capacity
        const absent = (
          await c.query<{ user_id: string; starts_on: string; ends_on: string; half_day: boolean }>(
            `SELECT user_id, starts_on::text AS starts_on, ends_on::text AS ends_on, half_day FROM absences
              WHERE state = 'approved' AND starts_on < $2::date AND ends_on >= $1::date`,
            [today, end],
          )
        ).rows;
        const spanDays = Array.from({ length: 14 }, (_, i) =>
          new Date(Date.parse(today + 'T00:00:00Z') + i * 86_400_000).toISOString().slice(0, 10),
        );
        const awayDays = (userId: string): number =>
          absent
            .filter((x) => x.user_id === userId)
            .reduce(
              (n, x) =>
                n +
                absenceWorkdays(
                  { startsOn: x.starts_on, endsOn: x.ends_on, halfDay: x.half_day },
                  spanDays,
                ),
              0,
            );
        const loadOf = new Map<string, number>();
        for (const p of people) {
          if (loadOf.has(p.user_id)) continue;
          const booked = tasks
            .filter((t) => t.assignee_id === p.user_id)
            .reduce((sum, t) => sum + sharedWorkdays(t.start_date, t.due_date, today, end), 0);
          loadOf.set(
            p.user_id,
            loadPercent(
              booked,
              Math.max(0, capacityDays - awayDays(p.user_id)) *
                ((p.capacity === null ? 40 : Number(p.capacity)) / 40),
            ),
          );
        }
        const teamIds = [...new Set(people.filter((p) => p.team_id).map((p) => p.team_id ?? ''))];
        const teams = teamIds.map((id) => {
          const members = people.filter((p) => p.team_id === id);
          const loads = members.map((m) => loadOf.get(m.user_id) ?? 0);
          return {
            id,
            name: members[0]?.team ?? '',
            load: loads.length ? Math.round(loads.reduce((x, y) => x + y, 0) / loads.length) : 0,
            overbooked: members
              .filter((m) => (loadOf.get(m.user_id) ?? 0) > 100)
              .map((m) => ({ name: m.name, load: loadOf.get(m.user_id) ?? 0 })),
          };
        });

        // weekly snapshots of finished weeks, per project
        for (const w of weeks.slice(0, -1))
          for (const p of projects) {
            const wk = done.filter((d) => d.week === w && d.project_id === p.id);
            await c.query(
              `INSERT INTO insight_snapshots (workspace_id, project_id, week, figures) VALUES ($1, $2, $3, $4)
               ON CONFLICT (project_id, week) DO UPDATE SET figures = $4, taken_at = now()`,
              [
                a.workspaceId,
                p.id,
                w,
                JSON.stringify({
                  done: wk.length,
                  points: pts(wk),
                  agentDone: wk.filter((d) => d.agent).length,
                  cycleDays: round1(cycles(wk)),
                }),
              ],
            );
          }

        return {
          body: {
            weeks: weeks.map((w) => {
              const wk = done.filter((d) => d.week === w);
              return {
                week: w,
                done: wk.length,
                points: pts(wk),
                agentDone: admin ? wk.filter((d) => d.agent).length : null,
                agentPoints: admin ? pts(wk.filter((d) => d.agent)) : null,
              };
            }),
            cycleDays: round1(cycles(done)),
            cycleDaysBefore: round1(median(earlier)),
            pointsPerWeek: Math.round((points / n) * 10) / 10,
            escapedBugs: Number(bugs?.bugs ?? 0),
            releases: Number(bugs?.releases ?? 0),
            aiCents,
            aiCentsPerPoint: points ? Math.round(aiCents / points) : null,
            agents: admin
              ? {
                  agentPoints: pts(agentDone),
                  peoplePoints: points - pts(agentDone),
                  agentCycleDays: round1(cycles(agentDone)),
                  peopleCycleDays: round1(cycles(done.filter((d) => !d.agent))),
                  agentCentsPerPoint: pts(agentDone) ? Math.round(aiCents / pts(agentDone)) : null,
                  runsSucceeded: Number(ai?.ok ?? 0),
                  runsFailed: Number(ai?.failed ?? 0),
                  declined: Number(ai?.declined ?? 0),
                }
              : null,
            flow: {
              wip: Number(flow?.wip ?? 0),
              aging: Number(flow?.aging ?? 0),
              carried: Number(flow?.carried ?? 0),
              reviewHours: round1(median(review)),
              projects: Number(flow?.projects ?? 0),
            },
            projects: perProject,
            teams,
          },
        };
      }),
  });
  return [insights];
}
