// ── [PCODE-359 | S15 | v0.1.0] T35.7a Plan contents enforced ──
// ── [PCODE-334 | S15 | v0.1.0] T33.4c MCP servers per agent: registry, our own MCP client, tools in runs under the agent's rules ──
// ── [PCODE-332 | S15 | v0.1.0] T33.4a Nested traces with latency and commits, agent rate limits, provider limits and health ──
// ── [PCODE-330 | S15 | v0.1.0] T33.3a Run quality: annotations, judge scores, outcomes ──
// ── [PCODE-329 | S15 | v0.1.0] T33.2 Agent playground: rerun with other settings, compare runs, A/B experiments ──
// ── [PCODE-328 | S15 | v0.1.0] T33.1b Cost estimate before a run, chargeback per client and cost centre, unit costs ──
// ── [PCODE-327 | S15 | v0.1.0] T33.1a Cache and reasoning tokens priced, the daily ECB rate, spend in euro by day ──
// ── [PCODE-247 | S15 | v0.1.0] T25.2 Agent scopes enforced: files, branches, network, trace redaction ──
// ── [PCODE-246 | S15 | v0.1.0] T25.1 Agent triggers act: assignment, label, mention, CI failure, schedule, webhook ──
// ── [PCODE-240 | S15 | v0.1.0] T24.1 AI provider connections: Anthropic, OpenAI, Azure, Gemini, Bedrock, Grok, fallbacks, prices ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-180 | S15 | v0.1.0] B5.1 Agents live: settings, versioned prompts, action rules, autonomy, pause all, budgets in euro, traces, costs, quality ──
//    Why:  the control half of the Agents section: new agents, versioned instructions with rollback and
//          the success of each version, a rule per class of action, one switch that pauses every agent, the
//          fleet with money and live work, costs per agent and project in euro with the waste of failed
//          runs and a forecast, and a leaderboard of what the agents deliver for their cost.
import {
  ACTION_CLASSES,
  ACTION_TEXT,
  DEFAULT_RULES,
  monthForecast,
  chargebackCsv, // [PCODE-328 | S15 | v0.1.0]
  perUnit,
  roughRunTokens,
  runEstimate,
  usageCost,
  type ChargebackRow,
  TRIGGER_KINDS,
  triggerProblem,
  usdMicrosToCents,
  type Trigger,
  type ActionClass,
  type ActionRule,
} from '@orqiva/shared';
import type { Pool, PoolClient } from 'pg';
import { recordEvent } from '../events/outbox.js';
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s } from '../http/schema.js';
import { DEFAULT_MODEL, DEFAULT_TOOLS } from '../agents/defaults.js';
import { priceOf, rateNow } from '../lib/money.js';
import { OUTCOME_SQL, outcomeOfRow, type OutcomeFlags } from './runquality.js'; // [PCODE-330 | S15 | v0.1.0]
import { seal } from '../agents/secrets.js'; // [PCODE-246 | S15 | v0.1.0]
import { newWebhook } from '../agents/triggers.js';
import { agentScopeAllows, type AgentScope } from '@orqiva/shared'; // [PCODE-247 | S15 | v0.1.0]
import { actorOf, asMember, type Access } from './access.js';
import { ensureAgents } from './agents.js';
import { requireFeature } from '../licence/licence.js'; // [PCODE-359 | S15 | v0.1.0]

const uuid = s.string({ format: 'uuid' });
const agentParams = s.object({ workspaceId: uuid, agentId: uuid });
const SCOPE_KEYS = ['files', 'branches', 'network', 'documents'];

export interface AgentSettings {
  systemPrompt?: string;
  promptNote?: string;
  fallbackModel?: string;
  temperature?: number;
  maxOutputTokens?: number;
  autonomy?: 'suggest' | 'approve' | 'scoped' | 'autonomous';
  ownerId?: string | null;
  scope?: Record<string, unknown>;
  triggers?: Record<string, unknown>[];
  concurrency?: number;
  runBudgetCents?: number | null;
  dayBudgetCents?: number | null;
  monthBudgetCents?: number | null;
  // [PCODE-240 | S15 | v0.1.0] the agent's own connection; null follows the workspace's
  connectionId?: string | null;
  runsPerHour?: number | null; // [PCODE-332 | S15 | v0.1.0]
  mcpServers?: string[]; // [PCODE-334 | S15 | v0.1.0]
}

/** Scope: lists of short texts under known keys. */
function checkScope(scope: Record<string, unknown>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(scope)) {
    if (
      !SCOPE_KEYS.includes(k) ||
      !Array.isArray(v) ||
      v.length > 50 ||
      !v.every((x) => typeof x === 'string' && x.length > 0 && x.length <= 200)
    )
      throw new HttpError(
        400,
        'invalid_request',
        'Scope names files, branches, network and documents as lists',
        [{ path: 'body.scope.' + k, message: 'is not a list of short texts under a known key' }],
      );
    out[k] = v as string[];
  }
  return out;
}

// [PCODE-246 | S15 | v0.1.0] a trigger is checked as it will act: its value, and the project it works in
async function checkTriggers(c: PoolClient, list: Record<string, unknown>[]): Promise<Trigger[]> {
  if (list.length > 20)
    throw new HttpError(400, 'invalid_request', 'An agent has at most 20 triggers', [
      { path: 'body.triggers', message: 'has more than 20 triggers' },
    ]);
  const out: Trigger[] = [];
  for (const [i, t] of list.entries()) {
    const kind = t['kind'];
    const value = t['value'] ?? '';
    const project = t['project'] ?? '';
    const instruction = t['instruction'] ?? '';
    const bad = (message: string): HttpError =>
      new HttpError(400, 'invalid_request', message, [
        { path: 'body.triggers.' + String(i), message: 'is not a trigger' },
      ]);
    if (
      typeof kind !== 'string' ||
      !(TRIGGER_KINDS as readonly string[]).includes(kind) ||
      typeof value !== 'string' ||
      value.length > 200 ||
      typeof project !== 'string' ||
      typeof instruction !== 'string' ||
      instruction.length > 2000
    )
      throw bad('A trigger is one of ' + TRIGGER_KINDS.join(', ') + ' with an optional value');
    const trigger: Trigger = {
      kind: kind as Trigger['kind'],
      value: value.trim(),
      ...(project.trim() ? { project: project.trim().toUpperCase() } : {}),
      ...(instruction.trim() ? { instruction: instruction.trim() } : {}),
    };
    const problem = triggerProblem(trigger);
    if (problem) throw bad(problem);
    if (
      trigger.project &&
      !(
        await c.query('SELECT 1 FROM projects WHERE key = $1 AND archived_at IS NULL', [
          trigger.project,
        ])
      ).rowCount
    )
      throw bad('There is no project ' + trigger.project);
    out.push(trigger);
  }
  return out;
}

