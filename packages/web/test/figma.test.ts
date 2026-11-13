// ── [PCODE-297 | S15 | v0.1.0] T30.10 Figma two-way sync: variables and components, tested against recorded Figma answers ──
//    Why:  values read in one line, and the decisions sent as the server expects them: conflicts go to
//          the side picked, the ones left for later go nowhere.
import { describe, expect, it } from 'vitest';
import { decisions, tokenText } from '../src/v2/figma.js';

const t = (light: string, dark = light, themes: Record<string, string> = {}) => ({
  type: 'color',
  light,
  dark,
  themes,
});

describe('the Figma card', () => {
  it('reads values and sorts decisions', () => {
    expect(tokenText(t('#111111', '#eeeeee', { contrast: '#000000' }))).toBe(
      '#111111 · dark #eeeeee · contrast #000000',
    );
    expect(tokenText(null)).toBe('not there');
    const plan = {
      pull: [
        { name: 'a', kind: 'change' as const, from: t('#1'), to: t('#2') },
        { name: 'b', kind: 'add' as const, from: null, to: t('#3') },
      ],
      push: [{ name: 'c', kind: 'add' as const, from: null, to: t('#4') }],
      conflicts: [
        { name: 'd', orqiva: t('#5'), figma: t('#6') },
        { name: 'e', orqiva: t('#7'), figma: t('#8') },
        { name: 'f', orqiva: t('#9'), figma: t('#0') },
      ],
      inSync: 3,
    };
    expect(
      decisions(plan, new Set(['a']), new Set(['c']), { d: 'figma', e: 'orqiva', f: '' }),
    ).toEqual({
      take: ['a', 'd'],
      send: ['c', 'e'],
    });
  });
});
