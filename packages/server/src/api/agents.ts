// ── [PCODE-459 | S15 | v0.1.0] Planning in VS Code locks the project in the portal: banner on every tab, conflicting AI planning refused both ways ──
// ── [PCODE-334 | S15 | v0.1.0] T33.4c MCP servers per agent: registry, our own MCP client, tools in runs under the agent's rules ──
// ── [PCODE-333 | S15 | v0.1.0] T33.4b Sandbox per run with repo tools, pull requests by a bot Git identity ──
// ── [PCODE-332 | S15 | v0.1.0] T33.4a Nested traces with latency and commits, agent rate limits, provider limits and health ──
// ── [PCODE-329 | S15 | v0.1.0] T33.2 Agent playground: rerun with other settings, compare runs, A/B experiments ──
// ── [PCODE-327 | S15 | v0.1.0] T33.1a Cache and reasoning tokens priced, the daily ECB rate, spend in euro by day ──
// ── [PCODE-246 | S15 | v0.1.0] T25.1 Agent triggers act: assignment, label, mention, CI failure, schedule, webhook ──
// ── [PCODE-240 | S15 | v0.1.0] T24.1 AI provider connections: Anthropic, OpenAI, Azure, Gemini, Bedrock, Grok, fallbacks, prices ──
// ── [PCODE-198 | S15 | v0.1.0] T16.2 Documenter agent: document tools with knowledge scopes, agent-written drafts, Ask the Documenter ──
// ── [PCODE-180 | S15 | v0.1.0] B5.1 Agents live: settings, versioned prompts, action rules, autonomy, pause all, budgets in euro, traces, costs, quality ──
// ── [PCODE-163 | S15 | v0.1.0] B1.2 Roles, clients and portal sign-in on the server ──
// ── [PCODE-120 | S15 | v0.1.0] Build the agent runtime: agents, queued runs, model providers, tools with approvals, budgets, streamed steps ──
//    Why:  agents, their runs and the model provider through the API. Admins shape agents and set the
//          provider (its key goes in, never out); members start runs, decide on actions waiting for
//          approval and cancel; everyone who sees the project can watch a run's steps.
import type { Pool, PoolClient } from 'pg';
import { assertNotLocked, PLANNING_AGENTS } from './planninglock.js'; // [PCODE-459 | S15 | v0.1.0]
import { recordEvent } from '../events/outbox.js';
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s, type Infer } from '../http/schema.js';
import { DEFAULT_AGENTS, DEFAULT_MODEL, toolsFor } from '../agents/defaults.js';
import { AGENT_CHANNEL } from '../agents/worker.js';
import { SecretKeyMissing, seal } from '../agents/secrets.js';
import { TOOLS } from '../agents/tools.js';
import { actorOf, asMember, atLeast, requireProject, type Access } from './access.js';
import { applySettings } from './agentcontrol.js';

const uuid = s.string({ format: 'uuid' });
const ws = s.object({ workspaceId: uuid });

/** Every workspace gets the plan's agents the first time it asks for them. */
export async function ensureAgents(c: PoolClient, workspaceId: string): Promise<void> {
  if (!(await c.query('SELECT 1 FROM agents LIMIT 1')).rowCount)
    for (const a of DEFAULT_AGENTS)
      await c.query(
        'INSERT INTO agents (workspace_id, key, name, description, system_prompt, model, tools) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING',
        [workspaceId, a.key, a.name, a.description, a.prompt, DEFAULT_MODEL, toolsFor(a.key)], // [PCODE-198 | S15 | v0.1.0]
      );
  // [PCODE-180 | S15 | v0.1.0] every agent's live instructions are a version
  await c.query(
    "INSERT INTO agent_prompt_versions (workspace_id, agent_id, version, prompt, note) SELECT workspace_id, id, prompt_version, system_prompt, 'first version' FROM agents ON CONFLICT DO NOTHING",
  );
}

