// ── [PCODE-363 | S15 | v0.1.0] T35.7e Rate limits shared across cluster nodes ──
//    Why:  two limiters on one database stand for two nodes of a cluster: attempts on one count on the
//          other, a success resets both, scopes stay apart, and no key is stored in the clear.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SharedRateLimiter } from '../../src/auth/ratelimit.js';
import { inSystem } from '../../src/db/pool.js';
import { startTestApp, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

describe.skipIf(!hasDatabase)('rate limits shared by the nodes (PostgreSQL)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await startTestApp();
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('counts attempts on every node, resets them together, and keeps scopes apart', async () => {
    const nodeA = new SharedRateLimiter(t.db.pool, 'sign-in', 3, 15 * 60_000);
    const nodeB = new SharedRateLimiter(t.db.pool, 'sign-in', 3, 15 * 60_000);
    const other = new SharedRateLimiter(t.db.pool, 'pairing', 3, 15 * 60_000);
    const key = 'email:ada@example.test';
    await nodeA.fail(key);
    await nodeB.fail(key);
    expect(await nodeA.allowed(key)).toBe(true);
    await nodeA.fail(key);
    expect(await nodeB.allowed(key)).toBe(false);
    expect(await other.allowed(key)).toBe(true);
    await nodeB.reset(key);
    expect(await nodeA.allowed(key)).toBe(true);
    const stored = await inSystem(t.db.pool, async (c) =>
      (await c.query<{ key_hash: string }>('SELECT key_hash FROM rate_hits')).rows.map(
        (r) => r.key_hash,
      ),
    );
    expect(stored.every((h) => /^[0-9a-f]{64}$/.test(h))).toBe(true);
  });

  it('forgets attempts older than the window', async () => {
    const short = new SharedRateLimiter(t.db.pool, 'short', 1, 1000);
    await short.fail('k');
    expect(await short.allowed('k')).toBe(false);
    await inSystem(t.db.pool, (c) =>
      c.query("UPDATE rate_hits SET at = now() - interval '2 seconds' WHERE scope = 'short'"),
    );
    expect(await short.allowed('k')).toBe(true);
  });
});
