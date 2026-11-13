// ── [PCODE-274 | S15 | v0.1.0] T28.3 Stories with Given/When/Then and personas; value/effort matrix, evidence library, compare ──
//    Why:  a user story says who wants what and why ("As a …, I want …, so that …"); its scenarios say how
//          to know it works (Given … When … Then …). The same shapes are read from the Analyst, edited on
//          the web, written into the PRD and turned into Gherkin for test cases, so they live here once.

export interface Scenario {
  given: string;
  when: string;
  then: string;
}

/** The most scenarios one story keeps. */
export const MAX_SCENARIOS = 20;
const PART_MAX = 1000;

/** Scenarios from untrusted input: objects with given, when and then, trimmed; a scenario without a then is dropped. */
export function scenariosOf(v: unknown): Scenario[] {
  if (!Array.isArray(v)) return [];
  const text = (x: unknown): string => (typeof x === 'string' ? x.trim().slice(0, PART_MAX) : '');
  return v
    .filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null)
    .map((x) => ({ given: text(x['given']), when: text(x['when']), then: text(x['then']) }))
    .filter((x) => x.then !== '' && (x.given !== '' || x.when !== ''))
    .slice(0, MAX_SCENARIOS);
}

/** "As a dispatcher, I want …, so that …" in its parts; null when the text is not written that way. */
export function storyParts(text: string): { role: string; want: string; benefit: string } | null {
  const m =
    /^\s*As an?\s+(.+?),?\s+I\s+(?:want|need|would like)\s+(.+?)(?:,?\s+so\s+that\s+(.+?))?\s*[.!]?\s*$/is.exec(
      text,
    );
  if (!m) return null;
  return { role: (m[1] ?? '').trim(), want: (m[2] ?? '').trim(), benefit: (m[3] ?? '').trim() };
}

/** A story written the usual way. */
export const storyText = (role: string, want: string, benefit: string): string =>
  'As ' +
  (/^[aeiou]/i.test(role.trim()) ? 'an ' : 'a ') +
  role.trim() +
  ', I want ' +
  want.trim() +
  (benefit.trim() ? ', so that ' + benefit.trim().replace(/[.!]$/, '') : '') +
  '.';

/** A step's lines: the first after its keyword, the rest after "And". */
const steps = (keyword: string, text: string): string[] =>
  text
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map(
      (l, i) =>
        '    ' + (i === 0 ? keyword : 'And') + ' ' + l.replace(/^(given|when|then|and)\s+/i, ''),
    );

/** Stories with their scenarios as one Gherkin feature, for test tools and the PRD. */
export function gherkin(
  feature: string,
  stories: readonly { code?: string; text: string; scenarios: readonly Scenario[] }[],
): string {
  const out = ['Feature: ' + feature.trim()];
  for (const s of stories) {
    out.push('', '  # ' + (s.code ? s.code + ' ' : '') + s.text.trim());
    s.scenarios.forEach((sc, i) => {
      out.push(
        '  Scenario: ' +
          (s.code ? s.code + ' ' : '') +
          (s.scenarios.length > 1 ? String(i + 1) + ' ' : '') +
          (sc.then.split('\n')[0] ?? '').slice(0, 80),
      );
      out.push(...steps('Given', sc.given), ...steps('When', sc.when), ...steps('Then', sc.then));
    });
    if (!s.scenarios.length) out.push('  # (no scenarios yet)');
  }
  return out.join('\n') + '\n';
}