const agentOut = s.object({
  id: s.string(),
  key: s.string(),
  name: s.string(),
  description: s.string(),
  role: s.string(),
  systemPrompt: s.string(),
  model: s.string(),
  tools: s.array(s.string()),
  maxTokensPerRun: s.number({ integer: true }),
  monthlyTokenBudget: s.number({ integer: true }),
  enabled: s.boolean(),
  usedThisMonth: s.number({ integer: true }),
  // [PCODE-180 | S15 | v0.1.0] the full settings of the approved design
  fallbackModel: s.string(),
  temperature: s.number(),
  maxOutputTokens: s.number({ integer: true }),
  autonomy: s.string(),
  ownerId: s.nullable(s.string()),
  ownerName: s.nullable(s.string()),
  scope: s.anyObject(),
  triggers: s.array(s.anyObject()),
  concurrency: s.number({ integer: true }),
  promptVersion: s.number({ integer: true }),
  runBudgetCents: s.nullable(s.number({ integer: true })),
  dayBudgetCents: s.nullable(s.number({ integer: true })),
  monthBudgetCents: s.nullable(s.number({ integer: true })),
  connectionId: s.nullable(s.string()), // [PCODE-240 | S15 | v0.1.0]
  runsPerHour: s.nullable(s.number({ integer: true })), // [PCODE-332 | S15 | v0.1.0]
  mcpServers: s.array(s.string()), // [PCODE-334 | S15 | v0.1.0]
  // [PCODE-246 | S15 | v0.1.0] the webhook's address (the secret is shown once) and when each trigger last started a run
  webhook: s.nullable(s.object({ path: s.string(), hint: s.string() })),
  triggersFired: s.anyObject(),
});
interface AgentRow {
  id: string;
  key: string;
  name: string;
  description: string;
  role: string;
  system_prompt: string;
  model: string;
  tools: string[];
  max_tokens_per_run: number;
  monthly_token_budget: string;
  enabled: boolean;
  used: string;
  fallback_model: string;
  temperature: number;
  max_output_tokens: number;
  autonomy: string;
  owner_id: string | null;
  owner_name: string | null;
  scope: Record<string, unknown>;
  triggers: Record<string, unknown>[];
  concurrency: number;
  prompt_version: number;
  run_budget_cents: string | null;
  day_budget_cents: string | null;
  month_budget_cents: string | null;
  connection_id: string | null; // [PCODE-240 | S15 | v0.1.0]
  runs_per_hour: number | null; // [PCODE-332 | S15 | v0.1.0]
  mcp_servers: string[]; // [PCODE-334 | S15 | v0.1.0]
  webhook_id: string | null; // [PCODE-246 | S15 | v0.1.0]
  webhook_secret_hint: string;
  fired: Record<string, string> | null;
}
export const AGENT_SELECT = `SELECT a.*, o.name AS owner_name, (SELECT coalesce(sum(r.tokens_in + r.tokens_out), 0) FROM agent_runs r
                        WHERE r.agent_id = a.id AND r.created_at >= date_trunc('month', now())) AS used,
                      (SELECT jsonb_object_agg(x.trigger_kind, x.last) FROM (SELECT trigger_kind, max(created_at) AS last FROM agent_runs
                        WHERE agent_id = a.id AND trigger_kind IS NOT NULL GROUP BY trigger_kind) x) AS fired
                      FROM agents a LEFT JOIN users o ON o.id = a.owner_id`;
const agentJson = (a: AgentRow) => ({
  id: a.id,
  key: a.key,
  name: a.name,
  description: a.description,
  role: a.role,
  systemPrompt: a.system_prompt,
  model: a.model,
  tools: a.tools,
  maxTokensPerRun: a.max_tokens_per_run,
  monthlyTokenBudget: Number(a.monthly_token_budget),
  enabled: a.enabled,
  usedThisMonth: Number(a.used),
  fallbackModel: a.fallback_model,
  temperature: Math.round(a.temperature * 100) / 100,
  maxOutputTokens: a.max_output_tokens,
  autonomy: a.autonomy,
  ownerId: a.owner_id,
  ownerName: a.owner_name,
  scope: a.scope,
  triggers: a.triggers,
  concurrency: a.concurrency,
  promptVersion: a.prompt_version,
  runBudgetCents: a.run_budget_cents === null ? null : Number(a.run_budget_cents),
  dayBudgetCents: a.day_budget_cents === null ? null : Number(a.day_budget_cents),
  monthBudgetCents: a.month_budget_cents === null ? null : Number(a.month_budget_cents),
  connectionId: a.connection_id, // [PCODE-240 | S15 | v0.1.0]
  runsPerHour: a.runs_per_hour, // [PCODE-332 | S15 | v0.1.0]
  mcpServers: a.mcp_servers, // [PCODE-334 | S15 | v0.1.0]
  webhook: a.webhook_id
    ? { path: '/hooks/agents/' + a.webhook_id, hint: a.webhook_secret_hint }
    : null,
  triggersFired: a.fired ?? {},
});

