// ── [PCODE-259 | S15 | v0.1.0] T27.1 Canvas engine: constraint types, split tasks, holidays, move with successors ──
// ── [PCODE-165 | S15 | v0.1.0] B2.1 Planning and Canvas on the server: plan fields, dependencies, schedule, baselines, scenarios, drafts, retro, workload ──
//    Why:  one scheduling engine for the server, the web app and the extension, so the Gantt, the
//          critical path and the workload say the same thing everywhere. Dates are ISO days; time runs in
//          working days of a calendar (working weekdays and holidays). Auto-scheduled tasks start as soon as
//          their dependencies allow (finish-to-start, start-to-start, finish-to-finish, start-to-finish, with
//          lag or lead) and never before the start date people gave them; manual tasks stay where they are
//          and report the dependencies they break. Summary tasks span their children.

export type DependencyKind = 'FS' | 'SS' | 'FF' | 'SF';
export const DEPENDENCY_KINDS: readonly DependencyKind[] = ['FS', 'SS', 'FF', 'SF'];
export type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
const WEEKDAYS: readonly Weekday[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

const DAY = 86_400_000;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const toTime = (iso: string): number => Date.parse(iso + 'T00:00:00Z');
const toIso = (t: number): string => new Date(t).toISOString().slice(0, 10);
export const isIsoDate = (v: unknown): v is string =>
  typeof v === 'string' && ISO.test(v) && !Number.isNaN(toTime(v)) && toIso(toTime(v)) === v;

/** Working days of a team: which weekdays are worked, and which dates are holidays. */
export class WorkCalendar {
  private readonly days: Set<number>;
  private readonly holidays: Set<string>;
  /** working days by index from the anchor, both directions, filled as needed */
  private readonly ahead: number[] = [];
  private readonly behind: number[] = [];
  private readonly indexOf = new Map<number, number>();
  readonly anchor: string;

  constructor(opts: {
    anchor: string;
    workingDays?: readonly Weekday[];
    holidays?: readonly string[];
  }) {
    const wd: readonly Weekday[] = opts.workingDays?.length
      ? opts.workingDays
      : ['mon', 'tue', 'wed', 'thu', 'fri'];
    this.days = new Set(wd.map((d) => WEEKDAYS.indexOf(d)));
    this.holidays = new Set(opts.holidays ?? []);
    this.anchor = this.nextWorkday(opts.anchor);
  }

  isWorkday(iso: string): boolean {
    return this.days.has(new Date(toTime(iso)).getUTCDay()) && !this.holidays.has(iso);
  }

  /** The date itself when it is worked, else the next working day. */
  nextWorkday(iso: string): string {
    let t = toTime(iso);
    for (let i = 0; i < 400 && !this.isWorkday(toIso(t)); i++) t += DAY;
    return toIso(t);
  }

  /** The date itself when it is worked, else the working day before it. */
  prevWorkday(iso: string): string {
    let t = toTime(iso);
    for (let i = 0; i < 400 && !this.isWorkday(toIso(t)); i++) t -= DAY;
    return toIso(t);
  }

  private fill(index: number): void {
    if (index >= 0) {
      let t = this.ahead.length
        ? (this.ahead[this.ahead.length - 1] ?? 0) + DAY
        : toTime(this.anchor);
      while (this.ahead.length <= index) {
        if (this.isWorkday(toIso(t))) {
          this.indexOf.set(t, this.ahead.length);
          this.ahead.push(t);
        }
        t += DAY;
      }
    } else {
      let t =
        (this.behind.length ? (this.behind[this.behind.length - 1] ?? 0) : toTime(this.anchor)) -
        DAY;
      while (this.behind.length < -index) {
        if (this.isWorkday(toIso(t))) {
          this.behind.push(t);
          this.indexOf.set(t, -this.behind.length);
        }
        t -= DAY;
      }
    }
  }

  /** The working day with this index (0 = the anchor). */
  date(index: number): string {
    this.fill(index);
    return toIso((index >= 0 ? this.ahead[index] : this.behind[-index - 1]) ?? 0);
  }

  /** The index of a date; a free day counts as the next working day. */
  index(iso: string): number {
    const t = toTime(this.nextWorkday(iso));
    const known = this.indexOf.get(t);
    if (known !== undefined) return known;
    const step = t >= toTime(this.anchor) ? 1 : -1;
    // grow towards the date; the gap in calendar days bounds the working days
    const guess = Math.ceil(Math.abs(t - toTime(this.anchor)) / DAY) + 1;
    this.fill(step * guess);
    return this.indexOf.get(t) ?? 0;
  }

  /** Working days from the start to the finish, both counted. */
  span(start: string, finish: string): number {
    return Math.max(0, this.index(this.prevWorkday(finish)) - this.index(start) + 1);
  }

  addWorkdays(iso: string, n: number): string {
    return this.date(this.index(iso) + n);
  }
}

// [PCODE-259 | S15 | v0.1.0] constraints and splits, as MS Project names them
export const CONSTRAINT_TYPES = [
  'asap',
  'alap',
  'snet',
  'snlt',
  'fnet',
  'fnlt',
  'mso',
  'mfo',
] as const;
export type ConstraintType = (typeof CONSTRAINT_TYPES)[number];
export const CONSTRAINT_TEXT: Record<ConstraintType, string> = {
  asap: 'As soon as possible',
  alap: 'As late as possible',
  snet: 'Start no earlier than',
  snlt: 'Start no later than',
  fnet: 'Finish no earlier than',
  fnlt: 'Finish no later than',
  mso: 'Must start on',
  mfo: 'Must finish on',
};
/** The kinds that need a date. */
export const DATED_CONSTRAINTS: ReadonlySet<ConstraintType> = new Set([
  'snet',
  'snlt',
  'fnet',
  'fnlt',
  'mso',
  'mfo',
]);
/** A pause in a task: after `after` working days of work it stops for `gap` working days. */
export interface Split {
  after: number;
  gap: number;
}

/** A problem with a task's splits, or null. */
export function splitsProblem(v: unknown): string | null {
  if (!Array.isArray(v)) return 'splits is a list';
  if (v.length > 10) return 'at most 10 splits';
  for (const x of v as unknown[]) {
    if (typeof x !== 'object' || x === null) return 'a split is { after, gap }';
    const { after, gap } = x as Record<string, unknown>;
    if (typeof after !== 'number' || !Number.isInteger(after) || after < 1 || after > 3650)
      return 'after is 1 to 3650 working days';
    if (typeof gap !== 'number' || !Number.isInteger(gap) || gap < 1 || gap > 365)
      return 'gap is 1 to 365 working days';
  }
  const at = (v as Split[]).map((x) => x.after);
  if (new Set(at).size !== at.length) return 'two splits at the same day';
  return null;
}

/** The splits that fall inside a task of d working days, in order. */
export const usableSplits = (splits: readonly Split[] | undefined, d: number): Split[] =>
  [...(splits ?? [])].filter((x) => x.after < d).sort((a, b) => a.after - b.after);

export interface PlanTask {
  id: string;
  parentId: string | null;
  rank: number;
  kind?: string;
  startDate: string | null;
  dueDate: string | null;
  durationDays: number | null;
  mode: 'auto' | 'manual';
  percentDone: number;
  assigneeId?: string | null;
  constraintType?: ConstraintType;
  constraintDate?: string | null;
  splits?: Split[];
}

export interface PlanDependency {
  predecessorId: string;
  successorId: string;
  kind: DependencyKind;
  lagDays: number;
}

export interface ScheduledTask {
  id: string;
  wbs: string;
  level: number;
  summary: boolean;
  milestone: boolean;
  start: string;
  finish: string;
  durationDays: number;
  percentDone: number;
  /** working days it can slip without moving the plan's finish */
  totalFloat: number;
  critical: boolean;
  /** dependencies a manual task breaks, as predecessor ids */
  violations: string[];
  /** the task's constraint cannot hold where its dependencies put it */
  constraintBroken: boolean;
  /** the stretches of work of a split task (empty when it runs in one piece) */
  segments: { start: string; finish: string }[];
}

export interface Schedule {
  tasks: ScheduledTask[];
  start: string;
  finish: string;
  /** tasks on a dependency loop; their loop edges are ignored */
  cycle: string[];
  /** dependencies to or from summary tasks, which the plan does not use */
  ignored: PlanDependency[];
}

/** Outline numbers (1, 1.2, 1.2.3) from the parent tree in rank order. */
export function wbsCodes(
  tasks: readonly Pick<PlanTask, 'id' | 'parentId' | 'rank'>[],
): Map<string, string> {
  const ids = new Set(tasks.map((t) => t.id));
  const kids = new Map<string | null, Pick<PlanTask, 'id' | 'parentId' | 'rank'>[]>();
  for (const t of tasks) {
    const p = t.parentId && ids.has(t.parentId) ? t.parentId : null;
    kids.set(p, [...(kids.get(p) ?? []), t]);
  }
  const out = new Map<string, string>();
  const walk = (parent: string | null, prefix: string, seen: Set<string>): void => {
    const list = [...(kids.get(parent) ?? [])].sort(
      (a, b) => a.rank - b.rank || a.id.localeCompare(b.id),
    );
    list.forEach((t, i) => {
      if (seen.has(t.id)) return;
      const code = prefix + String(i + 1);
      out.set(t.id, code);
      walk(t.id, code + '.', new Set([...seen, t.id]));
    });
  };
  walk(null, '', new Set());
  return out;
}

/** Ids of tasks that sit on a dependency loop (Kahn's algorithm leaves them over). */
export function findCycle(
  ids: readonly string[],
  deps: readonly Pick<PlanDependency, 'predecessorId' | 'successorId'>[],
): string[] {
  const indeg = new Map(ids.map((id) => [id, 0]));
  const out = new Map<string, string[]>();
  for (const d of deps) {
    if (!indeg.has(d.predecessorId) || !indeg.has(d.successorId)) continue;
    indeg.set(d.successorId, (indeg.get(d.successorId) ?? 0) + 1);
    out.set(d.predecessorId, [...(out.get(d.predecessorId) ?? []), d.successorId]);
  }
  const queue = ids.filter((id) => indeg.get(id) === 0);
  for (let i = 0; i < queue.length; i++)
    for (const s of out.get(queue[i] ?? '') ?? []) {
      indeg.set(s, (indeg.get(s) ?? 0) - 1);
      if (indeg.get(s) === 0) queue.push(s);
    }
  const done = new Set(queue);
  return ids.filter((id) => !done.has(id));
}

/** True when adding the dependency would close a loop. */
export const wouldCycle = (
  deps: readonly Pick<PlanDependency, 'predecessorId' | 'successorId'>[],
  from: string,
  to: string,
): boolean => {
  const next = new Map<string, string[]>();
  for (const d of deps)
    next.set(d.predecessorId, [...(next.get(d.predecessorId) ?? []), d.successorId]);
  const stack = [to];
  const seen = new Set<string>();
  while (stack.length) {
    const n = stack.pop() ?? '';
    if (n === from) return true;
    if (seen.has(n)) continue;
    seen.add(n);
    stack.push(...(next.get(n) ?? []));
  }
  return false;
};

/**
 * The plan: forward pass (earliest start) through the dependencies in order, backward pass (latest
 * start) from the plan's finish, float and the critical path, then summary tasks over their children.
 * Time is half-open in working-day indices: a task of d days runs [es, es + d).
 */
export function schedulePlan(
  tasks: readonly PlanTask[],
  deps: readonly PlanDependency[],
  cal: WorkCalendar,
  opts: { minStart?: ReadonlyMap<string, string> } = {},
): Schedule {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const parents = new Set(
    tasks.map((t) => t.parentId).filter((p): p is string => p !== null && byId.has(p)),
  );
  const leaves = tasks.filter((t) => !parents.has(t.id));
  const ignored = deps.filter(
    (d) =>
      parents.has(d.predecessorId) ||
      parents.has(d.successorId) ||
      !byId.has(d.predecessorId) ||
      !byId.has(d.successorId),
  );
  const live = deps.filter((d) => !ignored.includes(d));
  const cycle = findCycle(
    leaves.map((t) => t.id),
    live,
  );
  const onCycle = new Set(cycle);
  const used = live.filter((d) => !(onCycle.has(d.predecessorId) && onCycle.has(d.successorId)));

  const dur = new Map<string, number>();
  for (const t of leaves) {
    const d =
      t.kind === 'milestone'
        ? 0
        : (t.durationDays ?? (t.startDate && t.dueDate ? cal.span(t.startDate, t.dueDate) : 1));
    dur.set(t.id, Math.max(0, d));
  }
  // [PCODE-259 | S15 | v0.1.0] a split task runs its work plus its pauses
  const span = new Map<string, number>();
  for (const t of leaves) {
    const d = dur.get(t.id) ?? 0;
    span.set(t.id, d + usableSplits(t.splits, d).reduce((n, x) => n + x.gap, 0));
  }
  const preds = new Map<string, PlanDependency[]>();
  const succs = new Map<string, PlanDependency[]>();
  for (const d of used) {
    preds.set(d.successorId, [...(preds.get(d.successorId) ?? []), d]);
    succs.set(d.predecessorId, [...(succs.get(d.predecessorId) ?? []), d]);
  }
  // topological order (cycle members last, in rank order)
  const order: string[] = [];
  const indeg = new Map(leaves.map((t) => [t.id, (preds.get(t.id) ?? []).length]));
  const queue = leaves
    .filter((t) => indeg.get(t.id) === 0)
    .sort((a, b) => a.rank - b.rank)
    .map((t) => t.id);
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i] ?? '';
    order.push(id);
    for (const d of succs.get(id) ?? []) {
      indeg.set(d.successorId, (indeg.get(d.successorId) ?? 0) - 1);
      if (indeg.get(d.successorId) === 0) queue.push(d.successorId);
    }
  }
  for (const t of leaves) if (!order.includes(t.id)) order.push(t.id);

  const es = new Map<string, number>();
  const violations = new Map<string, string[]>();
  const need = (d: PlanDependency, ownDur: number): number => {
    const pes = es.get(d.predecessorId) ?? 0;
    const pef = pes + (span.get(d.predecessorId) ?? 0);
    switch (d.kind) {
      case 'FS':
        return pef + d.lagDays;
      case 'SS':
        return pes + d.lagDays;
      case 'FF':
        return pef + d.lagDays - ownDur;
      case 'SF':
        return pes + d.lagDays - ownDur;
    }
  };
  const anchorIndex = 0;
  // [PCODE-259 | S15 | v0.1.0] the constraint's day as an index, for the kinds with a date
  const cIndex = (t: PlanTask): number | null =>
    t.constraintType && DATED_CONSTRAINTS.has(t.constraintType) && t.constraintDate
      ? cal.index(t.constraintDate)
      : null;
  for (const id of order) {
    const t = byId.get(id);
    if (!t) continue;
    const d = span.get(id) ?? 0;
    const fromDeps = Math.max(-Infinity, ...(preds.get(id) ?? []).map((p) => need(p, d)));
    const floorDate = opts.minStart?.get(id);
    const own = t.startDate ? cal.index(t.startDate) : null;
    if (t.mode === 'manual' && own !== null) {
      es.set(id, own);
      const broken = (preds.get(id) ?? [])
        .filter((p) => need(p, d) > own)
        .map((p) => p.predecessorId);
      if (broken.length) violations.set(id, broken);
    } else {
      // as soon as possible: from the anchor, never before its own start date or a levelling delay
      const floor = Math.max(own ?? anchorIndex, floorDate ? cal.index(floorDate) : -Infinity);
      // [PCODE-259 | S15 | v0.1.0] then the constraint: a floor, or a fixed day
      const ci = cIndex(t);
      const kind = ci === null ? 'asap' : t.constraintType;
      const cfloor = kind === 'snet' ? (ci ?? 0) : kind === 'fnet' ? (ci ?? 0) + 1 - d : -Infinity;
      if (kind === 'mso') es.set(id, ci ?? 0);
      else if (kind === 'mfo') es.set(id, (ci ?? 0) + 1 - Math.max(1, d));
      else es.set(id, Math.max(floor, cfloor, fromDeps));
    }
  }
  // [PCODE-259 | S15 | v0.1.0] as late as possible: as late as the successors, as already placed, and the plan allow
  const planEnd = leaves.length
    ? Math.max(...leaves.map((t) => (es.get(t.id) ?? 0) + (span.get(t.id) ?? 0)))
    : 0;
  for (const id of [...order].reverse()) {
    const t = byId.get(id);
    if (!t || t.mode === 'manual' || t.constraintType !== 'alap') continue;
    const d = span.get(id) ?? 0;
    let latest = planEnd - d;
    for (const x of succs.get(id) ?? []) {
      const ses = es.get(x.successorId) ?? 0;
      const sd = span.get(x.successorId) ?? 0;
      latest = Math.min(
        latest,
        x.kind === 'FS'
          ? ses - x.lagDays - d
          : x.kind === 'SS'
            ? ses - x.lagDays
            : x.kind === 'FF'
              ? ses + sd - x.lagDays - d
              : ses + sd - x.lagDays,
      );
    }
    if (latest > (es.get(id) ?? 0)) es.set(id, latest);
  }
  const ef = (id: string): number => (es.get(id) ?? 0) + (span.get(id) ?? 0);
  const finish = leaves.length ? Math.max(...leaves.map((t) => ef(t.id))) : 0;
  const start = leaves.length ? Math.min(...leaves.map((t) => es.get(t.id) ?? 0)) : 0;

  // backward pass: latest finish allowed by every successor
  const lf = new Map<string, number>();
  for (const id of [...order].reverse()) {
    const d = span.get(id) ?? 0;
    // [PCODE-259 | S15 | v0.1.0] the "no later than" kinds bound the latest finish too
    const t = byId.get(id);
    const ci = t ? cIndex(t) : null;
    let latest =
      ci === null || !t
        ? finish
        : t.constraintType === 'snlt' || t.constraintType === 'mso'
          ? Math.min(finish, ci + d)
          : t.constraintType === 'fnlt' || t.constraintType === 'mfo'
            ? Math.min(finish, ci + 1)
            : finish;
    for (const x of succs.get(id) ?? []) {
      const sd = span.get(x.successorId) ?? 0;
      const sls = (lf.get(x.successorId) ?? finish) - sd;
      const slf = lf.get(x.successorId) ?? finish;
      const bound =
        x.kind === 'FS'
          ? sls - x.lagDays
          : x.kind === 'SS'
            ? sls - x.lagDays + d
            : x.kind === 'FF'
              ? slf - x.lagDays
              : slf - x.lagDays + d;
      latest = Math.min(latest, bound);
    }
    lf.set(id, latest);
  }

  const wbs = wbsCodes(tasks);
  const levelOf = (id: string): number => (wbs.get(id) ?? '').split('.').length - 1;
  const leafOut = new Map<string, ScheduledTask>();
  for (const t of leaves) {
    const work = dur.get(t.id) ?? 0;
    const d = span.get(t.id) ?? 0;
    const s = es.get(t.id) ?? 0;
    const float = (lf.get(t.id) ?? finish) - d - s;
    // [PCODE-259 | S15 | v0.1.0] whether the constraint holds where the task landed, and its pieces of work
    const ci = cIndex(t);
    const end = s + Math.max(1, d) - 1;
    const constraintBroken =
      ci !== null &&
      ((t.constraintType === 'snet' && s < ci) ||
        (t.constraintType === 'snlt' && s > ci) ||
        (t.constraintType === 'fnet' && end < ci) ||
        (t.constraintType === 'fnlt' && end > ci) ||
        (t.constraintType === 'mso' && s !== ci) ||
        (t.constraintType === 'mfo' && end !== ci) ||
        ((t.constraintType === 'mso' || t.constraintType === 'mfo') &&
          (preds.get(t.id) ?? []).some((p) => need(p, d) > s)));
    const pieces = usableSplits(t.splits, work);
    const segments: { start: string; finish: string }[] = [];
    if (pieces.length) {
      let at = s;
      let doneWork = 0;
      for (const x of [...pieces, { after: work, gap: 0 }]) {
        const len = x.after - doneWork;
        segments.push({ start: cal.date(at), finish: cal.date(at + len - 1) });
        at += len + x.gap;
        doneWork = x.after;
      }
    }
    leafOut.set(t.id, {
      id: t.id,
      wbs: wbs.get(t.id) ?? '',
      level: levelOf(t.id),
      summary: false,
      milestone: d === 0,
      start: cal.date(s),
      finish: cal.date(d === 0 ? s : s + d - 1),
      durationDays: work, // [PCODE-259 | S15 | v0.1.0] the work; finish covers the pauses
      percentDone: Math.max(0, Math.min(100, Math.round(t.percentDone))),
      totalFloat: float,
      critical: float <= 0 && !onCycle.has(t.id),
      violations: violations.get(t.id) ?? [],
      constraintBroken,
      segments,
    });
  }
  // summary tasks: from their leaves, deepest first
  const children = new Map<string, string[]>();
  for (const t of tasks)
    if (t.parentId && byId.has(t.parentId))
      children.set(t.parentId, [...(children.get(t.parentId) ?? []), t.id]);
  const summaryOut = new Map<string, ScheduledTask>();
  const roll = (id: string, seen: Set<string>): ScheduledTask | null => {
    const leaf = leafOut.get(id);
    if (leaf) return leaf;
    const done = summaryOut.get(id);
    if (done) return done;
    if (seen.has(id)) return null;
    const parts = (children.get(id) ?? [])
      .map((k) => roll(k, new Set([...seen, id])))
      .filter((x): x is ScheduledTask => x !== null);
    if (!parts.length) return null;
    const s = Math.min(...parts.map((p) => cal.index(p.start)));
    const f = Math.max(...parts.map((p) => cal.index(p.finish) + (p.durationDays === 0 ? 0 : 1)));
    const weight = (p: ScheduledTask): number => Math.max(1, p.durationDays);
    const out: ScheduledTask = {
      id,
      wbs: wbs.get(id) ?? '',
      level: levelOf(id),
      summary: true,
      milestone: false,
      start: cal.date(s),
      finish: cal.date(Math.max(s, f - 1)),
      durationDays: f - s,
      percentDone: Math.round(
        parts.reduce((n, p) => n + p.percentDone * weight(p), 0) /
          parts.reduce((n, p) => n + weight(p), 0),
      ),
      totalFloat: Math.min(...parts.map((p) => p.totalFloat)),
      critical: false,
      violations: [],
      constraintBroken: false,
      segments: [],
    };
    summaryOut.set(id, out);
    return out;
  };
  for (const id of parents) roll(id, new Set());
  const all = tasks
    .map((t) => leafOut.get(t.id) ?? summaryOut.get(t.id))
    .filter((x): x is ScheduledTask => x !== undefined)
    .sort((a, b) => compareWbs(a.wbs, b.wbs));
  return {
    tasks: all,
    start: cal.date(start),
    finish: cal.date(Math.max(start, finish - 1)),
    cycle,
    ignored,
  };
}

