// ── [PCODE-352 | S15 | v0.1.0] T35.3c Policies for approvals, budgets and data, with a dry run ──
// ── [PCODE-334 | S15 | v0.1.0] T33.4c MCP servers per agent: registry, our own MCP client, tools in runs under the agent's rules ──
// ── [PCODE-332 | S15 | v0.1.0] T33.4a Nested traces with latency and commits, agent rate limits, provider limits and health ──
// ── [PCODE-329 | S15 | v0.1.0] T33.2 Agent playground: rerun with other settings, compare runs, A/B experiments ──
// ── [PCODE-327 | S15 | v0.1.0] T33.1a Cache and reasoning tokens priced, the daily ECB rate, spend in euro by day ──
// ── [PCODE-325 | S15 | v0.1.0] T32.8b Leak scans of commits, traces and logs ──
// ── [PCODE-290 | S15 | v0.1.0] T30.4 UI kit in the code: component usage, a lint for non-token values, the agent rule ──
// ── [PCODE-284 | S15 | v0.1.0] T29.6 Documents: tree drag and drop, files, image annotation, read analytics, per-task knowledge, checked citations ──
// ── [PCODE-247 | S15 | v0.1.0] T25.2 Agent scopes enforced: files, branches, network, trace redaction ──
// ── [PCODE-240 | S15 | v0.1.0] T24.1 AI provider connections: Anthropic, OpenAI, Azure, Gemini, Bedrock, Grok, fallbacks, prices ──
// ── [PCODE-198 | S15 | v0.1.0] T16.2 Documenter agent: document tools with knowledge scopes, agent-written drafts, Ask the Documenter ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-181 | S15 | v0.1.0] B5.2 Tokens and costs live: AI spend, budgets, prices, provider keys per project, access tokens with scopes, policy, leak revocation ──
// ── [PCODE-180 | S15 | v0.1.0] B5.1 Agents live: settings, versioned prompts, action rules, autonomy, pause all, budgets in euro, traces, costs, quality ──
// ── [PCODE-120 | S15 | v0.1.0] Build the agent runtime: agents, queued runs, model providers, tools with approvals, budgets, streamed steps ──
//    Why:  one agent run, step by step. The conversation is rebuilt from the stored steps each time, so a
//          run that waits for a person's approval (or a server that restarts) continues exactly where it
//          stopped. Every step is written in its own transaction with an event, which is what lets people
//          watch a run as it happens. Budgets are checked before every model turn.
import { recordLeaks } from '../security/leaks.js'; // [PCODE-325 | S15 | v0.1.0]
import { redactValue, usageCost, type Actor, type AgentScope, type Usage } from '@orqiva/shared';
import { revokeLeaks } from '../auth/leaks.js'; // [PCODE-247 | S15 | v0.1.0]
import type { Pool, PoolClient } from 'pg';
import { inSystem, inWorkspace } from '../db/pool.js';
import { recordEvent } from '../events/outbox.js';
import type { Access } from '../api/access.js';
import { ProviderError, type Block, type ModelMessage, type ModelProvider } from './provider.js';
// [PCODE-240 | S15 | v0.1.0]
import {
  answererOf,
  limitsOf, // [PCODE-332 | S15 | v0.1.0]
  noteProviderUse,
  noteReply,
  providerResolver,
  type AgentChoice,
} from './connections.js';
import {
  classDecision, // [PCODE-334 | S15 | v0.1.0]
  firstSentence,
  TOOL_CLASS, // [PCODE-329 | S15 | v0.1.0]
  usdMicrosToCents,
  type ActionClass,
  type ActionRule,
  type Autonomy,
} from '@orqiva/shared';
import { runTool, toolSpecs } from './tools.js';
import { priceOf, usdEurNow } from '../lib/money.js';
import { limiter } from './limits.js'; // [PCODE-332 | S15 | v0.1.0]
import { mcpToolsFor, type McpBinding } from './mcptools.js'; // [PCODE-334 | S15 | v0.1.0]
import { budgetStop } from '../api/costs.js';
import { kitRuleFor, UI_AGENTS } from '../api/kitcode.js'; // [PCODE-290 | S15 | v0.1.0]