/** Applies the settings of the approved design; a changed prompt becomes the next version. */
export async function applySettings(
  c: PoolClient,
  a: Access,
  agentId: string,
  b: AgentSettings,
): Promise<void> {
  const cur = (
    await c.query<{ system_prompt: string; prompt_version: number }>(
      'SELECT system_prompt, prompt_version FROM agents WHERE id = $1',
      [agentId],
    )
  ).rows[0];
  if (!cur) throw new HttpError(404, 'not_found', 'Agent not found');
  if (
    b.ownerId &&
    !(
      await c.query(
        "SELECT 1 FROM workspace_members WHERE user_id = $1 AND role NOT IN ('guest', 'billing', 'auditor')",
        [b.ownerId],
      )
    ).rowCount
  )
    throw new HttpError(400, 'invalid_request', 'The accountable person is a member of the team', [
      { path: 'body.ownerId', message: 'is not a team member' },
    ]);
  // [PCODE-240 | S15 | v0.1.0]
  if (
    b.connectionId &&
    !(await c.query('SELECT 1 FROM ai_connections WHERE id = $1', [b.connectionId])).rowCount
  )
    throw new HttpError(400, 'invalid_request', 'There is no such AI connection', [
      { path: 'body.connectionId', message: 'is not a connection of this workspace' },
    ]);
  // [PCODE-334 | S15 | v0.1.0] only servers of this workspace
  const servers = b.mcpServers ? [...new Set(b.mcpServers)] : null;
  if (
    servers?.length &&
    Number(
      (
        await c.query<{ n: string }>(
          'SELECT count(*) AS n FROM mcp_servers WHERE id = ANY($1::uuid[])',
          [servers],
        )
      ).rows[0]?.n,
    ) !== servers.length
  )
    throw new HttpError(400, 'invalid_request', 'There is no such MCP server', [
      { path: 'body.mcpServers', message: 'names a server that does not exist' },
    ]);
  const scope = b.scope ? checkScope(b.scope) : null;
  const triggers = b.triggers ? await checkTriggers(c, b.triggers) : null;
  // [PCODE-246 | S15 | v0.1.0] the matcher reads this workspace from now on: what happened before starts nothing
  if (triggers?.length)
    await c.query(
      `INSERT INTO agent_trigger_cursors (workspace_id, last_sequence)
       VALUES ($1, (SELECT coalesce(max(sequence), 0) FROM activity_events WHERE workspace_id = $1))
       ON CONFLICT (workspace_id) DO NOTHING`,
      [a.workspaceId],
    );
  let version: number | null = null;
  if (b.systemPrompt !== undefined && b.systemPrompt !== cur.system_prompt) {
    // the version that is live now is kept first, for agents made before versions existed
    await c.query(
      "INSERT INTO agent_prompt_versions (workspace_id, agent_id, version, prompt, note) VALUES ($1, $2, $3, $4, 'as it was') ON CONFLICT DO NOTHING",
      [a.workspaceId, agentId, cur.prompt_version, cur.system_prompt],
    );
    version =
      ((
        await c.query<{ v: number }>(
          'SELECT greatest(coalesce(max(v.version), 0), (SELECT prompt_version FROM agents WHERE id = $1)) AS v FROM agent_prompt_versions v WHERE v.agent_id = $1',
          [agentId],
        )
      ).rows[0]?.v ?? 0) + 1;
    await c.query(
      'INSERT INTO agent_prompt_versions (workspace_id, agent_id, version, prompt, note, created_by) VALUES ($1, $2, $3, $4, $5, $6)',
      [a.workspaceId, agentId, version, b.systemPrompt, (b.promptNote ?? '').trim(), a.user.id],
    );
  }
  const keep = (v: unknown): boolean => v === undefined;
  await c.query(
    `UPDATE agents SET fallback_model = coalesce($2, fallback_model), temperature = coalesce($3, temperature), max_output_tokens = coalesce($4, max_output_tokens),
            autonomy = coalesce($5, autonomy), owner_id = CASE WHEN $6 THEN owner_id ELSE $7::uuid END, scope = coalesce($8, scope), triggers = coalesce($9, triggers),
            concurrency = coalesce($10, concurrency), prompt_version = coalesce($11, prompt_version),
            run_budget_cents = CASE WHEN $12 THEN run_budget_cents ELSE $13::bigint END,
            day_budget_cents = CASE WHEN $14 THEN day_budget_cents ELSE $15::bigint END,
            month_budget_cents = CASE WHEN $16 THEN month_budget_cents ELSE $17::bigint END,
            connection_id = CASE WHEN $18 THEN connection_id ELSE $19::uuid END,
            runs_per_hour = CASE WHEN $20 THEN runs_per_hour ELSE $21::int END,
            mcp_servers = coalesce($22::uuid[], mcp_servers)
      WHERE id = $1`,
    [
      agentId,
      b.fallbackModel?.trim() ?? null,
      b.temperature ?? null,
      b.maxOutputTokens ?? null,
      b.autonomy ?? null,
      keep(b.ownerId),
      b.ownerId ?? null,
      scope ? JSON.stringify(scope) : null,
      triggers ? JSON.stringify(triggers) : null,
      b.concurrency ?? null,
      version,
      keep(b.runBudgetCents),
      b.runBudgetCents ?? null,
      keep(b.dayBudgetCents),
      b.dayBudgetCents ?? null,
      keep(b.monthBudgetCents),
      b.monthBudgetCents ?? null,
      keep(b.connectionId),
      b.connectionId ?? null,
      keep(b.runsPerHour), // [PCODE-332 | S15 | v0.1.0]
      b.runsPerHour ?? null,
      servers, // [PCODE-334 | S15 | v0.1.0]
    ],
  );
}

