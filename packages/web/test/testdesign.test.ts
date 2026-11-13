// ── [PCODE-313 | S15 | v0.1.0] T32.1 Test repository: shared steps, parameters in the screen, structured BDD ──
//    Why:  the editor's rows become parameters only when they are sound, and shared steps read and write
//          as "action -> expected" lines.
import { describe, expect, it } from 'vitest';
import { paramsToRows, rowsToParams, stepsToText, textToSteps } from '../src/v2/testdesign.js';

describe('test design in the web app', () => {
  it('edits parameters as rows and checks them', () => {
    const rows = paramsToRows({ browser: ['chromium', 'webkit'] });
    expect(rows).toEqual([{ name: 'browser', values: 'chromium, webkit' }]);
    expect(
      rowsToParams([...rows, { name: 'size', values: ' s, m , s,' }, { name: '', values: '' }]),
    ).toEqual({ ok: true, value: { browser: ['chromium', 'webkit'], size: ['s', 'm'] } });
    expect(rowsToParams([{ name: '2x', values: 'a' }])).toMatchObject({ ok: false });
    expect(rowsToParams([{ name: 'a', values: '' }])).toEqual({
      ok: false,
      error: 'Give a at least one value',
    });
    expect(
      rowsToParams([
        { name: 'a', values: 'x' },
        { name: 'a', values: 'y' },
      ]),
    ).toEqual({
      ok: false,
      error: 'The parameter a is there twice',
    });
  });

  it('writes shared steps as lines', () => {
    const steps = textToSteps('Open <url>\n\n Sign in -> The board shows \n-> nothing');
    expect(steps).toEqual([
      { action: 'Open <url>', expected: '' },
      { action: 'Sign in', expected: 'The board shows' },
    ]);
    expect(stepsToText(steps)).toBe('Open <url>\nSign in -> The board shows');
  });
});
