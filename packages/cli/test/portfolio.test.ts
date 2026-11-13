// ── [PCODE-211 | S15 | v0.1.0] T18.3 Scale test (20 projects, 50 live users, under 1 s event-to-screen) and orq portfolio ──
//    Why:  the terminal prints every project's health and why, and for one project its cards with the
//          agents at work, plus the open alerts.
import { describe, expect, it } from 'vitest';
import { portfolioLines } from '../src/loop/portfolio.js';

const data = {
  projects: [
    {
      key: 'API',
      name: 'Api',
      phase: null,
      health: 'critical',
      reasons: ['1 critical finding'],
      counts: { open: 4, inProgress: 1, doneThisWeek: 2 },
      cards: [],
    },
    {
      key: 'APP',
      name: 'App',
      phase: 'Build',
      health: 'on-track',
      reasons: [],
      counts: { open: 9, inProgress: 2, doneThisWeek: 5 },
      cards: [
        {
          ref: 'APP-12',
          title: 'Live map',
          assignee: { name: 'Ada' },
          agents: [{ name: 'Developer agent' }],
        },
      ],
    },
  ],
  alerts: [{ projectKey: 'API', severity: 'sev2', title: 'p95 above 3 s', count: 4 }],
};

describe('orq portfolio', () => {
  it('lists every project with health and why, and the alerts', () => {
    expect(portfolioLines(data)).toEqual([
      '■ API     critical  Api · 1 in progress, 4 open, 2 done this week',
      '    1 critical finding',
      '● APP     on track  App · Build · 2 in progress, 9 open, 5 done this week',
      '',
      'Open alerts:',
      '  SEV2 API     p95 above 3 s (4×)',
    ]);
  });

  it('shows one project with its cards', () => {
    expect(portfolioLines(data, 'app')).toEqual([
      '● APP     on track  App · Build · 2 in progress, 9 open, 5 done this week',
      '    APP-12    Live map (Ada) · Developer agent at work',
    ]);
    expect(portfolioLines(data, 'nope')).toEqual(['No project nope']);
  });
});