export function compareWbs(a: string, b: string): number {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? -1) - (y[i] ?? -1);
    if (d) return d;
  }
  return 0;
}

export interface WorkloadRow {
  assigneeId: string;
  /** per working day from the range's start: share of a full day planned, in percent */
  days: { date: string; percent: number; taskIds: string[] }[];
  peak: number;
  overDays: number;
}

/** Each task takes its assignee fully for each working day it runs. */
export function workload(
  sched: Schedule,
  tasks: readonly PlanTask[],
  cal: WorkCalendar,
  from: string,
  to: string,
): WorkloadRow[] {
  const who = new Map(tasks.map((t) => [t.id, t.assigneeId ?? null]));
  const a = cal.index(from);
  const b = cal.index(cal.prevWorkday(to));
  const rows = new Map<string, Map<number, string[]>>();
  for (const t of sched.tasks) {
    const person = who.get(t.id);
    if (t.summary || t.milestone || !person || t.percentDone >= 100) continue;
    // [PCODE-259 | S15 | v0.1.0] a split task is busy only on its pieces of work
    for (const i of workIndices(t, cal)) {
      if (i < a || i > b) continue;
      const m = rows.get(person) ?? new Map<number, string[]>();
      m.set(i, [...(m.get(i) ?? []), t.id]);
      rows.set(person, m);
    }
  }
  return [...rows].map(([assigneeId, m]) => {
    const days = [];
    for (let i = a; i <= b; i++)
      days.push({
        date: cal.date(i),
        percent: (m.get(i)?.length ?? 0) * 100,
        taskIds: m.get(i) ?? [],
      });
    return {
      assigneeId,
      days,
      peak: Math.max(0, ...days.map((d) => d.percent)),
      overDays: days.filter((d) => d.percent > 100).length,
    };
  });
}

