// ── [PCODE-256 | S15 | v0.1.0] T26.5 Planning charts: burndown and burnup in points, cumulative flow, control chart, lead time ──
//    Why:  where every task stood on every day, rebuilt from when it was made and each move since, so the
//          charts need no daily snapshots and work for the past too; and the numbers a control chart and a
//          lead-time chart show: average, spread and the 50th and 85th percentile.

export interface Step<T> {
  /** ISO time the value began */
  at: string;
  value: T;
}

/** The value at the end of a day (YYYY-MM-DD, UTC), or null before the first step. */
export function valueOn<T>(steps: readonly Step<T>[], day: string): T | null {
  const end = day + 'T23:59:59.999Z';
  let v: T | null = null;
  for (const s of steps) {
    if (s.at > end) break;
    v = s.value;
  }
  return v;
}

export interface Stats {
  count: number;
  mean: number | null;
  sd: number | null;
  p50: number | null;
  p85: number | null;
}

const round1 = (x: number): number => Math.round(x * 10) / 10;

/** The p-th percentile (0 to 100) of sorted values, by nearest rank. */
export function percentile(sorted: readonly number[], p: number): number | null {
  if (!sorted.length) return null;
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1] ?? null;
}

export function stats(values: readonly number[]): Stats {
  if (!values.length) return { count: 0, mean: null, sd: null, p50: null, p85: null };
  const s = [...values].sort((a, b) => a - b);
  const mean = s.reduce((a, b) => a + b, 0) / s.length;
  const sd = Math.sqrt(s.reduce((a, b) => a + (b - mean) ** 2, 0) / s.length);
  return {
    count: s.length,
    mean: round1(mean),
    sd: round1(sd),
    p50: percentile(s, 50),
    p85: percentile(s, 85),
  };
}

/** How many values fall in each bin of `size` days: [0, size), [size, 2·size) … */
export function histogram(values: readonly number[], size = 1): { from: number; count: number }[] {
  if (!values.length) return [];
  const top = Math.floor(Math.max(...values) / size);
  const bins = Array.from({ length: top + 1 }, (_, i) => ({ from: i * size, count: 0 }));
  for (const v of values) {
    const b = bins[Math.floor(Math.max(0, v) / size)];
    if (b) b.count++;
  }
  return bins;
}

/** Days between two ISO times, with one decimal. */
export const daysBetweenTimes = (from: string, to: string): number =>
  round1((Date.parse(to) - Date.parse(from)) / 86_400_000);
