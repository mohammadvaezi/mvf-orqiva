// ── [PCODE-363 | S15 | v0.1.0] T35.7e Rate limits shared across cluster nodes ──
// ── [PCODE-88 | S15 | v0.1.0] Implement authentication: email and password, sessions, OIDC login ──
//    Why:  slows password guessing: at most `max` failed attempts per key in a sliding window. In memory, per
//          server instance; [PCODE-363 | S15 | v0.1.0] SharedRateLimiter keeps the security limits in
//          PostgreSQL, so all nodes of a cluster count the same attempts.
import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import { inSystem } from '../db/pool.js';

// [PCODE-363 | S15 | v0.1.0] what a limit offers, kept in memory or shared
export interface Limiter {
  allowed(key: string): boolean | Promise<boolean>;
  fail(key: string): void | Promise<void>;
  reset(key: string): void | Promise<void>;
}

export class RateLimiter implements Limiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** True while `key` is under its limit. */
  allowed(key: string): boolean {
    return this.recent(key).length < this.max;
  }

  /** Counts a failure against `key`. */
  fail(key: string): void {
    const list = this.recent(key);
    list.push(this.now());
    this.hits.set(key, list);
  }

  reset(key: string): void {
    this.hits.delete(key);
  }

  private recent(key: string): number[] {
    const since = this.now() - this.windowMs;
    const list = (this.hits.get(key) ?? []).filter((t) => t > since);
    if (list.length) this.hits.set(key, list);
    else this.hits.delete(key);
    return list;
  }
}

// [PCODE-363 | S15 | v0.1.0]
const hash = (key: string): string => createHash('sha256').update(key).digest('hex');

/** The same sliding window, counted in PostgreSQL for every node of a cluster. */
export class SharedRateLimiter implements Limiter {
  private sweeps = 0;

  constructor(
    private readonly pool: Pool,
    private readonly scope: string,
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  async allowed(key: string): Promise<boolean> {
    const n = await inSystem(this.pool, async (c) =>
      Number(
        (
          await c.query<{ n: string }>(
            `SELECT count(*) AS n FROM rate_hits
              WHERE scope = $1 AND key_hash = $2 AND at > now() - make_interval(secs => $3)`,
            [this.scope, hash(key), this.windowMs / 1000],
          )
        ).rows[0]?.n ?? 0,
      ),
    );
    return n < this.max;
  }

  async fail(key: string): Promise<void> {
    // now and then, rows older than a day go
    const sweep = this.sweeps++ % 100 === 0;
    await inSystem(this.pool, async (c) => {
      await c.query('INSERT INTO rate_hits (scope, key_hash) VALUES ($1, $2)', [
        this.scope,
        hash(key),
      ]);
      if (sweep) await c.query("DELETE FROM rate_hits WHERE at < now() - interval '1 day'");
    });
  }

  async reset(key: string): Promise<void> {
    await inSystem(this.pool, (c) =>
      c.query('DELETE FROM rate_hits WHERE scope = $1 AND key_hash = $2', [this.scope, hash(key)]),
    );
  }
}
