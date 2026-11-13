// ── [PCODE-420 | S15 | v0.1.0] T37 medium: English screens use English number and date formats ──
//    Why:  screens format with the workspace's chosen format: German until told otherwise, English when
//          the workspace picks it, and nothing else.
import { hoursText } from '@orqiva/shared';
import { describe, expect, it } from 'vitest';
import { fmtLocale, setFormatLocale } from '../src/core/locale.js';

describe('the number and date format', () => {
  it('is German by default, English when chosen, and ignores anything else', () => {
    expect(fmtLocale()).toBe('de-DE');
    expect(hoursText(345, fmtLocale())).toBe('5,75');
    setFormatLocale('en-GB');
    expect(hoursText(345, fmtLocale())).toBe('5.75');
    setFormatLocale('fr-FR');
    expect(fmtLocale()).toBe('en-GB');
    setFormatLocale('de-DE');
    expect(fmtLocale()).toBe('de-DE');
  });
});
