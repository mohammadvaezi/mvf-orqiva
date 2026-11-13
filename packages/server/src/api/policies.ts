// ── [PCODE-424 | S15 | v0.1.0] T37 low: Policy dry run counts read right ──
// ── [PCODE-352 | S15 | v0.1.0] T35.3c Policies for approvals, budgets and data, with a dry run ──
//    Why:  the workspace's rules, kept by the server wherever the thing they govern happens: an item
//          entering a sprint, an agent's merge, an agent run's tokens, a message to an AI provider. Before
//          a rule goes on, the dry run says what it would have stopped or changed in the last 30 days.
import {
  isWorkspaceRule,
  maskPersonal,
  policyProblem,
  policyText,
  POLICY_RULES,
  TOOL_CLASS,
  type WorkspaceRule,
} from '@orqiva/shared';
import type { Pool, PoolClient } from 'pg';
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s } from '../http/schema.js';
import { asMember } from './access.js';

const uuid = s.string({ format: 'uuid' });

interface PolicyRow {
  id: string;
  rule: WorkspaceRule;
  params: Record<string, unknown>;
  project_ids: string[];
  state: 'draft' | 'on';
  updated_at: Date;
}

const policyJson = (p: PolicyRow): Record<string, unknown> => ({
  id: p.id,
  rule: p.rule,
  kind: POLICY_RULES[p.rule].kind,
  text: policyText(p.rule, p.params),
  params: p.params,
  projectIds: p.project_ids,
  state: p.state,
  updatedAt: p.updated_at.toISOString(),
});

/** The rules that are on for a project (or for the workspace when there is no project). */
async function onFor(c: PoolClient, projectId: string | null): Promise<PolicyRow[]> {
  return (
    await c.query<PolicyRow>(
      `SELECT id, rule, params, project_ids, state, updated_at FROM workspace_policies
        WHERE state = 'on' AND (cardinality(project_ids) = 0 OR $1::uuid = ANY (project_ids))`,
      [projectId],
    )
  ).rows;
}

/** What the policies change for an agent run in a project: no merging, a token cap, masked data. */
export async function runPolicies(
  c: PoolClient,
  projectId: string | null,
): Promise<{ noMerge: boolean; tokenCap: number | null; mask: boolean }> {
  const on = await onFor(c, projectId);
  const caps = on
    .filter((p) => p.rule === 'run_token_cap')
    .map((p) => Number(p.params['maxTokens']));
  return {
    noMerge: on.some((p) => p.rule === 'agents_no_merge'),
    tokenCap: caps.length ? Math.min(...caps) : null,
    mask: on.some((p) => p.rule === 'mask_personal_data'),
  };
}

/** Refuses items without acceptance criteria entering a sprint when the policy is on; new items have none. */
export async function sprintPolicy(
  c: PoolClient,
  projectId: string,
  itemIds: readonly string[] | null,
): Promise<void> {
  if (!(await onFor(c, projectId)).some((p) => p.rule === 'sprint_requires_criteria')) return;
  const missing = itemIds
    ? (
        await c.query<{ ref: string }>(
          `SELECT p.key || '-' || i.sequence AS ref FROM items i JOIN projects p ON p.id = i.project_id
            WHERE i.id = ANY ($1::uuid[]) AND i.kind NOT IN ('epic', 'milestone')
              AND NOT EXISTS (SELECT 1 FROM item_criteria ic WHERE ic.item_id = i.id)`,
          [itemIds],
        )
      ).rows.map((r) => r.ref)
    : ['the new task'];
  if (missing.length)
    throw new HttpError(
      409,
      'conflict',
      'A policy keeps tasks without acceptance criteria out of sprints: ' +
        missing.slice(0, 5).join(', '),
    );
}

