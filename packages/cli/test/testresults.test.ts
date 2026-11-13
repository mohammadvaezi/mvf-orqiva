// ── [PCODE-317 | S15 | v0.1.0] T32.4a AI triage of test failures and impacted tests first ──
// ── [PCODE-315 | S15 | v0.1.0] T32.3a Cypress and Allure import, defects in the trace, leakage and burndown ──
// ── [PCODE-136 | S15 | v0.1.0] Stream test results from a running suite and import JUnit ──
import { describe, expect, it } from 'vitest';
import type { Api } from '../src/loop/api.js';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { impactedText, readReport, ResultSender } from '../src/tests/command.js';
import { decodeEntities, parseXml, readJunit } from '../src/tests/junit.js';
import { readTap, TapReader, type TestResult } from '../src/tests/tap.js';

// as node --test writes it: nested subtests, YAML blocks, a suite line closing them
const NODE_TAP = `TAP version 13
# Subtest: export
    # Subtest: writes a header
    ok 1 - writes a header
      ---
      duration_ms: 0.61
      ...
    # Subtest: writes ISO dates
    not ok 2 - writes ISO dates
      ---
      duration_ms: 1.2
      failureType: 'testCodeFailure'
      error: |-
        Expected values to be strictly equal:
        '2026-10-04' !== '04.10.2026'
      ...
    1..2
not ok 1 - export
  ---
  duration_ms: 3
  ...
# Subtest: later
ok 2 - later # SKIP not ready
1..2
# tests 3`;

// as vitest --reporter=tap-flat writes it
const FLAT_TAP = `TAP version 13
1..3
ok 1 - src/a.test.ts > csv > header
not ok 2 - src/a.test.ts > csv > dates
    ---
    error:
        name: "AssertionError"
        message: "expected 1 to be 2"
    at: "src/a.test.ts:9:5"
    ...
ok 3 - src/b.test.ts > todo later # TODO`;

describe('our TAP reader', () => {
  it('reports the tests of nested subtests, not their suites, with times and failure messages', () => {
    expect(readTap(NODE_TAP)).toEqual([
      { key: 'export > writes a header', status: 'passed', durationMs: 1 },
      {
        key: 'export > writes ISO dates',
        status: 'failed',
        durationMs: 1,
        message: "Expected values to be strictly equal:\n'2026-10-04' !== '04.10.2026'",
      },
      { key: 'later', status: 'skipped' },
    ]);
  });

  it('reads flat TAP, line by line as it arrives', () => {
    const seen: TestResult[] = [];
    const r = new TapReader((x) => seen.push(x));
    const lines = FLAT_TAP.split('\n');
    r.line(lines[0] ?? '');
    r.line(lines[1] ?? '');
    r.line(lines[2] ?? '');
    // the first result is out as soon as the next line shows it is complete
    r.line(lines[3] ?? '');
    expect(seen.map((x) => x.key)).toEqual(['src/a.test.ts > csv > header']);
    for (const l of lines.slice(4)) r.line(l);
    r.end();
    expect(seen.map((x) => [x.key, x.status])).toEqual([
      ['src/a.test.ts > csv > header', 'passed'],
      ['src/a.test.ts > csv > dates', 'failed'],
      ['src/b.test.ts > todo later', 'skipped'],
    ]);
  });
});