export const runOut = s.object({
  id: s.string(),
  agentId: s.string(),
  agentName: s.string(),
  projectId: s.string(),
  itemId: s.nullable(s.string()),
  itemRef: s.nullable(s.string()),
  instruction: s.string(),
  status: s.string(),
  model: s.string(),
  tokensIn: s.number({ integer: true }),
  tokensOut: s.number({ integer: true }),
  costMicros: s.number({ integer: true }),
  error: s.string(),
  requestedBy: s.nullable(s.string()),
  createdAt: s.string(),
  startedAt: s.nullable(s.string()),
  finishedAt: s.nullable(s.string()),
  // [PCODE-180 | S15 | v0.1.0] the run's prompt version and its one-line summary
  promptVersion: s.number({ integer: true }),
  summary: s.string(),
  // [PCODE-246 | S15 | v0.1.0] what started the run by itself, if a trigger did
  trigger: s.nullable(s.object({ kind: s.string(), note: s.string() })),
  // [PCODE-327 | S15 | v0.1.0] the cache, the reasoning, and the euro rate of the run's day
  tokensCacheRead: s.number({ integer: true }),
  tokensCacheWrite: s.number({ integer: true }),
  tokensReasoning: s.number({ integer: true }),
  usdEur: s.nullable(s.number()),
  // [PCODE-329 | S15 | v0.1.0] a playground run, what it reruns, its experiment variant and temperature
  playground: s.boolean(),
  rerunOf: s.nullable(s.string()),
  experimentId: s.nullable(s.string()),
  variant: s.string(),
  temperature: s.nullable(s.number()),
  // [PCODE-333 | S15 | v0.1.0] the pull request it opened from its sandbox
  sandboxPrUrl: s.string(),
  // [PCODE-456 | S15 | v0.1.0] where it ran: the server, or a developer's machine (and which)
  source: s.string(),
  client: s.string(),
});
export interface RunRow {
  id: string;
  agent_id: string;
  agent_name: string;
  project_id: string;
  item_id: string | null;
  item_ref: string | null;
  instruction: string;
  status: string;
  model: string;
  tokens_in: string;
  tokens_out: string;
  cost_micros: string;
  error: string;
  requested_by_name: string | null;
  created_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
  requested_by: string | null;
  prompt_version: number;
  summary: string;
  trigger_kind: string | null; // [PCODE-246 | S15 | v0.1.0]
  trigger_note: string;
  tokens_cache_read: string; // [PCODE-327 | S15 | v0.1.0]
  tokens_cache_write: string;
  tokens_reasoning: string;
  usd_eur: number | null;
  playground: boolean; // [PCODE-329 | S15 | v0.1.0]
  rerun_of: string | null;
  experiment_id: string | null;
  variant: string;
  temperature: number | null;
  sandbox_pr_url: string; // [PCODE-333 | S15 | v0.1.0]
  source: string; // [PCODE-456 | S15 | v0.1.0]
  client: string;
}
export const RUN_SELECT = `SELECT r.*, a.name AS agent_name, u.name AS requested_by_name,
                      CASE WHEN i.id IS NULL THEN NULL ELSE p.key || '-' || i.sequence END AS item_ref
                    FROM agent_runs r JOIN agents a ON a.id = r.agent_id JOIN projects p ON p.id = r.project_id
                    LEFT JOIN items i ON i.id = r.item_id LEFT JOIN users u ON u.id = r.requested_by`;
export const runJson = (r: RunRow): Infer<typeof runOut> => ({
  id: r.id,
  agentId: r.agent_id,
  agentName: r.agent_name,
  projectId: r.project_id,
  itemId: r.item_id,
  itemRef: r.item_ref,
  instruction: r.instruction,
  status: r.status,
  model: r.model,
  tokensIn: Number(r.tokens_in),
  tokensOut: Number(r.tokens_out),
  costMicros: Number(r.cost_micros),
  error: r.error,
  requestedBy: r.requested_by_name,
  createdAt: r.created_at.toISOString(),
  startedAt: r.started_at?.toISOString() ?? null,
  finishedAt: r.finished_at?.toISOString() ?? null,
  promptVersion: r.prompt_version,
  summary: r.summary,
  trigger: r.trigger_kind ? { kind: r.trigger_kind, note: r.trigger_note } : null,
  tokensCacheRead: Number(r.tokens_cache_read), // [PCODE-327 | S15 | v0.1.0]
  tokensCacheWrite: Number(r.tokens_cache_write),
  tokensReasoning: Number(r.tokens_reasoning),
  usdEur: r.usd_eur,
  playground: r.playground, // [PCODE-329 | S15 | v0.1.0]
  rerunOf: r.rerun_of,
  experimentId: r.experiment_id,
  variant: r.variant,
  temperature: r.temperature,
  sandboxPrUrl: r.sandbox_pr_url, // [PCODE-333 | S15 | v0.1.0]
  source: r.source, // [PCODE-456 | S15 | v0.1.0]
  client: r.client,
});

