// ── [PCODE-329 | S15 | v0.1.0] T33.2 Agent playground: rerun with other settings, compare runs, A/B experiments ──
//    Why:  a variant sends only what differs from the agent (a German decimal comma included), and its
//          settings read back in one line.
import { describe, expect, it } from 'vitest';
import { settingsText, variantBody } from '../src/v2/playground.js';

describe('playground variants', () => {
  it('sends only the settings that were filled in', () => {
    expect(variantBody({ label: ' A ', model: '', promptVersion: '', temperature: '' })).toEqual({
      label: 'A',
    });
    expect(
      variantBody({ label: 'B', model: ' haiku-5 ', promptVersion: '2', temperature: '0,7' }),
    ).toEqual({ label: 'B', model: 'haiku-5', promptVersion: 2, temperature: 0.7 });
    expect(variantBody({ label: 'C', model: '', promptVersion: '', temperature: 'warm' })).toEqual({
      label: 'C',
    });
  });

  it('says the settings in one line', () => {
    expect(settingsText({ model: null, promptVersion: null, temperature: null })).toBe(
      'as the agent is set',
    );
    expect(settingsText({ model: 'haiku-5', promptVersion: 2, temperature: 0.7 })).toBe(
      'haiku-5 · prompt v2 · temperature 0,7',
    );
  });
});
