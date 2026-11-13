// ── [PCODE-274 | S15 | v0.1.0] T28.3 Stories with Given/When/Then and personas; value/effort matrix, evidence library, compare ──
//    Why:  stories read and written the usual way, scenarios kept only when they say what should happen,
//          and Gherkin a test tool reads.
import { describe, expect, it } from 'vitest';
import { gherkin, scenariosOf, storyParts, storyText } from '../src/stories.js';

describe('user stories', () => {
  it('reads a story in its parts, with or without the benefit', () => {
    expect(
      storyParts('As a dispatcher, I want to see late drivers, so that I can call them.'),
    ).toEqual({ role: 'dispatcher', want: 'to see late drivers', benefit: 'I can call them' });
    expect(storyParts('As an admin I need an export')).toEqual({
      role: 'admin',
      want: 'an export',
      benefit: '',
    });
    expect(storyParts('The export must be CSV.')).toBeNull();
    expect(storyText('admin', 'to export the list', 'finance can check it.')).toBe(
      'As an admin, I want to export the list, so that finance can check it.',
    );
    expect(storyText('dispatcher', 'see late drivers', '')).toBe(
      'As a dispatcher, I want see late drivers.',
    );
  });

  it('keeps scenarios that say what should happen', () => {
    expect(
      scenariosOf([
        {
          given: ' a booking tomorrow ',
          when: 'the day before at 18:00',
          then: 'a reminder goes out',
        },
        { given: 'x', when: 'y', then: '' },
        { then: 'only a then' },
        'nonsense',
        { when: 'the driver opens the app', then: 'no reminder' },
      ]),
    ).toEqual([
      { given: 'a booking tomorrow', when: 'the day before at 18:00', then: 'a reminder goes out' },
      { given: '', when: 'the driver opens the app', then: 'no reminder' },
    ]);
    expect(scenariosOf('x')).toEqual([]);
    expect(scenariosOf(Array.from({ length: 30 }, () => ({ when: 'w', then: 't' })))).toHaveLength(
      20,
    );
  });

  it('writes Gherkin with And for further lines', () => {
    expect(
      gherkin('Booking reminders', [
        {
          code: 'R-3',
          text: 'As a customer, I want a reminder, so that I do not forget.',
          scenarios: [
            {
              given: 'a booking tomorrow\nthe customer has a mobile number',
              when: 'it is 18:00 the day before',
              then: 'Then an SMS goes out\nit names the time',
            },
          ],
        },
        { text: 'As a driver, I want no reminders.', scenarios: [] },
      ]),
    ).toBe(
      [
        'Feature: Booking reminders',
        '',
        '  # R-3 As a customer, I want a reminder, so that I do not forget.',
        '  Scenario: R-3 Then an SMS goes out',
        '    Given a booking tomorrow',
        '    And the customer has a mobile number',
        '    When it is 18:00 the day before',
        '    Then an SMS goes out',
        '    And it names the time',
        '',
        '  # As a driver, I want no reminders.',
        '  # (no scenarios yet)',
        '',
      ].join('\n'),
    );
  });
});
