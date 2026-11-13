// ── [PCODE-296 | S15 | v0.1.0] T30.9 Accessibility checks: alt text, names, focus order, target size, in the code and on the page ──
//    Why:  rules read as words, the most frequent first.
import { describe, expect, it } from 'vitest';
import { countsText, ruleText } from '../src/v2/a11ychecks.js';

describe('accessibility in the Checks tab', () => {
  it('names rules and orders counts', () => {
    expect(ruleText('target-size')).toBe('Target smaller than 24 × 24 px');
    expect(ruleText('unknown-rule')).toBe('unknown-rule');
    expect(countsText({ 'alt-missing': 1, 'focus-invisible': 4 })).toBe(
      'No visible focus mark 4, Image without alt text 1',
    );
  });
});
