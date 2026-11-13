// ── [PCODE-313 | S15 | v0.1.0] T32.1 Test repository: shared steps, parameters in the screen, structured BDD ──
//    Why:  test cases written once and used many times. A case's step can be a reference to a project's
//          shared steps (log in, open the cart), shown expanded wherever the case is read; a step can name a
//          parameter as <browser>, filled from the run's configuration; and a BDD case is Gherkin text that
//          becomes steps: Given and When are actions, a Then (and the And or But after it) the expected
//          result of the step before, a Scenario Outline's Examples become its parameters.

export interface DesignStep {
  action: string;
  expected: string;
  /** a reference to shared steps, which stand in its place */
  shared?: string;
}

export interface SharedSteps {
  id: string;
  name: string;
  steps: readonly { action: string; expected: string }[];
}

export interface ShownStep {
  action: string;
  expected: string;
  /** the shared steps this step came from */
  from?: { id: string; name: string };
}

/** A case's steps with each shared reference replaced by its steps; a missing one says so. */
export function expandSteps(
  steps: readonly DesignStep[],
  shared: ReadonlyMap<string, SharedSteps>,
): ShownStep[] {
  const out: ShownStep[] = [];
  for (const s of steps) {
    if (!s.shared) {
      out.push({ action: s.action, expected: s.expected });
      continue;
    }
    const set = shared.get(s.shared);
    if (!set) {
      out.push({ action: '(shared steps that were removed)', expected: '' });
      continue;
    }
    for (const x of set.steps)
      out.push({ action: x.action, expected: x.expected, from: { id: set.id, name: set.name } });
  }
  return out;
}

const PLACEHOLDER = /<([A-Za-z][A-Za-z0-9_]{0,30})>/g;

/** The parameter names a text uses as <name>. */
export const placeholdersIn = (text: string): string[] => [
  ...new Set([...text.matchAll(PLACEHOLDER)].map((m) => m[1] ?? '')),
];

/** The text with each <name> the values know replaced; unknown names stay as written. */
export const fillPlaceholders = (text: string, values: Readonly<Record<string, unknown>>): string =>
  text.replace(PLACEHOLDER, (all, name: string) => {
    const v = values[name];
    return typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'
      ? String(v)
      : all;
  });

export interface GherkinScenario {
  name: string;
  outline: boolean;
  steps: { keyword: string; text: string }[];
  examples: { headers: string[]; rows: string[][] };
}

export interface Gherkin {
  feature: string;
  background: { keyword: string; text: string }[];
  scenarios: GherkinScenario[];
  errors: { line: number; message: string }[];
}

const STEP = /^(Given|When|Then|And|But|\*)\s+(.+)$/;
const cells = (line: string): string[] =>
  line
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((c) => c.trim());

