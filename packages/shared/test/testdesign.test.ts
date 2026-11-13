// ── [PCODE-313 | S15 | v0.1.0] T32.1 Test repository: shared steps, parameters in the screen, structured BDD ──
//    Why:  Gherkin becomes steps the way a tester reads it (Then is what to expect), outlines bring their
//          Examples as parameters, mistakes are named by line, shared steps expand and <names> fill.
import { describe, expect, it } from 'vitest';
import {
  examplesAsParameters,
  expandSteps,
  fillPlaceholders,
  gherkinSteps,
  gherkinText,
  parseGherkin,
  placeholdersIn,
} from '../src/testdesign.js';

const FEATURE = `@cart
Feature: Cart
  People keep what they put in the cart.

  Background:
    Given I am signed in as <user>

  Scenario: Items stay between visits
    When I add a book to the cart
    And I come back tomorrow
    Then the book is still in the cart
    And the total is 12.00

  Scenario Outline: Totals round to cents
    When I add items costing <price> to the cart
    Then the total shows <total>

    Examples:
      | user | price  | total |
      | ada  | 0.333  | 0.33  |
      | bob  | 0.335  | 0.34  |
      | ada  | 1      | 1.00  |
`;

describe('test design', () => {
  it('reads a feature: background, scenarios and an outline with its examples', () => {
    const g = parseGherkin(FEATURE);
    expect(g.errors).toEqual([]);
    expect(g.feature).toBe('Cart');
    expect(g.background).toEqual([{ keyword: 'Given', text: 'I am signed in as <user>' }]);
    expect(g.scenarios.map((s) => [s.name, s.outline, s.steps.length])).toEqual([
      ['Items stay between visits', false, 4],
      ['Totals round to cents', true, 2],
    ]);
    const outline = g.scenarios[1];
    if (!outline) throw new Error('no outline');
    expect(examplesAsParameters(outline)).toEqual({
      user: ['ada', 'bob'],
      price: ['0.333', '0.335', '1'],
      total: ['0.33', '0.34', '1.00'],
    });
  });

  it('makes steps: Given and When act, Then and its Ands are expected', () => {
    const g = parseGherkin(FEATURE);
    const first = g.scenarios[0];
    if (!first) throw new Error('no scenario');
    expect(gherkinSteps(g.background, first)).toEqual([
      { action: 'Given I am signed in as <user>', expected: '' },
      { action: 'When I add a book to the cart', expected: '' },
      {
        action: 'And I come back tomorrow',
        expected: 'the book is still in the cart; the total is 12.00',
      },
    ]);
    // one scenario written back on its own reads the same
    const again = parseGherkin(gherkinText(g.feature, g.background, first));
    expect(again.errors).toEqual([]);
    expect(again.scenarios[0]?.steps).toEqual(first.steps);
  });

  it('names mistakes by line', () => {
    const g = parseGherkin(
      [
        'Feature: Cart',
        'Scenario: Empty',
        'Scenario Outline: Prices',
        '  When I pay <amount>',
        '  Examples:',
        '    | price |',
        '    | 1 | 2 |',
        'Clicking around',
      ].join('\n'),
    );
    expect(g.errors).toEqual([
      { line: 7, message: 'This row has 2 cells, the header 1' },
      { line: 8, message: 'Not Gherkin: Clicking around' },
      { line: 0, message: 'Scenario "Empty" has no steps' },
      { line: 0, message: 'Scenario Outline "Prices" has no Examples' },
      { line: 0, message: '<amount> in "Prices" is not a column of its Examples' },
    ]);
    expect(parseGherkin('Given nothing').errors.map((e) => e.message)).toEqual([
      'A step outside a Scenario or Background',
      'No Scenario',
    ]);
  });

  it('expands shared steps and fills parameters', () => {
    const shared = new Map([
      [
        's1',
        {
          id: 's1',
          name: 'Sign in',
          steps: [
            { action: 'Open <url>', expected: '' },
            { action: 'Sign in', expected: 'The board shows' },
          ],
        },
      ],
    ]);
    const shown = expandSteps(
      [
        { action: '', expected: '', shared: 's1' },
        { action: 'Open the cart on <browser>', expected: 'It is empty' },
        { action: '', expected: '', shared: 'gone' },
      ],
      shared,
    );
    expect(shown).toEqual([
      { action: 'Open <url>', expected: '', from: { id: 's1', name: 'Sign in' } },
      { action: 'Sign in', expected: 'The board shows', from: { id: 's1', name: 'Sign in' } },
      { action: 'Open the cart on <browser>', expected: 'It is empty' },
      { action: '(shared steps that were removed)', expected: '' },
    ]);
    expect(placeholdersIn('Open <url> on <browser> at <url>')).toEqual(['url', 'browser']);
    expect(fillPlaceholders('Open the cart on <browser> at <width>', { browser: 'webkit' })).toBe(
      'Open the cart on webkit at <width>',
    );
  });
});