// [PCODE-259 | S15 | v0.1.0]
/** The working-day indices a scheduled task works on (its segments when split). */
export function workIndices(t: ScheduledTask, cal: WorkCalendar): number[] {
  const out: number[] = [];
  if (t.milestone) return out;
  const pieces = t.segments.length ? t.segments : [{ start: t.start, finish: t.finish }];
  for (const p of pieces)
    for (let i = cal.index(p.start); i <= cal.index(p.finish); i++) out.push(i);
  return out;
}

/** The tasks that follow a task through its dependencies, at any depth (for "move with successors"). */
export function successorsOf(
  deps: readonly Pick<PlanDependency, 'predecessorId' | 'successorId'>[],
  id: string,
): string[] {
  const next = new Map<string, string[]>();
  for (const d of deps)
    next.set(d.predecessorId, [...(next.get(d.predecessorId) ?? []), d.successorId]);
  const seen = new Set<string>();
  const stack = [...(next.get(id) ?? [])];
  while (stack.length) {
    const n = stack.pop() ?? '';
    if (seen.has(n) || n === id) continue;
    seen.add(n);
    stack.push(...(next.get(n) ?? []));
  }
  return [...seen];
}

export interface Levelling {
  moves: { id: string; from: string; to: string }[];
  finishBefore: string;
  finishAfter: string;
  schedule: Schedule;
}

