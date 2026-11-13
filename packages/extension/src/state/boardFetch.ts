// ── [PCODE-17 | S03 | v0.1.0] Add live refresh: file watcher triggers plus Plane polling with backoff ──
//    Why:  one refresh = states, labels, recent cycles, their issue ids and the issues, mapped by board.ts.
//          Only cycles within ±14 days are fetched so a long plan does not eat the 20 req/min budget.
import type { PlaneClient } from '../plane/client';
import { buildBoardFromPlane, type Sprint } from './board';

export const CYCLE_WINDOW_DAYS = 14;

function shift(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ── [PCODE-17 | S03 | v0.1.0] fetchBoard: read-only calls through the throttled client ──
export async function fetchBoard(
  client: Pick<
    PlaneClient,
    'getStates' | 'getLabels' | 'getCycles' | 'getCycleIssueIds' | 'getIssues' | 'webUrl'
  >,
  projectId: string,
  identifier: string,
  today: string,
): Promise<Sprint[]> {
  const [states, labels, cycles, issues] = await Promise.all([
    client.getStates(projectId),
    client.getLabels(projectId),
    client.getCycles(projectId),
    client.getIssues(projectId),
  ]);
  const from = shift(today, -CYCLE_WINDOW_DAYS);
  const to = shift(today, CYCLE_WINDOW_DAYS);
  const recent = cycles.filter((c) => {
    const d = (c.start_date ?? '').slice(0, 10);
    return d && d >= from && d <= to;
  });
  const cycleIssueIds = new Map<string, string[]>();
  for (const c of recent) cycleIssueIds.set(c.id, await client.getCycleIssueIds(projectId, c.id));
  return buildBoardFromPlane(
    {
      cycles: recent,
      cycleIssueIds,
      issues,
      states,
      labels,
      identifier,
      webUrl: (id) => client.webUrl(projectId, id),
    },
    today,
  );
}
