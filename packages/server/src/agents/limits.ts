// ── [PCODE-332 | S15 | v0.1.0] T33.4a Nested traces with latency and commits, agent rate limits, provider limits and health ──
//    Why:  a connection's own requests and tokens a minute: a call waits for room in the last minute
//          rather than run into the provider's limit and fail. Kept in this process, like the sign-in rate
//          limit, so several servers each keep their own count.

export interface ConnectionLimits {
  requestsPerMinute: number | null;
  tokensPerMinute: number | null;
}

interface Call {
  at: number;
  tokens: number;
}

const WINDOW = 60_000;

export class Limiter {
  private calls = new Map<string, Call[]>();
  constructor(
    private readonly now: () => number = Date.now,
    private readonly sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((r) => setTimeout(r, ms)),
  ) {}

  private recent(id: string): Call[] {
    const t = this.now();
    const list = (this.calls.get(id) ?? []).filter((c) => c.at > t - WINDOW);
    this.calls.set(id, list);
    return list;
  }

  /** How long a call must wait now, in milliseconds; 0 when there is room. */
  waitFor(id: string, l: ConnectionLimits, tokens = 0): number {
    const list = this.recent(id);
    const t = this.now();
    let wait = 0;
    if (l.requestsPerMinute && list.length >= l.requestsPerMinute) {
      const oldest = list[list.length - l.requestsPerMinute];
      if (oldest) wait = Math.max(wait, oldest.at + WINDOW - t);
    }
    if (l.tokensPerMinute) {
      let used = list.reduce((n, c) => n + c.tokens, 0);
      // the oldest calls leave the window first
      for (const c of list) {
        if (used + tokens <= l.tokensPerMinute) break;
        used -= c.tokens;
        wait = Math.max(wait, c.at + WINDOW - t);
      }
    }
    return Math.max(0, wait);
  }

  /**
   * Waits until a call fits and takes its place; `expected` is the tokens it will likely use. Returns the
   * call, so its real tokens can be set afterwards, and how long it waited.
   */
  async take(
    id: string,
    l: ConnectionLimits,
    expected = 0,
  ): Promise<{ call: Call; waited: number }> {
    let waited = 0;
    for (let i = 0; i < 20; i++) {
      const w = this.waitFor(id, l, expected);
      if (!w) break;
      await this.sleep(w + 5);
      waited += w + 5;
    }
    const call = { at: this.now(), tokens: expected };
    this.recent(id).push(call);
    return { call, waited };
  }
}

export const limiter = new Limiter();
