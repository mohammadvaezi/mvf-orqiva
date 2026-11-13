// ── [PCODE-184 | S15 | v0.1.0] B6.2 Insights live: cycle time, throughput, escaped bugs, AI cost per point, agents vs people for admins, flow, per project, team load ──
//    Why:  the throughput chart splits people and agents only when the server sends the split (admins),
//          keeps its bars in the box, and the page renders without inline styles.
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { InsightsHub, throughputBars } from '../src/v2/insightspage.js';

const weeks = [
  { week: '2026-09-28', done: 3, points: 10, agentDone: 1, agentPoints: 4 },
  { week: '2026-10-05', done: 2, points: 20, agentDone: null, agentPoints: null },
];

describe('insights page', () => {
  it('splits bars only when the split is there', () => {
    const split = throughputBars(weeks, true);
    expect(split.map((b) => [Math.round(b.people), Math.round(b.agents), b.label])).toEqual([
      [51, 34, '28.09.'],
      [170, 0, '05.10.'],
    ]);
    expect(throughputBars(weeks, false)[0]?.agents).toBe(0);
    expect(split.every((b) => b.x < 560)).toBe(true);
  });

  it('renders without inline styles', () => {
    const html = renderToString(<InsightsHub workspaceId="w" role="member" go={() => undefined} />);
    expect(html).toContain('Insights');
    expect(html).not.toContain('style=');
  });
});
