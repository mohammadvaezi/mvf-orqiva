// ── [PCODE-181 | S15 | v0.1.0] B5.2 Tokens and costs live: AI spend, budgets, prices, provider keys per project, access tokens with scopes, policy, leak revocation ──
//    Why:  the spend chart must mark the days that stand out and keep the bars in their box; money reads
//          in German euro; the page renders without inline styles.
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { money, spendBars, TokensHub } from '../src/v2/tokenspage.js';

describe('tokens and costs page', () => {
  it('draws the spend bars in their box and marks the spikes', () => {
    const bars = spendBars([{ cents: 100 }, { cents: 400 }, { cents: 0 }], [1]);
    expect(bars.map((b) => [Math.round(b.h), b.spike])).toEqual([
      [43, false],
      [170, true],
      [0, false],
    ]);
    expect(bars.every((b) => b.x + b.w <= 760)).toBe(true);
  });

  it('writes money as people read it', () => {
    expect(money(8)).toMatch(/^0,08\s€$/);
    expect(money(128_600)).toMatch(/^1\.286\s€$/);
  });

  it('renders without inline styles', () => {
    const html = renderToString(<TokensHub workspaceId="w" role="admin" />);
    expect(html).toContain('Tokens and costs');
    expect(html).not.toContain('style=');
  });
});
