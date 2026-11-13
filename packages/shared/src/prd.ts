// ── [PCODE-276 | S15 | v0.1.0] T28.5 Idea estimates: size, confidence range from estimate vs actual, basis from similar past tasks ──
// ── [PCODE-275 | S15 | v0.1.0] T28.4 PRD: templates per idea kind, citations per statement, version diff, MD, PDF and Word export ──
//    Why:  a PRD is read, compared and signed, so its parts are worked out once and used by the Architect's
//          prompt, the server's exports and the web view alike: the extra sections each kind of idea needs,
//          the citations each statement carries ([R-3] for a requirement, [S2] for a source), what changed
//          between two versions, and the document as Markdown (which the Word and PDF exports start from).
import type { ProposalContent, ProposalSection } from './proposal.js';
import { gherkin, type Scenario } from './stories.js';

export type IdeaKind = 'feature' | 'improvement' | 'bug' | 'research' | 'change_request';

export interface TemplateSection {
  key: string;
  title: string;
  /** what the section should say, for the writer and as a placeholder */
  hint: string;
}

/** The sections a PRD of each kind adds to summary, problem, goals, scope, risks and tasks. */
export const PRD_TEMPLATES: Record<IdeaKind, readonly TemplateSection[]> = {
  feature: [
    {
      key: 'users',
      title: 'Users and personas',
      hint: 'Who uses it, in which situation, how often.',
    },
    {
      key: 'metrics',
      title: 'Success metrics',
      hint: 'The numbers that show it worked, with targets.',
    },
    {
      key: 'nfr',
      title: 'Quality requirements',
      hint: 'Speed, availability, accessibility, security.',
    },
  ],
  improvement: [
    {
      key: 'today',
      title: 'How it works today',
      hint: 'The current behaviour and what is wrong with it.',
    },
    {
      key: 'better',
      title: 'What gets better',
      hint: 'The change people will notice, measured if possible.',
    },
  ],
  bug: [
    { key: 'steps', title: 'Steps to reproduce', hint: 'Numbered steps from a clean start.' },
    {
      key: 'expected',
      title: 'Expected and actual',
      hint: 'What should happen, and what happens instead.',
    },
    {
      key: 'affected',
      title: 'Affected versions and users',
      hint: 'Where it occurs and who is hit.',
    },
  ],
  research: [
    { key: 'questions', title: 'Questions to answer', hint: 'What we do not know yet.' },
    { key: 'method', title: 'Method', hint: 'How we find out: interviews, a spike, data.' },
    { key: 'decision', title: 'Decision it informs', hint: 'What we will decide with the answer.' },
  ],
  change_request: [
    { key: 'current', title: 'Current agreement', hint: 'What was agreed and signed before.' },
    { key: 'change', title: 'Requested change', hint: 'What the client asks for instead.' },
    {
      key: 'impact',
      title: 'Impact on cost and dates',
      hint: 'Effort, price and schedule effect.',
    },
  ],
};

export const templateOf = (kind: string): readonly TemplateSection[] =>
  kind in PRD_TEMPLATES ? PRD_TEMPLATES[kind as IdeaKind] : PRD_TEMPLATES.feature;

// ── citations ──
const CITE = /\[((?:R-\d+|S\d+)(?:\s*,\s*(?:R-\d+|S\d+))*)\]/g;

/** The codes a statement cites, in order, each once: "… [R-3, S2]" gives R-3 and S2. */
export function citesIn(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(CITE))
    for (const code of (m[1] ?? '').split(',').map((x) => x.trim()))
      if (!out.includes(code)) out.push(code);
  return out;
}

