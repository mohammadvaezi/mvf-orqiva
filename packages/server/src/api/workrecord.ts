// ── [PCODE-467 | S15 | v0.1.0] A project is planned for a client, and every task traces back to the client request it serves ──
// ── [PCODE-466 | S15 | v0.1.0] Every task shows its work record: AI, model, tokens, price, time and version, in VS Code and the portal ──
//    Why:  a project is analysed afterwards task by task: who or what did the work, with which model, how
//          many tokens it took, what it cost, how long it ran and on which version. The AI usage of Claude
//          Code in VS Code arrives with the loop (the hooks read it from the session's transcript) and is
//          added to a local run of the developer agent on the task, priced from the model's price list;
//          the run belongs to the work session and ends with it. The record of a task joins that with the
//          server's own runs on it, the time entries and the open session.
import { usageCost } from '@orqiva/shared';
import type { Pool, PoolClient } from 'pg';
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s } from '../http/schema.js';
import { priceOf, usdEurNow } from '../lib/money.js';
import { asMember, requireProject, type Access } from './access.js';
import { ensureAgents } from './agents.js';
import { requestsOfItem } from './projectbinding.js';

export interface UsageReport {
  model: string;
  tokensIn: number;
  tokensOut: number;
  cacheRead: number;
  cacheWrite: number;
  /** what the tool itself says it cost, when it says so (Claude Code headless does) */
  costUsd?: number | undefined;
}

/** claude-opus-5-5[1m] or claude-opus-5-5-20261001 -> claude-opus-5-5: the name the price list uses */
export function priceModel(model: string): string {
  return model
    .toLowerCase()
    .replace(/^anthropic[/.:]/, '')
    .replace(/\[.*\]$/, '')
    .replace(/-\d{8}$/, '')
    .trim();
}

const PROVIDER_OF = (model: string): string =>
  /^(gpt|o\d|whisper)/.test(model) ? 'openai' : /^gemini/.test(model) ? 'gemini' : 'anthropic';

/** Millionths of a dollar for this usage: the tool's own figure, else the price list's. */
export async function costOf(c: PoolClient, workspaceId: string, u: UsageReport): Promise<number> {
  if (u.costUsd !== undefined && u.costUsd > 0) return Math.round(u.costUsd * 1_000_000);
  const m = priceModel(u.model);
  const p = await priceOf(c, workspaceId, PROVIDER_OF(m), m);
  return usageCost(
    { input: u.tokensIn, output: u.tokensOut, cacheRead: u.cacheRead, cacheWrite: u.cacheWrite },
    p,
  );
}

// ── [PCODE-466 | S15 | v0.1.0] addSessionUsage: the session's tokens onto its run of the developer agent ──
export async function addSessionUsage(
  c: PoolClient,
  a: Access,
  session: { id: string; item_id: string },
  item: { project_id: string; ref: string; title: string },
  client: string,
  u: UsageReport,
): Promise<{ runId: string; costMicros: number }> {
  const model = priceModel(u.model) || 'claude-code';
  const cost = await costOf(c, a.workspaceId, u);
  let run = (
    await c.query<{ id: string }>(
      `SELECT id FROM agent_runs WHERE work_session_id = $1 AND source = 'local' AND model = $2`,
      [session.id, model],
    )
  ).rows[0];
  if (!run) {
    await ensureAgents(c, a.workspaceId);
    const agent = (await c.query<{ id: string }>("SELECT id FROM agents WHERE key = 'developer'"))
      .rows[0];
    if (!agent) throw new HttpError(409, 'conflict', 'The workspace has no developer agent');
    run = (
      await c.query<{ id: string }>(
        `INSERT INTO agent_runs (workspace_id, project_id, item_id, agent_id, requested_by, instruction, model,
                                 status, started_at, source, client, work_session_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7,
                 CASE WHEN (SELECT ended_at FROM work_sessions WHERE id = $9) IS NULL THEN 'running' ELSE 'succeeded' END,
                 now(), 'local', $8, $9) RETURNING id`,
        [
          a.workspaceId,
          item.project_id,
          session.item_id,
          agent.id,
          a.user.id,
          ('Claude Code in VS Code: ' + item.ref + ' ' + item.title).slice(0, 20000),
          model,
          client,
          session.id,
        ],
      )
    ).rows[0];
    if (!run) throw new Error('run insert returned nothing');
  }
  await c.query(
    `UPDATE agent_runs SET tokens_in = tokens_in + $2, tokens_out = tokens_out + $3,
            tokens_cache_read = tokens_cache_read + $4, tokens_cache_write = tokens_cache_write + $5,
            cost_micros = cost_micros + $6
      WHERE id = $1`,
    [run.id, u.tokensIn, u.tokensOut, u.cacheRead, u.cacheWrite, cost],
  );
  return { runId: run.id, costMicros: cost };
}