/** Reads Gherkin: a feature, an optional background, scenarios and outlines with their examples. */
export function parseGherkin(text: string): Gherkin {
  const out: Gherkin = { feature: '', background: [], scenarios: [], errors: [] };
  let section: 'none' | 'background' | 'scenario' | 'examples' = 'none';
  let current: GherkinScenario | null = null;
  const lines = text.split(/\r?\n/);
  lines.forEach((raw, i) => {
    const n = i + 1;
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('@')) return;
    let m: RegExpExecArray | null;
    if ((m = /^Feature:\s*(.*)$/.exec(line))) {
      out.feature = (m[1] ?? '').trim();
      section = 'none';
    } else if (/^Background:/.test(line)) section = 'background';
    else if ((m = /^Scenario( Outline| Template)?:\s*(.*)$/.exec(line))) {
      current = {
        name: (m[2] ?? '').trim(),
        outline: Boolean(m[1]),
        steps: [],
        examples: { headers: [], rows: [] },
      };
      out.scenarios.push(current);
      section = 'scenario';
    } else if (/^(Examples|Scenarios):/.test(line)) {
      if (!current?.outline)
        out.errors.push({ line: n, message: 'Examples belong to a Scenario Outline' });
      section = 'examples';
    } else if ((m = STEP.exec(line))) {
      const step = { keyword: m[1] ?? '', text: (m[2] ?? '').trim() };
      if (section === 'background') out.background.push(step);
      else if (section === 'scenario' && current) current.steps.push(step);
      else out.errors.push({ line: n, message: 'A step outside a Scenario or Background' });
    } else if (line.startsWith('|')) {
      if (section !== 'examples' || !current) {
        // a data table under a step: kept with the step before
        const last = current?.steps.at(-1) ?? out.background.at(-1);
        if (last) last.text += ' ' + line;
        else out.errors.push({ line: n, message: 'A table outside a step or Examples' });
        return;
      }
      const row = cells(line);
      if (!current.examples.headers.length) current.examples.headers = row;
      else if (row.length !== current.examples.headers.length)
        out.errors.push({
          line: n,
          message:
            'This row has ' +
            String(row.length) +
            ' cells, the header ' +
            String(current.examples.headers.length),
        });
      else current.examples.rows.push(row);
    } else if (section === 'none' && out.feature) {
      // the feature's description
    } else out.errors.push({ line: n, message: 'Not Gherkin: ' + line.slice(0, 60) });
  });
  if (!out.scenarios.length) out.errors.push({ line: 0, message: 'No Scenario' });
  for (const s of out.scenarios) {
    if (!s.steps.length)
      out.errors.push({ line: 0, message: 'Scenario "' + s.name + '" has no steps' });
    if (s.outline && !s.examples.rows.length)
      out.errors.push({ line: 0, message: 'Scenario Outline "' + s.name + '" has no Examples' });
    if (s.outline)
      for (const name of placeholdersIn(s.steps.map((x) => x.text).join(' ')))
        if (!s.examples.headers.includes(name))
          out.errors.push({
            line: 0,
            message: '<' + name + '> in "' + s.name + '" is not a column of its Examples',
          });
  }
  return out;
}

/**
 * A scenario as steps: Given and When lines are actions; a Then line, and And or But after it, is the
 * expected result of the action before it.
 */
export function gherkinSteps(
  background: readonly { keyword: string; text: string }[],
  scenario: GherkinScenario,
): { action: string; expected: string }[] {
  const out: { action: string; expected: string }[] = [];
  let mode: 'action' | 'expected' = 'action';
  for (const s of [...background, ...scenario.steps]) {
    if (s.keyword === 'Then') mode = 'expected';
    else if (s.keyword === 'Given' || s.keyword === 'When') mode = 'action';
    const last = out.at(-1);
    if (mode === 'expected' && last)
      last.expected = last.expected ? last.expected + '; ' + s.text : s.text;
    else if (mode === 'expected') out.push({ action: '(no action)', expected: s.text });
    else out.push({ action: (s.keyword === '*' ? '' : s.keyword + ' ') + s.text, expected: '' });
  }
  return out;
}

/** An outline's Examples as parameters: each column with its values, in order, without repeats. */
export function examplesAsParameters(scenario: GherkinScenario): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  scenario.examples.headers.forEach((h, i) => {
    out[h] = [...new Set(scenario.examples.rows.map((r) => r[i] ?? ''))];
  });
  return out;
}

/** One scenario as Gherkin of its own: the feature line, the background and the scenario with its Examples. */
export function gherkinText(
  feature: string,
  background: readonly { keyword: string; text: string }[],
  scenario: GherkinScenario,
): string {
  const out: string[] = ['Feature: ' + feature, ''];
  if (background.length) {
    out.push('  Background:');
    for (const s of background) out.push('    ' + s.keyword + ' ' + s.text);
    out.push('');
  }
  out.push('  Scenario' + (scenario.outline ? ' Outline' : '') + ': ' + scenario.name);
  for (const s of scenario.steps) out.push('    ' + s.keyword + ' ' + s.text);
  if (scenario.outline) {
    out.push('', '    Examples:');
    for (const r of [scenario.examples.headers, ...scenario.examples.rows])
      out.push('      | ' + r.join(' | ') + ' |');
  }
  return out.join('\n') + '\n';
}
