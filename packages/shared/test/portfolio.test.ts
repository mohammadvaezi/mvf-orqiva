// ── [PCODE-209 | S15 | v0.1.0] T18.1 Portfolio on the server: health, risk heatmap, gates, cards in progress with people and agents, alerts, 24 h replay ──
//    Why:  a project's heatmap names each risk in words, and its health is the worst of them.
import { describe, expect, it } from 'vitest';
import { healthOf, heatOf, type PortfolioFacts } from '../src/index.js';

const calm: PortfolioFacts = {
  overdue: 0,
  sprint: { total: 10, done: 5, dayShare: 0.5 },
  failedTests: 0,
  criticalFindings: 0,
  highFindings: 0,
  seriousIncidents: 0,
  otherIncidents: 0,
  failedDeploys24h: 0,
  budgetUsed: 0.4,
};

describe('portfolio health', () => {
  it('is on track when nothing warns', () => {
    const heat = heatOf(calm);
    expect(Object.values(heat).map((c) => c.level)).toEqual(['ok', 'ok', 'ok', 'ok', 'ok']);
    expect(heat.budget.note).toBe('40 % of the AI budget');
    expect(healthOf(heat)).toEqual({ health: 'on-track', reasons: [] });
  });

  it('names the risks, the bad ones first', () => {
    const heat = heatOf({
      ...calm,
      overdue: 1,
      sprint: { total: 10, done: 2, dayShare: 0.5 },
      failedTests: null,
      highFindings: 2,
      seriousIncidents: 1,
      failedDeploys24h: 1,
      budgetUsed: null,
    });
    expect(heat.delivery).toEqual({ level: 'warn', note: '1 task overdue, sprint behind' });
    expect(heat.quality.level).toBe('none');
    expect(heat.operations).toEqual({ level: 'bad', note: '1 SEV-1/2 incident open' });
    expect(healthOf(heat)).toEqual({
      health: 'critical',
      reasons: ['1 SEV-1/2 incident open', '1 task overdue, sprint behind', '2 high findings'],
    });
    expect(heatOf({ ...calm, budgetUsed: 1.05 }).budget).toEqual({
      level: 'bad',
      note: '105 % of the AI budget used',
    });
    expect(heatOf({ ...calm, failedTests: 3 }).quality.note).toBe('3 tests failing');
  });
});