/** The usage a local run reports when it ends (the planning conversation in VS Code). */
export async function addRunUsage(
  c: PoolClient,
  workspaceId: string,
  runId: string,
  u: UsageReport,
): Promise<void> {
  const cost = await costOf(c, workspaceId, u);
  await c.query(
    `UPDATE agent_runs SET tokens_in = tokens_in + $2, tokens_out = tokens_out + $3,
            tokens_cache_read = tokens_cache_read + $4, tokens_cache_write = tokens_cache_write + $5,
            cost_micros = cost_micros + $6,
            model = CASE WHEN model = 'claude-code' AND $7 <> '' THEN $7 ELSE model END
      WHERE id = $1`,
    [runId, u.tokensIn, u.tokensOut, u.cacheRead, u.cacheWrite, cost, priceModel(u.model)],
  );
}

/** The session is over: its runs end with it. */
export async function endSessionRuns(c: PoolClient, sessionIds: string[]): Promise<void> {
  if (!sessionIds.length) return;
  await c.query(
    `UPDATE agent_runs SET status = 'succeeded', finished_at = now()
      WHERE work_session_id = ANY($1::uuid[]) AND status = 'running'`,
    [sessionIds],
  );
}

// ── [PCODE-466 | S15 | v0.1.0] the work record of one task ──
const uuid = s.string({ format: 'uuid' });
const runOut = s.object({
  id: s.string(),
  agent: s.string(),
  source: s.string(),
  client: s.string(),
  model: s.string(),
  status: s.string(),
  tokensIn: s.number({ integer: true }),
  tokensOut: s.number({ integer: true }),
  cacheRead: s.number({ integer: true }),
  cacheWrite: s.number({ integer: true }),
  costUsd: s.number(),
  startedAt: s.nullable(s.string()),
  finishedAt: s.nullable(s.string()),
});

interface RunRow {
  id: string;
  agent: string;
  source: string;
  client: string;
  model: string;
  status: string;
  tokens_in: string;
  tokens_out: string;
  tokens_cache_read: string;
  tokens_cache_write: string;
  cost_micros: string;
  started_at: Date | null;
  finished_at: Date | null;
}