/** A statement's text without its citation brackets. */
export const withoutCites = (text: string): string =>
  text
    .replace(CITE, '')
    .replace(/\s+([.,;:!?])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();

/** Text with its citations as parts, for drawing chips in place of the brackets. */
export function citeParts(text: string): ({ text: string } | { codes: string[] })[] {
  const out: ({ text: string } | { codes: string[] })[] = [];
  let at = 0;
  for (const m of text.matchAll(CITE)) {
    const i = m.index;
    if (i > at) out.push({ text: text.slice(at, i) });
    out.push({ codes: (m[1] ?? '').split(',').map((x) => x.trim()) });
    at = i + m[0].length;
  }
  if (at < text.length) out.push({ text: text.slice(at) });
  return out;
}

export interface Statement {
  /** where it is, e.g. "goals.2" or "sections.steps" */
  path: string;
  /** the part of the PRD, as people read it */
  part: string;
  text: string;
}

const BASE_LISTS = [
  ['goals', 'Goals'],
  ['scopeIn', 'In scope'],
  ['scopeOut', 'Out of scope'],
  ['risks', 'Risks and open questions'],
] as const;

/** Every statement of a PRD that could rest on something: sentences of the text, lines of the lists. */
export function statementsOf(c: ProposalContent): Statement[] {
  const sentences = (path: string, part: string, text: string): Statement[] =>
    text
      .split(/(?<=[.!?\]])\s+(?=[A-ZÄÖÜ0-9"“])|\n+/)
      .map((t) => t.trim())
      .filter((t) => t.length > 2)
      .map((t, i) => ({ path: path + '.' + String(i + 1), part, text: t }));
  return [
    ...sentences('summary', 'Summary', c.summary),
    ...sentences('problem', 'Problem', c.problem),
    ...BASE_LISTS.flatMap(([k, part]) =>
      c[k].map((t, i) => ({ path: k + '.' + String(i + 1), part, text: t })),
    ),
    ...(c.sections ?? []).flatMap((s) => sentences('sections.' + s.key, s.title, s.body)),
  ];
}

/** How many statements are cited, and which are not. */
export function citationReport(c: ProposalContent): {
  total: number;
  cited: number;
  uncited: Statement[];
} {
  const all = statementsOf(c);
  const uncited = all.filter((s) => citesIn(s.text).length === 0);
  return { total: all.length, cited: all.length - uncited.length, uncited };
}

// ── the diff ──
export type DiffOp = { op: 'same' | 'add' | 'remove'; text: string };

/** The longest common subsequence of two lists, as same/add/remove steps. */
function lcs(a: readonly string[], b: readonly string[]): DiffOp[] {
  const n = a.length;
  const m = b.length;
  const t: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      (t[i] as number[])[j] =
        a[i] === b[j]
          ? ((t[i + 1] as number[])[j + 1] ?? 0) + 1
          : Math.max((t[i + 1] as number[])[j] ?? 0, (t[i] as number[])[j + 1] ?? 0);
  const out: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ op: 'same', text: a[i] ?? '' });
      i++;
      j++;
    } else if (((t[i + 1] as number[])[j] ?? 0) >= ((t[i] as number[])[j + 1] ?? 0)) {
      out.push({ op: 'remove', text: a[i] ?? '' });
      i++;
    } else {
      out.push({ op: 'add', text: b[j] ?? '' });
      j++;
    }
  }
  while (i < n) out.push({ op: 'remove', text: a[i++] ?? '' });
  while (j < m) out.push({ op: 'add', text: b[j++] ?? '' });
  return out;
}

/**
 * Word by word: a change runs over the spaces between changed words, so "the day" → "two days" reads as
 * one removal and one addition; neighbouring steps of the same kind are joined.
 */
export function wordDiff(a: string, b: string): DiffOp[] {
  const words = (s: string): string[] => s.split(/(\s+)/).filter((w) => w !== '');
  const steps = lcs(words(a), words(b));
  const out: DiffOp[] = [];
  let removed = '';
  let added = '';
  const flush = (): void => {
    if (removed) out.push({ op: 'remove', text: removed });
    if (added) out.push({ op: 'add', text: added });
    removed = '';
    added = '';
  };
  steps.forEach((d, i) => {
    const inside =
      d.op === 'same' &&
      /^\s+$/.test(d.text) &&
      (removed !== '' || added !== '') &&
      steps.slice(i + 1).find((x) => !/^\s+$/.test(x.text) || x.op !== 'same')?.op !== 'same' &&
      i + 1 < steps.length;
    if (d.op === 'remove' || inside) removed += d.text;
    if (d.op === 'add' || inside) added += d.text;
    if (d.op === 'same' && !inside) {
      flush();
      const last = out[out.length - 1];
      if (last && last.op === 'same') last.text += d.text;
      else out.push({ ...d });
    }
  });
  flush();
  return out;
}

export interface PartDiff {
  part: string;
  kind: 'text' | 'list';
  changed: boolean;
  ops: DiffOp[];
}

const sectionText = (s: readonly ProposalSection[] | undefined, title: string): string =>
  s?.find((x) => x.title === title)?.body ?? '';

