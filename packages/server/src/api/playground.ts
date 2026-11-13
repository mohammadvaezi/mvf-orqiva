// ── [PCODE-331 | S15 | v0.1.0] T33.3b Evals: saved cases with checks, eval runs per model or prompt version, pass rates over time ──
// ── [PCODE-329 | S15 | v0.1.0] T33.2 Agent playground: rerun with other settings, compare runs, A/B experiments ──
//    Why:  trying an agent before trusting it: a run again with another model, prompt version or
//          temperature; two or three runs side by side with a diff of their answers; and experiments that
//          run one instruction with a few variants, a few times each, to see which does better for what it
//          costs. Every playground run reads what it needs and only records its actions.
import { lineDiff, usdMicrosToCents } from '@orqiva/shared';
import type { Pool, PoolClient } from 'pg';
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s } from '../http/schema.js';
import { rateNow } from '../lib/money.js';
import { asMember, atLeast, requireProject, type Access } from './access.js';
import { RUN_SELECT, runEvent, runJson, runOut, visibleRun, wake, type RunRow } from './agents.js';

const uuid = s.string({ format: 'uuid' });

export interface Variant {
  label: string;
  model?: string;
  promptVersion?: number;
  temperature?: number;
}
const variantIn = s.object({
  label: s.string({ min: 1, max: 40 }),
  model: s.optional(s.string({ min: 1, max: 120 })),
  promptVersion: s.optional(s.number({ integer: true, min: 1, max: 100_000 })),
  temperature: s.optional(s.number({ min: 0, max: 1 })),
});

/** A queued playground run of an agent; an agent still switched off can be tried too. */
export async function playRun(
  c: PoolClient,
  a: Access,
  base: { projectId: string; agentId: string; itemId: string | null; instruction: string },
  v: Omit<Variant, 'label'>,
  link: {
    rerunOf?: string;
    experimentId?: string;
    variant?: string;
    evalRunId?: string; // [PCODE-331 | S15 | v0.1.0]
    evalCaseId?: string;
  } = {},
): Promise<RunRow> {
  const agent = (
    await c.query<{ id: string; model: string; prompt_version: number }>(
      'SELECT id, model, prompt_version FROM agents WHERE id = $1',
      [base.agentId],
    )
  ).rows[0];
  if (!agent) throw new HttpError(404, 'not_found', 'Agent not found');
  if (
    v.promptVersion !== undefined &&
    !(
      await c.query('SELECT 1 FROM agent_prompt_versions WHERE agent_id = $1 AND version = $2', [
        agent.id,
        v.promptVersion,
      ])
    ).rowCount
  )
    throw new HttpError(
      400,
      'invalid_request',
      'The agent has no prompt version ' + String(v.promptVersion),
      [{ path: 'body.promptVersion', message: 'does not exist' }],
    );
  const id = (
    await c.query<{ id: string }>(
      `INSERT INTO agent_runs (workspace_id, project_id, item_id, agent_id, requested_by, instruction, model, prompt_version,
                               playground, model_pinned, temperature, rerun_of, experiment_id, variant,
                               eval_run_id, eval_case_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, $9, $10, $11, $12, $13, $14, $15) RETURNING id`,
      [
        a.workspaceId,
        base.projectId,
        base.itemId,
        agent.id,
        a.user.id,
        base.instruction,
        v.model ?? agent.model,
        v.promptVersion ?? agent.prompt_version,
        v.model !== undefined,
        v.temperature ?? null,
        link.rerunOf ?? null,
        link.experimentId ?? null,
        link.variant ?? '',
        link.evalRunId ?? null,
        link.evalCaseId ?? null,
      ],
    )
  ).rows[0]?.id;
  if (!id) throw new Error('run insert returned nothing');
  const run = await visibleRun(c, a, id);
  await runEvent(c, a, run, 'created', { status: { from: null, to: 'queued' } });
  await wake(c, id);
  return run;
}

interface StepLite {
  kind: string;
  content: Record<string, unknown>;
}

