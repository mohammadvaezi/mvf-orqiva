// ── [PCODE-309 | S15 | v0.1.0] T31.8b Architecture graph, change coupling and bus factor on the code map ──
//    Why:  the graph's layout puts every folder on the circle with a size from its lines; the bus factor
//          is said in words, naming the one person a folder rests on.
import { describe, expect, it } from 'vitest';
import { busText, circleLayout, commonPrefix, cycleText } from '../src/v2/codearch.js';

describe('architecture and knowledge', () => {
  it('lays folders on a circle, sized by their lines', () => {
    const at = circleLayout(
      [
        { id: 'a', lines: 400 },
        { id: 'b', lines: 100 },
      ],
      { w: 800, h: 520 },
    );
    expect(at.get('a')).toEqual({ x: 400, y: 70, r: 30, side: 'middle' });
    expect(at.get('b')?.side).toBe('middle');
    expect(at.get('b')?.r).toBe(19);
    expect(circleLayout([{ id: 'x', lines: 5 }], { w: 800, h: 520 }).get('x')).toMatchObject({
      x: 400,
      y: 260,
    });
  });

  it('shortens labels and long cycles', () => {
    const ids = ['packages/server/src/api', 'packages/server/src/git', 'packages/server/src'];
    expect(commonPrefix(ids)).toBe('packages/server/');
    expect(commonPrefix(['a'])).toBe('');
    expect(cycleText(['p/a', 'p/b', 'p/c', 'p/d', 'p/e', 'p/f'], 'p/')).toBe(
      'a ⇄ b ⇄ c ⇄ d and 2 more',
    );
  });

  it('says who a folder rests on', () => {
    expect(busText({ busFactor: 1, owner: 'ada', ownerShare: 0.87 })).toBe('only ada (87 %)');
    expect(busText({ busFactor: 3, owner: 'ada', ownerShare: 0.3 })).toBe(
      '3 people know most of it',
    );
    expect(busText({ busFactor: 0, owner: null, ownerShare: 0 })).toBe('written by agents only');
  });
});
