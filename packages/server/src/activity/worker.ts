// ── [PCODE-413 | S15 | v0.1.0] T37 high: Activity facets answer under 1 s ──
// ── [PCODE-349 | S15 | v0.1.0] T35.2b Slack and Teams bridges, personal calendar feed, CI pipeline runs ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-191 | S15 | v0.1.0] B7.6 Client status page with uptime probes, own portal domains with DNS verification and on-demand TLS ──
// ── [PCODE-188 | S15 | v0.1.0] B7.4 Incidents and on-call live: alerts, incidents with timeline and roles, suspect deploys and rollback, status updates, rotations and escalation, postmortems, SLOs ──
// ── [PCODE-183 | S15 | v0.1.0] B6.1 Activity at scale live: search, query language, facets, histogram, saved views, export, archive, hash chain, webhooks ──
//    Why:  the background half of Activity at scale. Webhooks get the events they ask for in order, in
//          batches, signed with their secret (HMAC-SHA256), continuing from the last event delivered; a
//          failure waits longer each time and switches the webhook off after ten. Events older than a
//          workspace's retention move to the archive, hash and all, so the audit chain stays whole.
import { parseActivityQuery } from '@orqiva/shared';
import { createHmac, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { open } from '../agents/secrets.js';
import { isPublicUrl } from '../api/documents.js';
import { escalateDue } from '../api/incidents.js'; // [PCODE-188 | S15 | v0.1.0]
import { probeAll } from '../api/status.js'; // [PCODE-191 | S15 | v0.1.0]
import { inSystem } from '../db/pool.js';
import { bridgeRound } from '../integrations/bridges.js'; // [PCODE-349 | S15 | v0.1.0]
import { whereOf } from './query.js';

const BATCH = 100;
const MAX_FAILURES = 10;
const COLUMNS =
  'workspace_id, sequence, id, type, time, actor_kind, actor_id, object_type, object_id, envelope, parent_type, parent_id, hash';

export interface ActivityWorkerOptions {
  fetchImpl?: typeof fetch;
  pollMs?: number;
  /** tests deliver to their own server on localhost */
  allowPrivate?: boolean;
  log?: (msg: string, data?: Record<string, unknown>) => void;
  /** [PCODE-349 | S15 | v0.1.0] the links the bridges post */
  publicUrl?: string;
}

/** The signature header of a body: sha256=<hex HMAC>. */
export const signBody = (secret: string, body: string): string =>
  'sha256=' + createHmac('sha256', secret).update(body).digest('hex');

interface Hook {
  id: string;
  workspace_id: string;
  url: string;
  secret_ciphertext: string;
  event_types: string[];
  query: string;
  cursor: string;
  failures: number;
}

/** Moves events older than each workspace's retention to the archive; returns how many moved. */
export async function archiveOld(pool: Pool, workspaceId?: string): Promise<number> {
  return inSystem(pool, async (c) => {
    const moved = await c.query(
      `WITH old AS (
         DELETE FROM activity_events e USING workspaces w LEFT JOIN activity_settings s ON s.workspace_id = w.id
          WHERE e.workspace_id = w.id AND ($1::uuid IS NULL OR w.id = $1)
            AND e.time < now() - make_interval(days => coalesce(s.retention_days, 90))
          RETURNING e.workspace_id, e.sequence, e.id, e.type, e.time, e.actor_kind, e.actor_id, e.object_type, e.object_id, e.envelope, e.parent_type, e.parent_id, e.hash)
       , counts AS (
         -- [PCODE-413 | S15 | v0.1.0] the moved events' hourly counts go from live to archived
         SELECT workspace_id, date_trunc('hour', time) AS hour, type, actor_kind, object_type,
                coalesce(envelope->'data'->>'verb', '') AS verb, coalesce(envelope->>'projectid', '') AS project_id,
                count(*) AS n
           FROM old GROUP BY 1, 2, 3, 4, 5, 6, 7
       ), live AS (
         UPDATE activity_rollup r SET n = greatest(0, r.n - counts.n) FROM counts
          WHERE r.workspace_id = counts.workspace_id AND r.archived = false AND r.hour = counts.hour
            AND r.type = counts.type AND r.actor_kind = counts.actor_kind AND r.object_type = counts.object_type
            AND r.verb = counts.verb AND r.project_id = counts.project_id
       ), gone AS (
         INSERT INTO activity_rollup (workspace_id, hour, archived, type, actor_kind, object_type, verb, project_id, n)
         SELECT workspace_id, hour, true, type, actor_kind, object_type, verb, project_id, n FROM counts
         ON CONFLICT (workspace_id, archived, hour, type, actor_kind, object_type, verb, project_id)
           DO UPDATE SET n = activity_rollup.n + EXCLUDED.n
       )
       INSERT INTO activity_archive (${COLUMNS}) SELECT ${COLUMNS} FROM old`,
      [workspaceId ?? null],
    );
    return moved.rowCount ?? 0;
  });
}

/** Delivers one webhook's next batch; returns whether anything was sent. */
export async function deliverOne(
  pool: Pool,
  hook: Hook,
  opts: ActivityWorkerOptions = {},
): Promise<boolean> {
  const q = parseActivityQuery(hook.query);
  const where = whereOf(
    { ...q, sinceHours: null, archive: false },
    {
      workspaceId: hook.workspace_id,
      role: 'owner',
      userId: '00000000-0000-0000-0000-000000000000',
      mode: 'all',
    },
    3,
  );
  const events = await inSystem(
    pool,
    async (c) =>
      (
        await c.query<{ sequence: string; envelope: unknown }>(
          `SELECT e.sequence, e.envelope FROM activity_events e
          WHERE e.sequence > $1 AND (cardinality($2::text[]) = 0 OR e.object_type = ANY($2)) AND ${where.sql}
          ORDER BY e.sequence LIMIT ${String(BATCH)}`,
          [hook.cursor, hook.event_types, ...where.params],
        )
      ).rows,
  );
  if (!events.length) return false;
  const from = Number(events[0]?.sequence ?? 0);
  const to = Number(events.at(-1)?.sequence ?? 0);
  const body = JSON.stringify({
    webhook: hook.id,
    delivery: randomUUID(),
    events: events.map((e) => e.envelope),
  });
  const started = Date.now();
  let status = 0;
  let error = '';
  try {
    if (!opts.allowPrivate && !(await isPublicUrl(hook.url)))
      throw new Error('the address is not public');
    const res = await (opts.fetchImpl ?? fetch)(hook.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-orqiva-signature': signBody(open(hook.secret_ciphertext), body),
        'user-agent': 'Orqiva-Webhooks',
      },
      body,
      signal: AbortSignal.timeout(10_000),
      redirect: 'manual',
    });
    status = res.status;
    if (status < 200 || status >= 300) error = 'answered ' + String(status);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  await inSystem(pool, async (c) => {
    await c.query(
      'INSERT INTO webhook_deliveries (workspace_id, webhook_id, from_sequence, to_sequence, events, status, response_code, error, duration_ms) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
      [
        hook.workspace_id,
        hook.id,
        from,
        to,
        events.length,
        error ? 'failed' : 'delivered',
        status || null,
        error.slice(0, 500),
        Date.now() - started,
      ],
    );
    if (error)
      await c.query(
        `UPDATE webhooks SET failures = failures + 1, active = failures + 1 < $2,
                next_attempt_at = now() + make_interval(mins => least(60, power(2, failures)::int)) WHERE id = $1`,
        [hook.id, MAX_FAILURES],
      );
    else
      await c.query(
        'UPDATE webhooks SET cursor = $2, failures = 0, next_attempt_at = now() WHERE id = $1',
        [hook.id, to],
      );
  });
  return !error;
}

