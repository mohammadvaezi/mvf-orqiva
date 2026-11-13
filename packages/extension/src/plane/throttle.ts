// ── [PCODE-12 | S02 | v0.1.0] Add a read-only Plane REST client with SecretStorage key and 20 req/min throttle ──
//    Why:  Plane allows 60 requests/minute per API key and the engine already uses up to 55; the extension
//          keeps to 20 so a busy session never starves `plane done`. Guards criticals #11.
//          Pure: the clock and the sleeper are injected for fake-timer tests.

export interface ThrottleOptions {
  perMinute?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// ── [PCODE-12 | S02 | v0.1.0] Throttle: sliding one-minute window; acquire() waits until a slot is free ──
export class Throttle {
  private readonly limit: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private stamps: number[] = [];
  /** Set by a 429: nothing runs before this time. */
  private blockedUntil = 0;

  constructor(opts: ThrottleOptions = {}) {
    this.limit = opts.perMinute ?? 20;
    this.now = opts.now ?? Date.now;
    this.sleep = opts.sleep ?? defaultSleep;
  }

  async acquire(): Promise<void> {
    for (;;) {
      const t = this.now();
      if (t < this.blockedUntil) {
        await this.sleep(this.blockedUntil - t);
        continue;
      }
      this.stamps = this.stamps.filter((s) => t - s < 60_000);
      if (this.stamps.length < this.limit) {
        this.stamps.push(t);
        return;
      }
      const oldest = this.stamps[0] ?? t;
      await this.sleep(Math.max(1, 60_000 - (t - oldest) + 5));
    }
  }

  /** Called on a 429: honours Retry-After (seconds) or X-RateLimit-Reset (epoch seconds), else 15 s. */
  backOff(headers: Record<string, string | undefined>): number {
    const retry = Number(headers['retry-after']);
    const reset = Number(headers['x-ratelimit-reset']);
    let ms = 15_000;
    if (Number.isFinite(retry) && retry > 0) ms = retry * 1000;
    else if (Number.isFinite(reset) && reset > 0) ms = Math.max(1000, reset * 1000 - this.now());
    ms = Math.min(ms, 10 * 60_000);
    this.blockedUntil = this.now() + ms;
    return ms;
  }

  get pending(): number {
    const t = this.now();
    return this.stamps.filter((s) => t - s < 60_000).length;
  }
}
