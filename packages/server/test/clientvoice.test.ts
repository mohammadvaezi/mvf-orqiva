// ── [PCODE-337 | S15 | v0.1.0] T34.1b Request votes and duplicate merge, NPS survey, embeddable feedback widget ──
//    Why:  the NPS counts promoters against detractors, an origin is only scheme, host and port, and the
//          widget's script is valid JavaScript.
import { Script } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { npsOf, originOf, WIDGET_JS } from '../src/api/clientvoice.js';

describe('the client voice', () => {
  it('scores promoters against detractors', () => {
    expect(npsOf([])).toEqual({ score: null, promoters: 0, passives: 0, detractors: 0 });
    expect(npsOf([10, 9, 8, 7, 6, 0])).toEqual({
      score: 0,
      promoters: 2,
      passives: 2,
      detractors: 2,
    });
    expect(npsOf([10, 10, 9, 3]).score).toBe(50);
  });

  it('reduces an address to its origin', () => {
    expect(originOf('https://app.example.com/x?y=1')).toBe('https://app.example.com');
    expect(originOf('http://localhost:5173/')).toBe('http://localhost:5173');
    expect(originOf('ftp://x.example')).toBeNull();
    expect(originOf('not a url')).toBeNull();
  });

  it('ships a script that parses', () => {
    expect(() => new Script(WIDGET_JS)).not.toThrow();
  });
});
