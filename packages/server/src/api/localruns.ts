// ── [PCODE-466 | S15 | v0.1.0] Every task shows its work record: AI, model, tokens, price, time and version, in VS Code and the portal ──
// ── [PCODE-459 | S15 | v0.1.0] Planning in VS Code locks the project in the portal: banner on every tab, conflicting AI planning refused both ways ──
// ── [PCODE-456 | S15 | v0.1.0] Planning in VS Code shows live in the portal: local AI runs, hook steps, plan documents synced ──
//    Why:  an AI run on a developer's machine (Claude Code planning in VS Code) is shown like a server run:
//          the portal counts it as running, the run page shows its steps as they happen, and it ends with a
//          result. The client opens the run, adds a step for each thing the AI does and closes it; only the
//          person who opened it can write to it. The worker never claims these runs (source = 'local'). A
//          new run from the same client closes one it left open, so a crashed editor leaves no run running.
import { redactValue, type Actor } from '@orqiva/shared';
import type { Pool, PoolClient } from 'pg';
import { revokeLeaks } from '../auth/leaks.js';
import { recordEvent } from '../events/outbox.js';
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s } from '../http/schema.js';
import { asMember, requireProject, type Access } from './access.js';
import { ensureAgents, runJson, runOut, visibleRun, type RunRow } from './agents.js';
import { assertNotLocked } from './planninglock.js';
import { addRunUsage } from './workrecord.js';

const uuid = s.string({ format: 'uuid' });
const runParams = s.object({ workspaceId: uuid, runId: uuid });

type Verb = 'created' | 'started' | 'progressed' | 'completed' | 'failed' | 'updated';

/** The run's event, by its agent; the portal's live views reload on it. */
async function localEvent(
  c: PoolClient,
  a: Access,
  r: RunRow,
  verb: Verb,
  changes: Record<string, { from: unknown; to: unknown }>,
): Promise<void> {
  const actor: Actor = { kind: 'agent', id: r.agent_id, name: r.agent_name };
  await recordEvent(
    c,
    a.workspaceId,
    {
      actor,
      verb,
      object: { type: 'agent_run', id: r.id, label: r.agent_name },
      changes,
    },
    { projectId: r.project_id },
  );
}

/** A run of this person's, opened from their machine and still running. */
async function ownRun(c: PoolClient, a: Access, runId: string): Promise<RunRow> {
  const r = await visibleRun(c, a, runId);
  if (r.source !== 'local' || r.requested_by !== a.user.id)
    throw new HttpError(403, 'forbidden', 'Only the person who started this run can write to it');
  return r;
}

