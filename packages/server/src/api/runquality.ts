// ── [PCODE-331 | S15 | v0.1.0] T33.3b Evals: saved cases with checks, eval runs per model or prompt version, pass rates over time ──
// ── [PCODE-330 | S15 | v0.1.0] T33.3a Run quality: annotations, judge scores, outcomes ──
//    Why:  how good a run was: people mark it good or bad with tags and a note; the Reviewer agent judges
//          it against a fixed rubric from the instruction, the tools it used and its answer; and what came
//          of it on its task (done, merged, reverted) is read from the task, its pull requests and commits.
import { JUDGE_RUBRIC, outcomeOf, parseJudge, RUN_TAGS, type RunOutcome } from '@orqiva/shared';
import type { IncomingMessage } from 'node:http';
import type { Pool, PoolClient } from 'pg';
import { askAgent } from '../agents/oneshot.js';
import { MODE_JUDGE } from '../agents/provider.js';
import type { ProviderFor } from '../agents/runner.js';
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s } from '../http/schema.js';
import { asMember } from './access.js';
import { visibleRun } from './agents.js';
import { runOutcome } from './playground.js';

const uuid = s.string({ format: 'uuid' });

/** Per run: whether a commit for its task was reverted, its pull request merged, its task done, all after it began. */
export const OUTCOME_SQL = `
  (r.item_id IS NOT NULL) AS has_task,
  EXISTS (SELECT 1 FROM git_commits gc JOIN items gi ON gi.id = r.item_id JOIN projects gp ON gp.id = gi.project_id
           WHERE gc.project_id = gi.project_id AND gc.reverted_by IS NOT NULL AND gc.committed_at >= r.created_at
             AND gc.message ~ ('(^|[^A-Za-z0-9-])' || gp.key || '-' || gi.sequence || '([^0-9]|$)')) AS reverted,
  EXISTS (SELECT 1 FROM pull_requests pr WHERE pr.item_id = r.item_id AND pr.state = 'merged'
             AND pr.merged_at >= r.created_at) AS merged,
  coalesce((SELECT oi.completed_at >= r.created_at FROM items oi WHERE oi.id = r.item_id), false) AS done`;

export interface OutcomeFlags {
  has_task: boolean;
  reverted: boolean;
  merged: boolean;
  done: boolean;
}
export const outcomeOfRow = (f: OutcomeFlags): RunOutcome =>
  outcomeOf({ hasTask: f.has_task, reverted: f.reverted, merged: f.merged, done: f.done });

async function qualityOf(c: PoolClient, runId: string) {
  const annotations = (
    await c.query<{
      user_id: string;
      name: string;
      verdict: 'good' | 'bad';
      tags: string[];
      note: string;
      updated_at: Date;
    }>(
      `SELECT n.user_id, u.name, n.verdict, n.tags, n.note, n.updated_at
         FROM agent_run_annotations n JOIN users u ON u.id = n.user_id
        WHERE n.run_id = $1 ORDER BY n.updated_at`,
      [runId],
    )
  ).rows;
  const r = (
    await c.query<
      {
        judge_score: number | null;
        judge_reason: string;
        judge_run_id: string | null;
        judged_at: Date | null;
      } & OutcomeFlags
    >(
      `SELECT r.judge_score, r.judge_reason, r.judge_run_id, r.judged_at, ${OUTCOME_SQL}
         FROM agent_runs r WHERE r.id = $1`,
      [runId],
    )
  ).rows[0];
  if (!r) throw new HttpError(404, 'not_found', 'Run not found');
  return {
    annotations: annotations.map((n) => ({
      userId: n.user_id,
      name: n.name,
      verdict: n.verdict,
      tags: n.tags,
      note: n.note,
      at: n.updated_at.toISOString(),
    })),
    judge:
      r.judge_score === null
        ? null
        : {
            score: r.judge_score,
            reason: r.judge_reason,
            runId: r.judge_run_id,
            at: r.judged_at?.toISOString() ?? '',
          },
    outcome: outcomeOfRow(r),
  };
}

const qualityOut = s.object({
  annotations: s.array(
    s.object({
      userId: s.string(),
      name: s.string(),
      verdict: s.enum(['good', 'bad']),
      tags: s.array(s.string()),
      note: s.string(),
      at: s.string(),
    }),
  ),
  judge: s.nullable(
    s.object({
      score: s.number({ integer: true }),
      reason: s.string(),
      runId: s.nullable(s.string()),
      at: s.string(),
    }),
  ),
  outcome: s.enum(['reverted', 'merged', 'done', 'open', 'none']),
});

/**
 * [PCODE-331 | S15 | v0.1.0] Has the Reviewer score one finished run and keeps the score on it; an eval
 * judges all its cases this way.
 */
