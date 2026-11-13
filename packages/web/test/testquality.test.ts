// ── [PCODE-315 | S15 | v0.1.0] T32.3a Cypress and Allure import, defects in the trace, leakage and burndown ──
//    Why:  the files picked become the import route's body (Allure's many files one list), and the
//          burndown's line stays in its box.
import { describe, expect, it } from 'vitest';
import { importBody, linePoints } from '../src/v2/testquality.js';

describe('test reports and quality in the web app', () => {
  it('turns the picked files into the import body', () => {
    expect(importBody('cypress', [{ name: 'mochawesome.json', text: '{"results":[]}' }])).toEqual({
      ok: true,
      body: { format: 'cypress', name: 'mochawesome', report: { results: [] } },
    });
    const allure = importBody('allure', [
      { name: 'a-result.json', text: '{"name":"a"}' },
      { name: 'b-result.json', text: '{"name":"b"}' },
    ]);
    expect(allure).toEqual({
      ok: true,
      body: {
        format: 'allure',
        name: 'Allure 2 results',
        report: { results: [{ name: 'a' }, { name: 'b' }] },
      },
    });
    expect(importBody('playwright', [{ name: 'x.json', text: 'nope' }])).toEqual({
      ok: false,
      error: 'x.json is not JSON',
    });
    expect(
      importBody('playwright', [
        { name: 'a.json', text: '{}' },
        { name: 'b.json', text: '{}' },
      ]),
    ).toEqual({ ok: false, error: 'One report file at a time' });
  });

  it('draws a line from the top of its box', () => {
    expect(linePoints([4, 2, 0], 4, 100, 50)).toBe('0,0 50,25 100,50');
    expect(linePoints([], 4, 100, 50)).toBe('');
  });
});
