// ── [PCODE-331 | S15 | v0.1.0] T33.3b Evals: saved cases with checks, eval runs per model or prompt version, pass rates over time ──
//    Why:  a case passes when its run succeeded, its answer says what it must and nothing it must not
//          (ignoring case and spacing), and the judge scored it high enough when that is asked for. Until
//          a needed score is there, the case waits rather than fails.

export interface EvalExpect {
  mustContain: readonly string[];
  mustNotContain: readonly string[];
  minJudge: number | null;
}

export interface EvalCheck {
  check: string;
  ok: boolean;
}

const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, ' ').trim();

/** Each check of a case against an answer. */
export function evalChecks(answer: string, e: EvalExpect): EvalCheck[] {
  const a = norm(answer);
  return [
    ...e.mustContain
      .filter((x) => x.trim())
      .map((x) => ({ check: 'says “' + x.trim() + '”', ok: a.includes(norm(x)) })),
    ...e.mustNotContain
      .filter((x) => x.trim())
      .map((x) => ({ check: 'does not say “' + x.trim() + '”', ok: !a.includes(norm(x)) })),
  ];
}

export type CaseResult = 'pass' | 'fail' | 'running' | 'needs judge';

/** Whether a case passed, failed, still runs, or waits for the judge. */
export function caseResult(
  status: string,
  checks: readonly EvalCheck[],
  judge: number | null,
  minJudge: number | null,
): CaseResult {
  if (status === 'queued' || status === 'running') return 'running';
  if (status !== 'succeeded') return 'fail';
  if (checks.some((c) => !c.ok)) return 'fail';
  if (minJudge !== null) {
    if (judge === null) return 'needs judge';
    if (judge < minJudge) return 'fail';
  }
  return 'pass';
}

/** Share of decided cases that passed, or null when none is decided yet. */
export function passRate(results: readonly CaseResult[]): number | null {
  const decided = results.filter((r) => r === 'pass' || r === 'fail');
  return decided.length
    ? Math.round((decided.filter((r) => r === 'pass').length / decided.length) * 100) / 100
    : null;
}
