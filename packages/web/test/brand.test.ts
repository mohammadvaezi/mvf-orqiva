// ── [PCODE-289 | S15 | v0.1.0] T30.3 Brand pages: colour, type, voice, logo use, do and don't ──
//    Why:  a swatch's label is written in whichever of white or near-black reads better on it.
import { describe, expect, it } from 'vitest';
import { labelOn } from '../src/v2/brand.js';

const colour = (onWhite: number, onBlack: number) => ({
  name: 'c',
  written: '#000',
  hex: '#000',
  dark: null,
  rgb: '',
  onWhite,
  onBlack,
  description: '',
});

describe('swatch labels', () => {
  it('picks the label colour with more contrast', () => {
    expect(labelOn(colour(15.3, 1.37))).toBe('#ffffff');
    expect(labelOn(colour(1.1, 19))).toBe('#111111');
  });
});
