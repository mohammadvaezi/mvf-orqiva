// ── [PCODE-328 | S15 | v0.1.0] T33.1b Cost estimate before a run, chargeback per client and cost centre, unit costs ──
// ── [PCODE-327 | S15 | v0.1.0] T33.1a Cache and reasoning tokens priced, the daily ECB rate, spend in euro by day ──
// ── [PCODE-180 | S15 | v0.1.0] B5.1 Agents live: settings, versioned prompts, action rules, autonomy, pause all, budgets in euro, traces, costs, quality ──
//    Why:  a run's trace is how people see what an agent did and what it cost, so each step must say what
//          it was and how long it took; cost cells are coloured by size; the page renders for the team.
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EventHub } from '../src/core/hub.js';
import {
  AgentsHub,
  AUTONOMY,
  estimateText,
  heat,
  traceExtra,
  traceOf,
} from '../src/v2/agentspage.js';

const step = (
  seq: number,
  kind: string,
  content: Record<string, unknown>,
  at: string,
  costMicros = 0,
) => ({
  seq,
  kind,
  content,
  tokensIn: kind === 'model' ? 100 : 0,
  tokensOut: kind === 'model' ? 50 : 0,
  costMicros,
  at,
});

describe('agents page', () => {
  // [PCODE-328 | S15 | v0.1.0] the estimate says its range and what it rests on
  it('words the estimate before a run', () => {
    const e = {
      lowCents: 20,
      midCents: 40,
      highCents: 80,
      basis: 'rough' as const,
      runs: 1,
      model: 'm-1',
    };
    const n = (x: string): string => x.replace(/\s/g, ' ');
    expect(n(estimateText(e))).toBe(
      'Likely about 0,40 € (0,20 €–0,80 €), a rough guess from the instruction and the price of m-1',
    );
    expect(n(estimateText({ ...e, basis: 'history', runs: 12 }))).toContain(
      'from the last 12 finished runs of this agent',
    );
    expect(n(estimateText({ ...e, lowCents: 0, midCents: 0, highCents: 0 }))).toMatch(
      /^Likely less than 0,01 €, a rough guess/,
    );
  });

  it('turns a run’s steps into a trace with durations', () => {
    const lines = traceOf(
      {
        createdAt: '2026-10-05T08:00:00Z',
        startedAt: '2026-10-05T08:00:00Z',
        finishedAt: '2026-10-05T08:00:10Z',
      },
      [
        step(
          1,
          'model',
          { blocks: [{ type: 'tool_use', name: 'get_item' }] },
          '2026-10-05T08:00:02Z',
          500,
        ),
        step(2, 'tool_result', { results: [] }, '2026-10-05T08:00:03Z'),
        step(3, 'approval', { tool: 'move_item' }, '2026-10-05T08:00:03Z'),
        step(4, 'decision', { approve: false, by: 'Ada' }, '2026-10-05T08:00:08Z'),
        step(
          5,
          'model',
          { blocks: [{ type: 'text', text: 'Left it as it is.' }] },
          '2026-10-05T08:00:10Z',
          300,
        ),
      ],
    );
    expect(lines.map((l) => [l.label, l.start, l.dur])).toEqual([
      ['model: calls get_item', 0, 2000],
      ['tools ran', 2000, 1000],
      ['asks a person: move_item', 3000, 0],
      ['declined by Ada', 3000, 5000],
      ['model: Left it as it is.', 8000, 2000],
    ]);
    expect(lines[0]?.tokens).toBe(150);
    // [PCODE-327 | S15 | v0.1.0] the cache and the reasoning, said only when there are some
    expect(lines[0] ? traceExtra(lines[0]) : 'x').toBe('');
    expect(traceExtra({ cacheRead: 12000, cacheWrite: 0, reasoning: 300 })).toBe(
      ' · 12.000 cached · 300 reasoning',
    );
  });

  it('colours costs by size and names the autonomy levels', () => {
    expect([heat(500), heat(2000), heat(10_000), heat(30_000)]).toEqual([
      'low',
      'mid',
      'full',
      'over',
    ]);
    expect(Object.values(AUTONOMY)).toEqual([
      'Suggests only',
      'Acts, asks first',
      'Acts within scope',
      'Fully autonomous',
    ]);
  });

  it('renders without inline styles', () => {
    const html = renderToString(
      <AgentsHub workspaceId="w" role="admin" hub={new EventHub()} go={() => undefined} />,
    );
    expect(html).toContain('Agents');
    expect(html).not.toContain('style=');
  });
});
