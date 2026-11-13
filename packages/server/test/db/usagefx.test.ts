// ── [PCODE-327 | S15 | v0.1.0] T33.1a Cache and reasoning tokens priced, the daily ECB rate, spend in euro by day ──
//    Why:  against the real database: a model call's cache and reasoning tokens land on its step and its
//          run and the cache is priced; a run keeps the rate of its day; the ECB's daily file (recorded)
//          becomes a stored rate; and the AI spend turns each day's dollars into euro at that day's rate.
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { scriptedProvider, type ModelReply } from '../../src/agents/provider.js';
import { inSystem } from '../../src/db/pool.js';
import { fxDueAfter, refreshFx } from '../../src/lib/fx.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

process.env['ORQIVA_SECRET_KEY'] = 'ab'.repeat(32);

const ECB = readFileSync(new URL('../fixtures/fx/ecb-daily.xml', import.meta.url), 'utf8');

describe('when the daily rate is due', () => {
  const at = (iso: string) => new Date(iso);
  it('asks after the publication on a working day, once', () => {
    expect(fxDueAfter('2026-10-14', at('2026-10-15T10:00:00Z'))).toBe(false);
    expect(fxDueAfter('2026-10-14', at('2026-10-15T16:30:00Z'))).toBe(true);
    expect(fxDueAfter('2026-10-15', at('2026-10-15T18:00:00Z'))).toBe(false);
    // Saturday: Friday's rate stands
    expect(fxDueAfter('2026-10-16', at('2026-10-17T18:00:00Z'))).toBe(false);
  });
  it('asks at once when nothing recent is stored', () => {
    expect(fxDueAfter(null, at('2026-10-17T08:00:00Z'))).toBe(true);
    expect(fxDueAfter('2026-10-01', at('2026-10-17T08:00:00Z'))).toBe(true);
  });
});

