// ── [PCODE-252 | S15 | v0.1.0] T26.1 Estimation: units, async planning poker, suggestions from similar tasks, estimate vs actual ──
//    Why:  one way to read and write estimates for the server, the web app and the extension. A task keeps a
//          number; the project says what it means: story points, hours, or T-shirt sizes (stored as the points
//          they stand for). Planning poker uses the deck of the unit, and its summary says whether the team
//          agrees. A suggestion comes from finished tasks that read alike: their estimates and the hours they
//          really took.

export const ESTIMATE_UNITS = ['points', 'hours', 'tshirt'] as const;
export type EstimateUnit = (typeof ESTIMATE_UNITS)[number];

/** T-shirt sizes and the points each stands for. */
export const TSHIRT: readonly { size: string; points: number }[] = [
  { size: 'XS', points: 1 },
  { size: 'S', points: 2 },
  { size: 'M', points: 3 },
  { size: 'L', points: 5 },
  { size: 'XL', points: 8 },
  { size: 'XXL', points: 13 },
];

/** The cards of a poker round; "?" means "I cannot say". */
export const POKER_DECKS: Record<EstimateUnit, readonly string[]> = {
  points: ['0', '1', '2', '3', '5', '8', '13', '21', '?'],
  hours: ['1', '2', '4', '8', '16', '24', '40', '?'],
  tshirt: [...TSHIRT.map((t) => t.size), '?'],
};

export const asUnit = (v: unknown): EstimateUnit =>
  (ESTIMATE_UNITS as readonly unknown[]).includes(v) ? (v as EstimateUnit) : 'points';

/** "5 pt", "8 h", "M"; an empty text without an estimate. */
export function estimateText(value: number | null | undefined, unit: EstimateUnit): string {
  if (value === null || value === undefined) return '';
  if (unit === 'hours') return String(value) + ' h';
  if (unit === 'tshirt') return sizeOf(value);
  return String(value) + ' pt';
}

/** The T-shirt size nearest to a number of points; a tie goes to the larger size. */
export function sizeOf(points: number): string {
  let best = TSHIRT[0] ?? { size: 'XS', points: 1 };
  for (const t of TSHIRT)
    if (Math.abs(t.points - points) <= Math.abs(best.points - points)) best = t;
  return best.size;
}

/** A card of the deck as the number stored on the task; null for "?" or a card not in the deck. */
export function cardValue(card: string, unit: EstimateUnit): number | null {
  if (!POKER_DECKS[unit].includes(card) || card === '?') return null;
  if (unit === 'tshirt') return TSHIRT.find((t) => t.size === card)?.points ?? null;
  return Number(card);
}

export interface PokerSummary {
  votes: number;
  /** the cards given, as numbers ("?" left out) */
  low: number | null;
  high: number | null;
  median: number | null;
  /** everyone who could say chose the same card */
  agreed: boolean;
  /** the card the median falls on: what to accept when nobody objects */
  suggested: string | null;
}

const median = (xs: readonly number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? (s[m] ?? null) : ((s[m - 1] ?? 0) + (s[m] ?? 0)) / 2;
};

/** The deck card nearest to a value (ties go to the larger card: estimates err on the safe side). */
export function nearestCard(value: number, unit: EstimateUnit): string | null {
  let best: { card: string; d: number; v: number } | null = null;
  for (const card of POKER_DECKS[unit]) {
    const v = cardValue(card, unit);
    if (v === null) continue;
    const d = Math.abs(v - value);
    if (!best || d < best.d || (d === best.d && v > best.v)) best = { card, d, v };
  }
  return best?.card ?? null;
}

export function pokerSummary(cards: readonly string[], unit: EstimateUnit): PokerSummary {
  const values = cards.map((c) => cardValue(c, unit)).filter((v): v is number => v !== null);
  const med = median(values);
  return {
    votes: cards.length,
    low: values.length ? Math.min(...values) : null,
    high: values.length ? Math.max(...values) : null,
    median: med,
    agreed: values.length > 0 && values.every((v) => v === values[0]),
    suggested: med === null ? null : nearestCard(med, unit),
  };
}

const STOP = new Set(
  'a an and are as at be by for from has in is it of on or that the this to with without when we our'.split(
    ' ',
  ),
);

/** The words of a text that say something: lower case, three letters or more, no common words. */
export function words(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9äöüß]+/)
      .filter((w) => w.length >= 3 && !STOP.has(w)),
  );
}

/** How alike two texts read: shared words over all words (0 to 1). */
export function similarity(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let both = 0;
  for (const w of a) if (b.has(w)) both++;
  return both / (a.size + b.size - both);
}

export interface SimilarTask {
  ref: string;
  title: string;
  estimate: number | null;
  /** hours logged on it */
  hours: number;
  score: number;
}

/**
 * The suggested estimate from similar finished tasks: the median of what they really took (hours, turned
 * into the unit) where time was logged, else of their estimates.
 */
export function suggestFrom(
  similar: readonly SimilarTask[],
  unit: EstimateUnit,
  hoursPerPoint: number,
): { value: number | null; basis: 'actual' | 'estimate' | 'none' } {
  const actual = similar.filter((s) => s.hours > 0).map((s) => s.hours);
  if (actual.length >= 2) {
    const h = median(actual) ?? 0;
    const v = unit === 'hours' ? h : h / hoursPerPoint;
    const card = nearestCard(v, unit);
    return { value: card === null ? null : cardValue(card, unit), basis: 'actual' };
  }
  const est = similar.map((s) => s.estimate).filter((e): e is number => e !== null);
  if (!est.length) return { value: null, basis: 'none' };
  const card = nearestCard(median(est) ?? 0, unit);
  return { value: card === null ? null : cardValue(card, unit), basis: 'estimate' };
}

/** An estimate in hours, to compare with the hours logged. */
export const estimateHours = (value: number, unit: EstimateUnit, hoursPerPoint: number): number =>
  unit === 'hours' ? value : value * hoursPerPoint;