/** The text of the last model turn, the tools the run called, and the actions it only recorded. */
export function runOutcome(steps: readonly StepLite[]): {
  answer: string;
  tools: string[];
  recorded: number;
} {
  let answer = '';
  const tools: string[] = [];
  let recorded = 0;
  for (const st of steps) {
    if (st.kind === 'model') {
      const blocks = (st.content['blocks'] ?? []) as {
        type: string;
        text?: string;
        name?: string;
      }[];
      const text = blocks
        .flatMap((b) => (b.type === 'text' && b.text ? [b.text] : []))
        .join('\n')
        .trim();
      if (text) answer = text;
      for (const b of blocks) if (b.type === 'tool_use' && b.name) tools.push(b.name);
    }
    if (st.kind === 'tool_result')
      for (const r of (st.content['results'] ?? []) as { content?: unknown }[])
        if (typeof r.content === 'string' && r.content.startsWith('Playground: not carried out'))
          recorded++;
  }
  return { answer, tools, recorded };
}

const durationMs = (r: RunRow): number | null =>
  r.started_at && r.finished_at ? r.finished_at.getTime() - r.started_at.getTime() : null;

export function playgroundRoutes(pool: Pool): Route[] {
  const rerun = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/agent-runs/:runId/rerun',
    summary:
      'Run it again in the playground, as it was or with another model, prompt version or temperature; actions are only recorded (member)',
    tags: ['agents'],
    params: s.object({ workspaceId: uuid, runId: uuid }),
    body: s.object({
      model: s.optional(s.string({ min: 1, max: 120 })),
      promptVersion: s.optional(s.number({ integer: true, min: 1, max: 100_000 })),
      temperature: s.optional(s.number({ min: 0, max: 1 })),
      instruction: s.optional(s.string({ min: 1, max: 20_000 })),
    }),
    response: runOut,
    status: 201,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const was = await visibleRun(c, a, params.runId);
        const run = await playRun(
          c,
          a,
          {
            projectId: was.project_id,
            agentId: was.agent_id,
            itemId: was.item_id,
            instruction: body.instruction?.trim() ?? was.instruction,
          },
          {
            ...(body.model !== undefined ? { model: body.model } : {}),
            promptVersion: body.promptVersion ?? was.prompt_version,
            ...(body.temperature !== undefined
              ? { temperature: body.temperature }
              : was.temperature !== null
                ? { temperature: was.temperature }
                : {}),
          },
          { rerunOf: was.id },
        );
        return { status: 201, body: runJson(run) };
      }),
  });

  const compared = s.object({
    run: runOut,
    temperature: s.number(),
    costCents: s.number({ integer: true }),
    durationMs: s.nullable(s.number({ integer: true })),
    steps: s.number({ integer: true }),
    tools: s.array(s.string()),
    recorded: s.number({ integer: true }),
    answer: s.string(),
    // against the first run's answer
    diff: s.array(s.object({ op: s.enum(['same', 'add', 'del']), text: s.string() })),
  });

  const compare = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/agent-runs-compare',
    summary:
      'Two or three runs side by side: settings, status, tokens, cost, time, tools, and how their answers differ from the first (guest)',
    tags: ['agents'],
    params: s.object({ workspaceId: uuid }),
    query: s.object({ ids: s.string({ min: 73, max: 120 }) }),
    response: s.array(compared),
    handler: ({ params, query, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        const ids = [...new Set(query.ids.split(','))];
        if (ids.length < 2 || ids.length > 3 || ids.some((x) => !/^[0-9a-f-]{36}$/.test(x)))
          throw new HttpError(400, 'invalid_request', 'Compare two or three runs', [
            { path: 'query.ids', message: 'names two or three runs' },
          ]);
        const rate = await rateNow(c);
        const out = [];
        let first = '';
        for (const [i, id] of ids.entries()) {
          const run = await visibleRun(c, a, id);
          const temp =
            run.temperature ??
            (
              await c.query<{ t: number }>('SELECT temperature AS t FROM agents WHERE id = $1', [
                run.agent_id,
              ])
            ).rows[0]?.t ??
            0;
          const steps = (
            await c.query<StepLite>(
              'SELECT kind, content FROM agent_steps WHERE run_id = $1 ORDER BY seq',
              [run.id],
            )
          ).rows;
          const o = runOutcome(steps);
          if (i === 0) first = o.answer;
          out.push({
            run: runJson(run),
            temperature: temp,
            costCents: usdMicrosToCents(Number(run.cost_micros), run.usd_eur ?? rate.usdEur),
            durationMs: durationMs(run),
            steps: steps.length,
            tools: o.tools,
            recorded: o.recorded,
            answer: o.answer,
            diff: i === 0 ? [] : lineDiff(first, o.answer),
          });
        }
        return { body: out };
      }),
  });

  const experimentOut = s.object({
    id: s.string(),
    name: s.string(),
    agentId: s.string(),
    agentName: s.string(),
    projectId: s.string(),
    itemId: s.nullable(s.string()),
    instruction: s.string(),
    repeats: s.number({ integer: true }),
    createdAt: s.string(),
    variants: s.array(
      s.object({
        label: s.string(),
        model: s.nullable(s.string()),
        promptVersion: s.nullable(s.number({ integer: true })),
        temperature: s.nullable(s.number()),
        runs: s.number({ integer: true }),
        finished: s.number({ integer: true }),
        succeeded: s.number({ integer: true }),
        avgCostCents: s.nullable(s.number({ integer: true })),
        avgMs: s.nullable(s.number({ integer: true })),
        avgTokens: s.nullable(s.number({ integer: true })),
      }),
    ),
    runs: s.array(
      s.object({
        id: s.string(),
        variant: s.string(),
        status: s.string(),
        costCents: s.number({ integer: true }),
        answer: s.string(),
      }),
    ),
  });

  interface ExperimentRow {
    id: string;
    name: string;
    agent_id: string;
    agent_name: string;
    project_id: string;
    item_id: string | null;
    instruction: string;
    repeats: number;
    variants: Variant[];
    created_at: Date;
  }

  const experimentJson = async (c: PoolClient, e: ExperimentRow) => {
    const rate = await rateNow(c);
    const runs = (
      await c.query<RunRow>(RUN_SELECT + ' WHERE r.experiment_id = $1 ORDER BY r.created_at', [
        e.id,
      ])
    ).rows;
    const answers = new Map<string, string>();
    for (const r of runs) {
      const steps = (
        await c.query<StepLite>(
          "SELECT kind, content FROM agent_steps WHERE run_id = $1 AND kind = 'model' ORDER BY seq",
          [r.id],
        )
      ).rows;
      answers.set(r.id, runOutcome(steps).answer);
    }
    const cents = (r: RunRow) => usdMicrosToCents(Number(r.cost_micros), r.usd_eur ?? rate.usdEur);
    const avg = (xs: number[]): number | null =>
      xs.length ? Math.round(xs.reduce((n, x) => n + x, 0) / xs.length) : null;
    return {
      id: e.id,
      name: e.name,
      agentId: e.agent_id,
      agentName: e.agent_name,
      projectId: e.project_id,
      itemId: e.item_id,
      instruction: e.instruction,
      repeats: e.repeats,
      createdAt: e.created_at.toISOString(),
      variants: e.variants.map((v) => {
        const mine = runs.filter((r) => r.variant === v.label);
        const done = mine.filter((r) => ['succeeded', 'failed', 'cancelled'].includes(r.status));
        return {
          label: v.label,
          model: v.model ?? null,
          promptVersion: v.promptVersion ?? null,
          temperature: v.temperature ?? null,
          runs: mine.length,
          finished: done.length,
          succeeded: done.filter((r) => r.status === 'succeeded').length,
          avgCostCents: avg(done.map(cents)),
          avgMs: avg(done.flatMap((r) => durationMs(r) ?? [])),
          avgTokens: avg(done.map((r) => Number(r.tokens_in) + Number(r.tokens_out))),
        };
      }),
      runs: runs.map((r) => ({
        id: r.id,
        variant: r.variant,
        status: r.status,
        costCents: cents(r),
        answer: (answers.get(r.id) ?? '').slice(0, 2000),
      })),
    };
  };

  const EXPERIMENT_SELECT = `SELECT e.*, a.name AS agent_name FROM agent_experiments e JOIN agents a ON a.id = e.agent_id`;

  const createExperiment = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/projects/:projectId/agent-experiments',
    summary:
      'An A/B experiment: one instruction run in the playground with two to four variants, each a few times (member)',
    tags: ['agents'],
    params: s.object({ workspaceId: uuid, projectId: uuid }),
    body: s.object({
      name: s.string({ min: 1, max: 120 }),
      agentId: uuid,
      instruction: s.string({ min: 1, max: 20_000 }),
      itemId: s.optional(uuid),
      variants: s.array(variantIn, { min: 2, max: 4 }),
      repeats: s.optional(s.number({ integer: true, min: 1, max: 5 })),
    }),
    response: experimentOut,
    status: 201,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const p = await requireProject(c, a, params.projectId);
        const labels = body.variants.map((v) => v.label.trim());
        if (new Set(labels).size !== labels.length)
          throw new HttpError(400, 'invalid_request', 'Each variant needs its own name', [
            { path: 'body.variants', message: 'repeat a name' },
          ]);
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
        const repeats = body.repeats ?? 1;
        const variants: Variant[] = body.variants.map((v) => ({ ...v, label: v.label.trim() }));
        const id = (
          await c.query<{ id: string }>(
            `INSERT INTO agent_experiments (workspace_id, project_id, agent_id, item_id, name, instruction, variants, repeats, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
            [
              a.workspaceId,
              p.id,
              body.agentId,
              body.itemId ?? null,
              body.name.trim(),
              body.instruction.trim(),
              JSON.stringify(variants),
              repeats,
              a.user.id,
            ],
          )
        ).rows[0]?.id;
        if (!id) throw new Error('experiment insert returned nothing');
        // round by round, so every variant gets its turn early
        for (let n = 0; n < repeats; n++)
          for (const v of variants) {
            const { label, ...settings } = v;
            await playRun(
              c,
              a,
              {
                projectId: p.id,
                agentId: body.agentId,
                itemId: body.itemId ?? null,
                instruction: body.instruction.trim(),
              },
              settings,
              { experimentId: id, variant: label },
            );
          }
        const e = (await c.query<ExperimentRow>(EXPERIMENT_SELECT + ' WHERE e.id = $1', [id]))
          .rows[0];
        if (!e) throw new Error('experiment vanished');
        return { status: 201, body: await experimentJson(c, e) };
      }),
  });

  const listExperiments = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/agent-experiments',
    summary: 'The experiments, newest first, with their results so far (member)',
    tags: ['agents'],
    params: s.object({ workspaceId: uuid }),
    response: s.array(experimentOut),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const rows = (
          await c.query<ExperimentRow>(EXPERIMENT_SELECT + ' ORDER BY e.created_at DESC LIMIT 30')
        ).rows;
        const out = [];
        for (const e of rows) {
          try {
            await requireProject(c, a, e.project_id);
          } catch {
            continue;
          }
          out.push(await experimentJson(c, e));
        }
        return { body: out };
      }),
  });

  const getExperiment = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/agent-experiments/:experimentId',
    summary: 'An experiment with its results per variant and every run (member)',
    tags: ['agents'],
    params: s.object({ workspaceId: uuid, experimentId: uuid }),
    response: experimentOut,
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const e = (
          await c.query<ExperimentRow>(EXPERIMENT_SELECT + ' WHERE e.id = $1', [
            params.experimentId,
          ])
        ).rows[0];
        if (!e) throw new HttpError(404, 'not_found', 'Experiment not found');
        try {
          await requireProject(c, a, e.project_id);
        } catch {
          throw new HttpError(404, 'not_found', 'Experiment not found');
        }
        return { body: await experimentJson(c, e) };
      }),
  });

  const dropExperiment = route({
    method: 'DELETE',
    path: '/api/workspaces/:workspaceId/agent-experiments/:experimentId',
    summary: 'Remove an experiment and its runs (who made it, or an admin)',
    tags: ['agents'],
    params: s.object({ workspaceId: uuid, experimentId: uuid }),
    response: s.object({ ok: s.literal(true) }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const e = (
          await c.query<{ created_by: string | null; project_id: string }>(
            'SELECT created_by, project_id FROM agent_experiments WHERE id = $1',
            [params.experimentId],
          )
        ).rows[0];
        if (!e) throw new HttpError(404, 'not_found', 'Experiment not found');
        if (e.created_by !== a.user.id && !atLeast(a.role, 'admin'))
          throw new HttpError(
            403,
            'forbidden',
            'Only who made it or an admin removes an experiment',
          );
        if (
          (
            await c.query<{ n: string }>(
              "SELECT count(*) AS n FROM agent_runs WHERE experiment_id = $1 AND status IN ('queued', 'running')",
              [params.experimentId],
            )
          ).rows[0]?.n !== '0'
        )
          throw new HttpError(409, 'conflict', 'Wait until its runs have finished');
        await c.query('DELETE FROM agent_experiments WHERE id = $1', [params.experimentId]);
        return { body: { ok: true as const } };
      }),
  });

  return [rerun, compare, createExperiment, listExperiments, getExperiment, dropExperiment];
}