export const MAX_TURNS = 15;
import { maskMessages } from '@orqiva/shared'; // [PCODE-352 | S15 | v0.1.0]
import { runPolicies } from '../api/policies.js'; // [PCODE-352 | S15 | v0.1.0]
const MAX_OUTPUT = 4096;

interface RunRow {
  id: string;
  workspace_id: string;
  project_id: string;
  project_key: string;
  item_id: string | null;
  item_ref: string | null;
  agent_id: string;
  agent_name: string;
  agent_key: string; // [PCODE-198 | S15 | v0.1.0] for the knowledge scope
  agent_role: 'member' | 'guest';
  system_prompt: string;
  tools: string[];
  max_tokens_per_run: number;
  monthly_token_budget: string;
  requested_by: string | null;
  requester_name: string | null;
  requester_email: string | null;
  instruction: string;
  status: string;
  model: string;
  tokens_in: string;
  tokens_out: string;
  // [PCODE-180 | S15 | v0.1.0] settings the runtime enforces
  autonomy: Autonomy;
  temperature: number;
  max_output_tokens: number;
  fallback_model: string;
  connection_id: string | null; // [PCODE-240 | S15 | v0.1.0]
  scope: AgentScope; // [PCODE-247 | S15 | v0.1.0]
  run_budget_cents: string | null;
  day_budget_cents: string | null;
  month_budget_cents: string | null;
  // [PCODE-329 | S15 | v0.1.0] a playground run only records actions; a pinned model beats the connection's
  playground: boolean;
  model_pinned: boolean;
}
interface StepRow {
  seq: number;
  kind: 'model' | 'tool_result' | 'approval' | 'decision' | 'error' | 'note';
  content: Record<string, unknown>;
}

export type ProviderFor = (
  c: PoolClient,
  workspaceId: string,
  // [PCODE-181 | S15 | v0.1.0] a project can bring its own key
  projectId?: string,
  // [PCODE-240 | S15 | v0.1.0] an agent may have its own connection and model
  agent?: AgentChoice,
) => Promise<ModelProvider>;

/** [PCODE-240 | S15 | v0.1.0] the workspace's connections (agents/connections.ts); ORQIVA_AGENT_DEMO=1 falls back to demo. */
export const configuredProvider: ProviderFor = providerResolver();

const RUN_SELECT = `
  SELECT r.id, r.workspace_id, r.project_id, p.key AS project_key, r.item_id,
         CASE WHEN i.id IS NULL THEN NULL ELSE p.key || '-' || i.sequence END AS item_ref,
         r.agent_id, a.name AS agent_name, a.key AS agent_key, a.role AS agent_role, a.tools, a.max_tokens_per_run,
         -- [PCODE-329 | S15 | v0.1.0] a playground run uses its own prompt version and temperature
         CASE WHEN r.playground THEN coalesce((SELECT v.prompt FROM agent_prompt_versions v
                                               WHERE v.agent_id = r.agent_id AND v.version = r.prompt_version), a.system_prompt)
              ELSE a.system_prompt END AS system_prompt,
         r.playground, r.model_pinned,
         a.monthly_token_budget, r.requested_by, u.name AS requester_name, u.email AS requester_email,
         r.instruction, r.status, r.model, r.tokens_in, r.tokens_out,
         a.autonomy, coalesce(r.temperature, a.temperature) AS temperature, a.max_output_tokens, a.fallback_model, a.run_budget_cents, a.day_budget_cents, a.month_budget_cents,
         a.connection_id, a.scope
  FROM agent_runs r JOIN agents a ON a.id = r.agent_id JOIN projects p ON p.id = r.project_id
  LEFT JOIN items i ON i.id = r.item_id LEFT JOIN users u ON u.id = r.requested_by
  WHERE r.id = $1`;

