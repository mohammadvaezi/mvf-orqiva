// ── [PCODE-180 | S15 | v0.1.0] B5.1 Agents live: settings, versioned prompts, action rules, autonomy, pause all, budgets in euro, traces, costs, quality ──
import { describe, expect, it } from 'vitest';
import { firstSentence, monthForecast, toolDecision, usdMicrosToCents } from '../src/agents.js';

describe('agent rules', () => {
  it('decides from autonomy and rules; reading always runs', () => {
    expect(toolDecision('get_item', 'suggest', {})).toBe('run');
    expect(toolDecision('add_comment', 'suggest', {})).toBe('refuse');
    expect(toolDecision('add_comment', 'approve', {})).toBe('ask');
    expect(toolDecision('add_comment', 'scoped', {})).toBe('run');
    expect(toolDecision('move_item', 'autonomous', {})).toBe('ask');
    expect(toolDecision('move_item', 'autonomous', { move: 'allowed' })).toBe('run');
    expect(toolDecision('create_item', 'autonomous', { write: 'never' })).toBe('refuse');
    expect(toolDecision('unknown_tool', 'autonomous', {})).toBe('refuse');
  });

  it('turns dollars into euro, forecasts the month and summarises a run', () => {
    expect(usdMicrosToCents(1_000_000, 0.92)).toBe(92);
    expect(monthForecast(1000, 10, 31)).toBe(3100);
    expect(monthForecast(500, 0, 30)).toBe(500);
    expect(firstSentence('Added a timeout to the routing call.  Then fixed a test.')).toBe(
      'Added a timeout to the routing call.',
    );
    expect(firstSentence('No full stop here')).toBe('No full stop here');
    expect(firstSentence('x'.repeat(300))).toHaveLength(200);
  });
});
