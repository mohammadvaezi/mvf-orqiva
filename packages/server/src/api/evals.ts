// ── [PCODE-331 | S15 | v0.1.0] T33.3b Evals: saved cases with checks, eval runs per model or prompt version, pass rates over time ──
//    Why:  an agent's saved cases, run again whenever its prompt, model or temperature changes: each eval
//          run runs every case in the playground with one set of settings and says which passed, so a
//          set's history shows at a glance whether a change made the agent better or worse.
import { caseResult, evalChecks, passRate, usdMicrosToCents } from '@orqiva/shared';
import type { Pool, PoolClient } from 'pg';
import type { ProviderFor } from '../agents/runner.js';
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s } from '../http/schema.js';
import { rateNow } from '../lib/money.js';
import { asMember, atLeast, requireProject, type Access } from './access.js';
import { visibleRun } from './agents.js';
import { playRun, runOutcome } from './playground.js';
import { judgeRun } from './runquality.js';

const uuid = s.string({ format: 'uuid' });
const phrases = s.array(s.string({ min: 1, max: 200 }), { max: 20 });

interface SetRow {
  id: string;
  project_id: string;
  agent_id: string;
  agent_name: string;
  name: string;
  created_by: string | null;
  created_at: Date;
}
interface CaseRow {
  id: string;
  instruction: string;
  item_id: string | null;
  item_ref: string | null;
  must_contain: string[];
  must_not_contain: string[];
  min_judge: number | null;
}
interface EvalRunRow {
  id: string;
  set_id: string;
  label: string;
  settings: { model?: string; promptVersion?: number; temperature?: number };
  created_at: Date;
}

const SET_SELECT = `SELECT e.*, a.name AS agent_name FROM agent_eval_sets e JOIN agents a ON a.id = e.agent_id`;
const CASE_SELECT = `SELECT c.id, c.instruction, c.item_id, c.must_contain, c.must_not_contain, c.min_judge,
                            CASE WHEN i.id IS NULL THEN NULL ELSE p.key || '-' || i.sequence END AS item_ref
                       FROM agent_eval_cases c LEFT JOIN items i ON i.id = c.item_id LEFT JOIN projects p ON p.id = i.project_id`;

async function visibleSet(c: PoolClient, a: Access, id: string): Promise<SetRow> {
  const e = (await c.query<SetRow>(SET_SELECT + ' WHERE e.id = $1', [id])).rows[0];
  if (!e) throw new HttpError(404, 'not_found', 'Eval set not found');
  try {
    await requireProject(c, a, e.project_id);
  } catch {
    throw new HttpError(404, 'not_found', 'Eval set not found');
  }
  return e;
}

const caseJson = (k: CaseRow) => ({
  id: k.id,
  instruction: k.instruction,
  itemId: k.item_id,
  itemRef: k.item_ref,
  mustContain: k.must_contain,
  mustNotContain: k.must_not_contain,
  minJudge: k.min_judge,
});

/** An eval run's cases with their run, answer, checks, judge score and result, and its summary. */
async function evalRunJson(c: PoolClient, r: EvalRunRow) {
  const rate = await rateNow(c);
  const rows = (
    await c.query<{
      run_id: string;
      case_id: string | null;
      status: string;
      cost_micros: string;
      usd_eur: number | null;
      judge_score: number | null;
      instruction: string;
      must_contain: string[] | null;
      must_not_contain: string[] | null;
      min_judge: number | null;
    }>(
      `SELECT x.id AS run_id, x.eval_case_id AS case_id, x.status, x.cost_micros, x.usd_eur, x.judge_score,
              x.instruction, k.must_contain, k.must_not_contain, k.min_judge
         FROM agent_runs x LEFT JOIN agent_eval_cases k ON k.id = x.eval_case_id
        WHERE x.eval_run_id = $1 ORDER BY k.created_at NULLS LAST, x.created_at, x.id`,
      [r.id],
    )
  ).rows;
  const cases = [];
  for (const x of rows) {
    const steps = (
      await c.query<{ kind: string; content: Record<string, unknown> }>(
        "SELECT kind, content FROM agent_steps WHERE run_id = $1 AND kind = 'model' ORDER BY seq",
        [x.run_id],
      )
    ).rows;
    const answer = runOutcome(steps).answer;
    const checks = evalChecks(answer, {
      mustContain: x.must_contain ?? [],
      mustNotContain: x.must_not_contain ?? [],
      minJudge: x.min_judge,
    });
    cases.push({
      caseId: x.case_id,
      runId: x.run_id,
      instruction: x.instruction.slice(0, 300),
      status: x.status,
      answer: answer.slice(0, 2000),
      checks,
      judge: x.judge_score,
      minJudge: x.min_judge,
      result: caseResult(x.status, checks, x.judge_score, x.min_judge),
      costCents: usdMicrosToCents(Number(x.cost_micros), x.usd_eur ?? rate.usdEur),
    });
  }
  const judged = cases.flatMap((k) => (k.judge === null ? [] : [k.judge]));
  return {
    id: r.id,
    label: r.label,
    settings: {
      model: r.settings.model ?? null,
      promptVersion: r.settings.promptVersion ?? null,
      temperature: r.settings.temperature ?? null,
    },
    createdAt: r.created_at.toISOString(),
    passRate: passRate(cases.map((k) => k.result)),
    passed: cases.filter((k) => k.result === 'pass').length,
    failed: cases.filter((k) => k.result === 'fail').length,
    pending: cases.filter((k) => k.result === 'running' || k.result === 'needs judge').length,
    judgeAvg: judged.length
      ? Math.round((judged.reduce((n, x) => n + x, 0) / judged.length) * 10) / 10
      : null,
    costCents: cases.reduce((n, k) => n + k.costCents, 0),
    cases,
  };
}

