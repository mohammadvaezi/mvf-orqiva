// ── [PCODE-436 | S15 | v0.1.0] T37 low: Untangle the three folder import cycles ──
// ── [PCODE-327 | S15 | v0.1.0] T33.1a Cache and reasoning tokens priced, the daily ECB rate, spend in euro by day ──
// ── [PCODE-240 | S15 | v0.1.0] T24.1 AI provider connections: Anthropic, OpenAI, Azure, Gemini, Bedrock, Grok, fallbacks, prices ──
// ── [PCODE-181 | S15 | v0.1.0] B5.2 Tokens and costs live: AI spend, budgets, prices, provider keys per project, access tokens with scopes, policy, leak revocation ──
// ── [PCODE-180 | S15 | v0.1.0] B5.1 Agents live: settings, versioned prompts, action rules, autonomy, pause all, budgets in euro, traces, costs, quality ──
//    Why:  providers bill in US dollars, the workspace thinks in euro: one place reads the daily rate (the
//          latest stored, or the default when none is stored yet) and says where it comes from.
import type { PoolClient } from 'pg';
import type { Prices } from '@orqiva/shared'; // [PCODE-327 | S15 | v0.1.0]

// [PCODE-436 | S15 | v0.1.0] the rate when no daily one is stored (lived in api/shell; lib depends on nothing above it)
export const FALLBACK_USD_EUR = 0.92;

export interface Rate {
  usdEur: number;
  day: string | null;
  source: string;
}

/** The latest stored rate up to today; fx_rates is readable in any transaction. */
export async function rateNow(c: PoolClient): Promise<Rate> {
  const fx = (
    await c.query<{ day: string; usd_eur: string; source: string }>(
      'SELECT day::text AS day, usd_eur, source FROM fx_rates WHERE day <= current_date ORDER BY day DESC LIMIT 1',
    )
  ).rows[0];
  return fx
    ? { usdEur: Number(fx.usd_eur), day: fx.day, source: fx.source }
    : { usdEur: FALLBACK_USD_EUR, day: null, source: 'default rate, no daily rate stored' };
}

export const usdEurNow = async (c: PoolClient): Promise<number> => (await rateNow(c)).usdEur;

// [PCODE-181 | S15 | v0.1.0] the price of a model: the workspace's table, the shipped table, then the provider setting
/** Millionths of a US dollar per million tokens, in and out. */
export async function priceOf(
  c: PoolClient,
  workspaceId: string,
  provider: string,
  model: string,
): Promise<Prices & { minute: number }> {
  for (const table of ['workspace_model_prices', 'model_prices']) {
    const p = (
      await c.query<{ i: string; o: string; m: string; cr: string; cw: string }>(
        `SELECT input_usd_micros AS i, output_usd_micros AS o, audio_minute_usd_micros AS m,
                cache_read_usd_micros AS cr, cache_write_usd_micros AS cw FROM ${table}
          WHERE provider = $1 AND model = $2 AND effective_from <= current_date ORDER BY effective_from DESC LIMIT 1`,
        [provider, model],
      )
    ).rows[0];
    // [PCODE-240 | S15 | v0.1.0] and per minute of audio, for transcripts
    if (p)
      return {
        in: Number(p.i),
        out: Number(p.o),
        minute: Number(p.m),
        // [PCODE-327 | S15 | v0.1.0] the cache prices; 0 means the usual share of the input price
        cacheRead: Number(p.cr),
        cacheWrite: Number(p.cw),
      };
  }
  const s = (
    await c.query<{ i: string; o: string }>(
      'SELECT input_price_micros AS i, output_price_micros AS o FROM agent_provider_settings WHERE workspace_id = $1',
      [workspaceId],
    )
  ).rows[0];
  return { in: Number(s?.i ?? 0), out: Number(s?.o ?? 0), minute: 0 };
}
