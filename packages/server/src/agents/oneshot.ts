// ── [PCODE-352 | S15 | v0.1.0] T35.3c Policies for approvals, budgets and data, with a dry run ──
// ── [PCODE-332 | S15 | v0.1.0] T33.4a Nested traces with latency and commits, agent rate limits, provider limits and health ──
// ── [PCODE-327 | S15 | v0.1.0] T33.1a Cache and reasoning tokens priced, the daily ECB rate, spend in euro by day ──
// ── [PCODE-240 | S15 | v0.1.0] T24.1 AI provider connections: Anthropic, OpenAI, Azure, Gemini, Bedrock, Grok, fallbacks, prices ──
// ── [PCODE-181 | S15 | v0.1.0] B5.2 Tokens and costs live: AI spend, budgets, prices, provider keys per project, access tokens with scopes, policy, leak revocation ──
// ── [PCODE-180 | S15 | v0.1.0] B5.1 Agents live: settings, versioned prompts, action rules, autonomy, pause all, budgets in euro, traces, costs, quality ──
// ── [PCODE-123 | S15 | v0.1.0] Add the ideas inbox and the AI owner interview ──
//    Why:  some agent work is one answer, not a run with tools: the next interview question, a proposal
//          draft. It still goes through the same governed path: the agent must be switched on and within its
//          monthly budget, and the call is kept as a finished agent run with its one step, tokens and cost,
//          so the Agents page counts it and an audit finds it. The run is written after the model answers,
//          never before, so the worker can never pick up a half-made one.
import { priceOf } from '../lib/money.js';
import { usageCost, type Prices } from '@orqiva/shared'; // [PCODE-327 | S15 | v0.1.0]
import type { Pool } from 'pg';
import { inWorkspace } from '../db/pool.js';
import { HttpError } from '../http/errors.js';
import { ensureAgents } from '../api/agents.js';
import {
  ProviderError,
  type Answerer,
  type ModelMessage,
  type ModelProvider,
  type ModelReply,
} from './provider.js';
import type { ProviderFor } from './runner.js';
import { answererOf, limitsOf, noteProviderUse, noteReply } from './connections.js'; // [PCODE-240 | S15 | v0.1.0]
import { limiter } from './limits.js'; // [PCODE-332 | S15 | v0.1.0]

const MAX_OUTPUT = 4096;
import { maskMessages } from '@orqiva/shared'; // [PCODE-352 | S15 | v0.1.0]
import { runPolicies } from '../api/policies.js'; // [PCODE-352 | S15 | v0.1.0]

export interface AskAgent {
  workspaceId: string;
  projectId: string;
  agentKey: string;
  requestedBy: string;
  /** what the run page shows as its instruction */
  instruction: string;
  /** added to the agent's own instructions */
  system: string;
  messages: ModelMessage[];
}

interface AgentRow {
  id: string;
  name: string;
  enabled: boolean;
  model: string;
  system_prompt: string;
  max_tokens_per_run: number;
  monthly_token_budget: string;
  used: string;
  connection_id: string | null; // [PCODE-240 | S15 | v0.1.0]
}