export function localRunRoutes(pool: Pool): Route[] {
  const open = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/projects/:projectId/local-runs',
    summary: "Open a run of an AI on the caller's machine, shown live in the portal (member)",
    tags: ['agents'],
    params: s.object({ workspaceId: uuid, projectId: uuid }),
    body: s.object({
      agent: s.string({ pattern: /^[a-z][a-z0-9-]{0,39}$/ }),
      instruction: s.string({ min: 1, max: 20_000 }),
      client: s.string({ min: 1, max: 200 }),
      model: s.optional(s.string({ min: 1, max: 100 })),
    }),
    response: runOut,
    status: 201,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const p = await requireProject(c, a, params.projectId);
        await ensureAgents(c, a.workspaceId);
        const agent = (
          await c.query<{ id: string }>('SELECT id FROM agents WHERE key = $1', [body.agent])
        ).rows[0];
        if (!agent) throw new HttpError(404, 'not_found', 'Agent ' + body.agent + ' not found');
        // a run the same machine left open (the editor closed or crashed) ends here
        const stale = (
          await c.query<{ id: string }>(
            `UPDATE agent_runs SET status = 'failed', finished_at = now(),
                    error = 'No end was reported; a new run started on the same machine', summary = 'Ended without a result'
              WHERE source = 'local' AND status = 'running' AND requested_by = $1 AND client = $2
              RETURNING id`,
            [a.user.id, body.client],
          )
        ).rows;
        for (const x of stale)
          await localEvent(c, a, await visibleRun(c, a, x.id), 'failed', {
            status: { from: 'running', to: 'failed' },
          });
        // [PCODE-459 | S15 | v0.1.0] one planning session per project: not while someone else plans it
        if (body.agent === 'planner')
          await assertNotLocked(c, p.id, { userId: a.user.id, client: body.client });
        const id = (
          await c.query<{ id: string }>(
            `INSERT INTO agent_runs (workspace_id, project_id, agent_id, requested_by, instruction, model, status,
                                     started_at, source, client)
             VALUES ($1, $2, $3, $4, $5, $6, 'running', now(), 'local', $7) RETURNING id`,
            [
              a.workspaceId,
              p.id,
              agent.id,
              a.user.id,
              body.instruction.trim(),
              body.model ?? 'claude-code',
              body.client,
            ],
          )
        ).rows[0]?.id;
        if (!id) throw new Error('run insert returned nothing');
        const run = await visibleRun(c, a, id);
        await localEvent(c, a, run, 'started', { status: { from: null, to: 'running' } });
        return { status: 201, body: runJson(run) };
      }),
  });

  const step = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/agent-runs/:runId/steps',
    summary: 'Add what the AI did to a run opened from this machine (its owner)',
    tags: ['agents'],
    params: runParams,
    body: s.object({
      kind: s.enum(['note', 'tool_result', 'error']),
      text: s.string({ min: 1, max: 4000 }),
      tool: s.optional(s.string({ max: 60 })),
      path: s.optional(s.string({ max: 500 })),
    }),
    response: s.object({ seq: s.number({ integer: true }) }),
    status: 201,
    handler: async ({ params, body, req }) => {
      // no secret stays in a trace: an Orqiva token is revoked, every secret is replaced by its kind
      await revokeLeaks(pool, params.workspaceId, [body.text, body.path ?? ''], {
        foundIn: 'trace',
        location: 'a run from VS Code (' + params.runId.slice(0, 8) + ')',
      });
      return asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const r = await ownRun(c, a, params.runId);
        if (r.status !== 'running') throw new HttpError(409, 'conflict', 'The run has ended');
        const found = new Set<string>();
        const raw =
          body.kind === 'error'
            ? { message: body.text }
            : {
                text: body.text,
                ...(body.tool ? { tool: body.tool } : {}),
                ...(body.path ? { path: body.path } : {}),
              };
        const content = redactValue(raw, found) as Record<string, unknown>;
        if (found.size) content['redacted'] = [...found];
        const seq =
          (
            await c.query<{ n: number }>(
              'SELECT coalesce(max(seq), 0) + 1 AS n FROM agent_steps WHERE run_id = $1',
              [r.id],
            )
          ).rows[0]?.n ?? 1;
        await c.query(
          'INSERT INTO agent_steps (workspace_id, run_id, seq, kind, content) VALUES ($1, $2, $3, $4, $5)',
          [a.workspaceId, r.id, seq, body.kind === 'tool_result' ? 'note' : body.kind, content],
        );
        await localEvent(c, a, r, 'progressed', {
          step: { from: null, to: { seq, kind: body.kind } },
        });
        return { status: 201, body: { seq } };
      });
    },
  });

  const end = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/agent-runs/:runId/finish',
    summary: 'End a run opened from this machine, with its result (its owner)',
    tags: ['agents'],
    params: runParams,
    body: s.object({
      status: s.enum(['succeeded', 'failed', 'cancelled']),
      summary: s.optional(s.string({ max: 500 })),
      error: s.optional(s.string({ max: 2000 })),
      // [PCODE-466 | S15 | v0.1.0] what the AI used, when the tool reports it
      usage: s.optional(
        s.object({
          model: s.string({ min: 1, max: 120 }),
          tokensIn: s.number({ integer: true, min: 0, max: 1e12 }),
          tokensOut: s.number({ integer: true, min: 0, max: 1e12 }),
          cacheRead: s.number({ integer: true, min: 0, max: 1e12 }),
          cacheWrite: s.number({ integer: true, min: 0, max: 1e12 }),
          costUsd: s.optional(s.number({ min: 0, max: 1e6 })),
        }),
      ),
    }),
    response: runOut,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const r = await ownRun(c, a, params.runId);
        if (body.usage && r.status === 'running')
          await addRunUsage(c, a.workspaceId, r.id, body.usage); // [PCODE-466 | S15 | v0.1.0]
        const done = await c.query(
          `UPDATE agent_runs SET status = $2, finished_at = now(), summary = $3, error = $4
            WHERE id = $1 AND status = 'running'`,
          [r.id, body.status, body.summary ?? '', body.error ?? ''],
        );
        if (done.rowCount)
          await localEvent(
            c,
            a,
            r,
            body.status === 'succeeded'
              ? 'completed'
              : body.status === 'failed'
                ? 'failed'
                : 'updated',
            { status: { from: 'running', to: body.status } },
          );
        return { body: runJson(await visibleRun(c, a, r.id)) };
      }),
  });

  return [open, step, end];
}