/**
 * Resolves over-allocation by delaying tasks: per person, tasks are placed in order (critical first,
 * then earliest, then rank) on the first days free for their whole duration; delayed tasks get a
 * start-no-earlier-than and the plan is computed again until nothing moves. Manual tasks stay.
 */
export function levelResources(
  tasks: readonly PlanTask[],
  deps: readonly PlanDependency[],
  cal: WorkCalendar,
): Levelling {
  const first = schedulePlan(tasks, deps, cal);
  const minStart = new Map<string, string>();
  let sched = first;
  const byId = new Map(tasks.map((t) => [t.id, t]));
  for (let round = 0; round < 25; round++) {
    const busy = new Map<string, Set<number>>();
    let moved = false;
    const leaves = sched.tasks
      .filter(
        (t) => !t.summary && !t.milestone && byId.get(t.id)?.assigneeId && t.percentDone < 100,
      )
      .sort(
        (x, y) =>
          Number(y.critical) - Number(x.critical) ||
          cal.index(x.start) - cal.index(y.start) ||
          (byId.get(x.id)?.rank ?? 0) - (byId.get(y.id)?.rank ?? 0),
      );
    for (const t of leaves) {
      const person = byId.get(t.id)?.assigneeId ?? '';
      const used = busy.get(person) ?? new Set<number>();
      let s = cal.index(t.start);
      const fixed = byId.get(t.id)?.mode === 'manual';
      // [PCODE-259 | S15 | v0.1.0] a split task holds its whole span while levelling
      const len = cal.index(t.finish) - cal.index(t.start) + 1;
      const free = (at: number): boolean => {
        for (let i = at; i < at + len; i++) if (used.has(i)) return false;
        return true;
      };
      if (!fixed) while (!free(s)) s++;
      if (s !== cal.index(t.start)) {
        minStart.set(t.id, cal.date(s));
        moved = true;
      }
      for (let i = s; i < s + len; i++) used.add(i);
      busy.set(person, used);
    }
    if (!moved) break;
    sched = schedulePlan(tasks, deps, cal, { minStart });
  }
  const before = new Map(first.tasks.map((t) => [t.id, t.start]));
  return {
    moves: sched.tasks
      .filter((t) => !t.summary && before.get(t.id) !== t.start)
      .map((t) => ({ id: t.id, from: before.get(t.id) ?? t.start, to: t.start })),
    finishBefore: first.finish,
    finishAfter: sched.finish,
    schedule: sched,
  };
}
