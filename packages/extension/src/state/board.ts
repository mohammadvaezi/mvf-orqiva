// ── [PCODE-462 | S15 | v0.1.0] Tasks run in plan order, finish by themselves, and show the same state in VS Code and the portal ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-13 | S03 | v0.1.0] Add the Orqiva activity bar container and the Sprints tree view ──
// ── [PCODE-105 | S15 | v0.1.0] Move the VS Code extension to the new API over WebSocket and remove polling ──
//    Task: https://plan.broszio.com/prodsystem/projects/74f47636-71b0-4eb5-94b5-ea2fe840ec01/issues/
//    Why:  one board shape for the tree whether it came from Plane (client) or from sprints.md (file), mapped
//          exactly like plane_task.py: sprint code from the cycle name, today = start <= today <= end.
import type { Cycle, Issue, Label, State } from '../plane/types';
import { sprintCode, type SprintsMdSprint } from './sprintsMd';

export type StateGroup = 'backlog' | 'unstarted' | 'started' | 'completed' | 'cancelled';
export type Priority = 'urgent' | 'high' | 'medium' | 'low' | 'none';

export interface Item {
  /** Plane issue id; undefined when the board came from sprints.md. */
  id?: string;
  ref: string;
  title: string;
  state: { name: string; group: StateGroup };
  priority: Priority;
  labels: string[];
  url?: string;
  done: boolean;
  /** [PCODE-462 | S15 | v0.1.0] the unfinished tasks it waits for (their refs); it cannot start before */
  waitsFor?: string[];
}

export interface Sprint {
  id?: string;
  name: string;
  code: string;
  date: string;
  endDate: string;
  goal: string;
  isToday: boolean;
  items: Item[];
  /** [PCODE-105 | S15 | v0.1.0] 'server': Orqiva's own API */
  source: 'plane' | 'file' | 'server';
}

export const PRIORITY_ORDER: Record<Priority, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
  none: 4,
};

const day = (v: string | null | undefined): string => (v ?? '').slice(0, 10);

// ── [PCODE-13 | S03 | v0.1.0] groupOf: engine state names -> Plane groups (for file-sourced boards) ──
export function groupOf(stateName: string): StateGroup {
  const n = stateName.toLowerCase();
  if (n === 'done') return 'completed';
  if (n === 'cancelled') return 'cancelled';
  if (n === 'backlog') return 'backlog';
  if (n === 'todo' || n === 'planned') return 'unstarted';
  return 'started';
}

function normalizePriority(p: string | null | undefined): Priority {
  return p === 'urgent' || p === 'high' || p === 'medium' || p === 'low' ? p : 'none';
}

// ── [PCODE-13 | S03 | v0.1.0] orderSprints: today first, then upcoming ascending, then past descending ──
//    (which sprints exist is decided by the source - the board source fetches recent cycles, the engine writes
//    the last 14 days into sprints.md - so ordering never drops anything)
export function orderSprints(sprints: Sprint[], today: string): Sprint[] {
  const current = sprints.filter((s) => s.isToday);
  const upcoming = sprints
    .filter((s) => !s.isToday && s.date > today)
    .sort((a, b) => a.date.localeCompare(b.date));
  const past = sprints
    .filter((s) => !s.isToday && s.date <= today)
    .sort((a, b) => b.date.localeCompare(a.date));
  return [...current, ...upcoming, ...past];
}

// ── [PCODE-13 | S03 | v0.1.0] buildBoardFromPlane: cycles + cycle-issue ids + issues + states + labels ──
export function buildBoardFromPlane(
  input: {
    cycles: Cycle[];
    cycleIssueIds: Map<string, string[]>;
    issues: Issue[];
    states: State[];
    labels: Label[];
    identifier: string;
    webUrl: (issueId: string) => string;
  },
  today: string,
): Sprint[] {
  const states = new Map(input.states.map((s) => [s.id, s]));
  const labels = new Map(input.labels.map((l) => [l.id, l.name]));
  const issues = new Map(input.issues.map((i) => [i.id, i]));
  const toItem = (i: Issue): Item => {
    const st = states.get(i.state);
    const group = (st?.group ?? 'backlog') as StateGroup;
    return {
      id: i.id,
      ref: `${input.identifier}-${i.sequence_id}`,
      title: i.name,
      state: { name: st?.name ?? '?', group },
      priority: normalizePriority(i.priority),
      labels: i.labels.map((id) => labels.get(id) ?? id),
      url: input.webUrl(i.id),
      done: group === 'completed',
    };
  };
  const sprints: Sprint[] = [];
  for (const c of input.cycles) {
    if (!c.start_date) continue;
    const date = day(c.start_date);
    const endDate = day(c.end_date) || date;
    const ids = input.cycleIssueIds.get(c.id) ?? [];
    const items = ids
      .map((id) => issues.get(id))
      .filter((i): i is Issue => i !== undefined)
      .map(toItem)
      .sort(
        (a, b) =>
          PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] ||
          a.ref.localeCompare(b.ref, undefined, { numeric: true }),
      );
    sprints.push({
      id: c.id,
      name: c.name,
      code: sprintCode(c.name),
      date,
      endDate,
      goal: (c.description || '').trim(),
      isToday: date <= today && today <= endDate,
      items,
      source: 'plane',
    });
  }
  return orderSprints(sprints, today);
}

// ── [PCODE-13 | S03 | v0.1.0] boardFromSprintsMd: the offline board in the same shape (no ids) ──
export function boardFromSprintsMd(parsed: SprintsMdSprint[], today: string): Sprint[] {
  const sprints = parsed.map<Sprint>((s) => ({
    name: s.name,
    code: s.code,
    date: s.date,
    endDate: s.date,
    goal: s.goal,
    isToday: s.isToday || s.date === today,
    source: 'file',
    items: s.items.map<Item>((i) => ({
      ref: i.ref,
      title: i.title,
      state: { name: i.state, group: groupOf(i.state) },
      priority: normalizePriority(i.priority),
      labels: [],
      done: i.done,
    })),
  }));
  return orderSprints(sprints, today);
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