export class ActivityWorker {
  private timer: ReturnType<typeof setInterval> | null = null;
  private archiveTimer: ReturnType<typeof setInterval> | null = null;
  // [PCODE-188 | S15 | v0.1.0] unacknowledged incidents escalate
  private escalationTimer: ReturnType<typeof setInterval> | null = null;
  // [PCODE-191 | S15 | v0.1.0] status pages probe their components every minute
  private probeTimer: ReturnType<typeof setInterval> | null = null;
  private busy = false;

  constructor(
    private readonly pool: Pool,
    private readonly opts: ActivityWorkerOptions = {},
  ) {}

  start(): void {
    this.timer = setInterval(() => {
      void this.tick();
    }, this.opts.pollMs ?? 3000);
    this.archiveTimer = setInterval(() => {
      void archiveOld(this.pool).catch((e: unknown) => {
        this.opts.log?.('archiving failed', { error: e instanceof Error ? e.message : String(e) });
      });
    }, 3_600_000);
    this.escalationTimer = setInterval(() => {
      void escalateDue(this.pool).catch((e: unknown) => {
        this.opts.log?.('escalation failed', { error: e instanceof Error ? e.message : String(e) });
      });
    }, 30_000);
    this.probeTimer = setInterval(() => {
      void probeAll(this.pool).catch((e: unknown) => {
        this.opts.log?.('status probes failed', {
          error: e instanceof Error ? e.message : String(e),
        });
      });
    }, 60_000);
  }

  /** One round: every active webhook that is due sends its next batch. */
  async tick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const hooks = await inSystem(
        this.pool,
        async (c) =>
          (
            await c.query<Hook>(
              'SELECT id, workspace_id, url, secret_ciphertext, event_types, query, cursor, failures FROM webhooks WHERE active AND next_attempt_at <= now()',
            )
          ).rows,
      );
      for (const h of hooks)
        await deliverOne(this.pool, h, this.opts).catch((e: unknown) => {
          this.opts.log?.('webhook delivery crashed', {
            webhook: h.id,
            error: e instanceof Error ? e.message : String(e),
          });
        });
      // [PCODE-349 | S15 | v0.1.0] then the Slack and Teams bridges
      await bridgeRound(this.pool, {
        ...(this.opts.fetchImpl ? { fetchImpl: this.opts.fetchImpl } : {}),
        ...(this.opts.allowPrivate ? { allowPrivate: true } : {}),
        ...(this.opts.publicUrl ? { publicUrl: this.opts.publicUrl } : {}),
      }).catch((e: unknown) => {
        this.opts.log?.('bridge round failed', {
          error: e instanceof Error ? e.message : String(e),
        });
      });
    } finally {
      this.busy = false;
    }
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.archiveTimer) clearInterval(this.archiveTimer);
    if (this.escalationTimer) clearInterval(this.escalationTimer);
    if (this.probeTimer) clearInterval(this.probeTimer);
  }
}
