// ── [PCODE-459 | S15 | v0.1.0] Planning in VS Code locks the project in the portal: banner on every tab, conflicting AI planning refused both ways ──
//    Why:  a project is planned in one place at a time. While a run of the Planner agent is open for it -
//          Claude Code planning in VS Code (a local run) or the Planner on the server - and has done
//          something in the last two hours, the project is locked for planning: the portal shows who plans
//          where on every project tab, and the Planner draft, new runs of the planning agents and a second
//          planning session in VS Code are refused with that same sentence. A run that went quiet for two
//          hours (an editor that crashed) no longer locks anything.
import type { Pool, PoolClient } from 'pg';
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s } from '../http/schema.js';
import { asMember, requireProject } from './access.js';

/** The agents whose work changes the plan; they wait while the project is planned elsewhere. */
export const PLANNING_AGENTS = ['planner', 'architect', 'documenter', 'analyst'] as const;

export interface PlanningLock {
  runId: string;
  source: 'local' | 'server';
  /** the computer, for a run from VS Code */
  computer: string;
  by: string;
  byId: string;
  /** the VS Code client id that holds it (computer and folder) */
  client: string;
  startedAt: string;
  lastAt: string;
  /** what the AI did last, for the banner */
  lastStep: string | null;
}

interface LockRow {
  id: string;
  source: 'local' | 'server';
  client: string;
  requested_by: string;
  by_name: string | null;
  started_at: Date | null;
  created_at: Date;
  last_at: Date;
  last_content: Record<string, unknown> | null;
}

/** "PC-ZARVANDEH" from "PC-ZARVANDEH:C:\\Development phase\\MarketSpider" */
export const computerOf = (client: string): string => client.split(':')[0] ?? client;

// ── [PCODE-459 | S15 | v0.1.0] planningLock: the open Planner run of the project, if it is alive ──
export async function planningLock(c: PoolClient, projectId: string): Promise<PlanningLock | null> {
  const r = (
    await c.query<LockRow>(
      `SELECT r.id, r.source, r.client, r.requested_by, u.name AS by_name, r.started_at, r.created_at,
              greatest(coalesce(r.started_at, r.created_at), coalesce(st.at, r.created_at)) AS last_at,
              st.content AS last_content
         FROM agent_runs r
         JOIN agents a ON a.id = r.agent_id
         LEFT JOIN users u ON u.id = r.requested_by
         LEFT JOIN LATERAL (SELECT at, content FROM agent_steps WHERE run_id = r.id ORDER BY seq DESC LIMIT 1) st ON true
        WHERE r.project_id = $1 AND a.key = 'planner' AND r.status IN ('queued', 'running', 'waiting')
          AND greatest(coalesce(r.started_at, r.created_at), coalesce(st.at, r.created_at)) > now() - interval '2 hours'
        ORDER BY r.created_at DESC
        LIMIT 1`,
      [projectId],
    )
  ).rows[0];
  if (!r) return null;
  const text = r.last_content?.['text'] ?? r.last_content?.['message'];
  return {
    runId: r.id,
    source: r.source,
    computer: r.source === 'local' ? computerOf(r.client) : '',
    by: r.by_name ?? 'someone',
    byId: r.requested_by,
    client: r.client,
    startedAt: (r.started_at ?? r.created_at).toISOString(),
    lastAt: r.last_at.toISOString(),
    lastStep: typeof text === 'string' ? text.slice(0, 300) : null,
  };
}

/** The sentence the portal, the API and VS Code show for a lock. */
export function lockMessage(l: PlanningLock): string {
  const since = l.startedAt.slice(11, 16) + ' UTC';
  return l.source === 'local'
    ? `Claude is planning this project in VS Code on ${l.computer} (${l.by}, since ${since}). Wait until it is done, or stop it there.`
    : `The Planner agent is planning this project in Orqiva (started by ${l.by} at ${since}). Wait until its run is done, or stop it on the run's page.`;
}

/** Refuses planning work while someone else plans the project; `holder` is the one allowed to go on. */
export async function assertNotLocked(
  c: PoolClient,
  projectId: string,
  holder?: { userId: string; client: string },
): Promise<void> {
  const l = await planningLock(c, projectId);
  if (!l) return;
  if (holder && l.source === 'local' && l.byId === holder.userId && l.client === holder.client)
    return;
  throw new HttpError(409, 'conflict', lockMessage(l));
}

const uuid = s.string({ format: 'uuid' });

export function planningLockRoutes(pool: Pool): Route[] {
  const get = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/projects/:projectId/planning-lock',
    summary: 'Who is planning the project right now, and where (member)',
    tags: ['agents'],
    params: s.object({ workspaceId: uuid, projectId: uuid }),
    response: s.object({
      lock: s.nullable(
        s.object({
          runId: uuid,
          source: s.enum(['local', 'server']),
          computer: s.string(),
          by: s.string(),
          startedAt: s.string(),
          lastAt: s.string(),
          lastStep: s.nullable(s.string()),
          message: s.string(),
        }),
      ),
    }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        const p = await requireProject(c, a, params.projectId);
        const l = await planningLock(c, p.id);
        return {
          body: {
            lock: l
              ? {
                  runId: l.runId,
                  source: l.source,
                  computer: l.computer,
                  by: l.by,
                  startedAt: l.startedAt,
                  lastAt: l.lastAt,
                  lastStep: l.lastStep,
                  message: lockMessage(l),
                }
              : null,
          },
        };
      }),
  });
  return [get];
}
