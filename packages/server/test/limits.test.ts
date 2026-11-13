// ── [PCODE-332 | S15 | v0.1.0] T33.4a Nested traces with latency and commits, agent rate limits, provider limits and health ──
//    Why:  a connection's calls and tokens a minute: a call waits exactly until the oldest one in its way
//          leaves the minute, and without limits nothing waits.
import { describe, expect, it } from 'vitest';
import { Limiter } from '../src/agents/limits.js';

const clock = () => {
  let t = 1_000_000;
  const slept: number[] = [];
  return {
    now: () => t,
    sleep: (ms: number) => {
      slept.push(ms);
      t += ms;
      return Promise.resolve();
    },
    tick: (ms: number) => {
      t += ms;
    },
    slept,
  };
};

describe('connection limits', () => {
  it('lets calls through without limits', async () => {
    const c = clock();
    const l = new Limiter(c.now, c.sleep);
    for (let i = 0; i < 50; i++)
      await l.take('a', { requestsPerMinute: null, tokensPerMinute: null }, 10_000);
    expect(c.slept).toEqual([]);
  });

  it('holds a call until the oldest of the minute has left', async () => {
    const c = clock();
    const l = new Limiter(c.now, c.sleep);
    const lim = { requestsPerMinute: 2, tokensPerMinute: null };
    await l.take('a', lim);
    c.tick(10_000);
    await l.take('a', lim);
    c.tick(5_000);
    expect(l.waitFor('a', lim)).toBe(45_000);
    // another connection has its own count
    expect(l.waitFor('b', lim)).toBe(0);
    const { waited } = await l.take('a', lim);
    expect(waited).toBe(45_005);
  });

  it('counts tokens, set after the call', async () => {
    const c = clock();
    const l = new Limiter(c.now, c.sleep);
    const lim = { requestsPerMinute: null, tokensPerMinute: 1000 };
    const first = await l.take('a', lim, 100);
    first.call.tokens = 900;
    c.tick(20_000);
    expect(l.waitFor('a', lim, 50)).toBe(0);
    expect(l.waitFor('a', lim, 200)).toBe(40_000);
  });
});