/** What a rule would have stopped or changed in the last 30 days. */
export async function dryRun(
  c: PoolClient,
  rule: WorkspaceRule,
  params: Record<string, unknown>,
  projectIds: readonly string[],
): Promise<{ count: number; examples: string[]; text: string }> {
  const scope = projectIds.length ? [...projectIds] : null;
  if (rule === 'sprint_requires_criteria') {
    const rows = (
      await c.query<{ ref: string; title: string }>(
        `SELECT p.key || '-' || i.sequence AS ref, i.title FROM items i JOIN projects p ON p.id = i.project_id
           JOIN sprints sp ON sp.id = i.sprint_id
          WHERE sp.completed_at IS NULL AND i.kind NOT IN ('epic', 'milestone')
            AND ($1::uuid[] IS NULL OR i.project_id = ANY ($1))
            AND NOT EXISTS (SELECT 1 FROM item_criteria ic WHERE ic.item_id = i.id)
          ORDER BY i.updated_at DESC`,
        [scope],
      )
    ).rows;
    return {
      count: rows.length,
      examples: rows.slice(0, 8).map((r) => r.ref + ' ' + r.title),
      text: rows.length
        ? said(
            rows.length,
            ' task in an open sprint has no acceptance criteria. It stays where it is; from now on such tasks cannot enter a sprint.',
            ' tasks in open sprints have no acceptance criteria. They stay where they are; from now on such tasks cannot enter a sprint.',
          )
        : 'Every task in an open sprint has acceptance criteria. Nothing would have been stopped.',
    };
  }
  if (rule === 'agents_no_merge') {
    // the agents whose own rules let them merge, or ask a person first; and their runs that tried
    const agents = (
      await c.query<{ name: string; rule: string }>(
        `SELECT a.name, r.rule FROM agent_action_rules r JOIN agents a ON a.id = r.agent_id
          WHERE r.action_class = 'merge' AND r.rule <> 'never' ORDER BY a.name`,
      )
    ).rows;
    const steps = (
      await c.query<{ run_id: string; blocks: { type: string; name?: string }[] }>(
        `SELECT s.run_id, s.content->'blocks' AS blocks FROM agent_steps s JOIN agent_runs r ON r.id = s.run_id
          WHERE s.kind = 'model' AND s.at > now() - interval '30 days' AND ($1::uuid[] IS NULL OR r.project_id = ANY ($1))`,
        [scope],
      )
    ).rows;
    const tried = new Set(
      steps
        .filter((st) =>
          (Array.isArray(st.blocks) ? st.blocks : []).some(
            (b) => b.type === 'tool_use' && b.name !== undefined && TOOL_CLASS[b.name] === 'merge',
          ),
        )
        .map((st) => st.run_id),
    );
    return {
      count: agents.length,
      examples: agents.map(
        (x) => x.name + ' (' + (x.rule === 'allowed' ? 'may merge' : 'asks first') + ')',
      ),
      text:
        (agents.length
          ? said(
              agents.length,
              ' agent may merge or ask to; it would be refused.',
              ' agents may merge or ask to; they would be refused.',
            )
          : 'No agent may merge now; the policy keeps it so.') +
        (tried.size
          ? ' ' +
            said(
              tried.size,
              ' run tried to merge in the last 30 days.',
              ' runs tried to merge in the last 30 days.',
            )
          : ''),
    };
  }
  if (rule === 'run_token_cap') {
    const cap = Number(params['maxTokens'] ?? 0);
    const rows = (
      await c.query<{ instruction: string; tokens: string }>(
        `SELECT instruction, tokens_in + tokens_out AS tokens FROM agent_runs
          WHERE created_at > now() - interval '30 days' AND tokens_in + tokens_out > $1
            AND ($2::uuid[] IS NULL OR project_id = ANY ($2))
          ORDER BY tokens_in + tokens_out DESC`,
        [cap, scope],
      )
    ).rows;
    return {
      count: rows.length,
      examples: rows
        .slice(0, 8)
        .map(
          (r) =>
            Number(r.tokens).toLocaleString('de-DE') + ' tokens: ' + r.instruction.slice(0, 100),
        ),
      text: rows.length
        ? said(
            rows.length,
            ' agent run used more in the last 30 days; it would have stopped at the cap.',
            ' agent runs used more in the last 30 days; they would have stopped at the cap.',
          )
        : 'No agent run used more in the last 30 days.',
    };
  }
  const rows = (
    await c.query<{ instruction: string }>(
      `SELECT instruction FROM agent_runs WHERE created_at > now() - interval '30 days'
        AND ($1::uuid[] IS NULL OR project_id = ANY ($1)) ORDER BY created_at DESC LIMIT 2000`,
      [scope],
    )
  ).rows;
  const hits = rows.map((r) => maskPersonal(r.instruction)).filter((m) => m.count > 0);
  return {
    count: hits.length,
    examples: hits.slice(0, 8).map((m) => m.text.slice(0, 120)),
    text: hits.length
      ? said(
          hits.length,
          ' agent instruction in the last 30 days held personal data; it would have gone masked.',
          ' agent instructions in the last 30 days held personal data; it would have gone masked.',
        )
      : 'No agent instruction in the last 30 days held personal data that would be masked.',
  };
}

// [PCODE-424 | S15 | v0.1.0] one of a thing reads as one: "1 task … has", not "1 tasks … have"
function said(n: number, one: string, many: string): string {
  return String(n) + (n === 1 ? one : many);
}