describe('our XML and JUnit reader', () => {
  it('decodes entities, CDATA and comments', () => {
    expect(decodeEntities('a &lt; b &amp;&amp; c &#38; &#x41; &unknown;')).toBe(
      'a < b && c & A &unknown;',
    );
    const el = parseXml(
      '<?xml version="1.0"?><!-- c --><a x=\'1\' y="&quot;2&quot;"><b/><c><![CDATA[<raw>]]></c></a>',
    );
    expect(el).toMatchObject({ name: 'a', attrs: { x: '1', y: '"2"' } });
    expect(el.children.map((c) => c.name)).toEqual(['b', 'c']);
    expect(el.children[1]?.text).toBe('<raw>');
    expect(() => parseXml('<a><b></a>')).toThrow('</a> does not close <b>');
  });

  it('turns test cases into results, nested suites first', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites>
  <testsuite name="export" tests="3">
    <testsuite name="csv">
      <testcase classname="csv" name="header" time="0.012"/>
      <testcase name="dates &amp; times" time="0.5">
        <failure message="expected ISO" type="AssertionError">at line 9</failure>
      </testcase>
    </testsuite>
    <testcase classname="com.app.ExportTest" name="later"><skipped/></testcase>
  </testsuite>
</testsuites>`;
    expect(readJunit(xml)).toEqual([
      { key: 'export > csv > header', status: 'passed', durationMs: 12 },
      {
        key: 'export > csv > dates & times',
        status: 'failed',
        durationMs: 500,
        message: 'expected ISO\nat line 9',
      },
      { key: 'export > com.app.ExportTest > later', status: 'skipped' },
    ]);
  });
});

describe('sending results', () => {
  it('sends in order, in batches, and counts what could not be sent', async () => {
    const calls: { path: string; n: number }[] = [];
    let fail = false;
    const api: Api = {
      call<T>(_m: string, path: string, body?: unknown): Promise<T> {
        if (fail) return Promise.reject(new Error('down'));
        calls.push({ path, n: (body as { results: unknown[] }).results.length });
        return Promise.resolve({} as T);
      },
    };
    const s = new ResultSender(api, '/r', 10_000, 2);
    for (let i = 0; i < 5; i++) s.add({ key: 't' + String(i), status: 'passed' });
    await s.done();
    expect(calls).toEqual([
      { path: '/r', n: 2 },
      { path: '/r', n: 2 },
      { path: '/r', n: 1 },
    ]);
    fail = true;
    s.add({ key: 'x', status: 'failed' });
    await s.done();
    expect([s.sent, s.failedSends]).toEqual([5, 1]);
  });
});

// ── [PCODE-315 | S15 | v0.1.0] T32.3a Cypress and Allure import, defects in the trace, leakage and burndown ──
describe('reports the server reads', () => {
  it('tells an allure-results folder, Cypress and Playwright JSON and JUnit apart', () => {
    const dir = mkdtempSync(join(tmpdir(), 'orq-reports-'));
    const allure = join(dir, 'allure-results');
    mkdirSync(allure);
    writeFileSync(join(allure, 'a-result.json'), '{"name":"a","status":"passed"}');
    writeFileSync(join(allure, 'a-container.json'), '{"children":[]}');
    writeFileSync(join(dir, 'cy.json'), '{"stats":{},"results":[]}');
    writeFileSync(join(dir, 'pw.json'), '{"config":{},"suites":[]}');
    writeFileSync(join(dir, 'other.json'), '{"tests":[]}');
    writeFileSync(join(dir, 'junit.xml'), '<testsuites/>');
    expect(readReport(allure)).toEqual({
      format: 'allure',
      report: { results: [{ name: 'a', status: 'passed' }] },
    });
    expect(readReport(join(dir, 'cy.json'))?.format).toBe('cypress');
    expect(readReport(join(dir, 'pw.json'))?.format).toBe('playwright');
    expect(readReport(join(dir, 'junit.xml'))).toBeNull();
    expect(() => readReport(join(dir, 'other.json'))).toThrow(/neither a Playwright nor a Cypress/);
    expect(() => readReport(dir)).toThrow(/no Allure -result.json files/);
  });
});

// [PCODE-317 | S15 | v0.1.0]
describe('impacted cases for CI', () => {
  it('lists the cases with why they matter', () => {
    expect(
      impactedText(
        [{ title: 'Cart keeps items', score: 5, reasons: ['SHOP-1 wrote src/cart.ts'] }],
        2,
        'main',
      ),
    ).toBe(
      '1 case covers the 2 files changed since main:\n  Cart keeps items  (SHOP-1 wrote src/cart.ts)',
    );
    expect(impactedText([], 3, 'origin/main')).toBe(
      'No case covers the 3 files changed since origin/main.',
    );
  });
});
