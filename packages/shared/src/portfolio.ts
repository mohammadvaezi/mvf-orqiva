// ── [PCODE-209 | S15 | v0.1.0] T18.1 Portfolio on the server: health, risk heatmap, gates, cards in progress with people and agents, alerts, 24 h replay ──
//    Why:  the command center reads every project the same way: five kinds of risk (delivery, quality,
//          security, operations, budget), each ok, warning or bad with the reason in words, and one health
//          from them: on track, at risk (something warns) or critical (something is bad). The same rules
//          for the server, the web app and the terminal.

export type HeatLevel = 'ok' | 'warn' | 'bad' | 'none';
export const HEAT_KEYS = ['delivery', 'quality', 'security', 'operations', 'budget'] as const;
export type HeatKey = (typeof HEAT_KEYS)[number];
export const HEAT_LABELS: Record<HeatKey, string> = {
  delivery: 'Delivery',
  quality: 'Quality',
  security: 'Security',
  operations: 'Operations',
  budget: 'Budget',
};

export interface PortfolioFacts {
  /** open tasks with a due date in the past */
  overdue: number;
  /** the active sprint: tasks and done tasks, and how far through its days it is (0..1) */
  sprint: { total: number; done: number; dayShare: number } | null;
  /** the last finished test run's failures, null without a run */
  failedTests: number | null;
  criticalFindings: number;
  highFindings: number;
  /** open incidents by weight */
  seriousIncidents: number;
  otherIncidents: number;
  failedDeploys24h: number;
  /** share of the month's AI budget used (1 = all), null without a budget */
  budgetUsed: number | null;
}

export interface HeatCell {
  level: HeatLevel;
  note: string;
}

const n = (v: number, one: string, many: string): string =>
  String(v) + ' ' + (v === 1 ? one : many);

export function heatOf(f: PortfolioFacts): Record<HeatKey, HeatCell> {
  // delivery: overdue work, and a sprint falling behind its days
  const behind =
    f.sprint && f.sprint.total > 0 ? f.sprint.dayShare - f.sprint.done / f.sprint.total : 0;
  const delivery: HeatCell =
    f.overdue >= 3 || behind > 0.4
      ? {
          level: 'bad',
          note: [
            f.overdue ? n(f.overdue, 'task overdue', 'tasks overdue') : '',
            behind > 0.4 ? 'sprint far behind' : '',
          ]
            .filter(Boolean)
            .join(', '),
        }
      : f.overdue > 0 || behind > 0.2
        ? {
            level: 'warn',
            note: [
              f.overdue ? n(f.overdue, 'task overdue', 'tasks overdue') : '',
              behind > 0.2 ? 'sprint behind' : '',
            ]
              .filter(Boolean)
              .join(', '),
          }
        : { level: 'ok', note: f.sprint ? 'on plan' : 'nothing overdue' };
  const quality: HeatCell =
    f.failedTests === null
      ? { level: 'none', note: 'no test run' }
      : f.failedTests > 0
        ? { level: 'bad', note: n(f.failedTests, 'test failing', 'tests failing') }
        : { level: 'ok', note: 'tests pass' };
  const security: HeatCell =
    f.criticalFindings > 0
      ? { level: 'bad', note: n(f.criticalFindings, 'critical finding', 'critical findings') }
      : f.highFindings > 0
        ? { level: 'warn', note: n(f.highFindings, 'high finding', 'high findings') }
        : { level: 'ok', note: 'no serious finding' };
  const operations: HeatCell =
    f.seriousIncidents > 0
      ? {
          level: 'bad',
          note: n(f.seriousIncidents, 'SEV-1/2 incident', 'SEV-1/2 incidents') + ' open',
        }
      : f.otherIncidents > 0 || f.failedDeploys24h > 0
        ? {
            level: 'warn',
            note: [
              f.otherIncidents ? n(f.otherIncidents, 'incident', 'incidents') + ' open' : '',
              f.failedDeploys24h
                ? n(f.failedDeploys24h, 'deploy failed', 'deploys failed') + ' today'
                : '',
            ]
              .filter(Boolean)
              .join(', '),
          }
        : { level: 'ok', note: 'running well' };
  const pct = f.budgetUsed === null ? null : Math.round(f.budgetUsed * 100);
  const budget: HeatCell =
    pct === null
      ? { level: 'none', note: 'no budget' }
      : pct >= 100
        ? { level: 'bad', note: String(pct) + ' % of the AI budget used' }
        : pct >= 80
          ? { level: 'warn', note: String(pct) + ' % of the AI budget used' }
          : { level: 'ok', note: String(pct) + ' % of the AI budget' };
  return { delivery, quality, security, operations, budget };
}

export type Health = 'on-track' | 'at-risk' | 'critical';

/** One health from the heatmap, with the reasons that make it so (bad first). */
export function healthOf(heat: Record<HeatKey, HeatCell>): { health: Health; reasons: string[] } {
  const bad = HEAT_KEYS.filter((k) => heat[k].level === 'bad');
  const warn = HEAT_KEYS.filter((k) => heat[k].level === 'warn');
  return {
    health: bad.length ? 'critical' : warn.length ? 'at-risk' : 'on-track',
    reasons: [...bad, ...warn].map((k) => heat[k].note),
  };
}

export const HEALTH_TEXT: Record<Health, string> = {
  'on-track': 'on track',
  'at-risk': 'at risk',
  critical: 'critical',
};