async function loadRun(c: PoolClient, runId: string): Promise<RunRow | undefined> {
  return (await c.query<RunRow>(RUN_SELECT, [runId])).rows[0];
}

async function runEvent(
  c: PoolClient,
  run: RunRow,
  verb: 'started' | 'progressed' | 'completed' | 'failed' | 'updated',
  changes: Record<string, { from: unknown; to: unknown }>,
): Promise<void> {
  const actor: Actor = { kind: 'agent', id: run.agent_id, name: run.agent_name };
  await recordEvent(
    c,
    run.workspace_id,
    {
      actor,
      verb,
      object: {
        type: 'agent_run',
        id: run.id,
        label: run.agent_name + (run.item_ref ? ' on ' + run.item_ref : ''),
      },
      ...(run.item_id
        ? { parent: { type: 'item' as const, id: run.item_id, label: run.item_ref ?? '' } }
        : {}),
      changes,
    },
    { projectId: run.project_id },
  );
}

async function addStep(
  pool: Pool,
  run: RunRow,
  kind: StepRow['kind'],
  content: Record<string, unknown>,
  // [PCODE-327 | S15 | v0.1.0] the cache and reasoning tokens too
  usage: Usage & { cost: number } = { input: 0, output: 0, cost: 0 },
  // [PCODE-332 | S15 | v0.1.0] how long it took, and the model turn it belongs to
  timing: { latencyMs?: number; parentSeq?: number | null } = {},
): Promise<void> {
  const cr = usage.cacheRead ?? 0;
  const cw = usage.cacheWrite ?? 0;
  const rs = usage.reasoning ?? 0;
  // [PCODE-247 | S15 | v0.1.0] no secret stays in a trace: an Orqiva token is revoked, every secret is replaced by its kind
  const raw = JSON.stringify(content);
  await revokeLeaks(pool, run.workspace_id, [raw], {
    foundIn: 'trace',
    location: run.agent_name + (run.item_ref ? ' on ' + run.item_ref : '') + ', run ' + run.id,
  });
  const found = new Set<string>();
  const clean = redactValue(content, found) as Record<string, unknown>;
  if (found.size) clean['redacted'] = [...found];
  // [PCODE-325 | S15 | v0.1.0] another service's secret seen by the agent is reported to rotate
  const others = [...found].filter((k) => k !== 'Orqiva token');
  if (others.length && run.project_id)
    await inWorkspace(pool, run.workspace_id, (c) =>
      recordLeaks(c, run.workspace_id, run.project_id, others, {
        foundIn: 'trace',
        location:
          'what ' +
          run.agent_name +
          ' saw' +
          (run.item_ref ? ' on ' + run.item_ref : '') +
          ' (run ' +
          run.id.slice(0, 8) +
          ')',
      }),
    );
  await inWorkspace(pool, run.workspace_id, async (c) => {
    const seq =
      (
        await c.query<{ n: number }>(
          'SELECT coalesce(max(seq), 0) + 1 AS n FROM agent_steps WHERE run_id = $1',
          [run.id],
        )
      ).rows[0]?.n ?? 1;
    await c.query(
      `INSERT INTO agent_steps (workspace_id, run_id, seq, kind, content, tokens_in, tokens_out, cost_micros,
                                tokens_cache_read, tokens_cache_write, tokens_reasoning, latency_ms, parent_seq)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        run.workspace_id,
        run.id,
        seq,
        kind,
        JSON.stringify(clean),
        usage.input,
        usage.output,
        usage.cost,
        cr,
        cw,
        rs,
        timing.latencyMs === undefined ? null : Math.round(timing.latencyMs),
        timing.parentSeq ?? null,
      ],
    );
    if (usage.input || usage.output || cr || cw)
      await c.query(
        `UPDATE agent_runs SET tokens_in = tokens_in + $2, tokens_out = tokens_out + $3, cost_micros = cost_micros + $4,
                tokens_cache_read = tokens_cache_read + $5, tokens_cache_write = tokens_cache_write + $6,
                tokens_reasoning = tokens_reasoning + $7
          WHERE id = $1`,
        [run.id, usage.input, usage.output, usage.cost, cr, cw, rs],
      );
    await runEvent(c, run, 'progressed', { step: { from: null, to: { seq, kind } } });
  });
}

async function finish(
  pool: Pool,
  run: RunRow,
  status: 'succeeded' | 'failed' | 'waiting',
  error = '',
  summary = '',
): Promise<void> {
  await inWorkspace(pool, run.workspace_id, async (c) => {
    // a run cancelled meanwhile stays cancelled; [PCODE-180 | S15 | v0.1.0] it keeps a one-line summary
    const r = await c.query(
      `UPDATE agent_runs SET status = $2, error = $3, finished_at = CASE WHEN $2 = 'waiting' THEN NULL ELSE now() END,
              summary = CASE WHEN $4 <> '' THEN $4 WHEN $2 = 'failed' THEN left($3, 500) ELSE summary END
       WHERE id = $1 AND status = 'running'`,
      [run.id, status, error, summary],
    );
    if (r.rowCount)
      await runEvent(
        c,
        run,
        status === 'succeeded' ? 'completed' : status === 'failed' ? 'failed' : 'updated',
        {
          status: { from: 'running', to: status },
        },
      );
  });
}

/** The conversation so far, and the tool calls of the last model turn that have no result yet. */
export function conversation(
  run: Pick<RunRow, 'instruction' | 'project_key' | 'item_ref'>,
  steps: StepRow[],
): { messages: ModelMessage[]; pending: Extract<Block, { type: 'tool_use' }>[] } {
  const intro =
    'Project ' +
    run.project_key +
    (run.item_ref ? ', task ' + run.item_ref : '') +
    '.\n\nInstruction: ' +
    run.instruction;
  const messages: ModelMessage[] = [{ role: 'user', content: [{ type: 'text', text: intro }] }];
  let pending: Extract<Block, { type: 'tool_use' }>[] = [];
  for (const s of steps) {
    if (s.kind === 'model') {
      const blocks = (s.content['blocks'] ?? []) as Block[];
      messages.push({ role: 'assistant', content: blocks });
      pending = blocks.filter(
        (b): b is Extract<Block, { type: 'tool_use' }> => b.type === 'tool_use',
      );
    } else if (s.kind === 'tool_result') {
      messages.push({ role: 'user', content: (s.content['results'] ?? []) as Block[] });
      pending = [];
    }
  }
  return { messages, pending };
}

/**
 * Advances a claimed (running) run until it ends, fails or waits for a person. Never throws for a
 * problem of the run itself: that becomes an error step and a failed run.
 */
export async function advanceRun(
  pool: Pool,
  runId: string,
  providerFor: ProviderFor = configuredProvider,
): Promise<void> {
  const head = await inWorkspace(pool, await workspaceOfRun(pool, runId), (c) => loadRun(c, runId));
  if (!head) return;
  const run = head;
  // [PCODE-334 | S15 | v0.1.0] the outside tools of the agent's MCP servers; one that cannot be reached is left out
  const mcp = await inWorkspace(pool, run.workspace_id, (c) => mcpToolsFor(c, run.agent_id)).catch(
    (e: unknown) => ({
      tools: new Map<string, McpBinding>(),
      problems: ['MCP servers: ' + (e instanceof Error ? e.message : String(e))],
    }),
  );
  if (mcp.problems.length)
    await addStep(pool, run, 'note', {
      text: 'Left out the tools of ' + mcp.problems.join('; '),
    });
  try {
    for (let guard = 0; guard < MAX_TURNS * 3; guard++) {
      const now = await inWorkspace(pool, run.workspace_id, async (c) => ({
        status: (await loadRun(c, run.id))?.status,
        steps: (
          await c.query<StepRow>(
            'SELECT seq, kind, content FROM agent_steps WHERE run_id = $1 ORDER BY seq',
            [run.id],
          )
        ).rows,
        prices: (
          await c.query<{ i: string; o: string }>(
            'SELECT input_price_micros AS i, output_price_micros AS o FROM agent_provider_settings WHERE workspace_id = $1',
            [run.workspace_id],
          )
        ).rows[0],
        totals: (
          await c.query<{ tin: string; tout: string }>(
            'SELECT tokens_in AS tin, tokens_out AS tout FROM agent_runs WHERE id = $1',
            [run.id],
          )
        ).rows[0],
        month: (
          await c.query<{ n: string }>(
            "SELECT coalesce(sum(tokens_in + tokens_out), 0) AS n FROM agent_runs WHERE agent_id = $1 AND created_at >= date_trunc('month', now())",
            [run.agent_id],
          )
        ).rows[0],
        // [PCODE-180 | S15 | v0.1.0] the rules, the euro spent and the daily rate
        rules: Object.fromEntries(
          (
            await c.query<{ action_class: ActionClass; rule: ActionRule }>(
              'SELECT action_class, rule FROM agent_action_rules WHERE agent_id = $1',
              [run.agent_id],
            )
          ).rows.map((x) => [x.action_class, x.rule]),
        ),
        spent: (
          await c.query<{ run: string; day: string; month: string }>(
            `SELECT coalesce(sum(cost_micros) FILTER (WHERE id = $2), 0) AS run,
                    coalesce(sum(cost_micros) FILTER (WHERE created_at >= date_trunc('day', now())), 0) AS day,
                    coalesce(sum(cost_micros) FILTER (WHERE created_at >= date_trunc('month', now())), 0) AS month
               FROM agent_runs WHERE agent_id = $1`,
            [run.agent_id, run.id],
          )
        ).rows[0],
        usdEur: await usdEurNow(c),
        policy: await runPolicies(c, run.project_id), // [PCODE-352 | S15 | v0.1.0]
      }));
      if (now.status !== 'running') return; // cancelled meanwhile
      // [PCODE-352 | S15 | v0.1.0] a workspace policy that agents never merge overrides the agent's rules
      if (now.policy.noMerge) now.rules['merge'] = 'never';
      const { messages, pending } = conversation(run, now.steps);

      if (pending.length) {
        // [PCODE-332 | S15 | v0.1.0] tool results and approvals hang under the turn that asked for them
        const parentSeq = now.steps.filter((s) => s.kind === 'model').at(-1)?.seq ?? null;
        // tool calls of the last turn: those that change state wait for a person's decision
        const decisions = new Map<string, { approve: boolean; note: string; by: string }>();
        const asked = new Set<string>();
        for (const s of now.steps) {
          if (s.kind === 'approval') asked.add(String(s.content['toolUseId']));
          if (s.kind === 'decision')
            decisions.set(String(s.content['toolUseId']), {
              approve: s.content['approve'] === true,
              note: typeof s.content['note'] === 'string' ? s.content['note'] : '',
              by: typeof s.content['by'] === 'string' ? s.content['by'] : '',
            });
        }
        // [PCODE-180 | S15 | v0.1.0] autonomy and the action rules decide: run, ask a person, or refuse
        // [PCODE-329 | S15 | v0.1.0] in the playground every action is only recorded
        // [PCODE-334 | S15 | v0.1.0] an MCP tool is decided by its server's kind of action
        const classOf = (name: string) =>
          mcp.tools.get(name)?.cls ?? TOOL_CLASS[name] ?? 'external';
        const mayUse = (name: string) => run.tools.includes(name) || mcp.tools.has(name);
        const decide = (name: string): 'run' | 'ask' | 'refuse' | 'record' =>
          run.playground && mayUse(name) && classOf(name) !== 'read'
            ? 'record'
            : classDecision(classOf(name), run.autonomy, now.rules);
        const waiting = pending.filter((p) => decide(p.name) === 'ask' && !decisions.has(p.id));
        if (waiting.length) {
          for (const p of waiting)
            if (!asked.has(p.id))
              await addStep(
                pool,
                run,
                'approval',
                { toolUseId: p.id, tool: p.name, input: p.input },
                undefined,
                { parentSeq },
              );
          await finish(pool, run, 'waiting');
          return;
        }
        const results: Block[] = [];
        // [PCODE-332 | S15 | v0.1.0] each tool's own time
        const toolsFrom = Date.now();
        const durations: { toolUseId: string; tool: string; ms: number }[] = [];
        for (const p of pending) {
          const d = decisions.get(p.id);
          if (d && !d.approve) {
            results.push({
              type: 'tool_result',
              tool_use_id: p.id,
              content:
                'A person (' + d.by + ') declined this action' + (d.note ? ': ' + d.note : '.'),
              is_error: true,
            });
            continue;
          }
          if (decide(p.name) === 'record') {
            results.push({
              type: 'tool_result',
              tool_use_id: p.id,
              content:
                'Playground: not carried out. It would have run ' +
                p.name +
                ' with ' +
                JSON.stringify(p.input).slice(0, 2000),
            });
            continue;
          }
          if (decide(p.name) === 'refuse') {
            results.push({
              type: 'tool_result',
              tool_use_id: p.id,
              content:
                run.autonomy === 'suggest'
                  ? 'This agent only suggests; describe the change instead of making it'
                  : 'The rules of this agent do not allow ' + p.name,
              is_error: true,
            });
            continue;
          }
          if (!mayUse(p.name)) {
            results.push({
              type: 'tool_result',
              tool_use_id: p.id,
              content: 'This agent may not use ' + p.name,
              is_error: true,
            });
            continue;
          }
          const toolFrom = Date.now();
          const outside = mcp.tools.get(p.name);
          const out = outside
            ? await outside.client.callTool(outside.tool, p.input).then(
                (r) => ({ ok: !r.isError, content: r.text }),
                (e: unknown) => ({
                  ok: false,
                  content: outside.label + ': ' + (e instanceof Error ? e.message : String(e)),
                }),
              )
            : await inWorkspace(pool, run.workspace_id, (c) => {
                if (!run.requested_by)
                  throw new ProviderError('The person who started this run no longer exists');
                const access: Access = {
                  user: {
                    id: run.requested_by,
                    name: run.requester_name ?? '',
                    email: run.requester_email ?? '',
                  },
                  workspaceId: run.workspace_id,
                  role: run.agent_role,
                };
                return runTool(p.name, p.input, {
                  c,
                  access,
                  actor: { kind: 'agent', id: run.agent_id, name: run.agent_name },
                  projectId: run.project_id,
                  agentKey: run.agent_key, // [PCODE-198 | S15 | v0.1.0]
                  runId: run.id,
                  itemId: run.item_id, // [PCODE-284 | S15 | v0.1.0]
                  // [PCODE-247 | S15 | v0.1.0] what the agent may reach
                  scope: run.scope,
                  agentName: run.agent_name,
                });
              });
          durations.push({ toolUseId: p.id, tool: p.name, ms: Date.now() - toolFrom });
          results.push({
            type: 'tool_result',
            tool_use_id: p.id,
            content: out.content.slice(0, 20_000),
            ...(out.ok ? {} : { is_error: true }),
          });
        }
        await addStep(pool, run, 'tool_result', { results, durations }, undefined, {
          latencyMs: Date.now() - toolsFrom,
          parentSeq,
        });
        continue;
      }

      const last = now.steps.filter((s) => s.kind === 'model').pop();
      if (last && !(last.content['blocks'] as Block[]).some((b) => b.type === 'tool_use')) {
        const text = (last.content['blocks'] as Block[])
          .map((b) => (b.type === 'text' ? b.text : ''))
          .join(' ');
        await finish(pool, run, 'succeeded', '', firstSentence(text));
        return;
      }
      const turns = now.steps.filter((s) => s.kind === 'model').length;
      const used = Number(now.totals?.tin ?? 0) + Number(now.totals?.tout ?? 0);
      // [PCODE-352 | S15 | v0.1.0] a workspace policy may cap a run lower than the agent does
      const cap = Math.min(run.max_tokens_per_run, now.policy.tokenCap ?? Number.MAX_SAFE_INTEGER);
      if (turns >= MAX_TURNS)
        throw new ProviderError(
          'The run took ' + String(MAX_TURNS) + ' model turns without finishing',
        );
      if (used >= cap)
        throw new ProviderError(
          cap < run.max_tokens_per_run
            ? 'The run reached the workspace policy of ' + String(cap) + ' tokens'
            : 'The run used its budget of ' + String(run.max_tokens_per_run) + ' tokens',
        );
      if (Number(now.month?.n ?? 0) >= Number(run.monthly_token_budget))
        throw new ProviderError(
          "The agent's monthly budget of " + run.monthly_token_budget + ' tokens is used up',
        );
      // [PCODE-180 | S15 | v0.1.0] the euro budgets: per run, day and month stop the run
      const cents = (m: string | undefined): number => usdMicrosToCents(Number(m ?? 0), now.usdEur);
      const euro = (c: string): string => (Number(c) / 100).toFixed(2).replace('.', ',') + ' €';
      if (run.run_budget_cents && cents(now.spent?.run) >= Number(run.run_budget_cents))
        throw new ProviderError('The run reached its budget of ' + euro(run.run_budget_cents));
      if (run.day_budget_cents && cents(now.spent?.day) >= Number(run.day_budget_cents))
        throw new ProviderError(
          "The agent's budget of " + euro(run.day_budget_cents) + ' for today is used up',
        );
      if (run.month_budget_cents && cents(now.spent?.month) >= Number(run.month_budget_cents))
        throw new ProviderError(
          "The agent's budget of " + euro(run.month_budget_cents) + ' for this month is used up',
        );

      // [PCODE-181 | S15 | v0.1.0] a hard budget of the workspace, client, project or agent stops the run
      const stop = await inWorkspace(pool, run.workspace_id, (c) => budgetStop(c, run, now.usdEur));
      if (stop) throw new ProviderError(stop);
      const provider = await inWorkspace(pool, run.workspace_id, (c) =>
        providerFor(c, run.workspace_id, run.project_id, {
          connectionId: run.connection_id,
          model: run.model,
        }),
      );
      // [PCODE-240 | S15 | v0.1.0] the connection's model, unless the agent names its own connection
      const model = run.model_pinned ? run.model : (provider.model ?? run.model); // [PCODE-329 | S15 | v0.1.0]
      // [PCODE-290 | S15 | v0.1.0] agents that shape UI get the project's kit rule after their own prompt
      const kit = UI_AGENTS.has(run.agent_key)
        ? await inWorkspace(pool, run.workspace_id, (c) => kitRuleFor(c, run.project_id))
        : '';
      // [PCODE-332 | S15 | v0.1.0] the connection's own limits: a call waits for room in the last minute
      const limits = await inWorkspace(pool, run.workspace_id, (c) =>
        limitsOf(c, provider.connectionId),
      );
      let waited = 0;
      const ask = async (model: string) => {
        const slot = provider.connectionId
          ? await limiter.take(
              provider.connectionId,
              limits,
              Math.ceil(JSON.stringify(messages).length / 4),
            )
          : null;
        waited += slot?.waited ?? 0;
        const r = await provider.complete({
          model,
          system: kit ? run.system_prompt + '\n\n' + kit : run.system_prompt,
          // [PCODE-352 | S15 | v0.1.0] personal data masked when the workspace says so
          messages: now.policy.mask ? maskMessages(messages).messages : messages,
          tools: [...toolSpecs(run.tools), ...[...mcp.tools.values()].map((b) => b.spec)],
          maxTokens: Math.min(run.max_output_tokens, MAX_OUTPUT, cap - used),
          temperature: run.temperature,
        });
        if (slot)
          slot.call.tokens =
            r.usage.input + r.usage.output + (r.usage.cacheRead ?? 0) + (r.usage.cacheWrite ?? 0);
        return r;
      };
      const askedAt = Date.now();
      // [PCODE-180 | S15 | v0.1.0] the fallback model takes over when the model fails
      let reply;
      let usedModel = model;
      try {
        reply = await ask(model);
      } catch (e) {
        // [PCODE-240 | S15 | v0.1.0] the connection's last error
        if (e instanceof ProviderError)
          await noteProviderUse(
            pool,
            run.workspace_id,
            answererOf(provider, model),
            e.message,
            Date.now() - askedAt,
          );
        if (!run.fallback_model || !(e instanceof ProviderError)) throw e;
        await addStep(pool, run, 'note', {
          text: model + ' failed (' + e.message + '); ' + run.fallback_model + ' takes over',
        });
        usedModel = run.fallback_model;
        reply = await ask(run.fallback_model);
      }
      // [PCODE-240 | S15 | v0.1.0] who answered: the connection, or the one that took over
      const latencyMs = Date.now() - askedAt - waited;
      const by = await noteReply(pool, run.workspace_id, provider, usedModel, reply, latencyMs);
      if (waited >= 1000)
        await addStep(pool, run, 'note', {
          text:
            'Waited ' +
            String(Math.round(waited / 1000)) +
            " s for room within the connection's limit",
        });
      if (reply.failed)
        await addStep(pool, run, 'note', {
          text:
            reply.failed.by.provider +
            ' (' +
            reply.failed.by.model +
            ') failed (' +
            reply.failed.error +
            '); ' +
            by.provider +
            ' (' +
            by.model +
            ') takes over',
        });
      usedModel = by.model;
      if (usedModel !== run.model)
        await inWorkspace(pool, run.workspace_id, (c) =>
          c.query('UPDATE agent_runs SET model = $2 WHERE id = $1', [run.id, usedModel]),
        );
      // [PCODE-181 | S15 | v0.1.0] priced by the model that answered
      const prices = await inWorkspace(pool, run.workspace_id, (c) =>
        priceOf(c, run.workspace_id, by.provider, usedModel),
      );
      await addStep(
        pool,
        run,
        'model',
        {
          blocks: reply.content,
          stopReason: reply.stopReason,
          provider: by.provider,
          model: by.model,
        },
        { ...reply.usage, cost: usageCost(reply.usage, prices) },
        { latencyMs }, // [PCODE-332 | S15 | v0.1.0]
      );
    }
    throw new ProviderError('The run did not settle');
  } catch (e) {
    const message =
      e instanceof ProviderError
        ? e.message
        : 'Something went wrong in the run: ' + (e instanceof Error ? e.message : String(e));
    await addStep(pool, run, 'error', { message });
    await finish(pool, run, 'failed', message);
  }
}

async function workspaceOfRun(pool: Pool, runId: string): Promise<string> {
  const ws = await inSystem(
    pool,
    async (c) =>
      (
        await c.query<{ workspace_id: string }>(
          'SELECT workspace_id FROM agent_runs WHERE id = $1',
          [runId],
        )
      ).rows[0]?.workspace_id,
  );
  if (!ws) throw new Error('run ' + runId + ' not found');
  return ws;
}
