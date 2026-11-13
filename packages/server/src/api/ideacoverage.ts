// ── [PCODE-273 | S15 | v0.1.0] T28.2 Interview steered by coverage; handed-over questions notify their owner ──
//    Why:  how much of an idea is known, per area, and what the interviewer is told before each turn. The
//          areas and the measure live here so the interview (ideas) and the workspace (ideation) count the
//          same way: a requirement or an answered question is a third of an area, an interview answer about
//          the area two thirds (the owner said it in their own words), an open question caps it at two
//          thirds. An area at two thirds or more is covered.

export const AREAS = [
  'problem',
  'users',
  'scope',
  'non_goals',
  'non_functional',
  'data',
  'integrations',
  'security',
] as const;
export type Area = (typeof AREAS)[number];

export const isArea = (v: string): v is Area => (AREAS as readonly string[]).includes(v);

/** The coverage an area needs before the interviewer leaves it. */
export const COVERED = 66;
/** The most questions an interview asks before it sums up. */
export const MAX_QUESTIONS = 12;

/** Coverage per area: each requirement or answered question counts a third; open questions cap it at two thirds. */
export function coverage(
  reqs: { area: string; status: string }[],
  questions: { area: string; status: string }[],
  /** the areas of interview questions the owner answered */
  interview: readonly string[] = [],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const area of AREAS) {
    const points =
      reqs.filter((r) => r.area === area && r.status !== 'rejected').length +
      questions.filter((q) => q.area === area && q.status === 'answered').length +
      2 * interview.filter((a) => a === area).length;
    let pct = Math.min(100, Math.round((points / 3) * 100));
    if (questions.some((q) => q.area === area && q.status === 'open')) pct = Math.min(pct, 66);
    out[area] = pct;
  }
  return out;
}

/** The areas still below covered, weakest first (ties in the order of AREAS). */
export const weakest = (cov: Record<string, number>): Area[] =>
  AREAS.filter((a) => (cov[a] ?? 0) < COVERED).sort((a, b) => (cov[a] ?? 0) - (cov[b] ?? 0));

/** The interview's areas that got an answer: each agent question with an area followed by the owner's reply. */
export function answeredAreas(
  messages: readonly { role: string; area?: string | null }[],
): string[] {
  const out: string[] = [];
  messages.forEach((m, i) => {
    if (m.role === 'agent' && m.area && messages[i + 1]?.role === 'owner') out.push(m.area);
  });
  return out;
}

/** The line the interviewer reads before each turn: coverage, what is weakest, and whether to finish. */
export function steering(
  cov: Record<string, number>,
  asked: number,
  enough: boolean,
): { text: string; finish: boolean } {
  const weak = weakest(cov);
  const finish = enough || asked >= MAX_QUESTIONS || weak.length === 0;
  const text =
    '[ORQIVA] COVERAGE: ' +
    AREAS.map((a) => a + ' ' + String(cov[a] ?? 0) + '%').join(', ') +
    '. Questions asked: ' +
    String(asked) +
    ' of at most ' +
    String(MAX_QUESTIONS) +
    '. ' +
    (finish
      ? 'FINISH NOW: ' +
        (enough ? 'the owner has said enough. ' : '') +
        'answer READY: with the summary.'
      : 'Weakest: ' + weak.join(', ') + '. Ask about the weakest area that matters for this idea.');
  return { text, finish };
}