export function policyRoutes(pool: Pool): Route[] {
  const ws = s.object({ workspaceId: uuid });
  const fields = {
    rule: s.string({ max: 60 }),
    params: s.optional(s.anyObject()),
    projectIds: s.optional(s.array(uuid, { max: 100 })),
  };
  const check = (rule: string, params: Record<string, unknown>): WorkspaceRule => {
    if (!isWorkspaceRule(rule))
      throw new HttpError(400, 'invalid_request', 'There is no such rule', [
        { path: 'body.rule', message: 'is not in the catalogue' },
      ]);
    const problem = policyProblem(rule, params);
    if (problem)
      throw new HttpError(400, 'invalid_request', problem, [
        { path: 'body.params', message: problem },
      ]);
    return rule;
  };
  const SELECT = 'SELECT id, rule, params, project_ids, state, updated_at FROM workspace_policies';

  const list = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/workspace-policies',
    summary: 'The workspace’s policies and the catalogue of rules (member)',
    tags: ['policies'],
    params: ws,
    response: s.anyObject(),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c) => ({
        body: {
          policies: (await c.query<PolicyRow>(SELECT + ' ORDER BY created_at')).rows.map(
            policyJson,
          ),
          rules: Object.entries(POLICY_RULES).map(([rule, r]) => ({ rule, ...r })),
        },
      })),
  });

  const add = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/workspace-policies',
    summary: 'Add a policy, as a draft or on (admin)',
    tags: ['policies'],
    params: ws,
    body: s.object({ ...fields, state: s.optional(s.enum(['draft', 'on'])) }),
    response: s.anyObject(),
    status: 201,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'admin', async (c, a) => {
        const rule = check(body.rule, body.params ?? {});
        const r = (
          await c.query<PolicyRow>(
            `INSERT INTO workspace_policies (workspace_id, rule, params, project_ids, state, created_by) VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING id, rule, params, project_ids, state, updated_at`,
            [
              a.workspaceId,
              rule,
              JSON.stringify(body.params ?? {}),
              body.projectIds ?? [],
              body.state ?? 'draft',
              a.user.id,
            ],
          )
        ).rows[0];
        if (!r) throw new Error('policy insert returned nothing');
        return { status: 201, body: policyJson(r) };
      }),
  });

  const change = route({
    method: 'PATCH',
    path: '/api/workspaces/:workspaceId/workspace-policies/:policyId',
    summary: 'Turn a policy on or back to a draft, or change its setting and projects (admin)',
    tags: ['policies'],
    params: s.object({ workspaceId: uuid, policyId: uuid }),
    body: s.object({
      state: s.optional(s.enum(['draft', 'on'])),
      params: s.optional(s.anyObject()),
      projectIds: s.optional(s.array(uuid, { max: 100 })),
    }),
    response: s.anyObject(),
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'admin', async (c) => {
        const cur = (await c.query<PolicyRow>(SELECT + ' WHERE id = $1', [params.policyId]))
          .rows[0];
        if (!cur) throw new HttpError(404, 'not_found', 'Policy not found');
        if (body.params) check(cur.rule, body.params);
        const r = (
          await c.query<PolicyRow>(
            `UPDATE workspace_policies SET state = coalesce($2, state), params = coalesce($3, params),
                    project_ids = coalesce($4, project_ids), updated_at = now()
              WHERE id = $1 RETURNING id, rule, params, project_ids, state, updated_at`,
            [
              params.policyId,
              body.state ?? null,
              body.params ? JSON.stringify(body.params) : null,
              body.projectIds ?? null,
            ],
          )
        ).rows[0];
        if (!r) throw new Error('policy update returned nothing');
        return { body: policyJson(r) };
      }),
  });

  const remove = route({
    method: 'DELETE',
    path: '/api/workspaces/:workspaceId/workspace-policies/:policyId',
    summary: 'Remove a policy (admin)',
    tags: ['policies'],
    params: s.object({ workspaceId: uuid, policyId: uuid }),
    response: s.object({ removed: s.boolean() }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'admin', async (c) => ({
        body: {
          removed: Boolean(
            (await c.query('DELETE FROM workspace_policies WHERE id = $1', [params.policyId]))
              .rowCount,
          ),
        },
      })),
  });

  const dry = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/workspace-policies/dry-run',
    summary: 'What a rule would have stopped or changed in the last 30 days (admin)',
    tags: ['policies'],
    params: ws,
    body: s.object(fields),
    response: s.object({ count: s.number(), examples: s.array(s.string()), text: s.string() }),
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'admin', async (c) => {
        const rule = check(body.rule, body.params ?? {});
        return { body: await dryRun(c, rule, body.params ?? {}, body.projectIds ?? []) };
      }),
  });

  return [list, dry, add, change, remove];
}
