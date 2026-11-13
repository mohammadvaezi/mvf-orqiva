// ── [PCODE-65 | S13 | v0.1.0] Build the multi-project dashboard panel across the Plane workspace ──
//    Task: https://plan.broszio.com/prodsystem/projects/74f47636-71b0-4eb5-94b5-ea2fe840ec01/issues/
//    Why:  one row per project, and every figure in it derived here rather than in the panel: an issue's
//          state is an id, so a count by group only exists once the project's own state set has been read.
//          Pure module - no vscode, no network - because the arithmetic is the part worth testing and the
//          fetching is the part worth throttling.
import type { Cycle, Issue, Project, State } from '../plane/types';

export interface ProjectCounts {
  open: number;
  inProgress: number;
  /** [PCODE-65 | S13 | v0.1.0] waiting for a person, counted apart from work in flight */
  review: number;
  done: number;
  cancelled: number;
  total: number;
}

export interface ProjectRow {
  id: string;
  identifier: string;
  name: string;
  counts: ProjectCounts;
  /** the cycle covering today, when there is one */
  sprint: string | null;
  /** ISO date of the newest issue update, or null when the project has none */
  lastActivity: string | null;
  boardUrl: string;
  /** a local folder this project is known to live in */
  folder?: string;
  /** set when the row could not be read; the counts are then zero */
  error?: string;
}

export const EMPTY_COUNTS: ProjectCounts = {
  open: 0,
  inProgress: 0,
  review: 0,
  done: 0,
  cancelled: 0,
  total: 0,
};

/** The started-group states that mean "waiting for a person", not "being worked on". */
const REVIEW_STATES = new Set(['review', 'test']);

// ── [PCODE-65 | S13 | v0.1.0] countByGroup: Plane's five state groups mapped to the columns ──
//    'backlog' and 'unstarted' are both work not begun - a board that splits them still reads as "open"
//    on a dashboard. An unknown group counts in the total and nowhere else, so a custom state set cannot
//    make the columns disagree with the total.
//    Review and Test are split out of 'started' deliberately. The engine's state set files four states
//    under that one group, and the real workspace showed why it matters: a project with everything
//    finished and awaiting sign-off reported "67 in progress", which is true of the group and false of
//    the project. A state set without those names simply reports nothing in the column.
export function countByGroup(issues: readonly Issue[], states: readonly State[]): ProjectCounts {
  const stateById = new Map(states.map((s) => [s.id, s]));
  const counts = { ...EMPTY_COUNTS };
  for (const issue of issues) {
    counts.total++;
    const state = stateById.get(issue.state);
    switch (state?.group) {
      case 'backlog':
      case 'unstarted':
        counts.open++;
        break;
      case 'started':
        if (REVIEW_STATES.has(state.name.trim().toLowerCase())) counts.review++;
        else counts.inProgress++;
        break;
      case 'completed':
        counts.done++;
        break;
      case 'cancelled':
        counts.cancelled++;
        break;
      default:
        break;
    }
  }
  return counts;
}

/** `YYYY-MM-DD` in local time, which is how Plane writes a cycle's dates. */
export function isoDay(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${String(d.getFullYear())}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// ── [PCODE-65 | S13 | v0.1.0] currentCycle: the one covering today; a cycle without dates covers nothing ──
export function currentCycle(cycles: readonly Cycle[], today: Date): Cycle | null {
  const day = isoDay(today);
  const covering = cycles.filter(
    (c) => c.start_date && c.end_date && c.start_date <= day && day <= c.end_date,
  );
  if (!covering.length) return null;
  // the sprints are one day long, but a longer cycle may overlap them: the one that started last wins
  return covering.reduce((a, b) => ((a.start_date ?? '') >= (b.start_date ?? '') ? a : b));
}

// ── [PCODE-65 | S13 | v0.1.0] lastActivity: the newest updated_at across the project's issues ──
export function lastActivity(issues: readonly Issue[]): string | null {
  let newest: string | null = null;
  for (const i of issues) {
    const at = i.updated_at;
    if (at && (newest === null || at > newest)) newest = at;
  }
  return newest;
}

/** "today", "yesterday", "5 days ago", "3 months ago" - or '' when there is nothing to date. */
export function ago(iso: string | null, now: Date): string {
  if (!iso) return '';
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return '';
  const days = Math.floor((now.getTime() - then.getTime()) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${String(days)} days ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${String(months)} month${months === 1 ? '' : 's'} ago`;
  const years = Math.round(days / 365);
  return `${String(years)} year${years === 1 ? '' : 's'} ago`;
}

// ── [PCODE-65 | S13 | v0.1.0] sortRows: what is being worked on first, then what is merely open ──
export function sortRows(rows: readonly ProjectRow[]): ProjectRow[] {
  return [...rows].sort((a, b) => {
    if ((a.sprint !== null) !== (b.sprint !== null)) return a.sprint !== null ? -1 : 1;
    const live = (r: ProjectRow): number => r.counts.inProgress + r.counts.review;
    if (live(b) !== live(a)) return live(b) - live(a);
    if (a.lastActivity !== b.lastActivity)
      return (b.lastActivity ?? '').localeCompare(a.lastActivity ?? '');
    return a.identifier.localeCompare(b.identifier);
  });
}

export function buildRow(input: {
  project: Project;
  issues: readonly Issue[];
  states: readonly State[];
  cycles: readonly Cycle[];
  boardUrl: string;
  now: Date;
  folder?: string;
}): ProjectRow {
  const cycle = currentCycle(input.cycles, input.now);
  return {
    id: input.project.id,
    identifier: input.project.identifier,
    name: input.project.name,
    counts: countByGroup(input.issues, input.states),
    sprint: cycle?.name ?? null,
    lastActivity: lastActivity(input.issues),
    boardUrl: input.boardUrl,
    ...(input.folder ? { folder: input.folder } : {}),
  };
}
