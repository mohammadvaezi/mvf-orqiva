// ── [PCODE-353 | S15 | v0.1.0] T35.4a System health page with backup, restore and upgrade wizards ──
//    Why:  one report for the owner of a self-hosted server: version and uptime, the database, the queues
//          that can get stuck (mail, webhooks, bridges, agent runs, deploys), the deploy runners, the AI
//          connections today, and the backups `orq backup` wrote into the folder `orq install` mounts.
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import {
  backupsOf,
  healthProblems,
  localDay,
  PLATFORM_VERSION,
  type HealthReport,
} from '@orqiva/shared';
import type { Pool } from 'pg';
import { inSystem } from '../db/pool.js';
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s } from '../http/schema.js';
import { asMember } from './access.js';

const uuid = s.string({ format: 'uuid' });
const STARTED = new Date();

/** The backups in a folder, or null when the server has none mounted. */
export async function backupFolder(dir: string | undefined): Promise<HealthReport['backups']> {
  if (!dir) return null;
  try {
    const names = await readdir(dir);
    const files = await Promise.all(
      names.map(async (name) => {
        const st = await stat(join(dir, name));
        return { name, bytes: st.size, at: st.mtime.toISOString(), dir: st.isDirectory() };
      }),
    );
    return backupsOf(files);
  } catch {
    return null;
  }
}

export function systemRoutes(pool: Pool, deps: { backupDir?: string } = {}): Route[] {
  const health = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/system/health',
    summary:
      'The server’s health: version, database, queues, runners, AI connections and backups (owner)',
    tags: ['system'],
    params: s.object({ workspaceId: uuid }),
    response: s.anyObject(),
    handler: async ({ params, req }) => {
      // the workspace's own parts, as its member
      const own = await asMember(pool, req, params.workspaceId, 'admin', async (c, a) => {
        if (a.role !== 'owner')
          throw new HttpError(403, 'forbidden', 'System health is for the owner');
        const n = async (sql: string): Promise<number> =>
          Number((await c.query<{ n: string }>(sql)).rows[0]?.n ?? 0);
        return {
          webhooksFailing: await n(
            'SELECT count(*) AS n FROM webhooks WHERE active AND failures > 0',
          ),
          bridgesFailing: await n(
            "SELECT count(*) AS n FROM chat_bridges WHERE last_error <> '' OR NOT active",
          ),
          runsQueued: await n("SELECT count(*) AS n FROM agent_runs WHERE status = 'queued'"),
          runsWaiting: await n("SELECT count(*) AS n FROM agent_runs WHERE status = 'waiting'"),
          deploysQueued: await n("SELECT count(*) AS n FROM deploy_runs WHERE status = 'queued'"),
          runners: (
            await c.query<{ name: string; last_seen_at: Date | null }>(
              'SELECT name, last_seen_at FROM runners ORDER BY name',
            )
          ).rows.map((r) => ({ name: r.name, lastSeenAt: r.last_seen_at?.toISOString() ?? null })),
          ai: (
            await c.query<{ name: string; calls: string; failures: string }>(
              `SELECT k.label AS name, coalesce(h.calls, 0) AS calls, coalesce(h.failures, 0) AS failures
                 FROM ai_connections k LEFT JOIN ai_connection_health h ON h.connection_id = k.id AND h.day = $1
                ORDER BY k.label`,
              [localDay(new Date())],
            )
          ).rows,
        };
      });
      // the server's parts, outside any workspace
      const server = await inSystem(pool, async (c) => {
        const n = async (sql: string): Promise<number> =>
          Number((await c.query<{ n: string }>(sql)).rows[0]?.n ?? 0);
        return {
          bytes: await n('SELECT pg_database_size(current_database()) AS n'),
          migration:
            (
              await c.query<{ m: string }>(
                "SELECT version::text || ' ' || name AS m FROM schema_migrations WHERE version = (SELECT max(version) FROM schema_migrations)",
              )
            ).rows[0]?.m ?? '',
          mailPending: await n("SELECT count(*) AS n FROM mail_outbox WHERE status = 'pending'"),
          mailStuck: await n(
            "SELECT count(*) AS n FROM mail_outbox WHERE status = 'pending' AND created_at < now() - interval '15 minutes'",
          ),
          mailFailed: await n(
            "SELECT count(*) AS n FROM mail_outbox WHERE status = 'failed' AND created_at > now() - interval '1 day'",
          ),
        };
      });
      const report: HealthReport = {
        version: PLATFORM_VERSION,
        startedAt: STARTED.toISOString(),
        database: { bytes: server.bytes, migration: server.migration },
        queues: {
          mailPending: server.mailPending,
          mailStuck: server.mailStuck,
          mailFailed: server.mailFailed,
          webhooksFailing: own.webhooksFailing,
          bridgesFailing: own.bridgesFailing,
          runsQueued: own.runsQueued,
          runsWaiting: own.runsWaiting,
          deploysQueued: own.deploysQueued,
        },
        runners: own.runners,
        ai: own.ai.map((x) => ({ ...x, calls: Number(x.calls), failures: Number(x.failures) })),
        backups: await backupFolder(deps.backupDir),
      };
      return { body: { ...report, problems: healthProblems(report, new Date()) } };
    },
  });
  return [health];
}
