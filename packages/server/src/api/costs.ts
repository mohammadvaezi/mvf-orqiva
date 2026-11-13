// ── [PCODE-327 | S15 | v0.1.0] T33.1a Cache and reasoning tokens priced, the daily ECB rate, spend in euro by day ──
// ── [PCODE-249 | S15 | v0.1.0] T25.4 Alerts and reminders: budgets, anomalies, doc watchers, stale flags and ideas ──
// ── [PCODE-243 | S15 | v0.1.0] T24.4 AI providers exit check, docs and sprint close ──
// ── [PCODE-242 | S15 | v0.1.0] T24.3 AI providers and file reading in the web app ──
// ── [PCODE-240 | S15 | v0.1.0] T24.1 AI provider connections: Anthropic, OpenAI, Azure, Gemini, Bedrock, Grok, fallbacks, prices ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-181 | S15 | v0.1.0] B5.2 Tokens and costs live: AI spend, budgets, prices, provider keys per project, access tokens with scopes, policy, leak revocation ──
//    Why:  the AI half of Tokens and costs: spend per day in euro with the days that stand out (a looping
//          agent), this month and its forecast, by project, model and agent; budgets at every level with
//          what they have used; the price table per model (the workspace's own wins over the shipped one);
//          and provider keys per project, sealed on the way in and never shown again.
import { monthForecast, spendAnomalies, usdMicrosToCents } from '@orqiva/shared';
import type { Pool, PoolClient } from 'pg';
import { seal, SecretKeyMissing } from '../agents/secrets.js';
import { PROVIDER_INFO } from '../agents/connections.js'; // [PCODE-240 | S15 | v0.1.0]
import { recordEvent } from '../events/outbox.js';
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s } from '../http/schema.js';
import { rateNow } from '../lib/money.js';
import { actorOf, asMember, requireProject } from './access.js';

const uuid = s.string({ format: 'uuid' });
const wsParams = s.object({ workspaceId: uuid });

export interface BudgetRow {
  id: string;
  scope_type: string;
  scope_id: string | null;
  measure: string;
  period: string;
  amount_cents: string;
  warn_pct: number;
  hard_stop: boolean;
  label: string | null;
}

/** Micro-dollars spent in a budget's scope and period. */
// [PCODE-249 | S15 | v0.1.0] the alerts count it too
export async function usedMicros(c: PoolClient, b: BudgetRow): Promise<number> {
  const since =
    b.period === 'day'
      ? "date_trunc('day', now())"
      : b.period === 'total'
        ? "'-infinity'::timestamptz"
        : "date_trunc('month', now())";
  const where =
    b.scope_type === 'workspace'
      ? 'true'
      : b.scope_type === 'project'
        ? 'r.project_id = $1'
        : b.scope_type === 'agent'
          ? 'r.agent_id = $1'
          : b.scope_type === 'client'
            ? 'p.client_id = $1'
            : 'false';
  const agg = b.period === 'run' ? 'max(r.cost_micros)' : 'sum(r.cost_micros)';
  const r = (
    await c.query<{ n: string | null }>(
      `SELECT ${agg} AS n FROM agent_runs r JOIN projects p ON p.id = r.project_id WHERE ${where} AND r.created_at >= ${since}`,
      b.scope_type === 'workspace' ? [] : [b.scope_id],
    )
  ).rows[0];
  return Number(r?.n ?? 0);
}

/** The first hard budget a run would break: workspace, its client, its project or its agent. */
export async function budgetStop(
  c: PoolClient,
  run: { project_id: string; agent_id: string },
  usdEur: number,
): Promise<string | null> {
  const list = (
    await c.query<BudgetRow>(
      `SELECT b.*, NULL AS label FROM budgets b
        WHERE b.hard_stop AND b.measure IN ('ai', 'total') AND b.period IN ('day', 'month', 'total')
          AND (b.scope_type = 'workspace'
            OR (b.scope_type = 'project' AND b.scope_id = $1)
            OR (b.scope_type = 'agent' AND b.scope_id = $2)
            OR (b.scope_type = 'client' AND b.scope_id = (SELECT client_id FROM projects WHERE id = $1)))`,
      [run.project_id, run.agent_id],
    )
  ).rows;
  for (const b of list) {
    const used = usdMicrosToCents(await usedMicros(c, b), usdEur);
    if (used >= Number(b.amount_cents))
      return (
        'The ' +
        b.scope_type +
        ' budget of ' +
        (Number(b.amount_cents) / 100).toFixed(2).replace('.', ',') +
        ' € ' +
        (b.period === 'day' ? 'for today' : b.period === 'month' ? 'for this month' : 'in total') +
        ' is used up'
      );
  }
  return null;
}

