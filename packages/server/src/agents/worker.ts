// ── [PCODE-332 | S15 | v0.1.0] T33.4a Nested traces with latency and commits, agent rate limits, provider limits and health ──
// ── [PCODE-329 | S15 | v0.1.0] T33.2 Agent playground: rerun with other settings, compare runs, A/B experiments ──
// ── [PCODE-246 | S15 | v0.1.0] T25.1 Agent triggers act: assignment, label, mention, CI failure, schedule, webhook ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-180 | S15 | v0.1.0] B5.1 Agents live: settings, versioned prompts, action rules, autonomy, pause all, budgets in euro, traces, costs, quality ──
// ── [PCODE-120 | S15 | v0.1.0] Build the agent runtime: agents, queued runs, model providers, tools with approvals, budgets, streamed steps ──
//    Why:  our own job queue for agent runs, on PostgreSQL alone: a queued run is claimed with
//          FOR UPDATE SKIP LOCKED, so several servers never take the same one; a NOTIFY wakes the worker at
//          once and a slow poll catches anything a lost notification missed. Runs that were "running" when
//          a server stopped are put back in the queue at start.
import type { Pool, PoolClient } from 'pg';
import { inSystem } from '../db/pool.js';
import { advanceRun, configuredProvider, type ProviderFor } from './runner.js';
import { triggerRound } from './triggers.js'; // [PCODE-246 | S15 | v0.1.0]

export const AGENT_CHANNEL = 'orqiva_agents';

export interface AgentWorkerOptions {
  provider?: ProviderFor;
  pollMs?: number;
  /** how many runs advance at the same time */
  concurrency?: number;
  /** [PCODE-246 | S15 | v0.1.0] whether this worker starts runs from triggers (on by default) */
  triggers?: boolean;
  log?: (msg: string, data?: Record<string, unknown>) => void;
}

export class AgentWorker {
  private listener: PoolClient | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private active = 0;
  private stopped = true;
  private draining: Promise<void> | null = null;
  private matching = false; // [PCODE-246 | S15 | v0.1.0]

  constructor(
    private readonly pool: Pool,
    private readonly opts: AgentWorkerOptions = {},
  ) {}

  async start(): Promise<void> {
    this.stopped = false;
    await inSystem(this.pool, (c) =>
      // [PCODE-456 | S15 | v0.1.0] a run on a developer's machine is not the worker's to restart
      c.query(
        "UPDATE agent_runs SET status = 'queued' WHERE status = 'running' AND source = 'server'",
      ),
    );
    this.listener = await this.pool.connect();
    this.listener.on('notification', () => {
      this.kick();
    });
    await this.listener.query('LISTEN ' + AGENT_CHANNEL);
    this.timer = setInterval(() => {
      this.matchTriggers(); // [PCODE-246 | S15 | v0.1.0]
      this.kick();
    }, this.opts.pollMs ?? 3000);
    this.kick();
  }

  /** [PCODE-246 | S15 | v0.1.0] New events and due schedules start the agents whose triggers fit; one round at a time. */
  matchTriggers(): void {
    if (this.stopped || this.matching || this.opts.triggers === false) return;
    this.matching = true;
    triggerRound(this.pool, new Date(), this.opts.log)
      .catch((e: unknown) => {
        this.opts.log?.('agent triggers failed', {
          error: e instanceof Error ? e.message : String(e),
        });
      })
      .finally(() => {
        this.matching = false;
      });
  }

  /** Takes queued runs until the queue is empty or the worker is full. */
  kick(): void {
    if (this.stopped) return;
    while (this.active < (this.opts.concurrency ?? 4)) {
      this.active++;
      const one = this.claimAndRun().finally(() => {
        this.active--;
      });
      this.draining = one.then((ran) => {
        if (ran) this.kick();
      });
      // one claim at a time; the next starts when this one found work
      break;
    }
  }

  private async claimAndRun(): Promise<boolean> {
    const id = await inSystem(
      this.pool,
      async (c) =>
        (
          await c.query<{ id: string }>(
            `UPDATE agent_runs SET status = 'running', started_at = coalesce(started_at, now())
           WHERE id = (
             -- [PCODE-180 | S15 | v0.1.0] not while all agents are paused, the agent is off or at its concurrency
             SELECT r.id FROM agent_runs r JOIN agents a ON a.id = r.agent_id
               LEFT JOIN agent_provider_settings s ON s.workspace_id = r.workspace_id
              -- [PCODE-329 | S15 | v0.1.0] an agent still switched off can be tried in the playground
              WHERE r.status = 'queued' AND r.source = 'server' AND (a.enabled OR r.playground) AND s.paused_at IS NULL
                AND (SELECT count(*) FROM agent_runs x WHERE x.agent_id = r.agent_id AND x.status = 'running' AND x.source = 'server') < a.concurrency
                -- [PCODE-332 | S15 | v0.1.0] and not over its runs an hour
                AND (a.runs_per_hour IS NULL OR (SELECT count(*) FROM agent_runs h WHERE h.agent_id = r.agent_id
                       AND h.started_at > now() - interval '1 hour') < a.runs_per_hour)
              ORDER BY r.created_at FOR UPDATE OF r SKIP LOCKED LIMIT 1)
           RETURNING id`,
          )
        ).rows[0]?.id,
    ).catch((e: unknown) => {
      this.opts.log?.('agent worker claim failed', {
        error: e instanceof Error ? e.message : String(e),
      });
      return undefined;
    });
    if (!id) return false;
    await advanceRun(this.pool, id, this.opts.provider ?? configuredProvider).catch(
      (e: unknown) => {
        this.opts.log?.('agent run crashed', {
          run: id,
          error: e instanceof Error ? e.stack : String(e),
        });
      },
    );
    return true;
  }

  /** Waits until nothing is running (tests). */
  async idle(): Promise<void> {
    while (this.active > 0 || this.draining) {
      const d = this.draining;
      this.draining = null;
      await d;
      await new Promise((r) => setTimeout(r, 5));
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    await this.idle();
    if (this.listener) {
      await this.listener.query('UNLISTEN ' + AGENT_CHANNEL).catch(() => undefined);
      this.listener.release();
      this.listener = null;
    }
  }
}