const settingsOut = s.object({
  model: s.nullable(s.string()),
  promptVersion: s.nullable(s.number({ integer: true })),
  temperature: s.nullable(s.number()),
});
const summaryFields = {
  id: s.string(),
  label: s.string(),
  settings: settingsOut,
  createdAt: s.string(),
  passRate: s.nullable(s.number()),
  passed: s.number({ integer: true }),
  failed: s.number({ integer: true }),
  pending: s.number({ integer: true }),
  judgeAvg: s.nullable(s.number()),
  costCents: s.number({ integer: true }),
};
const evalRunOut = s.object({
  ...summaryFields,
  cases: s.array(
    s.object({
      caseId: s.nullable(s.string()),
      runId: s.string(),
      instruction: s.string(),
      status: s.string(),
      answer: s.string(),
      checks: s.array(s.object({ check: s.string(), ok: s.boolean() })),
      judge: s.nullable(s.number({ integer: true })),
      minJudge: s.nullable(s.number({ integer: true })),
      result: s.enum(['pass', 'fail', 'running', 'needs judge']),
      costCents: s.number({ integer: true }),
    }),
  ),
});
const caseOut = s.object({
  id: s.string(),
  instruction: s.string(),
  itemId: s.nullable(s.string()),
  itemRef: s.nullable(s.string()),
  mustContain: s.array(s.string()),
  mustNotContain: s.array(s.string()),
  minJudge: s.nullable(s.number({ integer: true })),
});
const setOut = s.object({
  id: s.string(),
  name: s.string(),
  projectId: s.string(),
  agentId: s.string(),
  agentName: s.string(),
  createdAt: s.string(),
  cases: s.array(caseOut),
  runs: s.array(s.object(summaryFields)),
});

