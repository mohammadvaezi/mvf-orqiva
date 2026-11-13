// ── [PCODE-276 | S15 | v0.1.0] T28.5 Idea estimates: size, confidence range from estimate vs actual, basis from similar past tasks ──
//    Why:  a sum of story points reads more certain than it is. The idea gets a T-shirt size people can talk
//          about, and a range: how the project's finished tasks really came out against their estimates
//          says how far this sum may move. Little history gives the standard cone of uncertainty and says
//          so. Each proposal task is set beside the finished tasks that read most alike.
import { POINTS_PER_DAY } from './proposal.js';

/** The size of a whole idea by its points: XS up to 3, XXL above 80. */
export const IDEA_SIZES: readonly { size: string; upTo: number }[] = [
  { size: 'XS', upTo: 3 },
  { size: 'S', upTo: 8 },
  { size: 'M', upTo: 20 },
  { size: 'L', upTo: 40 },
  { size: 'XL', upTo: 80 },
  { size: 'XXL', upTo: Infinity },
];

export const ideaSize = (points: number): string =>
  (IDEA_SIZES.find((s) => points <= s.upTo) ?? { size: 'XXL' }).size;

/** The q-th quantile (0 to 1) of numbers, between neighbours. */
export function quantile(xs: readonly number[], q: number): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const at = (s.length - 1) * q;
  const lo = Math.floor(at);
  const hi = Math.ceil(at);
  return (s[lo] ?? 0) + ((s[hi] ?? 0) - (s[lo] ?? 0)) * (at - lo);
}

/** Below this many finished tasks the history says too little and the standard cone is used. */
export const MIN_HISTORY = 5;
/** The standard spread of an early estimate when there is no history. */
export const STANDARD_CONE = { low: 0.75, likely: 1, high: 1.6 } as const;

export interface EstimateRange {
  points: number;
  size: string;
  low: number;
  likely: number;
  high: number;
  lowDays: number;
  likelyDays: number;
  highDays: number;
  confidence: 'high' | 'medium' | 'low';
  /** where the spread came from */
  basis: 'history' | 'standard';
  /** finished tasks the history rests on */
  history: number;
}

const r1 = (x: number): number => Math.round(x * 10) / 10;
const days = (points: number): number => Math.ceil(points / POINTS_PER_DAY);

/**
 * The range of an estimate from how finished tasks came out (actual over estimated, 1.5 = half again as
 * long): low and high are the 20th and 80th percentile, likely the median. Ratios beyond 10 or under
 * 0.1 are left out as mistakes in logging.
 */
export function estimateRange(points: number, ratios: readonly number[]): EstimateRange {
  const usable = ratios.filter((r) => Number.isFinite(r) && r >= 0.1 && r <= 10);
  const fromHistory = usable.length >= MIN_HISTORY;
  const f = fromHistory
    ? { low: quantile(usable, 0.2), likely: quantile(usable, 0.5), high: quantile(usable, 0.8) }
    : STANDARD_CONE;
  const spread = f.low > 0 ? f.high / f.low : Infinity;
  const confidence = !fromHistory
    ? 'low'
    : usable.length >= 20 && spread <= 1.8
      ? 'high'
      : spread <= 3
        ? 'medium'
        : 'low';
  const low = r1(points * f.low);
  const likely = r1(points * f.likely);
  const high = r1(points * f.high);
  return {
    points,
    size: ideaSize(points),
    low,
    likely,
    high,
    lowDays: days(low),
    likelyDays: days(likely),
    highDays: days(high),
    confidence,
    basis: fromHistory ? 'history' : 'standard',
    history: usable.length,
  };
}

/** "M · likely 4 days (3–7), medium confidence from 12 finished tasks" */
export function rangeText(r: EstimateRange): string {
  return (
    r.size +
    ' · likely ' +
    String(r.likelyDays) +
    (r.likelyDays === 1 ? ' day' : ' days') +
    ' (' +
    String(r.lowDays) +
    '–' +
    String(r.highDays) +
    '), ' +
    r.confidence +
    ' confidence ' +
    (r.basis === 'history'
      ? 'from ' + String(r.history) + ' finished tasks'
      : '(standard spread: fewer than ' + String(MIN_HISTORY) + ' finished tasks with logged time)')
  );
}

/** A proposal task's estimate is off when its look-alikes took at least twice or at most half of it. */
export function offFromBasis(estimate: number, suggested: number | null): boolean {
  if (suggested === null || suggested <= 0 || estimate <= 0) return false;
  return suggested / estimate >= 2 || suggested / estimate <= 0.5;
}