// [PCODE-332 | S15 | v0.1.0] commits naming the run's task, from when it started to two weeks after
async function runCommits(c: PoolClient, run: RunRow) {
  // [PCODE-333 | S15 | v0.1.0] and the commits that name the run in their trailer
  const rows = (
    await c.query<{
      sha: string;
      message: string;
      url: string;
      committed_at: Date;
      reverted_by: string | null;
    }>(
      `SELECT sha, message, url, committed_at, reverted_by FROM git_commits
        WHERE project_id = $1 AND committed_at >= $2 AND committed_at < $2 + interval '14 days'
          AND (($3::text IS NOT NULL AND message ~ ('(^|[^A-Za-z0-9-])' || $3 || '([^0-9]|$)'))
               OR position($4 in message) > 0)
        ORDER BY committed_at LIMIT 10`,
      [run.project_id, run.created_at, run.item_ref, 'Orqiva-Run: ' + run.id],
    )
  ).rows;
  return rows.map((g) => ({
    sha: g.sha,
    message: g.message.split('\n')[0]?.slice(0, 200) ?? '',
    url: g.url,
    committedAt: g.committed_at.toISOString(),
    reverted: g.reverted_by !== null,
  }));
}

export async function visibleRun(c: PoolClient, a: Access, id: string): Promise<RunRow> {
  const r = (await c.query<RunRow>(RUN_SELECT + ' WHERE r.id = $1', [id])).rows[0];
  if (!r) throw new HttpError(404, 'not_found', 'Run not found');
  try {
    await requireProject(c, a, r.project_id);
  } catch {
    throw new HttpError(404, 'not_found', 'Run not found');
  }
  return r;
}

export async function runEvent(
  c: PoolClient,
  a: Access,
  r: RunRow,
  verb: 'created' | 'updated',
  changes: Record<string, { from: unknown; to: unknown }>,
): Promise<void> {
  await recordEvent(
    c,
    a.workspaceId,
    {
      actor: actorOf(a),
      verb,
      object: {
        type: 'agent_run',
        id: r.id,
        label: r.agent_name + (r.item_ref ? ' on ' + r.item_ref : ''),
      },
      ...(r.item_id
        ? { parent: { type: 'item' as const, id: r.item_id, label: r.item_ref ?? '' } }
        : {}),
      changes,
    },
    { projectId: r.project_id },
  );
}

export const wake = (c: PoolClient, runId: string): Promise<unknown> =>
  c.query('SELECT pg_notify($1, $2)', [AGENT_CHANNEL, runId]);

