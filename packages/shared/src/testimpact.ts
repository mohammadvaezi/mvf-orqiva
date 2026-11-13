// ── [PCODE-317 | S15 | v0.1.0] T32.4a AI triage of test failures and impacted tests first ──
//    Why:  a change touches some files; the tests worth running first are the ones that cover them. A
//          case's task that wrote a changed file (its fingerprints) is the strongest sign, an automated
//          case named after the file the next, a case whose task wrote a file importing a changed one the
//          weakest. And a failed test's triage, as the agent answers it, read into one shape.

export interface ImpactCase {
  id: string;
  title: string;
  key: string;
  suite: string;
  itemRef: string | null;
  /** the files the case's task wrote (its fingerprints) */
  itemFiles: readonly string[];
}

export interface Impacted {
  caseId: string;
  title: string;
  score: number;
  reasons: string[];
}

const base = (path: string): string => {
  const name = path.split('/').pop() ?? path;
  // cart.ts, cart.test.ts, cart.cy.js → cart
  return name.split('.')[0]?.toLowerCase() ?? '';
};

/**
 * The cases a change touches, the most directly covered first. imports maps a file to the repository
 * files it imports (from the code scan).
 */
export function impactedCases(
  changed: readonly string[],
  cases: readonly ImpactCase[],
  imports: ReadonlyMap<string, readonly string[]> = new Map(),
): Impacted[] {
  const touched = new Set(changed);
  const names = new Map<string, string>();
  for (const p of changed) {
    const b = base(p);
    // names too common to tell anything apart are left out
    if (b.length >= 3 && !['index', 'main', 'app', 'utils', 'types'].includes(b)) names.set(b, p);
  }
  const out: Impacted[] = [];
  for (const c of cases) {
    let score = 0;
    const reasons: string[] = [];
    const wrote = c.itemFiles.filter((f) => touched.has(f));
    if (wrote.length) {
      score += 3;
      reasons.push(
        (c.itemRef ?? 'Its task') +
          ' wrote ' +
          wrote.slice(0, 2).join(', ') +
          (wrote.length > 2 ? ' and ' + String(wrote.length - 2) + ' more' : ''),
      );
    }
    const text = (c.key + ' ' + c.suite + ' ' + c.title).toLowerCase();
    for (const [name, path] of names)
      if (new RegExp('(^|[^a-z0-9])' + name + '([^a-z0-9]|$)').test(text)) {
        score += 2;
        reasons.push('named after ' + path);
        break;
      }
    if (!wrote.length) {
      const via = c.itemFiles.find((f) => (imports.get(f) ?? []).some((i) => touched.has(i)));
      if (via) {
        score += 1;
        reasons.push(
          via +
            ' (by ' +
            (c.itemRef ?? 'its task') +
            ') imports ' +
            (imports.get(via) ?? [])
              .filter((i) => touched.has(i))
              .slice(0, 2)
              .join(', '),
        );
      }
    }
    if (score) out.push({ caseId: c.id, title: c.title, score, reasons });
  }
  return out.sort((x, y) => y.score - x.score || x.title.localeCompare(y.title));
}

export const TRIAGE_CATEGORIES = ['product_bug', 'test_bug', 'environment', 'flaky'] as const;
export type TriageCategory = (typeof TRIAGE_CATEGORIES)[number];

export interface FailureTriage {
  category: TriageCategory;
  /** 0 to 1 */
  confidence: number;
  reason: string;
  next: string;
}

/** The agent's answer: a JSON object somewhere in its text; null when it is not one. */
export function parseFailureTriage(text: string): FailureTriage | null {
  const from = text.indexOf('{');
  const to = text.lastIndexOf('}');
  if (from < 0 || to <= from) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(from, to + 1));
  } catch {
    return null;
  }
  const o = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const category = o['category'];
  if (typeof category !== 'string' || !(TRIAGE_CATEGORIES as readonly string[]).includes(category))
    return null;
  const confidence = typeof o['confidence'] === 'number' ? o['confidence'] : 0.5;
  const str = (v: unknown, max: number): string =>
    typeof v === 'string' ? v.trim().slice(0, max) : '';
  return {
    category: category as TriageCategory,
    confidence: Math.min(1, Math.max(0, Math.round(confidence * 100) / 100)),
    reason: str(o['reason'], 2000),
    next: str(o['next'], 1000),
  };
}
