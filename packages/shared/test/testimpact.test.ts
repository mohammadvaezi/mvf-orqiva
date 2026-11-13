// ── [PCODE-317 | S15 | v0.1.0] T32.4a AI triage of test failures and impacted tests first ──
//    Why:  the ranking prefers a task that wrote the changed file, then a test named after it, then an
//          import; common names say nothing; the agent's triage reads from its text or not at all.
import { describe, expect, it } from 'vitest';
import { impactedCases, parseFailureTriage } from '../src/testimpact.js';

describe('impacted tests and failure triage', () => {
  it('ranks the cases a change touches', () => {
    const cases = [
      {
        id: 'a',
        title: 'Cart keeps items',
        key: '',
        suite: 'Cart',
        itemRef: 'SHOP-1',
        itemFiles: ['src/cart.ts'],
      },
      {
        id: 'b',
        title: 'adds to the cart',
        key: 'cy:cypress/e2e/cart.cy.js › adds',
        suite: 'Cart',
        itemRef: null,
        itemFiles: [],
      },
      {
        id: 'c',
        title: 'Totals round',
        key: '',
        suite: 'Money',
        itemRef: 'SHOP-2',
        itemFiles: ['src/checkout.ts'],
      },
      {
        id: 'd',
        title: 'Profile page',
        key: '',
        suite: 'Profile',
        itemRef: 'SHOP-3',
        itemFiles: ['src/profile.ts'],
      },
      { id: 'e', title: 'Index loads', key: 'index', suite: '', itemRef: null, itemFiles: [] },
    ];
    const imports = new Map([['src/checkout.ts', ['src/cart.ts', 'src/money.ts']]]);
    const r = impactedCases(['src/cart.ts', 'src/index.ts'], cases, imports);
    expect(r.map((x) => [x.caseId, x.score])).toEqual([
      ['a', 5],
      ['b', 2],
      ['c', 1],
    ]);
    expect(r[0]?.reasons).toEqual(['SHOP-1 wrote src/cart.ts', 'named after src/cart.ts']);
    expect(r[2]?.reasons).toEqual(['src/checkout.ts (by SHOP-2) imports src/cart.ts']);
  });

  it('reads the agent’s triage', () => {
    expect(
      parseFailureTriage(
        'Here: {"category": "environment", "confidence": 0.834, "reason": "The sandbox was down.", "next": "Run again."}',
      ),
    ).toEqual({
      category: 'environment',
      confidence: 0.83,
      reason: 'The sandbox was down.',
      next: 'Run again.',
    });
    expect(parseFailureTriage('{"category": "cosmic rays"}')).toBeNull();
    expect(parseFailureTriage('no idea')).toBeNull();
    expect(parseFailureTriage('{"category": "flaky", "confidence": 7}')?.confidence).toBe(1);
  });
});
