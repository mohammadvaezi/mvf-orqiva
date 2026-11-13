// ── [PCODE-327 | S15 | v0.1.0] T33.1a Cache and reasoning tokens priced, the daily ECB rate, spend in euro by day ──
//    Why:  euro figures need the day's rate. The ECB publishes its reference rates each working day around
//          16:00 CET as a public file; reading it sends nothing about the workspace. Once a day is enough,
//          a failed try waits an hour, and a day already stored is not asked for again.
import { parseEcbDaily } from '@orqiva/shared';
import type { Pool } from 'pg';
import { inSystem } from '../db/pool.js';

export interface FxDeps {
  fetch: typeof fetch;
  url: string;
}

export const DEFAULT_FX: FxDeps = {
  fetch: (input, init) => fetch(input, init),
  url: 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml',
};

/** The latest stored day, or null. */
async function lastDay(pool: Pool): Promise<string | null> {
  return inSystem(
    pool,
    async (c) =>
      (await c.query<{ d: string | null }>('SELECT max(day)::text AS d FROM fx_rates')).rows[0]
        ?.d ?? null,
  );
}

/**
 * Due when today's rate is missing on a working day after 16:00 UTC (the ECB's publication with room to
 * spare), or when no rate of the last four days is stored at all.
 */
export function fxDueAfter(last: string | null, now: Date): boolean {
  const today = now.toISOString().slice(0, 10);
  if (last === today) return false;
  if (!last || Date.parse(today) - Date.parse(last) > 4 * 86_400_000) return true;
  const wd = now.getUTCDay();
  return wd >= 1 && wd <= 5 && now.getUTCHours() >= 16;
}

export const fxDue = async (pool: Pool, now: Date): Promise<boolean> =>
  fxDueAfter(await lastDay(pool), now);

/** Reads the ECB's daily file and stores the US dollar rate of its day. */
export async function refreshFx(
  pool: Pool,
  deps: FxDeps,
): Promise<{ day: string; usdEur: number } | null> {
  const res = await deps.fetch(deps.url, {
    headers: { accept: 'application/xml', 'user-agent': 'Orqiva' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error('the ECB answered ' + String(res.status));
  const rate = parseEcbDaily(await res.text());
  if (!rate) throw new Error('the ECB file had no US dollar rate');
  await inSystem(pool, (c) =>
    c.query(
      `INSERT INTO fx_rates (day, usd_eur, source) VALUES ($1, $2, 'ECB')
       ON CONFLICT (day) DO UPDATE SET usd_eur = EXCLUDED.usd_eur, source = 'ECB', fetched_at = now()`,
      [rate.day, rate.usdEur],
    ),
  );
  return rate;
}