/** Asks an agent for one answer; returns its text and the run that records it. */
export async function askAgent(
  pool: Pool,
  providerFor: ProviderFor,
  o: AskAgent,
): Promise<{ text: string; runId: string }> {
  const ready = await inWorkspace(pool, o.workspaceId, async (c) => {
    await ensureAgents(c, o.workspaceId);
    const agent = (
      await c.query<AgentRow>(
        `SELECT a.id, a.name, a.enabled, a.model, a.system_prompt, a.max_tokens_per_run, a.monthly_token_budget, a.connection_id,
                (SELECT coalesce(sum(r.tokens_in + r.tokens_out), 0) FROM agent_runs r
                  WHERE r.agent_id = a.id AND r.created_at >= date_trunc('month', now())) AS used
           FROM agents a WHERE a.key = $1`,
        [o.agentKey],
      )
    ).rows[0];
    if (!agent) throw new HttpError(409, 'conflict', 'There is no ' + o.agentKey + ' agent');
    if (!agent.enabled)
      throw new HttpError(
        409,
        'conflict',
        agent.name + ' is switched off; an admin can switch it on',
      );
    if (Number(agent.used) >= Number(agent.monthly_token_budget))
      throw new HttpError(409, 'conflict', agent.name + "'s monthly budget is used up");
    // [PCODE-180 | S15 | v0.1.0] "pause all" holds one-answer calls too
    const paused = (
      await c.query<{ paused_at: Date | null }>(
        'SELECT paused_at FROM agent_provider_settings WHERE workspace_id = $1',
        [o.workspaceId],
      )
    ).rows[0]?.paused_at;
    if (paused)
      throw new HttpError(409, 'conflict', 'All agents are paused; an admin can resume them');
    let provider: ModelProvider;
    try {
      provider = await providerFor(c, o.workspaceId, o.projectId, {
        connectionId: agent.connection_id,
        model: agent.model,
      });
    } catch (e) {
      if (e instanceof ProviderError) throw new HttpError(409, 'conflict', e.message);
      throw e;
    }
    return { agent, provider };
  });

  const { agent } = ready;
  // [PCODE-240 | S15 | v0.1.0] the connection's model unless the agent has its own connection
  const model = ready.provider.model ?? agent.model;
  let reply: ModelReply;
  // [PCODE-332 | S15 | v0.1.0] within the connection's limits, timed
  const limits = await inWorkspace(pool, o.workspaceId, (c) =>
    limitsOf(c, ready.provider.connectionId),
  );
  const slot = ready.provider.connectionId
    ? await limiter.take(
        ready.provider.connectionId,
        limits,
        Math.ceil(JSON.stringify(o.messages).length / 4),
      )
    : null;
  const askedAt = Date.now();
  // [PCODE-352 | S15 | v0.1.0] personal data masked when the workspace says so
  const policy = await inWorkspace(pool, o.workspaceId, (c) => runPolicies(c, o.projectId));
  try {
    reply = await ready.provider.complete({
      model,
      system: (agent.system_prompt + '\n\n' + o.system).trim(),
      messages: policy.mask ? maskMessages(o.messages).messages : o.messages,
      tools: [],
      maxTokens: Math.min(MAX_OUTPUT, agent.max_tokens_per_run),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const by = answererOf(ready.provider, model);
    if (e instanceof ProviderError)
      await noteProviderUse(pool, o.workspaceId, by, message, Date.now() - askedAt);
    await record(pool, o, agent, by, null, message, { in: 0, out: 0 });
    throw new HttpError(502, 'bad_gateway', 'The model did not answer: ' + message);
  }
  // [PCODE-240 | S15 | v0.1.0] priced by the provider and model that answered
  if (slot) slot.call.tokens = reply.usage.input + reply.usage.output;
  const by = await noteReply(
    pool,
    o.workspaceId,
    ready.provider,
    model,
    reply,
    Date.now() - askedAt,
  );
  const prices = await inWorkspace(pool, o.workspaceId, (c) =>
    priceOf(c, o.workspaceId, by.provider, by.model),
  );
  const runId = await record(pool, o, agent, by, reply, '', prices);
  const text = reply.content
    .flatMap((b) => (b.type === 'text' ? [b.text] : []))
    .join('\n')
    .trim();
  if (!text) throw new HttpError(502, 'bad_gateway', agent.name + ' gave an empty answer');
  return { text, runId };
}

/** The finished run with its one step: the model's answer, or the error. */
async function record(
  pool: Pool,
  o: AskAgent,
  agent: AgentRow,
  by: Answerer,
  reply: ModelReply | null,
  error: string,
  p: Prices,
): Promise<string> {
  const tin = reply?.usage.input ?? 0;
  const tout = reply?.usage.output ?? 0;
  // [PCODE-327 | S15 | v0.1.0] priced with the cache, which is kept with the reasoning
  const u = reply?.usage ?? { input: 0, output: 0 };
  const cost = usageCost(u, p);
  const extra = [u.cacheRead ?? 0, u.cacheWrite ?? 0, u.reasoning ?? 0];
  return inWorkspace(pool, o.workspaceId, async (c) => {
    const id = (
      await c.query<{ id: string }>(
        `INSERT INTO agent_runs (workspace_id, project_id, agent_id, requested_by, instruction, status, model,
                                 tokens_in, tokens_out, cost_micros, error, started_at, finished_at,
                                 tokens_cache_read, tokens_cache_write, tokens_reasoning)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now(), now(), $12, $13, $14) RETURNING id`,
        [
          o.workspaceId,
          o.projectId,
          agent.id,
          o.requestedBy,
          o.instruction.slice(0, 20_000),
          reply ? 'succeeded' : 'failed',
          by.model || agent.model,
          tin,
          tout,
          cost,
          error,
          ...extra,
        ],
      )
    ).rows[0]?.id;
    if (!id) throw new Error('run insert returned nothing');
    await c.query(
      `INSERT INTO agent_steps (workspace_id, run_id, seq, kind, content, tokens_in, tokens_out, cost_micros,
                                tokens_cache_read, tokens_cache_write, tokens_reasoning)
       VALUES ($1, $2, 1, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        o.workspaceId,
        id,
        reply ? 'model' : 'error',
        JSON.stringify(
          reply
            ? {
                blocks: reply.content,
                stopReason: reply.stopReason,
                provider: by.provider,
                model: by.model,
                ...(reply.failed ? { failed: reply.failed } : {}),
              }
            : { message: error, provider: by.provider },
        ),
        tin,
        tout,
        cost,
        ...extra,
      ],
    );
    return id;
  });
}
