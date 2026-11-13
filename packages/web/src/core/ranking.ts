// ── [PCODE-436 | S15 | v0.1.0] T37 low: Untangle the three folder import cycles ──
//    Why:  where a task goes between two others, and the order of a list: shared by the old and the new
//          screens, so it sits below both.
/** A rank that sorts between two neighbours (either may be missing: the start or the end of a list). */
export function rankBetween(before: number | undefined, after: number | undefined): number {
  if (before !== undefined && after !== undefined) return (before + after) / 2;
  if (before !== undefined) return before + 1;
  if (after !== undefined) return after - 1;
  return 0;
}

/** List order: rank, then the number (anything with both, so core needs no task type). */
export const byRank = <T extends { rank: number; sequence: number }>(a: T, b: T): number =>
  a.rank - b.rank || a.sequence - b.sequence;
