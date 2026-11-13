// ── [PCODE-330 | S15 | v0.1.0] T33.3a Run quality: annotations, judge scores, outcomes ──
//    Why:  how good a run was, three ways: what people say (good or bad, with tags), what a judge model
//          scores against a fixed rubric, and what came of it on the task. The judge answers a small JSON
//          object; a model that wraps it in words or a code fence is still read.

/** What people can say about a run besides good or bad. */
export const RUN_TAGS = [
  'made things up',
  'wrong tool',
  'missed the point',
  'too slow',
  'too costly',
  'unsafe action',
  'well explained',
  'saved time',
] as const;
export type RunTag = (typeof RUN_TAGS)[number];

/** The rubric the judge scores by. */
export const JUDGE_RUBRIC = [
  'Score the agent run from 1 to 5:',
  '5 the instruction is fully done, correct, and nothing unneeded was done;',
  '4 done with small gaps;',
  '3 partly done, or done with a mistake a person must fix;',
  '2 mostly not done, or misleading;',
  '1 wrong, made up, or harmful.',
  'Judge only by what is shown. Answer with JSON only: {"score": <1-5>, "reason": "<one or two sentences>"}.',
].join('\n');

/** The judge's answer read as a score and a reason, or null when there is none. */
export function parseJudge(text: string): { score: number; reason: string } | null {
  const m = /\{[\s\S]*\}/.exec(text);
  if (!m) return null;
  try {
    const v = JSON.parse(m[0]) as { score?: unknown; reason?: unknown };
    const score = typeof v.score === 'number' ? Math.round(v.score) : Number.NaN;
    if (!(score >= 1 && score <= 5)) return null;
    return {
      score,
      reason: typeof v.reason === 'string' ? v.reason.trim().slice(0, 1000) : '',
    };
  } catch {
    return null;
  }
}

export type RunOutcome = 'reverted' | 'merged' | 'done' | 'open' | 'none';

/** What came of a run on a task, the strongest sign first: a revert outweighs a merge, a merge a done task. */
export function outcomeOf(f: {
  hasTask: boolean;
  reverted: boolean;
  merged: boolean;
  done: boolean;
}): RunOutcome {
  if (!f.hasTask) return 'none';
  if (f.reverted) return 'reverted';
  if (f.merged) return 'merged';
  if (f.done) return 'done';
  return 'open';
}

export const OUTCOME_TEXT: Record<RunOutcome, string> = {
  reverted: 'a commit for its task was reverted',
  merged: 'its task’s pull request was merged',
  done: 'its task was done',
  open: 'its task is still open',
  none: 'not on a task',
};