/** What changed from one version to the next, part by part. */
export function proposalDiff(a: ProposalContent, b: ProposalContent): PartDiff[] {
  const text = (part: string, x: string, y: string): PartDiff => {
    const ops = wordDiff(x, y);
    return { part, kind: 'text', changed: ops.some((o) => o.op !== 'same'), ops };
  };
  const list = (part: string, x: readonly string[], y: readonly string[]): PartDiff => {
    const ops = lcs(x, y);
    return { part, kind: 'list', changed: ops.some((o) => o.op !== 'same'), ops };
  };
  const task = (t: ProposalContent['tasks'][number]): string =>
    t.title + ' (' + String(t.estimate) + ' points)';
  const titles = [...new Set([...(a.sections ?? []), ...(b.sections ?? [])].map((s) => s.title))];
  return [
    text('Summary', a.summary, b.summary),
    text('Problem', a.problem, b.problem),
    ...BASE_LISTS.map(([k, part]) => list(part, a[k], b[k])),
    ...titles.map((t) => text(t, sectionText(a.sections, t), sectionText(b.sections, t))),
    list('Tasks', a.tasks.map(task), b.tasks.map(task)),
  ];
}

// ── the document ──
export interface PrdRef {
  code: string;
  text: string;
  /** the source label and title the requirement cites, when it does */
  source: string;
  passage: string;
}

export interface PrdDoc {
  ref: string;
  title: string;
  kind: string;
  version: number;
  status: string;
  author: string;
  date: string;
  content: ProposalContent;
  estimate: { points: number; days: number };
  /** [PCODE-276 | S15 | v0.1.0] the size and range, as rangeText writes it */
  range?: string;
  refs: readonly PrdRef[];
  stories: readonly {
    code: string;
    text: string;
    persona: string;
    scenarios: readonly Scenario[];
  }[];
}

const md = (s: string): string => s.replace(/([\\*_`<>#])/g, '\\$1');

/** The PRD as Markdown: the base parts, the kind's sections, stories with scenarios, tasks, cited requirements. */
export function prdMarkdown(d: PrdDoc): string {
  const c = d.content;
  const out: string[] = [
    '# ' + md(d.ref + ' ' + d.title),
    '',
    '_' +
      ['Version ' + String(d.version), d.status, d.kind.replace(/_/g, ' '), d.author, d.date]
        .filter(Boolean)
        .join(' · ') +
      '_',
    '',
    '## Summary',
    '',
    md(c.summary),
    '',
    '## Problem',
    '',
    md(c.problem),
  ];
  for (const [k, part] of BASE_LISTS)
    if (c[k].length) out.push('', '## ' + part, '', ...c[k].map((l) => '- ' + md(l)));
  for (const s of c.sections ?? []) out.push('', '## ' + md(s.title), '', md(s.body));
  if (d.stories.length) {
    out.push('', '## Stories');
    for (const s of d.stories) {
      out.push('', '### ' + s.code + (s.persona ? ' (' + md(s.persona) + ')' : ''), '', md(s.text));
      for (const sc of s.scenarios) {
        out.push('');
        if (sc.given) out.push('- **Given** ' + md(sc.given.replace(/\n+/g, '; ')));
        if (sc.when) out.push('- **When** ' + md(sc.when.replace(/\n+/g, '; ')));
        out.push('- **Then** ' + md(sc.then.replace(/\n+/g, '; ')));
      }
    }
  }
  out.push(
    '',
    '## Tasks',
    '',
    '| Task | Points |',
    '| --- | ---: |',
    ...c.tasks.map(
      (t) => '| ' + md(t.title).replace(/\|/g, '\\|') + ' | ' + String(t.estimate) + ' |',
    ),
    '',
    'Estimate: ' +
      String(d.estimate.points) +
      ' points, about ' +
      String(d.estimate.days) +
      ' working days.' +
      (d.range ? ' Size ' + d.range + '.' : ''),
  );
  const cited = new Set(statementsOf(c).flatMap((s) => citesIn(s.text)));
  const refs = d.refs.filter((r) => cited.has(r.code));
  if (refs.length) {
    out.push('', '## Cited requirements and sources', '');
    for (const r of refs)
      out.push(
        '- **' +
          r.code +
          '** ' +
          md(r.text) +
          (r.passage
            ? ' — ' + (r.source ? md(r.source) + ': ' : '') + '“' + md(r.passage) + '”'
            : ''),
      );
  }
  return out.join('\n') + '\n';
}

/** The stories as a Gherkin feature, for the same PRD. */
export const prdGherkin = (d: Pick<PrdDoc, 'ref' | 'title' | 'stories'>): string =>
  gherkin(
    d.ref + ' ' + d.title,
    d.stories.map((s) => ({ code: s.code, text: s.text, scenarios: s.scenarios })),
  );
