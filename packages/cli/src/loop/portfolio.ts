// ── [PCODE-211 | S15 | v0.1.0] T18.3 Scale test (20 projects, 50 live users, under 1 s event-to-screen) and orq portfolio ──
//    Why:  the command center in the terminal: every project with its health and why, its phase, what is
//          in progress (with the agent on it), and the open alerts. `--project KEY` narrows it to one.
import { linked, option, type LoopDeps, type LoopResult } from './commands.js';

export const PORTFOLIO_USAGE = [
  '  portfolio [--project KEY]  every project: health and why, phase, cards in progress, open alerts',
];

interface PortfolioOut {
  projects: {
    key: string;
    name: string;
    phase: string | null;
    health: string;
    reasons: string[];
    counts: { open: number; inProgress: number; doneThisWeek: number };
    cards: {
      ref: string;
      title: string;
      assignee: { name: string } | null;
      agents: { name: string }[];
    }[];
  }[];
  alerts: { projectKey: string | null; severity: string; title: string; count: number }[];
}

const MARK: Record<string, string> = { 'on-track': '●', 'at-risk': '▲', critical: '■' };
const TEXT: Record<string, string> = {
  'on-track': 'on track',
  'at-risk': 'at risk',
  critical: 'critical',
};

/** The portfolio as the terminal prints it. */
export function portfolioLines(p: PortfolioOut, only?: string): string[] {
  const list = only
    ? p.projects.filter((x) => x.key.toLowerCase() === only.toLowerCase())
    : p.projects;
  if (!list.length) return [only ? 'No project ' + only : 'No projects.'];
  const out: string[] = [];
  for (const x of list) {
    out.push(
      (MARK[x.health] ?? '?') +
        ' ' +
        x.key.padEnd(8) +
        (TEXT[x.health] ?? x.health).padEnd(10) +
        x.name +
        (x.phase ? ' · ' + x.phase : '') +
        ' · ' +
        String(x.counts.inProgress) +
        ' in progress, ' +
        String(x.counts.open) +
        ' open, ' +
        String(x.counts.doneThisWeek) +
        ' done this week',
    );
    if (x.reasons.length) out.push('    ' + x.reasons.join(' · '));
    if (only)
      for (const c of x.cards)
        out.push(
          '    ' +
            c.ref.padEnd(10) +
            c.title +
            (c.assignee ? ' (' + c.assignee.name + ')' : '') +
            (c.agents.length ? ' · ' + c.agents.map((g) => g.name).join(', ') + ' at work' : ''),
        );
  }
  const alerts = only
    ? p.alerts.filter((a) => a.projectKey?.toLowerCase() === only.toLowerCase())
    : p.alerts;
  if (alerts.length) {
    out.push('', 'Open alerts:');
    for (const a of alerts)
      out.push(
        '  ' +
          a.severity.toUpperCase() +
          ' ' +
          (a.projectKey ?? '—').padEnd(8) +
          a.title +
          (a.count > 1 ? ' (' + String(a.count) + '×)' : ''),
      );
  }
  return out;
}

export async function runPortfolio(
  argv: readonly string[],
  deps: LoopDeps,
): Promise<LoopResult | null> {
  if (argv[0] !== 'portfolio') return null;
  const l = linked(deps);
  const p = await l.api.call<PortfolioOut>('GET', l.ws + '/command-center', undefined, 30_000);
  return { code: 0, out: portfolioLines(p, option(argv, '--project')).join('\n') };
}