export function workRecordRoutes(pool: Pool): Route[] {
  const get = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/items/:itemId/work',
    summary:
      "A task's work record: AI runs with model, tokens and cost, the time worked, the version (guest)",
    tags: ['items'],
    params: s.object({ workspaceId: uuid, itemId: uuid }),
    response: s.object({
      ref: s.string(),
      // [PCODE-467 | S15 | v0.1.0] for whom: the client, or internal, and the requests the task serves
      client: s.nullable(s.string()),
      internal: s.boolean(),
      requests: s.array(s.object({ id: s.string(), ref: s.string(), title: s.string() })),
      versions: s.array(s.string()),
      time: s.object({
        minutes: s.number({ integer: true }),
        running: s.boolean(),
        sessions: s.array(
          s.object({
            by: s.string(),
            client: s.string(),
            version: s.string(),
            startedAt: s.string(),
            endedAt: s.nullable(s.string()),
            minutes: s.number({ integer: true }),
            ended: s.nullable(s.string()),
          }),
        ),
      }),
      ai: s.object({
        runs: s.array(runOut),
        tokensIn: s.number({ integer: true }),
        tokensOut: s.number({ integer: true }),
        cacheRead: s.number({ integer: true }),
        cacheWrite: s.number({ integer: true }),
        costUsd: s.number(),
        costEur: s.number(),
        models: s.array(s.string()),
      }),
    }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        const it = (
          await c.query<{
            id: string;
            project_id: string;
            ref: string;
            client: string | null;
            internal: boolean;
          }>(
            "SELECT i.id, i.project_id, p.key || '-' || i.sequence AS ref, cl.name AS client, p.internal FROM items i JOIN projects p ON p.id = i.project_id LEFT JOIN clients cl ON cl.id = p.client_id WHERE i.id = $1",
            [params.itemId],
          )
        ).rows[0];
        if (!it) throw new HttpError(404, 'not_found', 'Item not found');
        try {
          await requireProject(c, a, it.project_id);
        } catch {
          throw new HttpError(404, 'not_found', 'Item not found');
        }
        const sessions = (
          await c.query<{
            by: string;
            client: string;
            version: string;
            started_at: Date;
            ended_at: Date | null;
            end_state: string | null;
            minutes: number;
          }>(
            `SELECT u.name AS by, w.client, w.version, w.started_at, w.ended_at, w.end_state,
                    (extract(epoch FROM (coalesce(w.ended_at, now()) - w.started_at)) / 60)::int AS minutes
               FROM work_sessions w JOIN users u ON u.id = w.user_id
              WHERE w.item_id = $1 ORDER BY w.started_at`,
            [it.id],
          )
        ).rows;
        // what the time sheet holds for the task (the ended sessions write there, and timers and manual
        // entries), plus the session still open
        const logged =
          (
            await c.query<{ m: number }>(
              'SELECT coalesce(sum(minutes), 0)::int AS m FROM time_entries WHERE item_id = $1',
              [it.id],
            )
          ).rows[0]?.m ?? 0;
        const open = sessions.filter((x) => !x.ended_at).reduce((n, x) => n + x.minutes, 0);
        const runs = (
          await c.query<RunRow>(
            `SELECT r.id, ag.name AS agent, r.source, r.client, r.model, r.status, r.tokens_in, r.tokens_out,
                    r.tokens_cache_read, r.tokens_cache_write, r.cost_micros, r.started_at, r.finished_at
               FROM agent_runs r JOIN agents ag ON ag.id = r.agent_id
              WHERE r.item_id = $1 ORDER BY r.created_at`,
            [it.id],
          )
        ).rows;
        const n = (v: string): number => Number(v);
        const sum = (f: (r: RunRow) => number): number => runs.reduce((t, r) => t + f(r), 0);
        const micros = sum((r) => n(r.cost_micros));
        const usdEur = await usdEurNow(c);
        return {
          body: {
            ref: it.ref,
            client: it.client,
            internal: it.internal,
            requests: await requestsOfItem(c, it.id),
            versions: [...new Set(sessions.map((x) => x.version).filter(Boolean))],
            time: {
              minutes: logged + open,
              running: open > 0 || sessions.some((x) => !x.ended_at),
              sessions: sessions.map((x) => ({
                by: x.by,
                client: x.client,
                version: x.version,
                startedAt: x.started_at.toISOString(),
                endedAt: x.ended_at ? x.ended_at.toISOString() : null,
                minutes: x.minutes,
                ended: x.end_state,
              })),
            },
            ai: {
              runs: runs.map((r) => ({
                id: r.id,
                agent: r.agent,
                source: r.source,
                client: r.client,
                model: r.model,
                status: r.status,
                tokensIn: n(r.tokens_in),
                tokensOut: n(r.tokens_out),
                cacheRead: n(r.tokens_cache_read),
                cacheWrite: n(r.tokens_cache_write),
                costUsd: n(r.cost_micros) / 1e6,
                startedAt: r.started_at ? r.started_at.toISOString() : null,
                finishedAt: r.finished_at ? r.finished_at.toISOString() : null,
              })),
              tokensIn: sum((r) => n(r.tokens_in)),
              tokensOut: sum((r) => n(r.tokens_out)),
              cacheRead: sum((r) => n(r.tokens_cache_read)),
              cacheWrite: sum((r) => n(r.tokens_cache_write)),
              costUsd: micros / 1e6,
              costEur: Math.round((micros / 1e6) * usdEur * 100) / 100,
              models: [...new Set(runs.map((r) => r.model))],
            },
          },
        };
      }),
  });
  return [get];
}