const rulesOut = s.array(
  s.object({
    actionClass: s.string(),
    label: s.string(),
    rule: s.string(),
    isDefault: s.boolean(),
  }),
);
async function rulesOf(c: PoolClient, agentId: string) {
  const set = new Map(
    (
      await c.query<{ action_class: ActionClass; rule: ActionRule }>(
        'SELECT action_class, rule FROM agent_action_rules WHERE agent_id = $1',
        [agentId],
      )
    ).rows.map((r) => [r.action_class, r.rule]),
  );
  return ACTION_CLASSES.map((k) => ({
    actionClass: k,
    label: ACTION_TEXT[k],
    rule: set.get(k) ?? DEFAULT_RULES[k],
    isDefault: !set.has(k),
  }));
}

async function agentOf(c: PoolClient, id: string): Promise<{ id: string; name: string }> {
  const r = (
    await c.query<{ id: string; name: string }>('SELECT id, name FROM agents WHERE id = $1', [id])
  ).rows[0];
  if (!r) throw new HttpError(404, 'not_found', 'Agent not found');
  return r;
}

const monthOf = (q: string | undefined): { from: string; days: number; day: number } => {
  const now = new Date();
  const m = /^(\d{4})-(\d{2})$/.exec(q ?? '');
  const y = m ? Number(m[1]) : now.getUTCFullYear();
  const mo = m ? Number(m[2]) - 1 : now.getUTCMonth();
  if (mo < 0 || mo > 11)
    throw new HttpError(400, 'invalid_request', 'A month is written 2026-10', [
      { path: 'query.month', message: 'is not a month' },
    ]);
  const days = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
  const current = y === now.getUTCFullYear() && mo === now.getUTCMonth();
  const past = Date.UTC(y, mo, 1) < Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  return {
    from: String(y) + '-' + String(mo + 1).padStart(2, '0') + '-01',
    days,
    day: current ? now.getUTCDate() : past ? days : 0,
  };
};

// [PCODE-328 | S15 | v0.1.0] who pays: the month's runs by client, cost centre or project, each at its day's rate
type ChargeBy = 'client' | 'cost centre' | 'project';
async function chargeback(
  c: PoolClient,
  from: string,
  usdEur: number,
  by: ChargeBy,
): Promise<ChargebackRow[]> {
  const group =
    by === 'client'
      ? "coalesce(cl.name, 'No client')"
      : by === 'project'
        ? "p.key || ' ' || p.name"
        : "coalesce(nullif(p.cost_centre, ''), 'No cost centre')";
  const rows = (
    await c.query<{ g: string; keys: string[]; runs: string; micros: string }>(
      `SELECT ${group} AS g, array_agg(DISTINCT p.key ORDER BY p.key) AS keys, count(r.id) AS runs,
              coalesce(sum(r.cost_micros * coalesce(r.usd_eur, $2::real)), 0) AS micros
         FROM agent_runs r JOIN projects p ON p.id = r.project_id LEFT JOIN clients cl ON cl.id = p.client_id
        WHERE r.created_at >= $1::date AND r.created_at < ($1::date + interval '1 month')
        GROUP BY 1 ORDER BY 4 DESC, 1`,
      [from, usdEur],
    )
  ).rows;
  return rows.map((r) => ({
    group: r.g,
    projects: r.keys,
    runs: Number(r.runs),
    cents: usdMicrosToCents(Number(r.micros), 1),
  }));
}

// [PCODE-328 | S15 | v0.1.0] what a result cost: the runs on the tasks finished in the month, and on the
// tasks behind the pull requests merged in it, all runs of such a task counted once
interface Units {
  tasksDone: number;
  perTaskCents: number | null;
  prsMerged: number;
  perPrCents: number | null;
}
async function unitCosts(
  c: PoolClient,
  from: string,
  usdEur: number,
): Promise<{ all: Units; byProject: Map<string, Units> }> {
  const runCost = `(SELECT coalesce(sum(r.cost_micros * coalesce(r.usd_eur, $2::real)), 0) FROM agent_runs r WHERE r.item_id = i.id)`;
  const tasks = (
    await c.query<{ id: string; project_id: string; micros: string }>(
      `SELECT i.id, i.project_id, ${runCost} AS micros FROM items i
        WHERE i.completed_at >= $1::date AND i.completed_at < ($1::date + interval '1 month')
          AND EXISTS (SELECT 1 FROM agent_runs r WHERE r.item_id = i.id)`,
      [from, usdEur],
    )
  ).rows;
  const prs = (
    await c.query<{ project_id: string; item_id: string; micros: string }>(
      `SELECT pr.project_id, i.id AS item_id, ${runCost} AS micros
         FROM pull_requests pr JOIN items i ON i.id = pr.item_id
        WHERE pr.state = 'merged' AND pr.merged_at >= $1::date AND pr.merged_at < ($1::date + interval '1 month')
          AND EXISTS (SELECT 1 FROM agent_runs r WHERE r.item_id = i.id)`,
      [from, usdEur],
    )
  ).rows;
  const acc = new Map<string, { t: number; tm: number; p: number; pm: Map<string, number> }>();
  const of = (k: string) => {
    let e = acc.get(k);
    if (!e) acc.set(k, (e = { t: 0, tm: 0, p: 0, pm: new Map() }));
    return e;
  };
  for (const t of tasks)
    for (const k of ['', t.project_id]) {
      const e = of(k);
      e.t++;
      e.tm += Number(t.micros);
    }
  for (const pr of prs)
    for (const k of ['', pr.project_id]) {
      const e = of(k);
      e.p++;
      e.pm.set(pr.item_id, Number(pr.micros));
    }
  const units = (k: string): Units => {
    const e = acc.get(k) ?? { t: 0, tm: 0, p: 0, pm: new Map<string, number>() };
    const prMicros = [...e.pm.values()].reduce((n, x) => n + x, 0);
    return {
      tasksDone: e.t,
      perTaskCents: perUnit(usdMicrosToCents(e.tm, 1), e.t),
      prsMerged: e.p,
      perPrCents: perUnit(usdMicrosToCents(prMicros, 1), e.p),
    };
  };
  const byProject = new Map<string, Units>();
  for (const k of acc.keys()) if (k) byProject.set(k, units(k));
  return { all: units(''), byProject };
}

const unitsOut = s.object({
  tasksDone: s.number({ integer: true }),
  perTaskCents: s.nullable(s.number({ integer: true })),
  prsMerged: s.number({ integer: true }),
  perPrCents: s.nullable(s.number({ integer: true })),
});
const chargeOut = s.array(
  s.object({
    group: s.string(),
    projects: s.array(s.string()),
    runs: s.number({ integer: true }),
    cents: s.number({ integer: true }),
  }),
);