export function costRoutes(pool: Pool): Route[] {
  const spend = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/ai-spend',
    summary:
      'AI spend in euro: per day with the days that stand out, today, this month and its forecast, by project, model and agent (member)',
    tags: ['costs'],
    params: wsParams,
    query: s.object({ days: s.optional(s.string({ max: 3 })) }),
    response: s.object({
      rate: s.object({ usdEur: s.number(), day: s.nullable(s.string()), source: s.string() }),
      days: s.array(
        s.object({
          day: s.string(),
          cents: s.number({ integer: true }),
          runs: s.number({ integer: true }),
        }),
      ),
      anomalies: s.array(
        s.object({
          day: s.string(),
          cents: s.number({ integer: true }),
          agent: s.nullable(s.string()),
          runs: s.number({ integer: true }),
        }),
      ),
      todayCents: s.number({ integer: true }),
      todayRuns: s.number({ integer: true }),
      todayAgents: s.number({ integer: true }),
      monthCents: s.number({ integer: true }),
      forecastCents: s.number({ integer: true }),
      budgetCents: s.nullable(s.number({ integer: true })),
      byProject: s.array(
        s.object({ id: s.string(), key: s.string(), cents: s.number({ integer: true }) }),
      ),
      byModel: s.array(
        s.object({
          model: s.string(),
          cents: s.number({ integer: true }),
          tokens: s.number({ integer: true }),
        }),
      ),
      byAgent: s.array(
        s.object({ id: s.string(), name: s.string(), cents: s.number({ integer: true }) }),
      ),
      // [PCODE-243 | S15 | v0.1.0] by the provider that answered each model call
      byProvider: s.array(
        s.object({
          provider: s.string(),
          cents: s.number({ integer: true }),
          tokens: s.number({ integer: true }),
        }),
      ),
    }),
    handler: ({ params, query, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c) => {
        const n = Math.max(7, Math.min(92, Number(query.days ?? 30) || 30));
        const rate = await rateNow(c);
        // [PCODE-327 | S15 | v0.1.0] each run at the rate of its day, today's rate where none was kept;
        // the sums below are dollar micros already turned into euro micros
        const cents = (m: string | number | null): number => usdMicrosToCents(Number(m ?? 0), 1);
        const eur = (r: string) => `${r}.cost_micros * coalesce(${r}.usd_eur, $1::real)`;
        const days = (
          await c.query<{ day: string; micros: string; runs: string; top: string | null }>(
            `SELECT d::date::text AS day, coalesce(sum(${eur('r')}), 0) AS micros, count(r.id) AS runs,
                    (SELECT a.name FROM agent_runs x JOIN agents a ON a.id = x.agent_id WHERE x.created_at::date = d::date
                      GROUP BY a.name ORDER BY sum(x.cost_micros) DESC LIMIT 1) AS top
               FROM generate_series(current_date - ($2::int - 1), current_date, interval '1 day') d
               LEFT JOIN agent_runs r ON r.created_at::date = d::date
              GROUP BY d ORDER BY d`,
            [rate.usdEur, n],
          )
        ).rows;
        const list = days.map((d) => ({
          day: d.day,
          cents: cents(d.micros),
          runs: Number(d.runs),
        }));
        const month = (
          await c.query<{ month: string; today: string; runs: string; agents: string }>(
            `SELECT coalesce(sum(${eur('r')}) FILTER (WHERE created_at >= date_trunc('month', now())), 0) AS month,
                    coalesce(sum(${eur('r')}) FILTER (WHERE created_at >= date_trunc('day', now())), 0) AS today,
                    count(*) FILTER (WHERE created_at >= date_trunc('day', now())) AS runs,
                    count(DISTINCT agent_id) FILTER (WHERE created_at >= date_trunc('day', now())) AS agents
               FROM agent_runs r`,
            [rate.usdEur],
          )
        ).rows[0];
        const by = async (sql: string) =>
          (
            await c.query<{ id: string; label: string; micros: string; tokens: string }>(sql, [
              rate.usdEur,
            ])
          ).rows;
        const byProject = await by(
          `SELECT p.id, p.key AS label, sum(${eur('r')}) AS micros, 0 AS tokens FROM agent_runs r JOIN projects p ON p.id = r.project_id WHERE r.created_at >= date_trunc('month', now()) GROUP BY p.id, p.key ORDER BY 3 DESC`,
        );
        const byModel = await by(
          `SELECT r.model AS id, r.model AS label, sum(${eur('r')}) AS micros, sum(r.tokens_in + r.tokens_out) AS tokens FROM agent_runs r WHERE r.created_at >= date_trunc('month', now()) GROUP BY r.model ORDER BY 3 DESC`,
        );
        // [PCODE-243 | S15 | v0.1.0] from the model steps: a run that a fallback finished counts for both
        const byProvider = await by(
          `SELECT coalesce(nullif(s.content->>'provider', ''), 'unknown') AS id, coalesce(nullif(s.content->>'provider', ''), 'unknown') AS label, sum(s.cost_micros * coalesce(r.usd_eur, $1::real)) AS micros, sum(s.tokens_in + s.tokens_out) AS tokens FROM agent_steps s JOIN agent_runs r ON r.id = s.run_id WHERE s.kind = 'model' AND s.at >= date_trunc('month', now()) GROUP BY 1, 2 ORDER BY 3 DESC`,
        );
        const byAgent = await by(
          `SELECT a.id, a.name AS label, sum(${eur('r')}) AS micros, 0 AS tokens FROM agent_runs r JOIN agents a ON a.id = r.agent_id WHERE r.created_at >= date_trunc('month', now()) GROUP BY a.id, a.name ORDER BY 3 DESC`,
        );
        const budget = (
          await c.query<{ amount_cents: string }>(
            "SELECT amount_cents FROM budgets WHERE scope_type = 'workspace' AND period = 'month' AND measure IN ('ai', 'total') ORDER BY measure LIMIT 1",
          )
        ).rows[0];
        const now = new Date();
        const daysIn = new Date(
          Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0),
        ).getUTCDate();
        const monthCents = cents(month?.month ?? 0);
        return {
          body: {
            rate,
            days: list,
            anomalies: spendAnomalies(list.map((d) => d.cents)).map((i) => ({
              day: list[i]?.day ?? '',
              cents: list[i]?.cents ?? 0,
              agent: days[i]?.top ?? null,
              runs: list[i]?.runs ?? 0,
            })),
            todayCents: cents(month?.today ?? 0),
            todayRuns: Number(month?.runs ?? 0),
            todayAgents: Number(month?.agents ?? 0),
            monthCents,
            forecastCents: monthForecast(monthCents, now.getUTCDate(), daysIn),
            budgetCents: budget ? Number(budget.amount_cents) : null,
            byProject: byProject.map((r) => ({ id: r.id, key: r.label, cents: cents(r.micros) })),
            byProvider: byProvider.map((r) => ({
              provider: r.label,
              cents: cents(r.micros),
              tokens: Number(r.tokens),
            })),
            byModel: byModel.map((r) => ({
              model: r.label,
              cents: cents(r.micros),
              tokens: Number(r.tokens),
            })),
            byAgent: byAgent.map((r) => ({ id: r.id, name: r.label, cents: cents(r.micros) })),
          },
        };
      }),
  });

  const budgetOut = s.object({
    id: s.string(),
    scopeType: s.string(),
    scopeId: s.nullable(s.string()),
    scopeLabel: s.string(),
    measure: s.string(),
    period: s.string(),
    amountCents: s.number({ integer: true }),
    warnPct: s.number({ integer: true }),
    hardStop: s.boolean(),
    usedCents: s.number({ integer: true }),
  });
  const BUDGET_SELECT = `SELECT b.*, coalesce(p.key, a.name, cl.name, t.name) AS label FROM budgets b
      LEFT JOIN projects p ON b.scope_type = 'project' AND p.id = b.scope_id
      LEFT JOIN agents a ON b.scope_type = 'agent' AND a.id = b.scope_id
      LEFT JOIN clients cl ON b.scope_type = 'client' AND cl.id = b.scope_id
      LEFT JOIN teams t ON b.scope_type = 'team' AND t.id = b.scope_id`;
  const budgetJson = async (c: PoolClient, b: BudgetRow, usdEur: number) => ({
    id: b.id,
    scopeType: b.scope_type,
    scopeId: b.scope_id,
    scopeLabel: b.scope_type === 'workspace' ? 'Workspace' : (b.label ?? '—'),
    measure: b.measure,
    period: b.period,
    amountCents: Number(b.amount_cents),
    warnPct: b.warn_pct,
    hardStop: b.hard_stop,
    usedCents: b.measure === 'time' ? 0 : usdMicrosToCents(await usedMicros(c, b), usdEur),
  });

  const budgets = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/budgets',
    summary: 'The budgets at every level with what each has used in its period (member)',
    tags: ['costs'],
    params: wsParams,
    response: s.array(budgetOut),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c) => {
        const rate = await rateNow(c);
        const rows = (
          await c.query<BudgetRow>(
            BUDGET_SELECT +
              " ORDER BY array_position(ARRAY['workspace', 'client', 'project', 'team', 'agent', 'run'], b.scope_type), b.created_at",
          )
        ).rows;
        const out = [];
        for (const b of rows) out.push(await budgetJson(c, b, rate.usdEur));
        return { body: out };
      }),
  });

  const addBudget = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/budgets',
    summary: 'A budget for the workspace, a client, a project, a team or an agent (admin)',
    tags: ['costs'],
    params: wsParams,
    body: s.object({
      scopeType: s.enum(['workspace', 'client', 'project', 'team', 'agent']),
      scopeId: s.optional(s.nullable(uuid)),
      measure: s.optional(s.enum(['ai', 'time', 'total'])),
      period: s.enum(['run', 'day', 'month', 'sprint', 'total']),
      amountCents: s.number({ integer: true, min: 1, max: 10_000_000_000 }),
      warnPct: s.optional(s.number({ integer: true, min: 1, max: 100 })),
      hardStop: s.optional(s.boolean()),
    }),
    response: budgetOut,
    status: 201,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'admin', async (c, a) => {
        if ((body.scopeType === 'workspace') !== !body.scopeId)
          throw new HttpError(
            400,
            'invalid_request',
            'A workspace budget has no scope; every other names one',
            [
              {
                path: 'body.scopeId',
                message: body.scopeType === 'workspace' ? 'must be empty' : 'is required',
              },
            ],
          );
        if (body.scopeType === 'project' && body.scopeId) await requireProject(c, a, body.scopeId);
        const table = {
          client: 'clients',
          team: 'teams',
          agent: 'agents',
          project: 'projects',
          workspace: '',
        }[body.scopeType];
        if (
          table &&
          !(await c.query(`SELECT 1 FROM ${table} WHERE id = $1`, [body.scopeId])).rowCount
        )
          throw new HttpError(400, 'invalid_request', 'There is no such ' + body.scopeType, [
            { path: 'body.scopeId', message: 'not found' },
          ]);
        const id = (
          await c.query<{ id: string }>(
            'INSERT INTO budgets (workspace_id, scope_type, scope_id, measure, period, amount_cents, warn_pct, hard_stop, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id',
            [
              a.workspaceId,
              body.scopeType,
              body.scopeId ?? null,
              body.measure ?? 'ai',
              body.period,
              body.amountCents,
              body.warnPct ?? 80,
              body.hardStop ?? false,
              a.user.id,
            ],
          )
        ).rows[0]?.id;
        const row = (await c.query<BudgetRow>(BUDGET_SELECT + ' WHERE b.id = $1', [id])).rows[0];
        if (!row) throw new Error('budget vanished');
        return { status: 201, body: await budgetJson(c, row, (await rateNow(c)).usdEur) };
      }),
  });

  const changeBudget = route({
    method: 'PATCH',
    path: '/api/workspaces/:workspaceId/budgets/:budgetId',
    summary: 'Change a budget’s amount, warning or hard stop (admin)',
    tags: ['costs'],
    params: s.object({ workspaceId: uuid, budgetId: uuid }),
    body: s.object({
      amountCents: s.optional(s.number({ integer: true, min: 1, max: 10_000_000_000 })),
      warnPct: s.optional(s.number({ integer: true, min: 1, max: 100 })),
      hardStop: s.optional(s.boolean()),
    }),
    response: budgetOut,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'admin', async (c) => {
        const r = await c.query(
          'UPDATE budgets SET amount_cents = coalesce($2, amount_cents), warn_pct = coalesce($3, warn_pct), hard_stop = coalesce($4, hard_stop) WHERE id = $1',
          [params.budgetId, body.amountCents ?? null, body.warnPct ?? null, body.hardStop ?? null],
        );
        if (!r.rowCount) throw new HttpError(404, 'not_found', 'Budget not found');
        const row = (
          await c.query<BudgetRow>(BUDGET_SELECT + ' WHERE b.id = $1', [params.budgetId])
        ).rows[0];
        if (!row) throw new Error('budget vanished');
        return { body: await budgetJson(c, row, (await rateNow(c)).usdEur) };
      }),
  });

  const removeBudget = route({
    method: 'DELETE',
    path: '/api/workspaces/:workspaceId/budgets/:budgetId',
    summary: 'Remove a budget (admin)',
    tags: ['costs'],
    params: s.object({ workspaceId: uuid, budgetId: uuid }),
    response: s.object({ removed: s.boolean() }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'admin', async (c) => ({
        body: {
          removed: Boolean(
            (await c.query('DELETE FROM budgets WHERE id = $1', [params.budgetId])).rowCount,
          ),
        },
      })),
  });

  const priceOut = s.object({
    provider: s.string(),
    model: s.string(),
    source: s.string(),
    effectiveFrom: s.string(),
    inputUsd: s.number(),
    outputUsd: s.number(),
    cacheReadUsd: s.number(),
    cacheWriteUsd: s.number(),
    retiresOn: s.nullable(s.string()),
    // [PCODE-240 | S15 | v0.1.0] transcripts, per minute of audio; where a shipped price comes from
    audioMinuteUsd: s.number(),
    note: s.string(),
  });
  const prices = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/model-prices',
    summary:
      'The price per model in US dollars per million tokens: the workspace’s own, else the shipped table; models used without a price (member)',
    tags: ['costs'],
    params: wsParams,
    response: s.object({
      rate: s.object({ usdEur: s.number(), day: s.nullable(s.string()), source: s.string() }),
      prices: s.array(priceOut),
      unpriced: s.array(s.string()),
    }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c) => {
        const rows = (
          await c.query<{
            provider: string;
            model: string;
            source: string;
            from: string;
            i: string;
            o: string;
            cr: string;
            cw: string;
            retires: string | null;
            am: string;
            note: string;
          }>(
            `SELECT DISTINCT ON (provider, model) provider, model, source, effective_from::text AS from, i, o, cr, cw, retires, am, note FROM (
               SELECT provider, model, 'workspace' AS source, effective_from, input_usd_micros AS i, output_usd_micros AS o, cache_read_usd_micros AS cr, cache_write_usd_micros AS cw, NULL::text AS retires, audio_minute_usd_micros AS am, '' AS note, 0 AS rank
                 FROM workspace_model_prices WHERE effective_from <= current_date
               UNION ALL
               SELECT provider, model, 'shipped', effective_from, input_usd_micros, output_usd_micros, cache_read_usd_micros, cache_write_usd_micros, retires_on::text, audio_minute_usd_micros, note, 1
                 FROM model_prices WHERE effective_from <= current_date) x
             ORDER BY provider, model, rank, effective_from DESC`,
          )
        ).rows;
        const used = (
          await c.query<{ model: string }>(
            "SELECT DISTINCT model FROM agent_runs WHERE created_at >= date_trunc('month', now())",
          )
        ).rows.map((r) => r.model);
        const usd = (m: string): number => Number(m) / 1_000_000;
        return {
          body: {
            rate: await rateNow(c),
            prices: rows.map((r) => ({
              provider: r.provider,
              model: r.model,
              source: r.source,
              effectiveFrom: r.from,
              inputUsd: usd(r.i),
              outputUsd: usd(r.o),
              cacheReadUsd: usd(r.cr),
              cacheWriteUsd: usd(r.cw),
              retiresOn: r.retires,
              audioMinuteUsd: usd(r.am),
              note: r.note,
            })),
            unpriced: used.filter((m) => !rows.some((r) => r.model === m)),
          },
        };
      }),
  });

  const setPrice = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/model-prices',
    summary:
      'The workspace’s price of a model from a date, in US dollars per million tokens (admin)',
    tags: ['costs'],
    params: wsParams,
    body: s.object({
      provider: s.string({ min: 1, max: 40 }),
      model: s.string({ min: 1, max: 120 }),
      effectiveFrom: s.string({ pattern: /^\d{4}-\d{2}-\d{2}$/ }),
      inputUsd: s.number({ min: 0, max: 10_000 }),
      outputUsd: s.number({ min: 0, max: 10_000 }),
      cacheReadUsd: s.optional(s.number({ min: 0, max: 10_000 })),
      cacheWriteUsd: s.optional(s.number({ min: 0, max: 10_000 })),
      audioMinuteUsd: s.optional(s.number({ min: 0, max: 100 })), // [PCODE-240 | S15 | v0.1.0]
    }),
    response: s.object({ saved: s.boolean() }),
    status: 201,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'admin', async (c, a) => {
        const m = (x: number | undefined): number => Math.round((x ?? 0) * 1_000_000);
        await c.query(
          `INSERT INTO workspace_model_prices (workspace_id, provider, model, effective_from, input_usd_micros, output_usd_micros, cache_read_usd_micros, cache_write_usd_micros, created_by, audio_minute_usd_micros)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           ON CONFLICT (workspace_id, provider, model, effective_from) DO UPDATE SET input_usd_micros = $5, output_usd_micros = $6, cache_read_usd_micros = $7, cache_write_usd_micros = $8, audio_minute_usd_micros = $10`,
          [
            a.workspaceId,
            body.provider.trim(),
            body.model.trim(),
            body.effectiveFrom,
            m(body.inputUsd),
            m(body.outputUsd),
            m(body.cacheReadUsd),
            m(body.cacheWriteUsd),
            a.user.id,
            m(body.audioMinuteUsd),
          ],
        );
        return { status: 201, body: { saved: true } };
      }),
  });

  const keyOut = s.object({
    projectId: s.nullable(s.string()),
    projectKey: s.nullable(s.string()),
    provider: s.string(),
    label: s.string(),
    hint: s.string(),
    lastUsedAt: s.nullable(s.string()),
    lastError: s.string(),
    createdAt: s.nullable(s.string()),
  });
  const keys = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/provider-keys',
    summary:
      'The workspace’s provider key and every project’s own; never the keys themselves (admin)',
    tags: ['costs'],
    params: wsParams,
    response: s.array(keyOut),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'admin', async (c) => {
        const ws = (
          await c.query<{ provider: string; key_ciphertext: string | null; updated_at: Date }>(
            'SELECT provider, key_ciphertext, updated_at FROM agent_provider_settings',
          )
        ).rows[0];
        const rows = (
          await c.query<{
            project_id: string;
            key: string;
            provider: string;
            label: string;
            key_hint: string;
            last_used_at: Date | null;
            last_error: string;
            created_at: Date;
          }>(
            'SELECT k.project_id, p.key, k.provider, k.label, k.key_hint, k.last_used_at, k.last_error, k.created_at FROM project_provider_keys k JOIN projects p ON p.id = k.project_id ORDER BY p.key',
          )
        ).rows;
        // [PCODE-242 | S15 | v0.1.0] the workspace's keys are its connections (Settings, AI providers)
        const conns = (
          await c.query<{ label: string; created_at: Date; last_error: string }>(
            'SELECT label, created_at, last_error FROM ai_connections ORDER BY created_at',
          )
        ).rows;
        return {
          body: [
            {
              projectId: null,
              projectKey: null,
              provider: ws?.provider ?? 'anthropic',
              label: conns.length
                ? 'Connections: ' + conns.map((x) => x.label).join(', ')
                : 'No connection yet: Settings, AI providers',
              hint: '',
              lastUsedAt: null,
              lastError: conns.find((x) => x.last_error)?.last_error ?? '',
              createdAt: conns[0]?.created_at.toISOString() ?? null,
            },
            ...rows.map((r) => ({
              projectId: r.project_id,
              projectKey: r.key,
              provider: r.provider,
              label: r.label,
              hint: r.key_hint,
              lastUsedAt: r.last_used_at?.toISOString() ?? null,
              lastError: r.last_error,
              createdAt: r.created_at.toISOString(),
            })),
          ],
        };
      }),
  });

  const setKey = route({
    method: 'PUT',
    path: '/api/workspaces/:workspaceId/projects/:projectId/provider-key',
    summary:
      'A project’s own provider key, e.g. when the client pays; sealed and never shown again (admin)',
    tags: ['costs'],
    params: s.object({ workspaceId: uuid, projectId: uuid }),
    body: s.object({
      key: s.string({ min: 20, max: 400 }),
      label: s.optional(s.string({ max: 80 })),
      // [PCODE-240 | S15 | v0.1.0] any provider; Bedrock with a Bedrock API key
      provider: s.optional(s.enum(['anthropic', 'openai', 'azure', 'gemini', 'bedrock', 'xai'])),
    }),
    response: keyOut,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'admin', async (c, a) => {
        const p = await requireProject(c, a, params.projectId);
        const plain = body.key.trim();
        const provider = body.provider ?? 'anthropic';
        const info = PROVIDER_INFO[provider];
        if (info.keyPattern && !info.keyPattern.test(plain))
          throw new HttpError(400, 'invalid_request', info.keyHelp, [
            { path: 'body.key', message: 'is not a key of ' + info.label },
          ]);
        let sealed: string;
        try {
          sealed = seal(plain);
        } catch (e) {
          if (e instanceof SecretKeyMissing) throw new HttpError(409, 'conflict', e.message);
          throw e;
        }
        await c.query(
          `INSERT INTO project_provider_keys (workspace_id, project_id, provider, label, key_ciphertext, key_hint, created_by) VALUES ($1, $2, $7, $3, $4, $5, $6)
           ON CONFLICT (project_id, provider) DO UPDATE SET label = $3, key_ciphertext = $4, key_hint = $5, created_by = $6, created_at = now(), last_error = '', last_used_at = NULL`,
          [
            a.workspaceId,
            p.id,
            (body.label ?? '').trim(),
            sealed,
            plain.slice(-4),
            a.user.id,
            provider,
          ],
        );
        await recordEvent(
          c,
          a.workspaceId,
          {
            actor: actorOf(a),
            verb: 'updated',
            object: { type: 'project', id: p.id, label: p.key },
            changes: { providerKey: { from: null, to: '…' + plain.slice(-4) } },
          },
          { projectId: p.id },
        );
        return {
          body: {
            projectId: p.id,
            projectKey: p.key,
            provider,
            label: (body.label ?? '').trim(),
            hint: plain.slice(-4),
            lastUsedAt: null,
            lastError: '',
            createdAt: new Date().toISOString(),
          },
        };
      }),
  });

  const removeKey = route({
    method: 'DELETE',
    path: '/api/workspaces/:workspaceId/projects/:projectId/provider-key',
    summary: 'Remove a project’s own key; its runs use the workspace key again (admin)',
    tags: ['costs'],
    params: s.object({ workspaceId: uuid, projectId: uuid }),
    // [PCODE-240 | S15 | v0.1.0] one provider's key, or all of the project's keys
    query: s.object({ provider: s.optional(s.string({ max: 20 })) }),
    response: s.object({ removed: s.boolean() }),
    handler: ({ params, query, req }) =>
      asMember(pool, req, params.workspaceId, 'admin', async (c, a) => {
        await requireProject(c, a, params.projectId);
        return {
          body: {
            removed: Boolean(
              (
                await c.query(
                  'DELETE FROM project_provider_keys WHERE project_id = $1 AND ($2::text IS NULL OR provider = $2)',
                  [params.projectId, query.provider ?? null],
                )
              ).rowCount,
            ),
          },
        };
      }),
  });

  return [
    spend,
    budgets,
    addBudget,
    changeBudget,
    removeBudget,
    prices,
    setPrice,
    keys,
    setKey,
    removeKey,
  ];
}