export function evalRoutes(pool: Pool, models: ProviderFor): Route[] {
  const setJson = async (c: PoolClient, e: SetRow) => {
    const cases = (
      await c.query<CaseRow>(CASE_SELECT + ' WHERE c.set_id = $1 ORDER BY c.created_at', [e.id])
    ).rows;
    const runs = (
      await c.query<EvalRunRow>(
        'SELECT * FROM agent_eval_runs WHERE set_id = $1 ORDER BY created_at DESC LIMIT 20',
        [e.id],
      )
    ).rows;
    const summaries = [];
    for (const r of runs) {
      const x = await evalRunJson(c, r);
      summaries.push({
        id: x.id,
        label: x.label,
        settings: x.settings,
        createdAt: x.createdAt,
        passRate: x.passRate,
        passed: x.passed,
        failed: x.failed,
        pending: x.pending,
        judgeAvg: x.judgeAvg,
        costCents: x.costCents,
      });
    }
    return {
      id: e.id,
      name: e.name,
      projectId: e.project_id,
      agentId: e.agent_id,
      agentName: e.agent_name,
      createdAt: e.created_at.toISOString(),
      cases: cases.map(caseJson),
      runs: summaries,
    };
  };

  const listSets = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/agent-eval-sets',
    summary: 'Eval sets with their cases and recent eval runs (member)',
    tags: ['agents'],
    params: s.object({ workspaceId: uuid }),
    query: s.object({ agentId: s.optional(uuid) }),
    response: s.array(setOut),
    handler: ({ params, query, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const rows = (
          await c.query<SetRow>(
            SET_SELECT + ' WHERE ($1::uuid IS NULL OR e.agent_id = $1) ORDER BY e.created_at DESC',
            [query.agentId ?? null],
          )
        ).rows;
        const out = [];
        for (const e of rows) {
          try {
            await requireProject(c, a, e.project_id);
          } catch {
            continue;
          }
          out.push(await setJson(c, e));
        }
        return { body: out };
      }),
  });

  const createSet = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/projects/:projectId/agent-eval-sets',
    summary: 'A new eval set for an agent (member)',
    tags: ['agents'],
    params: s.object({ workspaceId: uuid, projectId: uuid }),
    body: s.object({ agentId: uuid, name: s.string({ min: 1, max: 120 }) }),
    response: setOut,
    status: 201,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const p = await requireProject(c, a, params.projectId);
        if (!(await c.query('SELECT 1 FROM agents WHERE id = $1', [body.agentId])).rowCount)
          throw new HttpError(404, 'not_found', 'Agent not found');
        const id = (
          await c.query<{ id: string }>(
            `INSERT INTO agent_eval_sets (workspace_id, project_id, agent_id, name, created_by)
             VALUES ($1, $2, $3, $4, $5) RETURNING id`,
            [a.workspaceId, p.id, body.agentId, body.name.trim(), a.user.id],
          )
        ).rows[0]?.id;
        if (!id) throw new Error('eval set insert returned nothing');
        return { status: 201, body: await setJson(c, await visibleSet(c, a, id)) };
      }),
  });

  const setParams = s.object({ workspaceId: uuid, setId: uuid });

  const getSet = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/agent-eval-sets/:setId',
    summary: 'An eval set with its cases and recent eval runs (member)',
    tags: ['agents'],
    params: setParams,
    response: setOut,
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => ({
        body: await setJson(c, await visibleSet(c, a, params.setId)),
      })),
  });

  const dropSet = route({
    method: 'DELETE',
    path: '/api/workspaces/:workspaceId/agent-eval-sets/:setId',
    summary: 'Remove an eval set with its cases and eval runs (who made it, or an admin)',
    tags: ['agents'],
    params: setParams,
    response: s.object({ ok: s.literal(true) }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const e = await visibleSet(c, a, params.setId);
        if (e.created_by !== a.user.id && !atLeast(a.role, 'admin'))
          throw new HttpError(403, 'forbidden', 'Only who made it or an admin removes an eval set');
        await c.query('DELETE FROM agent_eval_sets WHERE id = $1', [e.id]);
        return { body: { ok: true as const } };
      }),
  });

  const addCase = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/agent-eval-sets/:setId/cases',
    summary:
      'A case: an instruction (or the one of a run), optionally a task, and what the answer must and must not say (member)',
    tags: ['agents'],
    params: setParams,
    body: s.object({
      instruction: s.optional(s.string({ min: 1, max: 20_000 })),
      itemId: s.optional(uuid),
      fromRunId: s.optional(uuid),
      mustContain: s.optional(phrases),
      mustNotContain: s.optional(phrases),
      minJudge: s.optional(s.nullable(s.number({ integer: true, min: 1, max: 5 }))),
    }),
    response: caseOut,
    status: 201,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const e = await visibleSet(c, a, params.setId);
        let instruction = body.instruction?.trim() ?? '';
        let itemId = body.itemId ?? null;
        if (body.fromRunId) {
          const run = await visibleRun(c, a, body.fromRunId);
          if (run.agent_id !== e.agent_id)
            throw new HttpError(400, 'invalid_request', 'The run is of another agent', [
              { path: 'body.fromRunId', message: 'is of another agent' },
            ]);
          instruction ||= run.instruction;
          itemId ??= run.item_id;
        }
        if (!instruction)
          throw new HttpError(400, 'invalid_request', 'A case needs an instruction', [
            { path: 'body.instruction', message: 'is missing' },
          ]);
        if (
          itemId &&
          !(
            await c.query('SELECT 1 FROM items WHERE id = $1 AND project_id = $2', [
              itemId,
              e.project_id,
            ])
          ).rowCount
        )
          throw new HttpError(400, 'invalid_request', 'The task is not in the set’s project', [
            { path: 'body.itemId', message: 'is not in this project' },
          ]);
        const clean = (xs?: string[]) => [
          ...new Set((xs ?? []).map((x) => x.trim()).filter(Boolean)),
        ];
        const id = (
          await c.query<{ id: string }>(
            `INSERT INTO agent_eval_cases (workspace_id, set_id, instruction, item_id, must_contain, must_not_contain, min_judge)
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
            [
              a.workspaceId,
              e.id,
              instruction,
              itemId,
              clean(body.mustContain),
              clean(body.mustNotContain),
              body.minJudge ?? null,
            ],
          )
        ).rows[0]?.id;
        const k = (await c.query<CaseRow>(CASE_SELECT + ' WHERE c.id = $1', [id])).rows[0];
        if (!k) throw new Error('case vanished');
        return { status: 201, body: caseJson(k) };
      }),
  });

  const dropCase = route({
    method: 'DELETE',
    path: '/api/workspaces/:workspaceId/agent-eval-sets/:setId/cases/:caseId',
    summary: 'Remove a case; eval runs keep their results (member)',
    tags: ['agents'],
    params: s.object({ workspaceId: uuid, setId: uuid, caseId: uuid }),
    response: s.object({ ok: s.literal(true) }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const e = await visibleSet(c, a, params.setId);
        const gone = await c.query('DELETE FROM agent_eval_cases WHERE id = $1 AND set_id = $2', [
          params.caseId,
          e.id,
        ]);
        if (!gone.rowCount) throw new HttpError(404, 'not_found', 'Case not found');
        return { body: { ok: true as const } };
      }),
  });

  const runSet = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/agent-eval-sets/:setId/runs',
    summary:
      'Run every case in the playground, as the agent is or with another model, prompt version or temperature (member)',
    tags: ['agents'],
    params: setParams,
    body: s.object({
      label: s.optional(s.string({ max: 60 })),
      model: s.optional(s.string({ min: 1, max: 120 })),
      promptVersion: s.optional(s.number({ integer: true, min: 1, max: 100_000 })),
      temperature: s.optional(s.number({ min: 0, max: 1 })),
    }),
    response: evalRunOut,
    status: 201,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const e = await visibleSet(c, a, params.setId);
        const cases = (
          await c.query<CaseRow>(CASE_SELECT + ' WHERE c.set_id = $1 ORDER BY c.created_at', [e.id])
        ).rows;
        if (!cases.length) throw new HttpError(409, 'conflict', 'The set has no cases yet');
        const settings = {
          ...(body.model !== undefined ? { model: body.model } : {}),
          ...(body.promptVersion !== undefined ? { promptVersion: body.promptVersion } : {}),
          ...(body.temperature !== undefined ? { temperature: body.temperature } : {}),
        };
        const r = (
          await c.query<EvalRunRow>(
            `INSERT INTO agent_eval_runs (workspace_id, set_id, label, settings, created_by)
             VALUES ($1, $2, $3, $4, $5) RETURNING *`,
            [a.workspaceId, e.id, (body.label ?? '').trim(), JSON.stringify(settings), a.user.id],
          )
        ).rows[0];
        if (!r) throw new Error('eval run insert returned nothing');
        for (const k of cases)
          await playRun(
            c,
            a,
            {
              projectId: e.project_id,
              agentId: e.agent_id,
              itemId: k.item_id,
              instruction: k.instruction,
            },
            settings,
            { evalRunId: r.id, evalCaseId: k.id },
          );
        return { status: 201, body: await evalRunJson(c, r) };
      }),
  });

  const runParams = s.object({ workspaceId: uuid, evalRunId: uuid });
  const visibleEvalRun = async (c: PoolClient, a: Access, id: string): Promise<EvalRunRow> => {
    const r = (await c.query<EvalRunRow>('SELECT * FROM agent_eval_runs WHERE id = $1', [id]))
      .rows[0];
    if (!r) throw new HttpError(404, 'not_found', 'Eval run not found');
    await visibleSet(c, a, r.set_id);
    return r;
  };

  const getRun = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/agent-eval-runs/:evalRunId',
    summary: 'An eval run: every case with its answer, checks, judge score and result (member)',
    tags: ['agents'],
    params: runParams,
    response: evalRunOut,
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => ({
        body: await evalRunJson(c, await visibleEvalRun(c, a, params.evalRunId)),
      })),
  });

  const judgeAll = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/agent-eval-runs/:evalRunId/judge',
    summary:
      'Have the judge score every finished case of an eval run that has no score yet (member)',
    tags: ['agents'],
    params: runParams,
    response: evalRunOut,
    handler: async ({ params, req }) => {
      const todo = await asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const r = await visibleEvalRun(c, a, params.evalRunId);
        return (
          await c.query<{ id: string }>(
            `SELECT id FROM agent_runs WHERE eval_run_id = $1 AND judge_score IS NULL
                AND status IN ('succeeded', 'failed') ORDER BY created_at`,
            [r.id],
          )
        ).rows.map((x) => x.id);
      });
      for (const id of todo) await judgeRun(pool, models, req, params.workspaceId, id);
      return asMember(pool, req, params.workspaceId, 'member', async (c, a) => ({
        body: await evalRunJson(c, await visibleEvalRun(c, a, params.evalRunId)),
      }));
    },
  });

  return [listSets, createSet, getSet, dropSet, addCase, dropCase, runSet, getRun, judgeAll];
}