describe.skipIf(!hasDatabase)('usage and the daily rate (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let project = '';
  let item = '';
  let analyst = '';
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  const reply: ModelReply = {
    content: [{ type: 'text', text: 'Done.' }],
    stopReason: 'end_turn',
    usage: { input: 100_000, output: 0, cacheRead: 1_000_000, cacheWrite: 100_000, reasoning: 0 },
  };

  beforeAll(async () => {
    t = await startTestApp({
      agents: { provider: () => Promise.resolve(scriptedProvider([reply])) },
    });
    ada = await t.signup('Ada');
    project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'FXU', name: 'Usage' })
    ).body.id;
    item = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects/' + project + '/items'), {
        title: 'Count the cache',
      })
    ).body.id;
    analyst =
      (await t.call<{ id: string; key: string }[]>(ada, 'GET', W('/agents'))).body.find(
        (a) => a.key === 'analyst',
      )?.id ?? '';
    // $2000 per million input tokens (a round test price); no cache prices, so the usual shares apply
    await t.call(ada, 'PUT', W('/agents/provider'), {
      provider: 'demo',
      inputPricePerMillion: 2000,
      outputPricePerMillion: 0,
    });
  }, 60_000);

  afterAll(async () => {
    await inSystem(t.db.pool, (c) => c.query("DELETE FROM fx_rates WHERE day = '2001-02-02'"));
    await t.stop();
  });

  it('keeps the cache and reasoning tokens on the step and the run, and prices the cache', async () => {
    const r = await t.call<{ id: string }>(ada, 'POST', W('/projects/' + project + '/agent-runs'), {
      agentId: analyst,
      instruction: 'Work on it',
      itemId: item,
    });
    expect(r.status).toBe(201);
    const end = Date.now() + 10_000;
    let status = '';
    while (Date.now() < end) {
      status = (
        await t.call<{ run: { status: string } }>(ada, 'GET', W('/agent-runs/' + r.body.id))
      ).body.run.status;
      if (status === 'succeeded' || status === 'failed') break;
      await new Promise((res) => setTimeout(res, 50));
    }
    expect(status).toBe('succeeded');
    const row = await inSystem(t.db.pool, async (c) => {
      const run = (
        await c.query<{
          tokens_in: string;
          tokens_cache_read: string;
          tokens_cache_write: string;
          cost_micros: string;
          usd_eur: number | null;
          today: string | null;
        }>(
          `SELECT tokens_in, tokens_cache_read, tokens_cache_write, cost_micros, usd_eur,
                  (SELECT usd_eur::real FROM fx_rates WHERE day <= current_date ORDER BY day DESC LIMIT 1) AS today
             FROM agent_runs WHERE id = $1`,
          [r.body.id],
        )
      ).rows[0];
      const step = (
        await c.query<{
          tokens_cache_read: string;
          tokens_cache_write: string;
          cost_micros: string;
        }>(
          "SELECT tokens_cache_read, tokens_cache_write, cost_micros FROM agent_steps WHERE run_id = $1 AND kind = 'model'",
          [r.body.id],
        )
      ).rows[0];
      return { run, step };
    });
    // 100k fresh at $2000/M = $200; 1M read at 10% = $200; 100k written at 125% = $250
    expect(Number(row.step?.cost_micros)).toBe(650_000_000);
    expect(Number(row.step?.tokens_cache_read)).toBe(1_000_000);
    expect(Number(row.run?.tokens_cache_read)).toBe(1_000_000);
    expect(Number(row.run?.tokens_cache_write)).toBe(100_000);
    expect(Number(row.run?.tokens_in)).toBe(100_000);
    expect(Number(row.run?.cost_micros)).toBe(650_000_000);
    // the run took the rate of its day
    expect(row.run?.usd_eur ?? null).toBe(row.run?.today ?? null);

    const costs = await t.call<{ cacheShare: number | null }>(ada, 'GET', W('/agent-costs'));
    expect(costs.body.cacheShare).toBeCloseTo(1_000_000 / 1_100_000, 2);
  });

  it('stores the ECB rate of the file’s day and says when the ECB fails', async () => {
    const asked: string[] = [];
    const rate = await refreshFx(t.db.pool, {
      url: 'https://ecb.test/daily.xml',
      fetch: (input) => {
        asked.push(
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
        );
        return Promise.resolve(new Response(ECB, { status: 200 }));
      },
    });
    expect(rate).toEqual({ day: '2001-02-02', usdEur: 0.925926 });
    expect(asked).toEqual(['https://ecb.test/daily.xml']);
    const stored = await inSystem(
      t.db.pool,
      async (c) =>
        (
          await c.query<{ usd_eur: string; source: string }>(
            "SELECT usd_eur, source FROM fx_rates WHERE day = '2001-02-02'",
          )
        ).rows[0],
    );
    expect(Number(stored?.usd_eur)).toBeCloseTo(0.925926, 6);
    expect(stored?.source).toBe('ECB');
    await expect(
      refreshFx(t.db.pool, {
        url: 'https://ecb.test/daily.xml',
        fetch: () => Promise.resolve(new Response('busy', { status: 503 })),
      }),
    ).rejects.toThrow('the ECB answered 503');
  });

  it('turns each day’s dollars into euro at that day’s rate', async () => {
    // two runs of a dollar each, three days ago at 0.5 and two days ago at 0.8
    await inSystem(t.db.pool, async (c) => {
      for (const [ago, rate] of [
        [3, 0.5],
        [2, 0.8],
      ] as const)
        await c.query(
          `INSERT INTO agent_runs (workspace_id, project_id, agent_id, requested_by, instruction, status, model,
                                   cost_micros, usd_eur, created_at)
           VALUES ($1, $2, $3, $4, 'old', 'succeeded', 'demo', 1000000, $5, current_date - $6::int + interval '12 hours')`,
          [ada.workspaceId, project, analyst, ada.id, rate, ago],
        );
    });
    const spend = await t.call<{ days: { day: string; cents: number }[] }>(
      ada,
      'GET',
      W('/ai-spend?days=7'),
    );
    const last = spend.body.days.slice(-4).map((d) => d.cents);
    expect(last.slice(0, 2)).toEqual([50, 80]);
  });
});