export function agentRoutes(pool: Pool): Route[] {
  // [PCODE-333 | S15 | v0.1.0] what a run wrote into its sandbox
  const sandbox = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/agent-runs/:runId/sandbox',
    summary:
      'The files a run wrote into its sandbox, new or changed against the repository (guest)',
    tags: ['agents'],
    params: s.object({ workspaceId: uuid, runId: uuid }),
    response: s.object({
      files: s.array(
        s.object({
          path: s.string(),
          state: s.enum(['new', 'changed', 'same']),
          text: s.string(),
          baseText: s.nullable(s.string()),
          updatedAt: s.string(),
        }),
      ),
      pullRequest: s.string(),
      branch: s.string(),
    }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        const run = await visibleRun(c, a, params.runId);
        const files = (
          await c.query<{ path: string; text: string; base_text: string | null; updated_at: Date }>(
            'SELECT path, text, base_text, updated_at FROM agent_run_files WHERE run_id = $1 ORDER BY path',
            [run.id],
          )
        ).rows;
        return {
          body: {
            files: files.map((f) => ({
              path: f.path,
              state:
                f.base_text === null
                  ? ('new' as const)
                  : f.base_text === f.text
                    ? ('same' as const)
                    : ('changed' as const),
              text: f.text.slice(0, 200_000),
              baseText: f.base_text?.slice(0, 200_000) ?? null,
              updatedAt: f.updated_at.toISOString(),
            })),
            pullRequest: run.sandbox_pr_url,
            branch:
              (
                await c.query<{ b: string }>(
                  'SELECT sandbox_branch AS b FROM agent_runs WHERE id = $1',
                  [run.id],
                )
              ).rows[0]?.b ?? '',
          },
        };
      }),
  });
  const list = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/agents',
    summary: 'The workspace’s agents with their tokens used this month',
    tags: ['agents'],
    params: ws,
    response: s.array(agentOut),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        await ensureAgents(c, a.workspaceId);
        return {
          body: (await c.query<AgentRow>(AGENT_SELECT + ' ORDER BY a.created_at, a.name')).rows.map(
            agentJson,
          ),
        };
      }),
  });

  const update = route({
    method: 'PATCH',
    path: '/api/workspaces/:workspaceId/agents/:agentId',
    summary: 'Change an agent: prompt, model, tools, role, budgets, on or off (admin)',
    tags: ['agents'],
    params: s.object({ workspaceId: uuid, agentId: uuid }),
    body: s.object({
      name: s.optional(s.string({ min: 1, max: 80 })),
      description: s.optional(s.string({ max: 500 })),
      systemPrompt: s.optional(s.string({ max: 20_000 })),
      model: s.optional(s.string({ min: 1, max: 100 })),
      role: s.optional(s.enum(['member', 'guest'])),
      tools: s.optional(s.array(s.string({ max: 60 }), { max: 30 })),
      maxTokensPerRun: s.optional(s.number({ integer: true, min: 1000, max: 5_000_000 })),
      monthlyTokenBudget: s.optional(s.number({ integer: true, min: 1000, max: 10_000_000_000 })),
      enabled: s.optional(s.boolean()),
      // [PCODE-180 | S15 | v0.1.0] the full settings; a changed prompt becomes a new version
      promptNote: s.optional(s.string({ max: 500 })),
      fallbackModel: s.optional(s.string({ max: 100 })),
      temperature: s.optional(s.number({ min: 0, max: 1 })),
      maxOutputTokens: s.optional(s.number({ integer: true, min: 256, max: 64_000 })),
      autonomy: s.optional(s.enum(['suggest', 'approve', 'scoped', 'autonomous'])),
      ownerId: s.optional(s.nullable(uuid)),
      scope: s.optional(s.anyObject()),
      triggers: s.optional(s.array(s.anyObject(), { max: 20 })),
      concurrency: s.optional(s.number({ integer: true, min: 1, max: 50 })),
      runBudgetCents: s.optional(s.nullable(s.number({ integer: true, min: 1, max: 100_000_000 }))),
      dayBudgetCents: s.optional(s.nullable(s.number({ integer: true, min: 1, max: 100_000_000 }))),
      monthBudgetCents: s.optional(
        s.nullable(s.number({ integer: true, min: 1, max: 1_000_000_000 })),
      ),
      // [PCODE-240 | S15 | v0.1.0] the agent's own connection; its model is then the agent's model
      connectionId: s.optional(s.nullable(uuid)),
      // [PCODE-332 | S15 | v0.1.0] runs an hour; null for no limit
      runsPerHour: s.optional(s.nullable(s.number({ integer: true, min: 1, max: 1000 }))),
      // [PCODE-334 | S15 | v0.1.0] the MCP servers it may use
      mcpServers: s.optional(s.array(uuid, { max: 10 })),
    }),
    response: agentOut,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'admin', async (c, a) => {
        const unknown = (body.tools ?? []).filter((t) => !(t in TOOLS));
        if (unknown.length)
          throw new HttpError(400, 'invalid_request', 'Unknown tools: ' + unknown.join(', '));
        // [PCODE-180 | S15 | v0.1.0] the settings beyond the first ones
        await applySettings(c, a, params.agentId, body);
        const r = await c.query(
          `UPDATE agents SET name = coalesce($2, name), description = coalesce($3, description), system_prompt = coalesce($4, system_prompt),
             model = coalesce($5, model), role = coalesce($6, role), tools = coalesce($7, tools), max_tokens_per_run = coalesce($8, max_tokens_per_run),
             monthly_token_budget = coalesce($9, monthly_token_budget), enabled = coalesce($10, enabled)
           WHERE id = $1`,
          [
            params.agentId,
            body.name ?? null,
            body.description ?? null,
            body.systemPrompt ?? null,
            body.model ?? null,
            body.role ?? null,
            body.tools ?? null,
            body.maxTokensPerRun ?? null,
            body.monthlyTokenBudget ?? null,
            body.enabled ?? null,
          ],
        );
        if (!r.rowCount) throw new HttpError(404, 'not_found', 'Agent not found');
        const row = (await c.query<AgentRow>(AGENT_SELECT + ' WHERE a.id = $1', [params.agentId]))
          .rows[0];
        if (!row) throw new Error('agent vanished');
        return { body: agentJson(row) };
      }),
  });

  const providerOut = s.object({
    provider: s.string(),
    hasKey: s.boolean(),
    inputPricePerMillion: s.number(),
    outputPricePerMillion: s.number(),
    tools: s.array(
      s.object({ name: s.string(), description: s.string(), needsApproval: s.boolean() }),
    ),
  });
  const providerJson = (
    r:
      | {
          provider: string;
          key_ciphertext: string | null;
          input_price_micros: string;
          output_price_micros: string;
        }
      | undefined,
  ) => ({
    provider: r?.provider ?? 'anthropic',
    hasKey: Boolean(r?.key_ciphertext),
    inputPricePerMillion: Number(r?.input_price_micros ?? 0) / 1_000_000,
    outputPricePerMillion: Number(r?.output_price_micros ?? 0) / 1_000_000,
    tools: Object.values(TOOLS).map((t) => ({
      name: t.spec.name,
      description: t.spec.description,
      needsApproval: t.needsApproval,
    })),
  });

  const getProvider = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/agents/provider',
    summary: 'The model provider: which one, whether a key is set (never the key), prices',
    tags: ['agents'],
    params: ws,
    response: providerOut,
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c) => ({
        body: providerJson(
          (
            await c.query<{
              provider: string;
              key_ciphertext: string | null;
              input_price_micros: string;
              output_price_micros: string;
            }>(
              'SELECT provider, key_ciphertext, input_price_micros, output_price_micros FROM agent_provider_settings',
            )
          ).rows[0],
        ),
      })),
  });

  const setProvider = route({
    method: 'PUT',
    path: '/api/workspaces/:workspaceId/agents/provider',
    summary:
      'Set the model provider, its key (stored encrypted; "" removes it) and prices in USD per million tokens (admin)',
    tags: ['agents'],
    params: ws,
    body: s.object({
      provider: s.enum(['anthropic', 'demo']),
      apiKey: s.optional(s.string({ max: 500 })),
      inputPricePerMillion: s.optional(s.number({ min: 0, max: 10_000 })),
      outputPricePerMillion: s.optional(s.number({ min: 0, max: 10_000 })),
    }),
    response: providerOut,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'admin', async (c, a) => {
        let sealed: string | null | undefined;
        if (body.apiKey !== undefined) {
          try {
            sealed = body.apiKey.trim() ? seal(body.apiKey.trim()) : null;
          } catch (e) {
            if (e instanceof SecretKeyMissing) throw new HttpError(409, 'conflict', e.message);
            throw e;
          }
        }
        // [PCODE-240 | S15 | v0.1.0] the provider of before is the workspace's connection for agents
        await useLegacyConnection(c, a, body.provider, sealed);
        await c.query(
          `INSERT INTO agent_provider_settings (workspace_id, provider, key_ciphertext, input_price_micros, output_price_micros)
           VALUES ($1, $2, $3, coalesce($4, 0), coalesce($5, 0))
           ON CONFLICT (workspace_id) DO UPDATE SET provider = $2,
             key_ciphertext = CASE WHEN $6 THEN $3 ELSE agent_provider_settings.key_ciphertext END,
             input_price_micros = coalesce($4, agent_provider_settings.input_price_micros),
             output_price_micros = coalesce($5, agent_provider_settings.output_price_micros), updated_at = now()`,
          [
            a.workspaceId,
            body.provider,
            sealed ?? null,
            body.inputPricePerMillion === undefined
              ? null
              : Math.round(body.inputPricePerMillion * 1_000_000),
            body.outputPricePerMillion === undefined
              ? null
              : Math.round(body.outputPricePerMillion * 1_000_000),
            sealed !== undefined,
          ],
        );
        const row = (
          await c.query<{
            provider: string;
            key_ciphertext: string | null;
            input_price_micros: string;
            output_price_micros: string;
          }>(
            'SELECT provider, key_ciphertext, input_price_micros, output_price_micros FROM agent_provider_settings',
          )
        ).rows[0];
        return { body: providerJson(row) };
      }),
  });

  const start = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/projects/:projectId/agent-runs',
    summary: 'Ask an agent to work: on the project, or on one of its tasks (member)',
    tags: ['agents'],
    params: s.object({ workspaceId: uuid, projectId: uuid }),
    body: s.object({
      agentId: uuid,
      instruction: s.string({ min: 1, max: 20_000 }),
      itemId: s.optional(uuid),
    }),
    response: runOut,
    status: 201,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const p = await requireProject(c, a, params.projectId);
        const agent = (
          await c.query<{ id: string; model: string; enabled: boolean; name: string; key: string }>(
            'SELECT id, model, enabled, name, key FROM agents WHERE id = $1',
            [body.agentId],
          )
        ).rows[0];
        if (!agent) throw new HttpError(404, 'not_found', 'Agent not found');
        if (!agent.enabled) throw new HttpError(409, 'conflict', agent.name + ' is switched off');
        // [PCODE-459 | S15 | v0.1.0] the planning agents wait while the project is planned elsewhere
        if ((PLANNING_AGENTS as readonly string[]).includes(agent.key))
          await assertNotLocked(c, p.id);
        if (
          body.itemId &&
          !(
            await c.query('SELECT 1 FROM items WHERE id = $1 AND project_id = $2', [
              body.itemId,
              p.id,
            ])
          ).rowCount
        )
          throw new HttpError(400, 'invalid_request', 'The task is not in this project', [
            { path: 'body.itemId', message: 'is not in this project' },
          ]);
        const id = (
          await c.query<{ id: string }>(
            // [PCODE-180 | S15 | v0.1.0] a run remembers the prompt version it ran on
            'INSERT INTO agent_runs (workspace_id, project_id, item_id, agent_id, requested_by, instruction, model, prompt_version) VALUES ($1, $2, $3, $4, $5, $6, $7, (SELECT prompt_version FROM agents WHERE id = $4)) RETURNING id',
            [
              a.workspaceId,
              p.id,
              body.itemId ?? null,
              agent.id,
              a.user.id,
              body.instruction.trim(),
              agent.model,
            ],
          )
        ).rows[0]?.id;
        if (!id) throw new Error('run insert returned nothing');
        const run = await visibleRun(c, a, id);
        await runEvent(c, a, run, 'created', { status: { from: null, to: 'queued' } });
        await wake(c, id);
        return { status: 201, body: runJson(run) };
      }),
  });

  const listRuns = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/agent-runs',
    summary: 'Runs, newest first: of a project, of a task, or only those still going (active=1)',
    tags: ['agents'],
    params: ws,
    query: s.object({
      projectId: s.optional(uuid),
      itemId: s.optional(uuid),
      active: s.optional(s.enum(['1'])),
    }),
    response: s.array(runOut),
    handler: ({ params, query, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        const rows = (
          await c.query<RunRow>(
            RUN_SELECT +
              ` WHERE ($1::uuid IS NULL OR r.project_id = $1) AND ($2::uuid IS NULL OR r.item_id = $2)
                  AND ($3::text IS NULL OR r.status IN ('queued', 'running', 'waiting'))
                  AND ($4 <> 'guest' OR guest_sees_project(r.project_id, $5))
                ORDER BY r.created_at DESC LIMIT 100`,
            [
              query.projectId ?? null,
              query.itemId ?? null,
              query.active ?? null,
              a.role,
              a.user.id,
            ],
          )
        ).rows;
        return { body: rows.map(runJson) };
      }),
  });

  const stepOut = s.object({
    seq: s.number({ integer: true }),
    kind: s.string(),
    content: s.anyObject(),
    tokensIn: s.number({ integer: true }),
    tokensOut: s.number({ integer: true }),
    costMicros: s.number({ integer: true }),
    at: s.string(),
    // [PCODE-327 | S15 | v0.1.0] what came from the cache, went into it, and was spent reasoning
    cacheRead: s.number({ integer: true }),
    cacheWrite: s.number({ integer: true }),
    reasoning: s.number({ integer: true }),
    // [PCODE-332 | S15 | v0.1.0] how long it took and the turn it belongs to
    latencyMs: s.nullable(s.number({ integer: true })),
    parentSeq: s.nullable(s.number({ integer: true })),
  });

  const getRun = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/agent-runs/:runId',
    summary: 'A run with every step it took',
    tags: ['agents'],
    params: s.object({ workspaceId: uuid, runId: uuid }),
    response: s.object({
      run: runOut,
      steps: s.array(stepOut),
      // [PCODE-332 | S15 | v0.1.0] commits for the run's task after it started
      commits: s.array(
        s.object({
          sha: s.string(),
          message: s.string(),
          url: s.string(),
          committedAt: s.string(),
          reverted: s.boolean(),
        }),
      ),
    }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        const run = await visibleRun(c, a, params.runId);
        const steps = (
          await c.query<{
            seq: number;
            kind: string;
            content: Record<string, unknown>;
            tokens_in: number;
            tokens_out: number;
            cost_micros: string;
            at: Date;
            cr: string;
            cw: string;
            rs: string;
            latency_ms: number | null;
            parent_seq: number | null;
          }>(
            `SELECT seq, kind, content, tokens_in, tokens_out, cost_micros, at,
                    tokens_cache_read AS cr, tokens_cache_write AS cw, tokens_reasoning AS rs,
                    latency_ms, parent_seq
               FROM agent_steps WHERE run_id = $1 ORDER BY seq`,
            [run.id],
          )
        ).rows;
        return {
          body: {
            run: runJson(run),
            steps: steps.map((x) => ({
              seq: x.seq,
              kind: x.kind,
              content: x.content,
              tokensIn: x.tokens_in,
              tokensOut: x.tokens_out,
              costMicros: Number(x.cost_micros),
              at: x.at.toISOString(),
              cacheRead: Number(x.cr), // [PCODE-327 | S15 | v0.1.0]
              cacheWrite: Number(x.cw),
              reasoning: Number(x.rs),
              latencyMs: x.latency_ms, // [PCODE-332 | S15 | v0.1.0]
              parentSeq: x.parent_seq,
            })),
            commits: await runCommits(c, run),
          },
        };
      }),
  });

  const decide = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/agent-runs/:runId/decision',
    summary: 'Approve or decline what a waiting run wants to do; the run continues (member)',
    tags: ['agents'],
    params: s.object({ workspaceId: uuid, runId: uuid }),
    body: s.object({ approve: s.boolean(), note: s.optional(s.string({ max: 2000 })) }),
    response: runOut,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const run = await visibleRun(c, a, params.runId);
        if (run.status !== 'waiting')
          throw new HttpError(409, 'conflict', 'This run is not waiting for a decision');
        const steps = (
          await c.query<{ seq: number; kind: string; content: Record<string, unknown> }>(
            'SELECT seq, kind, content FROM agent_steps WHERE run_id = $1 ORDER BY seq',
            [run.id],
          )
        ).rows;
        const decided = new Set(
          steps.filter((x) => x.kind === 'decision').map((x) => String(x.content['toolUseId'])),
        );
        const open = steps.filter(
          (x) => x.kind === 'approval' && !decided.has(String(x.content['toolUseId'])),
        );
        let seq = (steps[steps.length - 1]?.seq ?? 0) + 1;
        for (const o of open)
          await c.query(
            'INSERT INTO agent_steps (workspace_id, run_id, seq, kind, content) VALUES ($1, $2, $3, $4, $5)',
            [
              a.workspaceId,
              run.id,
              seq++,
              'decision',
              JSON.stringify({
                toolUseId: o.content['toolUseId'],
                tool: o.content['tool'],
                approve: body.approve,
                note: body.note ?? '',
                by: a.user.name,
              }),
            ],
          );
        await c.query("UPDATE agent_runs SET status = 'queued' WHERE id = $1", [run.id]);
        await runEvent(c, a, run, 'updated', {
          decision: { from: 'waiting', to: body.approve ? 'approved' : 'declined' },
        });
        await wake(c, run.id);
        return { body: runJson({ ...run, status: 'queued' }) };
      }),
  });

  const cancel = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/agent-runs/:runId/cancel',
    summary: 'Stop a run (the person who started it, or an admin)',
    tags: ['agents'],
    params: s.object({ workspaceId: uuid, runId: uuid }),
    response: runOut,
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const run = await visibleRun(c, a, params.runId);
        if (run.requested_by !== a.user.id && !atLeast(a.role, 'admin'))
          throw new HttpError(403, 'forbidden', 'Only who started it, or an admin, stops a run');
        if (!['queued', 'running', 'waiting'].includes(run.status))
          throw new HttpError(409, 'conflict', 'This run has already ended');
        await c.query(
          "UPDATE agent_runs SET status = 'cancelled', finished_at = now() WHERE id = $1",
          [run.id],
        );
        await runEvent(c, a, run, 'updated', { status: { from: run.status, to: 'cancelled' } });
        return { body: runJson({ ...run, status: 'cancelled' }) };
      }),
  });

  return [list, getProvider, setProvider, update, start, listRuns, getRun, decide, cancel, sandbox];
}

