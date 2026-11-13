// ── [PCODE-315 | S15 | v0.1.0] T32.3a Cypress and Allure import, defects in the trace, leakage and burndown ──
//    Why:  results from the other common test tools arrive as runs, the same shape as Playwright's; and two
//          measures of a release's testing: how many of its bugs the tests caught before it shipped (defect
//          leakage is the share that got through), and how its planned cases were worked down day by day.
import type { ImportedResult } from './quality.js';

const asObj = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
const asArr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/**
 * Cypress's mochawesome JSON: results (one per spec file) of suites with tests and nested suites. A
 * merged report (mochawesome-merge) has the same shape.
 */
export function parseMochawesome(report: unknown): ImportedResult[] {
  const out: ImportedResult[] = [];
  const walk = (suite: Record<string, unknown>, path: string[], file: string): void => {
    const title = str(suite['title']);
    const here = title ? [...path, title] : path;
    for (const t of asArr(suite['tests']).map(asObj)) {
      const name = str(t['title']) || 'test';
      const state = str(t['state']);
      const pending = t['pending'] === true || t['skipped'] === true || state === 'pending';
      const status: ImportedResult['status'] = pending
        ? 'skipped'
        : state === 'passed' || t['pass'] === true
          ? 'passed'
          : 'failed';
      const err = asObj(t['err']);
      out.push({
        key: ('cy:' + (file ? file + ' › ' : '') + [...here, name].join(' › ')).slice(0, 500),
        title: name.slice(0, 300),
        suite: (here.join(' / ') || file).slice(0, 300),
        status,
        durationMs: typeof t['duration'] === 'number' ? Math.max(0, Math.round(t['duration'])) : 0,
        message: (str(err['message']) || str(err['estack'])).slice(0, 20000),
      });
    }
    for (const s of asArr(suite['suites']).map(asObj)) walk(s, here, file);
  };
  for (const r of asArr(asObj(report)['results']).map(asObj)) {
    const file = str(r['file']) || str(r['fullFile']);
    // the root suite of a spec file has no title; its tests sit at the top
    walk(r, [], file);
  }
  return out;
}

/**
 * Allure's result files (allure-results/*-result.json), one test each. A retried test comes once per
 * try: the last try (by its stop time) counts.
 */
export function parseAllure(results: readonly unknown[]): ImportedResult[] {
  const last = new Map<string, Record<string, unknown>>();
  for (const raw of results) {
    const r = asObj(raw);
    const id = str(r['historyId']) || str(r['fullName']) || str(r['name']);
    if (!id) continue;
    const seen = last.get(id);
    const stop = (x: Record<string, unknown>): number =>
      typeof x['stop'] === 'number' ? x['stop'] : 0;
    if (!seen || stop(r) >= stop(seen)) last.set(id, r);
  }
  return [...last.values()].map((r) => {
    const labels = new Map(
      asArr(r['labels'])
        .map(asObj)
        .map((l) => [str(l['name']), str(l['value'])] as const),
    );
    const suite = [labels.get('parentSuite'), labels.get('suite'), labels.get('subSuite')]
      .filter((x): x is string => Boolean(x))
      .join(' / ');
    const status = str(r['status']);
    const start = typeof r['start'] === 'number' ? r['start'] : 0;
    const stop = typeof r['stop'] === 'number' ? r['stop'] : start;
    const details = asObj(r['statusDetails']);
    const name = str(r['name']) || 'test';
    return {
      key: ('allure:' + (str(r['fullName']) || [suite, name].filter(Boolean).join(' › '))).slice(
        0,
        500,
      ),
      title: name.slice(0, 300),
      suite: suite.slice(0, 300),
      // broken (an error outside the assertion) and unknown count as failed
      status: status === 'passed' ? 'passed' : status === 'skipped' ? 'skipped' : 'failed',
      durationMs: Math.max(0, Math.round(stop - start)),
      message: (str(details['message']) || str(details['trace'])).slice(0, 20000),
    } satisfies ImportedResult;
  });
}

/** Defect leakage: the share of a release's bugs that were found after it shipped; null without bugs. */
export const defectLeakage = (caught: number, escaped: number): number | null =>
  caught + escaped ? Math.round((escaped / (caught + escaped)) * 1000) / 10 : null;

export interface BurndownDay {
  day: string;
  /** planned cases without a result by the end of the day */
  remaining: number;
  passed: number;
  failed: number;
}

/**
 * A release's planned cases worked down day by day (UTC days): what was still to run at the end of each
 * day, and how many had passed or failed. A case run in several configurations counts once, by its last
 * result that day.
 */
export function testBurndown(
  planned: readonly string[],
  results: readonly { caseId: string; status: string; at: string }[],
  from: string,
  to: string,
): BurndownDay[] {
  const wanted = new Set(planned);
  const sorted = results
    .filter((r) => wanted.has(r.caseId))
    .slice()
    .sort((a, b) => a.at.localeCompare(b.at));
  const out: BurndownDay[] = [];
  const end = new Date(to.slice(0, 10) + 'T00:00:00Z').getTime();
  let day = new Date(from.slice(0, 10) + 'T00:00:00Z').getTime();
  // at most 120 days, the most recent ones
  if ((end - day) / 86_400_000 > 119) day = end - 119 * 86_400_000;
  const state = new Map<string, string>();
  let i = 0;
  for (; day <= end; day += 86_400_000) {
    const until = new Date(day + 86_400_000).toISOString();
    for (; i < sorted.length && (sorted[i]?.at ?? '') < until; i++) {
      const r = sorted[i];
      if (r) state.set(r.caseId, r.status);
    }
    const values = [...state.values()];
    out.push({
      day: new Date(day).toISOString().slice(0, 10),
      remaining: wanted.size - state.size,
      passed: values.filter((s) => s === 'passed').length,
      failed: values.filter((s) => s === 'failed' || s === 'blocked').length,
    });
  }
  return out;
}