export function agentControlRoutes(pool: Pool): Route[] {
  const create = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/agents',
    summary: 'A new agent, from scratch or as a copy of another (admin)',
    tags: ['agents'],
    params: s.object({ workspaceId: uuid }),
    body: s.object({
      key: s.string({ pattern: /^[a-z][a-z0-9-]{0,39}$/ }),
      name: s.string({ min: 1, max: 80 }),
      description: s.optional(s.string({ max: 500 })),
      model: s.optional(s.string({ min: 1, max: 100 })),
      systemPrompt: s.optional(s.string({ max: 20_000 })),
      copyOf: s.optional(uuid),
    }),
    response: s.object({ id: s.string() }),
    status: 201,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'admin', async (c, a) => {
        await requireFeature(c, a.workspaceId, 'custom-agents', 'Making your own agents'); // [PCODE-359 | S15 | v0.1.0]
        await ensureAgents(c, a.workspaceId);
        if ((await c.query('SELECT 1 FROM agents WHERE key = $1', [body.key])).rowCount)
          throw new HttpError(
            409,
            'conflict',
            'An agent with the key ' + body.key + ' exists already',
          );
        const from = body.copyOf
          ? (
              await c.query<{
                system_prompt: string;
                model: string;
                tools: string[];
                description: string;
              }>('SELECT system_prompt, model, tools, description FROM agents WHERE id = $1', [
                body.copyOf,
              ])
            ).rows[0]
          : undefined;
        if (body.copyOf && !from)
          throw new HttpError(404, 'not_found', 'The agent to copy was not found');
        const prompt = body.systemPrompt ?? from?.system_prompt ?? '';
        const id = (
          await c.query<{ id: string }>(
            `INSERT INTO agents (workspace_id, key, name, description, system_prompt, model, tools, enabled, owner_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, false, $8) RETURNING id`,
            [
              a.workspaceId,
              body.key,
              body.name.trim(),
              body.description ?? from?.description ?? '',
              prompt,
              body.model ?? from?.model ?? DEFAULT_MODEL,
              from?.tools ?? DEFAULT_TOOLS,
              a.user.id,
            ],
          )
        ).rows[0]?.id;
        if (!id) throw new Error('agent insert returned nothing');
        await c.query(
          "INSERT INTO agent_prompt_versions (workspace_id, agent_id, version, prompt, note, created_by) VALUES ($1, $2, 1, $3, 'first version', $4)",
          [a.workspaceId, id, prompt, a.user.id],
        );
        if (body.copyOf)
          await c.query(
            'INSERT INTO agent_action_rules (workspace_id, agent_id, action_class, rule) SELECT workspace_id, $2, action_class, rule FROM agent_action_rules WHERE agent_id = $1',
            [body.copyOf, id],
          );
        return { status: 201, body: { id } };
      }),
  });

  const prompts = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/agents/:agentId/prompts',
    summary:
      'The versions of an agent’s instructions, with how often and how well each ran (member)',
    tags: ['agents'],
    params: agentParams,
    response: s.array(
      s.object({
        version: s.number({ integer: true }),
        prompt: s.string(),
        note: s.string(),
        createdBy: s.nullable(s.string()),
        createdAt: s.string(),
        live: s.boolean(),
        runs: s.number({ integer: true }),
        succeeded: s.number({ integer: true }),
      }),
    ),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c) => {
        await agentOf(c, params.agentId);
        const rows = (
          await c.query<{
            version: number;
            prompt: string;
            note: string;
            by: string | null;
            created_at: Date;
            live: boolean;
            runs: string;
            ok: string;
          }>(
            `SELECT v.version, v.prompt, v.note, u.name AS by, v.created_at, (a.prompt_version = v.version) AS live,
                    (SELECT count(*) FROM agent_runs r WHERE r.agent_id = v.agent_id AND r.prompt_version = v.version AND r.status IN ('succeeded', 'failed')) AS runs,
                    (SELECT count(*) FROM agent_runs r WHERE r.agent_id = v.agent_id AND r.prompt_version = v.version AND r.status = 'succeeded') AS ok
               FROM agent_prompt_versions v JOIN agents a ON a.id = v.agent_id LEFT JOIN users u ON u.id = v.created_by
              WHERE v.agent_id = $1 ORDER BY v.version DESC`,
            [params.agentId],
          )
        ).rows;
        return {
          body: rows.map((r) => ({
            version: r.version,
            prompt: r.prompt,
            note: r.note,
            createdBy: r.by,
            createdAt: r.created_at.toISOString(),
            live: r.live,
            runs: Number(r.runs),
            succeeded: Number(r.ok),
          })),
        };
      }),
  });

  const rollback = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/agents/:agentId/prompts/:version/rollback',
    summary:
      'Go back to an earlier version of the instructions; it comes back as the newest version (admin)',
    tags: ['agents'],
    params: s.object({
      workspaceId: uuid,
      agentId: uuid,
      version: s.string({ pattern: /^\d{1,6}$/ }),
    }),
    response: s.object({ version: s.number({ integer: true }) }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'admin', async (c, a) => {
        const agent = await agentOf(c, params.agentId);
        const old = (
          await c.query<{ prompt: string }>(
            'SELECT prompt FROM agent_prompt_versions WHERE agent_id = $1 AND version = $2',
            [agent.id, Number(params.version)],
          )
        ).rows[0];
        if (!old) throw new HttpError(404, 'not_found', 'There is no version ' + params.version);
        await applySettings(c, a, agent.id, {
          systemPrompt: old.prompt,
          promptNote: 'back to version ' + params.version,
        });
        await c.query('UPDATE agents SET system_prompt = $2 WHERE id = $1', [agent.id, old.prompt]);
        const v =
          (
            await c.query<{ prompt_version: number }>(
              'SELECT prompt_version FROM agents WHERE id = $1',
              [agent.id],
            )
          ).rows[0]?.prompt_version ?? 1;
        return { body: { version: v } };
      }),
  });

  const getRules = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/agents/:agentId/rules',
    summary: 'What the agent may do per class of action: never, ask, allowed (member)',
    tags: ['agents'],
    params: agentParams,
    response: rulesOut,
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c) => {
        await agentOf(c, params.agentId);
        return { body: await rulesOf(c, params.agentId) };
      }),
  });

  const setRules = route({
    method: 'PUT',
    path: '/api/workspaces/:workspaceId/agents/:agentId/rules',
    summary: 'Set the rule of one or more classes of action (admin)',
    tags: ['agents'],
    params: agentParams,
    body: s.object({ rules: s.anyObject() }),
    response: rulesOut,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'admin', async (c, a) => {
        const agent = await agentOf(c, params.agentId);
        for (const [k, v] of Object.entries(body.rules)) {
          if (
            !(ACTION_CLASSES as readonly string[]).includes(k) ||
            (v !== 'never' && v !== 'ask' && v !== 'allowed')
          )
            throw new HttpError(
              400,
              'invalid_request',
              'A rule is never, ask or allowed for a known class of action',
              [{ path: 'body.rules.' + k, message: 'is not a rule' }],
            );
          await c.query(
            'INSERT INTO agent_action_rules (workspace_id, agent_id, action_class, rule) VALUES ($1, $2, $3, $4) ON CONFLICT (agent_id, action_class) DO UPDATE SET rule = $4',
            [a.workspaceId, agent.id, k, v],
          );
        }
        await recordEvent(c, a.workspaceId, {
          actor: actorOf(a),
          verb: 'updated',
          object: { type: 'agent', id: agent.id, label: agent.name },
          changes: { rules: { from: null, to: body.rules } },
        });
        return { body: await rulesOf(c, agent.id) };
      }),
  });

  const pause = route({
    method: 'PUT',
    path: '/api/workspaces/:workspaceId/agents/pause',
    summary: 'Pause every agent (running steps finish, nothing new starts) or resume them (admin)',
    tags: ['agents'],
    params: s.object({ workspaceId: uuid }),
    body: s.object({ paused: s.boolean() }),
    response: s.object({ paused: s.boolean(), pausedAt: s.nullable(s.string()) }),
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'admin', async (c, a) => {
        const r = (
          await c.query<{ paused_at: Date | null }>(
            `INSERT INTO agent_provider_settings (workspace_id, paused_at, paused_by) VALUES ($1, CASE WHEN $2 THEN now() END, CASE WHEN $2 THEN $3::uuid END)
             ON CONFLICT (workspace_id) DO UPDATE SET paused_at = CASE WHEN $2 THEN coalesce(agent_provider_settings.paused_at, now()) END,
               paused_by = CASE WHEN $2 THEN coalesce(agent_provider_settings.paused_by, $3::uuid) END
             RETURNING paused_at`,
            [a.workspaceId, body.paused, a.user.id],
          )
        ).rows[0];
        await recordEvent(c, a.workspaceId, {
          actor: actorOf(a),
          verb: 'updated',
          object: { type: 'workspace', id: a.workspaceId, label: 'agents' },
          changes: { agentsPaused: { from: !body.paused, to: body.paused } },
        });
        if (!body.paused) await c.query("SELECT pg_notify('orqiva_agents', 'resume')");
        return { body: { paused: body.paused, pausedAt: r?.paused_at?.toISOString() ?? null } };
      }),
  });

  const fleet = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/agent-fleet',
    summary:
      'Every agent with its money this month in euro, runs today, success, live work, and whether all are paused (member)',
    tags: ['agents'],
    params: s.object({ workspaceId: uuid }),
    response: s.object({
      paused: s.nullable(s.object({ at: s.string(), by: s.nullable(s.string()) })),
      running: s.number({ integer: true }),
      waiting: s.number({ integer: true }),
      monthCents: s.number({ integer: true }),
      agents: s.array(
        s.object({
          id: s.string(),
          monthCents: s.number({ integer: true }),
          runsToday: s.number({ integer: true }),
          successRate: s.nullable(s.number()),
          perSucceededCents: s.nullable(s.number({ integer: true })),
          live: s.array(
            s.object({
              runId: s.string(),
              status: s.string(),
              itemRef: s.nullable(s.string()),
              instruction: s.string(),
            }),
          ),
        }),
      ),
    }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        await ensureAgents(c, a.workspaceId);
        const rate = await rateNow(c);
        const p = (
          await c.query<{ paused_at: Date | null; by: string | null }>(
            'SELECT s.paused_at, u.name AS by FROM agent_provider_settings s LEFT JOIN users u ON u.id = s.paused_by',
          )
        ).rows[0];
        const rows = (
          await c.query<{
            id: string;
            month: string;
            today: string;
            ok: string;
            done: string;
            cost30: string;
          }>(
            `SELECT a.id,
                    coalesce(sum(r.cost_micros) FILTER (WHERE r.created_at >= date_trunc('month', now())), 0) AS month,
                    count(r.id) FILTER (WHERE r.created_at >= date_trunc('day', now())) AS today,
                    count(r.id) FILTER (WHERE r.status = 'succeeded' AND r.created_at > now() - interval '30 days') AS ok,
                    count(r.id) FILTER (WHERE r.status IN ('succeeded', 'failed') AND r.created_at > now() - interval '30 days') AS done,
                    coalesce(sum(r.cost_micros) FILTER (WHERE r.created_at > now() - interval '30 days'), 0) AS cost30
               FROM agents a LEFT JOIN agent_runs r ON r.agent_id = a.id GROUP BY a.id`,
          )
        ).rows;
        const live = (
          await c.query<{
            id: string;
            agent_id: string;
            status: string;
            item_ref: string | null;
            instruction: string;
          }>(
            `SELECT r.id, r.agent_id, r.status, CASE WHEN i.id IS NULL THEN NULL ELSE p.key || '-' || i.sequence END AS item_ref, r.instruction
               FROM agent_runs r JOIN projects p ON p.id = r.project_id LEFT JOIN items i ON i.id = r.item_id
              WHERE r.status IN ('running', 'waiting', 'queued') ORDER BY r.created_at`,
          )
        ).rows;
        const cents = (m: string): number => usdMicrosToCents(Number(m), rate.usdEur);
        return {
          body: {
            paused: p?.paused_at ? { at: p.paused_at.toISOString(), by: p.by } : null,
            running: live.filter((r) => r.status === 'running').length,
            waiting: live.filter((r) => r.status === 'waiting').length,
            monthCents: rows.reduce((n, r) => n + cents(r.month), 0),
            agents: rows.map((r) => ({
              id: r.id,
              monthCents: cents(r.month),
              runsToday: Number(r.today),
              successRate: Number(r.done)
                ? Math.round((Number(r.ok) / Number(r.done)) * 100) / 100
                : null,
              perSucceededCents: Number(r.ok) ? Math.round(cents(r.cost30) / Number(r.ok)) : null,
              live: live
                .filter((x) => x.agent_id === r.id)
                .map((x) => ({
                  runId: x.id,
                  status: x.status,
                  itemRef: x.item_ref,
                  instruction: x.instruction.slice(0, 140),
                })),
            })),
          },
        };
      }),
  });

  const costs = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/agent-costs',
    summary:
      'Agent costs of a month in euro: per agent and project, the waste of failed and cancelled runs, the forecast and the budget (member)',
    tags: ['agents'],
    params: s.object({ workspaceId: uuid }),
    query: s.object({ month: s.optional(s.string({ max: 7 })) }),
    response: s.object({
      month: s.string(),
      rate: s.object({ usdEur: s.number(), day: s.nullable(s.string()), source: s.string() }),
      totalCents: s.number({ integer: true }),
      wasteCents: s.number({ integer: true }),
      forecastCents: s.number({ integer: true }),
      budgetCents: s.nullable(s.number({ integer: true })),
      cacheShare: s.nullable(s.number()),
      projects: s.array(s.object({ id: s.string(), key: s.string() })),
      agents: s.array(
        s.object({
          agentId: s.string(),
          name: s.string(),
          byProject: s.anyObject(),
          wasteCents: s.number({ integer: true }),
          totalCents: s.number({ integer: true }),
        }),
      ),
      // [PCODE-328 | S15 | v0.1.0] chargeback and what a result cost
      byClient: chargeOut,
      byCostCentre: chargeOut,
      units: unitsOut,
      projectUnits: s.array(
        s.object({
          id: s.string(),
          key: s.string(),
          tasksDone: s.number({ integer: true }),
          perTaskCents: s.nullable(s.number({ integer: true })),
          prsMerged: s.number({ integer: true }),
          perPrCents: s.nullable(s.number({ integer: true })),
        }),
      ),
    }),
    handler: ({ params, query, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c) => {
        const m = monthOf(query.month);
        const rate = await rateNow(c);
        const rows = (
          await c.query<{
            agent_id: string;
            name: string;
            project_id: string;
            key: string;
            cost: string;
            waste: string;
            tin: string;
            cread: string;
          }>(
            // [PCODE-327 | S15 | v0.1.0] each run at the rate of its day, in euro micros
            `SELECT r.agent_id, a.name, r.project_id, p.key, sum(r.cost_micros * coalesce(r.usd_eur, $2::real)) AS cost,
                    coalesce(sum(r.cost_micros * coalesce(r.usd_eur, $2::real)) FILTER (WHERE r.status IN ('failed', 'cancelled')), 0) AS waste,
                    sum(r.tokens_in) AS tin, sum(r.tokens_cache_read) AS cread
               FROM agent_runs r JOIN agents a ON a.id = r.agent_id JOIN projects p ON p.id = r.project_id
              WHERE r.created_at >= $1::date AND r.created_at < ($1::date + interval '1 month')
              GROUP BY r.agent_id, a.name, r.project_id, p.key ORDER BY a.name, p.key`,
            [m.from, rate.usdEur],
          )
        ).rows;
        const cents = (x: string): number => usdMicrosToCents(Number(x), 1);
        const agents = new Map<
          string,
          {
            agentId: string;
            name: string;
            byProject: Record<string, number>;
            wasteCents: number;
            totalCents: number;
          }
        >();
        const projects = new Map<string, string>();
        let tin = 0;
        let cread = 0;
        for (const r of rows) {
          projects.set(r.project_id, r.key);
          const e = agents.get(r.agent_id) ?? {
            agentId: r.agent_id,
            name: r.name,
            byProject: {},
            wasteCents: 0,
            totalCents: 0,
          };
          e.byProject[r.project_id] = (e.byProject[r.project_id] ?? 0) + cents(r.cost);
          e.wasteCents += cents(r.waste);
          e.totalCents += cents(r.cost);
          agents.set(r.agent_id, e);
          tin += Number(r.tin);
          cread += Number(r.cread);
        }
        const total = [...agents.values()].reduce((n, x) => n + x.totalCents, 0);
        const budget = (
          await c.query<{ amount_cents: string }>(
            "SELECT amount_cents FROM budgets WHERE scope_type = 'workspace' AND period = 'month' AND measure IN ('ai', 'total') ORDER BY measure LIMIT 1",
          )
        ).rows[0];
        // [PCODE-328 | S15 | v0.1.0] chargeback and unit costs of the month
        const units = await unitCosts(c, m.from, rate.usdEur);
        const keys = new Map(
          (
            await c.query<{ id: string; key: string }>('SELECT id, key FROM projects ORDER BY key')
          ).rows.map((p) => [p.id, p.key]),
        );
        return {
          body: {
            month: m.from.slice(0, 7),
            rate,
            byClient: await chargeback(c, m.from, rate.usdEur, 'client'),
            byCostCentre: await chargeback(c, m.from, rate.usdEur, 'cost centre'),
            units: units.all,
            projectUnits: [...units.byProject]
              .map(([id, u]) => ({ id, key: keys.get(id) ?? '?', ...u }))
              .sort((x, y) => x.key.localeCompare(y.key)),
            totalCents: total,
            wasteCents: [...agents.values()].reduce((n, x) => n + x.wasteCents, 0),
            forecastCents: m.day >= m.days ? total : monthForecast(total, m.day, m.days),
            budgetCents: budget ? Number(budget.amount_cents) : null,
            cacheShare: tin + cread ? Math.round((cread / (tin + cread)) * 100) / 100 : null,
            projects: [...projects]
              .map(([id, key]) => ({ id, key }))
              .sort((x, y) => x.key.localeCompare(y.key)),
            agents: [...agents.values()].sort((x, y) => y.totalCents - x.totalCents),
          },
        };
      }),
  });

  // [PCODE-328 | S15 | v0.1.0] the chargeback as a file for the finance team
  const chargebackFile = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/agent-costs/chargeback',
    summary:
      'The AI cost of a month per client, cost centre or project, as CSV for booking (member)',
    tags: ['agents'],
    params: s.object({ workspaceId: uuid }),
    query: s.object({
      month: s.optional(s.string({ max: 7 })),
      by: s.optional(s.enum(['client', 'cost-centre', 'project'])),
    }),
    response: s.anyObject(),
    handler: ({ params, query, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c) => {
        const m = monthOf(query.month);
        const rate = await rateNow(c);
        const by: ChargeBy =
          query.by === 'project'
            ? 'project'
            : query.by === 'cost-centre'
              ? 'cost centre'
              : 'client';
        const month = m.from.slice(0, 7);
        const csv = chargebackCsv(month, by, await chargeback(c, m.from, rate.usdEur, by));
        return {
          body: {},
          file: {
            data: Buffer.from(csv, 'utf8'),
            contentType: 'text/csv; charset=utf-8',
            name: 'ai-chargeback-' + month + '-' + (query.by ?? 'client') + '.csv',
          },
        };
      }),
  });

  // [PCODE-328 | S15 | v0.1.0] what a run will likely cost, before it starts
  const estimate = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/projects/:projectId/agent-runs/estimate',
    summary:
      "What a run would likely cost in euro, with a range: from the agent's finished runs, or a rough figure from the instruction and the price (member)",
    tags: ['agents'],
    params: s.object({ workspaceId: uuid, projectId: uuid }),
    body: s.object({
      agentId: uuid,
      instruction: s.string({ max: 20_000 }),
      itemId: s.optional(uuid),
    }),
    response: s.object({
      lowCents: s.number({ integer: true }),
      midCents: s.number({ integer: true }),
      highCents: s.number({ integer: true }),
      basis: s.enum(['history', 'rough']),
      runs: s.number({ integer: true }),
      model: s.string(),
    }),
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c) => {
        const agent = (
          await c.query<{ model: string; prompt: number }>(
            'SELECT model, length(system_prompt) AS prompt FROM agents WHERE id = $1',
            [body.agentId],
          )
        ).rows[0];
        if (!agent) throw new HttpError(404, 'not_found', 'Agent not found');
        const history = (
          await c.query<{ cost: string }>(
            `SELECT cost_micros AS cost FROM agent_runs
              WHERE agent_id = $1 AND status = 'succeeded' AND cost_micros > 0
              ORDER BY created_at DESC LIMIT 30`,
            [body.agentId],
          )
        ).rows.map((r) => Number(r.cost));
        const item = body.itemId
          ? ((
              await c.query<{ n: number }>(
                'SELECT length(title) + length(description) AS n FROM items WHERE id = $1 AND project_id = $2',
                [body.itemId, params.projectId],
              )
            ).rows[0]?.n ?? 0)
          : 0;
        // the provider that answered this agent last, else the workspace's
        const provider =
          (
            await c.query<{ p: string }>(
              `SELECT s.content->>'provider' AS p FROM agent_steps s JOIN agent_runs r ON r.id = s.run_id
                WHERE r.agent_id = $1 AND s.kind = 'model' AND s.content ? 'provider'
                ORDER BY s.at DESC LIMIT 1`,
              [body.agentId],
            )
          ).rows[0]?.p ??
          (await c.query<{ p: string }>('SELECT provider AS p FROM agent_provider_settings'))
            .rows[0]?.p ??
          'anthropic';
        const price = await priceOf(c, params.workspaceId, provider, agent.model);
        const rough = usageCost(
          roughRunTokens(agent.prompt + body.instruction.length + item),
          price,
        );
        const e = runEstimate(history, rough);
        const rate = await rateNow(c);
        const cents = (x: number): number => usdMicrosToCents(x, rate.usdEur);
        return {
          body: {
            lowCents: cents(e.low),
            midCents: cents(e.mid),
            highCents: cents(e.high),
            basis: e.basis,
            runs: e.runs,
            model: agent.model,
          },
        };
      }),
  });

  const quality = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/agent-quality',
    summary:
      'What each agent delivered in a period: success, declined actions, tasks finished, cost per success (admin)',
    tags: ['agents'],
    params: s.object({ workspaceId: uuid }),
    query: s.object({ days: s.optional(s.string({ max: 3 })) }),
    response: s.array(
      s.object({
        agentId: s.string(),
        name: s.string(),
        runs: s.number({ integer: true }),
        succeeded: s.number({ integer: true }),
        failed: s.number({ integer: true }),
        cancelled: s.number({ integer: true }),
        successRate: s.nullable(s.number()),
        declined: s.number({ integer: true }),
        tasksDone: s.number({ integer: true }),
        costCents: s.number({ integer: true }),
        perSucceededCents: s.nullable(s.number({ integer: true })),
        // [PCODE-330 | S15 | v0.1.0] what people said, the judge's average, and what came of the runs
        good: s.number({ integer: true }),
        bad: s.number({ integer: true }),
        judged: s.number({ integer: true }),
        judgeAvg: s.nullable(s.number()),
        outcomes: s.object({
          done: s.number({ integer: true }),
          merged: s.number({ integer: true }),
          reverted: s.number({ integer: true }),
          open: s.number({ integer: true }),
        }),
      }),
    ),
    handler: ({ params, query, req }) =>
      // agent-vs-people figures are for admins (gate A1); this one compares agents with each other
      asMember(pool, req, params.workspaceId, 'admin', async (c) => {
        const days = Math.max(1, Math.min(365, Number(query.days ?? 30) || 30));
        const rate = await rateNow(c);
        const rows = (
          await c.query<{
            id: string;
            name: string;
            runs: string;
            ok: string;
            failed: string;
            cancelled: string;
            declined: string;
            done: string;
            cost: string;
          }>(
            `SELECT a.id, a.name, count(r.id) AS runs,
                    count(r.id) FILTER (WHERE r.status = 'succeeded') AS ok,
                    count(r.id) FILTER (WHERE r.status = 'failed') AS failed,
                    count(r.id) FILTER (WHERE r.status = 'cancelled') AS cancelled,
                    (SELECT count(*) FROM agent_steps st JOIN agent_runs x ON x.id = st.run_id
                      WHERE x.agent_id = a.id AND NOT x.playground AND st.kind = 'decision' AND st.content->>'approve' = 'false' AND x.created_at > now() - make_interval(days => $1)) AS declined,
                    (SELECT count(DISTINCT x.item_id) FROM agent_runs x JOIN items i ON i.id = x.item_id JOIN project_states ps ON ps.id = i.state_id
                      WHERE x.agent_id = a.id AND NOT x.playground AND x.status = 'succeeded' AND ps.grp = 'completed' AND x.created_at > now() - make_interval(days => $1)) AS done,
                    coalesce(sum(r.cost_micros), 0) AS cost
               -- [PCODE-329 | S15 | v0.1.0] what an agent delivered, without its playground tries
               FROM agents a LEFT JOIN agent_runs r ON r.agent_id = a.id AND NOT r.playground AND r.created_at > now() - make_interval(days => $1)
              GROUP BY a.id, a.name ORDER BY count(r.id) DESC, a.name`,
            [days],
          )
        ).rows;
        // [PCODE-330 | S15 | v0.1.0] verdicts, judge scores and outcomes of the same runs
        const verdicts = new Map(
          (
            await c.query<{ agent_id: string; good: string; bad: string }>(
              `SELECT r.agent_id, count(*) FILTER (WHERE n.verdict = 'good') AS good,
                      count(*) FILTER (WHERE n.verdict = 'bad') AS bad
                 FROM agent_run_annotations n JOIN agent_runs r ON r.id = n.run_id
                WHERE NOT r.playground AND r.created_at > now() - make_interval(days => $1)
                GROUP BY r.agent_id`,
              [days],
            )
          ).rows.map((v) => [v.agent_id, v]),
        );
        const ended = (
          await c.query<{ agent_id: string; judge_score: number | null } & OutcomeFlags>(
            `SELECT r.agent_id, r.judge_score, ${OUTCOME_SQL}
               FROM agent_runs r
              WHERE NOT r.playground AND r.status IN ('succeeded', 'failed')
                AND r.created_at > now() - make_interval(days => $1)`,
            [days],
          )
        ).rows;
        const judgedOf = (id: string) =>
          ended
            .filter((x) => x.agent_id === id && x.judge_score !== null)
            .map((x) => x.judge_score ?? 0);
        const outcomesOf = (id: string) => {
          const o = { done: 0, merged: 0, reverted: 0, open: 0 };
          for (const x of ended)
            if (x.agent_id === id) {
              const k = outcomeOfRow(x);
              if (k !== 'none') o[k]++;
            }
          return o;
        };
        return {
          body: rows.map((r) => {
            const ok = Number(r.ok);
            const ended = ok + Number(r.failed);
            const cost = usdMicrosToCents(Number(r.cost), rate.usdEur);
            return {
              agentId: r.id,
              name: r.name,
              runs: Number(r.runs),
              succeeded: ok,
              failed: Number(r.failed),
              cancelled: Number(r.cancelled),
              successRate: ended ? Math.round((ok / ended) * 100) / 100 : null,
              declined: Number(r.declined),
              tasksDone: Number(r.done),
              costCents: cost,
              perSucceededCents: ok ? Math.round(cost / ok) : null,
              good: Number(verdicts.get(r.id)?.good ?? 0),
              bad: Number(verdicts.get(r.id)?.bad ?? 0),
              judged: judgedOf(r.id).length,
              judgeAvg: judgedOf(r.id).length
                ? Math.round(
                    (judgedOf(r.id).reduce((n, x) => n + x, 0) / judgedOf(r.id).length) * 10,
                  ) / 10
                : null,
              outcomes: outcomesOf(r.id),
            };
          }),
        };
      }),
  });

  // [PCODE-246 | S15 | v0.1.0] the agent's webhook: a new address and secret (shown once), or none
  const webhook = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/agents/:agentId/webhook',
    summary: 'A new webhook address and secret for the agent; the old ones stop working (admin)',
    tags: ['agents'],
    params: agentParams,
    response: s.object({ path: s.string(), secret: s.string(), hint: s.string() }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'admin', async (c, a) => {
        const agent = await agentOf(c, params.agentId);
        const hook = newWebhook();
        const hint = hook.secret.slice(-4);
        await c.query(
          'UPDATE agents SET webhook_id = $2, webhook_secret = $3, webhook_secret_hint = $4 WHERE id = $1',
          [agent.id, hook.id, seal(hook.secret), hint],
        );
        await recordEvent(c, a.workspaceId, {
          actor: actorOf(a),
          verb: 'updated',
          object: { type: 'agent', id: agent.id, label: agent.name },
          changes: { webhook: { from: null, to: 'new secret …' + hint } },
        });
        return { body: { path: '/hooks/agents/' + hook.id, secret: hook.secret, hint } };
      }),
  });

  // [PCODE-247 | S15 | v0.1.0] may this agent touch a file, a branch or a host? For clients that enforce it themselves
  const answerOut = s.optional(s.object({ allowed: s.boolean(), reason: s.string() }));
  const scopeCheck = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/agents/:agentId/scope-check',
    summary: "Whether a file, a branch or a host is inside the agent's scope, and why (member)",
    tags: ['agents'],
    params: agentParams,
    query: s.object({
      file: s.optional(s.string({ max: 1000 })),
      branch: s.optional(s.string({ max: 300 })),
      host: s.optional(s.string({ max: 300 })),
    }),
    response: s.object({ files: answerOut, branches: answerOut, network: answerOut }),
    handler: ({ params, query, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c) => {
        const row = (
          await c.query<{ name: string; scope: AgentScope }>(
            'SELECT name, scope FROM agents WHERE id = $1',
            [params.agentId],
          )
        ).rows[0];
        if (!row) throw new HttpError(404, 'not_found', 'Agent not found');
        const ask = (kind: 'files' | 'branches' | 'network', target: string | undefined) =>
          target ? { [kind]: agentScopeAllows(row.scope, kind, target, row.name) } : {};
        return {
          body: {
            ...ask('files', query.file),
            ...ask('branches', query.branch),
            ...ask('network', query.host),
          },
        };
      }),
  });

  const dropWebhook = route({
    method: 'DELETE',
    path: '/api/workspaces/:workspaceId/agents/:agentId/webhook',
    summary: "Remove the agent's webhook address (admin)",
    tags: ['agents'],
    params: agentParams,
    response: s.object({ ok: s.literal(true) }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'admin', async (c, a) => {
        const agent = await agentOf(c, params.agentId);
        await c.query(
          "UPDATE agents SET webhook_id = NULL, webhook_secret = NULL, webhook_secret_hint = '' WHERE id = $1",
          [agent.id],
        );
        await recordEvent(c, a.workspaceId, {
          actor: actorOf(a),
          verb: 'updated',
          object: { type: 'agent', id: agent.id, label: agent.name },
          changes: { webhook: { from: 'set', to: null } },
        });
        return { body: { ok: true as const } };
      }),
  });

  return [
    create,
    prompts,
    rollback,
    getRules,
    setRules,
    pause,
    fleet,
    costs,
    chargebackFile, // [PCODE-328 | S15 | v0.1.0]
    estimate,
    quality,
    webhook,
    dropWebhook,
    scopeCheck,
  ];
}