/**
 * [PCODE-240 | S15 | v0.1.0] PUT /agents/provider of before: Anthropic with a key, or the demo model, as
 * the workspace's connection for agents. The connection of that provider is reused (its key replaced when
 * a new one is given), or made.
 */
async function useLegacyConnection(
  c: PoolClient,
  a: Access,
  provider: 'anthropic' | 'demo',
  sealed: string | null | undefined,
): Promise<void> {
  const existing = (
    await c.query<{ id: string }>(
      'SELECT id FROM ai_connections WHERE provider = $1 ORDER BY created_at LIMIT 1',
      [provider],
    )
  ).rows[0];
  let id = existing?.id;
  if (id && sealed !== undefined)
    await c.query(
      'UPDATE ai_connections SET key_ciphertext = $2, updated_at = now(), last_error = $3 WHERE id = $1',
      [id, sealed, ''],
    );
  if (!id && (provider === 'demo' || sealed))
    id = (
      await c.query<{ id: string }>(
        'INSERT INTO ai_connections (workspace_id, provider, label, key_ciphertext, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING id',
        [
          a.workspaceId,
          provider,
          provider === 'demo' ? 'Demo model' : 'Anthropic',
          provider === 'demo' ? null : sealed,
          a.user.id,
        ],
      )
    ).rows[0]?.id;
  await c.query(
    `INSERT INTO agent_provider_settings (workspace_id, agent_connection_id) VALUES ($1, $2)
     ON CONFLICT (workspace_id) DO UPDATE SET agent_connection_id = $2`,
    [a.workspaceId, id ?? null],
  );
}
