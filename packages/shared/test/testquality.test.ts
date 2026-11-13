// ── [PCODE-315 | S15 | v0.1.0] T32.3a Cypress and Allure import, defects in the trace, leakage and burndown ──
//    Why:  the recorded Cypress (mochawesome) and Allure reports read into results with suites, keys,
//          statuses (pending is skipped, broken is failed, the last retry counts) and messages; leakage and
//          the burndown add up.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { defectLeakage, parseAllure, parseMochawesome, testBurndown } from '../src/testquality.js';

const fixture = (name: string): unknown =>
  JSON.parse(
    readFileSync(
      new URL('../../server/test/fixtures/testreports/' + name, import.meta.url),
      'utf8',
    ),
  ) as unknown;

describe('test reports and quality', () => {
  it('reads Cypress’s mochawesome report', () => {
    const r = parseMochawesome(fixture('cypress-mochawesome.json'));
    expect(r.map((x) => [x.key, x.suite, x.status, x.durationMs])).toEqual([
      ['cy:cypress/e2e/cart.cy.js › Cart › keeps items between visits', 'Cart', 'passed', 1203],
      ['cy:cypress/e2e/cart.cy.js › Cart › rounds totals to cents', 'Cart', 'failed', 845],
      [
        'cy:cypress/e2e/cart.cy.js › Cart › when empty › shows a hint',
        'Cart / when empty',
        'skipped',
        0,
      ],
      [
        'cy:cypress/e2e/checkout.cy.js › pays by card',
        'cypress/e2e/checkout.cy.js',
        'passed',
        2310,
      ],
    ]);
    expect(r[1]?.message).toContain("expected '0.335' to equal '0.34'");
    expect(parseMochawesome({})).toEqual([]);
  });

  it('reads Allure’s result files, the last retry counting', () => {
    const r = parseAllure(fixture('allure-results.json') as unknown[]);
    expect(r.map((x) => [x.title, x.suite, x.status, x.durationMs])).toEqual([
      ['test_keeps_items', 'tests / test_cart / TestCart', 'passed', 1500],
      ['test_rounds_totals', 'tests / test_cart / TestCart', 'passed', 120],
      ['test_pays_by_card', 'tests / test_checkout', 'failed', 3000],
      ['test_invoice_pdf', 'tests / test_checkout', 'skipped', 0],
    ]);
    expect(r[0]?.key).toBe('allure:tests.test_cart.TestCart#test_keeps_items');
    expect(r[2]?.message).toBe('ConnectionError: payment sandbox not reachable');
  });

  it('measures leakage and works the planned cases down by day', () => {
    expect(defectLeakage(3, 1)).toBe(25);
    expect(defectLeakage(0, 0)).toBeNull();
    const days = testBurndown(
      ['a', 'b', 'c'],
      [
        { caseId: 'a', status: 'passed', at: '2026-10-12T09:00:00Z' },
        { caseId: 'b', status: 'failed', at: '2026-10-12T15:00:00Z' },
        { caseId: 'b', status: 'passed', at: '2026-10-14T10:00:00Z' },
        { caseId: 'x', status: 'passed', at: '2026-10-12T10:00:00Z' },
      ],
      '2026-10-11T22:00:00Z',
      '2026-10-14T18:00:00Z',
    );
    expect(days).toEqual([
      { day: '2026-10-11', remaining: 3, passed: 0, failed: 0 },
      { day: '2026-10-12', remaining: 1, passed: 1, failed: 1 },
      { day: '2026-10-13', remaining: 1, passed: 1, failed: 1 },
      { day: '2026-10-14', remaining: 1, passed: 2, failed: 0 },
    ]);
  });
});