export async function judgeRun(
  pool: Pool,
  models: ProviderFor,
  req: IncomingMessage,
  workspaceId: string,
  runId: string,
): Promise<void> {
  const prep = await asMember(pool, req, workspaceId, 'member', async (c, a) => {
    const run = await visibleRun(c, a, runId);
    if (run.status !== 'succeeded' && run.status !== 'failed')
      throw new HttpError(409, 'conflict', 'Only a finished run can be judged');
    if (!run.project_id) throw new HttpError(409, 'conflict', 'This run has no project');
    const steps = (
      await c.query<{ kind: string; content: Record<string, unknown> }>(
        'SELECT kind, content FROM agent_steps WHERE run_id = $1 ORDER BY seq',
        [run.id],
      )
    ).rows;
    const o = runOutcome(steps);
    const text = [
      'Agent: ' + run.agent_name,
      'Status: ' + run.status + (run.error ? ' (' + run.error + ')' : ''),
      'Task: ' + (run.item_ref ?? 'none'),
      'Instruction:\n' + run.instruction.slice(0, 8000),
      'Tools used: ' + (o.tools.length ? o.tools.join(', ') : 'none'),
      ...(o.recorded ? [String(o.recorded) + ' actions were only recorded (playground).'] : []),
      'Answer:\n' + (o.answer ? o.answer.slice(0, 12_000) : '(none)'),
    ].join('\n\n');
    return { run, text, user: a.user.id };
  });
  const asked = await askAgent(pool, models, {
    workspaceId,
    projectId: prep.run.project_id,
    agentKey: 'reviewer',
    requestedBy: prep.user,
    instruction: 'Judge the run of ' + prep.run.agent_name + ' ' + prep.run.id.slice(0, 8),
    system: MODE_JUDGE + '\n' + JUDGE_RUBRIC,
    messages: [{ role: 'user', content: [{ type: 'text', text: prep.text }] }],
  });
  const v = parseJudge(asked.text);
  if (!v) throw new HttpError(502, 'bad_gateway', 'The judge gave no score');
  await asMember(pool, req, workspaceId, 'member', (c) =>
    c.query(
      `UPDATE agent_runs SET judge_score = $2, judge_reason = $3, judge_run_id = $4, judged_at = now()
        WHERE id = $1`,
      [prep.run.id, v.score, v.reason, asked.runId],
    ),
  );
}

export function runQualityRoutes(pool: Pool, models: ProviderFor): Route[] {
  const params = s.object({ workspaceId: uuid, runId: uuid });

  const get = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/agent-runs/:runId/quality',
    summary: 'What people said about a run, its judge score and what came of it (guest)',
    tags: ['agents'],
    params,
    response: qualityOut,
    handler: ({ params: p, req }) =>
      asMember(pool, req, p.workspaceId, 'guest', async (c, a) => {
        await visibleRun(c, a, p.runId);
        return { body: await qualityOf(c, p.runId) };
      }),
  });

  const annotate = route({
    method: 'PUT',
    path: '/api/workspaces/:workspaceId/agent-runs/:runId/annotation',
    summary: 'Say whether a run was good or bad, with tags and a note; one per person (member)',
    tags: ['agents'],
    params,
    body: s.object({
      verdict: s.enum(['good', 'bad']),
      tags: s.optional(s.array(s.enum(RUN_TAGS), { max: 8 })),
      note: s.optional(s.string({ max: 2000 })),
    }),
    response: qualityOut,
    handler: ({ params: p, body, req }) =>
      asMember(pool, req, p.workspaceId, 'member', async (c, a) => {
        const run = await visibleRun(c, a, p.runId);
        await c.query(
          `INSERT INTO agent_run_annotations (workspace_id, run_id, user_id, verdict, tags, note)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (run_id, user_id) DO UPDATE
             SET verdict = EXCLUDED.verdict, tags = EXCLUDED.tags, note = EXCLUDED.note, updated_at = now()`,
          [
            a.workspaceId,
            run.id,
            a.user.id,
            body.verdict,
            [...new Set(body.tags ?? [])],
            (body.note ?? '').trim(),
          ],
        );
        return { body: await qualityOf(c, run.id) };
      }),
  });

  const unannotate = route({
    method: 'DELETE',
    path: '/api/workspaces/:workspaceId/agent-runs/:runId/annotation',
    summary: 'Take back what you said about a run (member)',
    tags: ['agents'],
    params,
    response: qualityOut,
    handler: ({ params: p, req }) =>
      asMember(pool, req, p.workspaceId, 'member', async (c, a) => {
        const run = await visibleRun(c, a, p.runId);
        await c.query('DELETE FROM agent_run_annotations WHERE run_id = $1 AND user_id = $2', [
          run.id,
          a.user.id,
        ]);
        return { body: await qualityOf(c, run.id) };
      }),
  });

  const judge = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/agent-runs/:runId/judge',
    summary:
      'Have the Reviewer agent score a finished run from 1 to 5 against the rubric, with a reason (member)',
    tags: ['agents'],
    params,
    response: qualityOut,
    handler: async ({ params: p, req }) => {
      // [PCODE-331 | S15 | v0.1.0] the judging itself is shared with evals
      await judgeRun(pool, models, req, p.workspaceId, p.runId);
      return asMember(pool, req, p.workspaceId, 'member', async (c) => ({
        body: await qualityOf(c, p.runId),
      }));
    },
  });

  return [get, annotate, unannotate, judge];
}
