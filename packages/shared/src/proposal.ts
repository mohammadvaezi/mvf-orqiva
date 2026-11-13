// ── [PCODE-275 | S15 | v0.1.0] T28.4 PRD: templates per idea kind, citations per statement, version diff, MD, PDF and Word export ──
// ── [PCODE-124 | S15 | v0.1.0] Generate proposals with an estimate from the interview, with versions ──
// ── [PCODE-125 | S15 | v0.1.0] Approve proposals with an electronic signature and turn them into a plan ──
//    Why:  a proposal is what the owner signs, so its shape is fixed and checked the same way on the server
//          and in the web app. The estimate is never typed or taken from the model: it is computed from the
//          tasks' story points, so it always matches the plan that approval will create.

export interface ProposalTask {
  title: string;
  /** story points, one of POINTS */
  estimate: number;
  description: string;
}

// [PCODE-275 | S15 | v0.1.0] the sections an idea kind's template adds (steps to reproduce, impact, …)
export interface ProposalSection {
  key: string;
  title: string;
  body: string;
}

export interface ProposalContent {
  summary: string;
  problem: string;
  goals: string[];
  scopeIn: string[];
  scopeOut: string[];
  risks: string[];
  tasks: ProposalTask[];
  /** optional: proposals written before templates have none */
  sections?: ProposalSection[];
}

export interface Estimate {
  points: number;
  /** working days at POINTS_PER_DAY */
  days: number;
}

/** The story points a task may have. */
export const POINTS = [1, 2, 3, 5, 8, 13] as const;

/** Points one person finishes in a day, until measured velocity replaces it. */
export const POINTS_PER_DAY = 5;

export function estimateOf(tasks: readonly Pick<ProposalTask, 'estimate'>[]): Estimate {
  const points = tasks.reduce((n, t) => n + t.estimate, 0);
  return { points, days: Math.ceil(points / POINTS_PER_DAY) };
}

const isText = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;

/** What is wrong with a proposal, as sentences; empty when it can be stored. */
export function proposalProblems(v: unknown): string[] {
  const out: string[] = [];
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return ['A proposal is an object'];
  const p = v as Record<string, unknown>;
  for (const k of ['summary', 'problem'] as const)
    if (!isText(p[k], 4000) || !p[k].trim()) out.push(k + ' is required (at most 4000 characters)');
  for (const k of ['goals', 'scopeIn', 'scopeOut', 'risks'] as const) {
    const list = p[k];
    if (!Array.isArray(list) || list.length > 30 || !list.every((x) => isText(x, 500)))
      out.push(k + ' is a list of at most 30 lines of up to 500 characters');
  }
  // [PCODE-275 | S15 | v0.1.0]
  const sections = p['sections'];
  if (sections !== undefined) {
    if (!Array.isArray(sections) || sections.length > 12)
      out.push('sections is a list of at most 12 sections');
    else
      sections.forEach((x: unknown, i) => {
        const sec = (typeof x === 'object' && x !== null ? x : {}) as Record<string, unknown>;
        if (
          !isText(sec['key'], 40) ||
          !isText(sec['title'], 120) ||
          !sec['title'].trim() ||
          !isText(sec['body'], 8000)
        )
          out.push(
            'section ' +
              String(i + 1) +
              ' needs a key, a title and a body of up to 8000 characters',
          );
      });
  }
  const tasks = p['tasks'];
  if (!Array.isArray(tasks) || tasks.length === 0 || tasks.length > 60) {
    out.push('tasks is a list of 1 to 60 tasks');
    return out;
  }
  tasks.forEach((t: unknown, i) => {
    const task = (typeof t === 'object' && t !== null ? t : {}) as Record<string, unknown>;
    const n = 'task ' + String(i + 1);
    if (!isText(task['title'], 200) || !task['title'].trim())
      out.push(n + ' needs a title (at most 200 characters)');
    if (!POINTS.includes(task['estimate'] as (typeof POINTS)[number]))
      out.push(n + "'s estimate is one of " + POINTS.join(', ') + ' points');
    if (task['description'] !== undefined && !isText(task['description'], 4000))
      out.push(n + "'s description is at most 4000 characters");
  });
  return out;
}

/** The proposal with defaults filled and text trimmed; call after proposalProblems found nothing. */
export function normalProposal(v: unknown): ProposalContent {
  const p = v as Record<string, unknown>;
  const lines = (x: unknown): string[] =>
    (x as string[]).map((s) => s.trim()).filter((s) => s.length > 0);
  return {
    summary: (p['summary'] as string).trim(),
    problem: (p['problem'] as string).trim(),
    goals: lines(p['goals']),
    scopeIn: lines(p['scopeIn']),
    scopeOut: lines(p['scopeOut']),
    risks: lines(p['risks']),
    tasks: (p['tasks'] as Record<string, unknown>[]).map((t) => ({
      title: (t['title'] as string).trim(),
      estimate: t['estimate'] as number,
      description: typeof t['description'] === 'string' ? t['description'].trim() : '',
    })),
    // [PCODE-275 | S15 | v0.1.0] kept only when given, so older versions keep their exact shape (and signature hash)
    ...(Array.isArray(p['sections'])
      ? {
          sections: (p['sections'] as Record<string, unknown>[])
            .map((x) => ({
              key: (x['key'] as string).trim(),
              title: (x['title'] as string).trim(),
              body: (x['body'] as string).trim(),
            }))
            .filter((x) => x.body !== ''),
        }
      : {}),
  };
}

/** The JSON object in a model's answer: bare, or in a ```json fence; null when there is none. */
export function jsonIn(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)?.[1];
  const raw = fenced ?? text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

// ── [PCODE-125 | S15 | v0.1.0] Approve proposals with an electronic signature and turn them into a plan ──

/** What the signer agrees to, word for word; stored with each signature. */
export const SIGN_CONSENT =
  'I have read this proposal version. By typing my name I sign my decision on it electronically, ' +
  'and an approval commits the scope, tasks and estimate it describes.';

/** JSON with keys in a fixed order, so the same proposal always hashes the same. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return '[' + v.map(canonicalJson).join(',') + ']';
  if (typeof v === 'object' && v !== null)
    return (
      '{' +
      Object.keys(v)
        .sort()
        .map((k) => JSON.stringify(k) + ':' + canonicalJson((v as Record<string, unknown>)[k]))
        .join(',') +
      '}'
    );
  return JSON.stringify(v);
}

/** A typed name matches the account's name regardless of case and spacing. */
export const sameName = (typed: string, account: string): boolean => {
  const norm = (s: string): string => s.trim().replace(/\s+/g, ' ').toLowerCase();
  return norm(typed) !== '' && norm(typed) === norm(account);
};
