// ── [PCODE-294 | S15 | v0.1.0] T30.8a Overlay compare of mockup versions, client pins in the portal ──
//    Why:  the compare modes are offered in order and the slider says what it does.
import { describe, expect, it } from 'vitest';
import { COMPARE_MODES, sliderLabel } from '../src/v2/overlay.js';

describe('overlay compare', () => {
  it('offers four ways to compare and names the slider', () => {
    expect(COMPARE_MODES.map((m) => m.key)).toEqual(['side', 'overlay', 'swipe', 'difference']);
    expect(sliderLabel('overlay', 30)).toBe('30 % of the newer one');
    expect(sliderLabel('swipe', 70)).toBe('Newer one on the left 70 %');
    expect(sliderLabel('difference', 10)).toBe('');
  });
});
