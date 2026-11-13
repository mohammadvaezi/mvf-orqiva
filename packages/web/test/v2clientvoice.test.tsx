// ── [PCODE-337 | S15 | v0.1.0] T34.1b Request votes and duplicate merge, NPS survey, embeddable feedback widget ──
//    Why:  the NPS reads with its sign.
import { describe, expect, it } from 'vitest';
import { npsText } from '../src/v2/clientvoice.js';

describe('NPS in words', () => {
  it('shows the sign', () => {
    expect(npsText(null)).toBe('—');
    expect(npsText(40)).toBe('+40');
    expect(npsText(-20)).toBe('−20');
    expect(npsText(0)).toBe('0');
  });
});
