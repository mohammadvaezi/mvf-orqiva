// ── [PCODE-327 | S15 | v0.1.0] T33.1a Cache and reasoning tokens priced, the daily ECB rate, spend in euro by day ──
//    Why:  what a model call costs. Input read from the provider's cache costs a fraction of fresh input,
//          writing to it a little more; reasoning is part of the output and billed as output, but shown on
//          its own. Prices are millionths of a dollar per million tokens. And the euro rate the ECB
//          publishes each working day, read from its daily file.

export interface Usage {
  /** fresh input, without what came from or went into the cache */
  input: number;
  /** output, reasoning included */
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
  /** the part of the output spent reasoning */
  reasoning?: number;
}

export interface Prices {
  in: number;
  out: number;
  /** null or 0: not in the table, the usual share of the input price is used */
  cacheRead?: number | null;
  cacheWrite?: number | null;
}

/** Reading from the cache: a tenth of fresh input, the providers' usual price when the table has none. */
export const CACHE_READ_SHARE = 0.1;
/** Writing to the cache: a quarter more than fresh input. */
export const CACHE_WRITE_SHARE = 1.25;

/** A call's cost in millionths of a dollar. */
export function usageCost(u: Usage, p: Prices): number {
  const read = p.cacheRead || p.in * CACHE_READ_SHARE;
  const write = p.cacheWrite || p.in * CACHE_WRITE_SHARE;
  return Math.round(
    (u.input * p.in + u.output * p.out + (u.cacheRead ?? 0) * read + (u.cacheWrite ?? 0) * write) /
      1_000_000,
  );
}

/** The share of input tokens that came from the cache, 0 to 1. */
export const cacheShare = (input: number, cacheRead: number): number =>
  input + cacheRead ? cacheRead / (input + cacheRead) : 0;

/**
 * The ECB's daily reference rates (eurofxref-daily.xml): the day and how many US dollars a euro buys,
 * turned around into euro per dollar.
 */
export function parseEcbDaily(xml: string): { day: string; usdEur: number } | null {
  const day = /<Cube\s+time=['"](\d{4}-\d{2}-\d{2})['"]/.exec(xml)?.[1];
  const usd = /<Cube\s+currency=['"]USD['"]\s+rate=['"]([\d.]+)['"]/.exec(xml)?.[1];
  const rate = Number(usd);
  if (!day || !Number.isFinite(rate) || rate <= 0) return null;
  return { day, usdEur: Math.round((1 / rate) * 1e6) / 1e6 };
}
