// ── [PCODE-266 | S15 | v0.1.0] Canvas fixes from the T27 browser walkthrough: drop jump-back, grid start width, Enter above a summary, picture menu closing ──
// ── [PCODE-262 | S15 | v0.1.0] T27.4 Canvas views: timeline, mind map, portfolio; agents as resources and heat map; scenario diff; commits on bars ──
// ── [PCODE-260 | S15 | v0.1.0] T27.2 Interactive Gantt: drag, resize, link, shift-drag, split, zoom, colour rules, outline levels ──
//    Why:  the Gantt as people use MS Project: a bar is dragged to move the task, its end to change the
//          duration, its dot onto another bar to link them, and with Shift the whole chain behind it moves.
//          It zooms from days to years, colours bars by a rule (critical path, state, kind, type, person),
//          folds the outline to a level, and draws split tasks in their pieces. The rules that decide what
//          a drag means are plain functions, so they are tested without a browser.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { LiveAvatar } from './shell.js';
import type { PlanData, Scheduled } from './canvas.js';

const DAY = 86_400_000;
const ROW = 32;
const HEAD = 44;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WD = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

const t0 = (iso: string): number => Date.parse(iso + 'T00:00:00Z');
const iso = (t: number): string => new Date(t).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string): number => Math.round((t0(b) - t0(a)) / DAY);
const addDays = (d: string, n: number): string => iso(t0(d) + n * DAY);
const weekday = (d: string): number => new Date(t0(d)).getUTCDay();
const shortDate = (d: string): string =>
  String(new Date(t0(d)).getUTCDate()) + ' ' + (MONTHS[new Date(t0(d)).getUTCMonth()] ?? '');

export type Zoom = 'day' | 'week' | 'month' | 'quarter' | 'year';
export const ZOOMS: { key: Zoom; label: string; width: number }[] = [
  { key: 'day', label: 'Days', width: 26 },
  { key: 'week', label: 'Weeks', width: 9 },
  { key: 'month', label: 'Months', width: 3.2 },
  { key: 'quarter', label: 'Quarters', width: 1.3 },
  { key: 'year', label: 'Years', width: 0.5 },
];
export const dayWidth = (z: Zoom): number => ZOOMS.find((x) => x.key === z)?.width ?? 26;

/** The span drawn at a zoom: from a period before the plan and today to a period after, at most five years. */
export function ganttSpan(
  plan: Pick<PlanData, 'start' | 'finish' | 'today'>,
  zoom: Zoom,
): { from: string; days: number } {
  const lo = [plan.start, plan.today].sort()[0] ?? plan.today;
  const hi = [plan.finish, plan.today].sort()[1] ?? plan.today;
  if (zoom === 'day' || zoom === 'week') {
    const from = addDays(lo, -((weekday(lo) + 6) % 7) - 7);
    return { from, days: Math.min(366, Math.max(42, daysBetween(from, hi) + 21)) };
  }
  const d = new Date(t0(lo));
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const from =
    zoom === 'month'
      ? iso(Date.UTC(y, m - 1, 1))
      : zoom === 'quarter'
        ? iso(Date.UTC(y, Math.floor(m / 3) * 3 - 3, 1))
        : iso(Date.UTC(y, 0, 1));
  const tail = zoom === 'month' ? 62 : zoom === 'quarter' ? 184 : 366;
  const least = zoom === 'month' ? 183 : zoom === 'quarter' ? 366 : 731;
  return { from, days: Math.min(1827, Math.max(least, daysBetween(from, hi) + tail)) };
}

export interface Ticks {
  /** upper labels (months or years), by day index */
  top: { i: number; label: string }[];
  /** lower labels (days, weeks, months or quarters) */
  bottom: { i: number; label: string }[];
  /** grid lines by day index */
  lines: number[];
}

/** The axis at a zoom: what is written where, and where the lines run. */
export function axisTicks(zoom: Zoom, from: string, days: number): Ticks {
  const out: Ticks = { top: [], bottom: [], lines: [] };
  for (let i = 0; i < days; i++) {
    const d = addDays(from, i);
    const date = new Date(t0(d));
    const dom = date.getUTCDate();
    const mon = date.getUTCMonth();
    const year = String(date.getUTCFullYear());
    const wd = weekday(d);
    if (zoom === 'day' || zoom === 'week') {
      if (dom === 1) out.top.push({ i, label: (MONTHS[mon] ?? '') + ' ' + year });
      if (wd === 1) {
        out.lines.push(i);
        out.bottom.push({ i, label: shortDate(d) });
      } else if (zoom === 'day' && wd !== 2) out.bottom.push({ i, label: String(dom) });
    } else if (zoom === 'month') {
      if (dom === 1 && (mon === 0 || i === 0)) out.top.push({ i, label: year });
      if (dom === 1) {
        out.lines.push(i);
        out.bottom.push({ i, label: MONTHS[mon] ?? '' });
      }
    } else if (zoom === 'quarter') {
      if (dom === 1 && (mon === 0 || i === 0)) out.top.push({ i, label: year });
      if (dom === 1) out.bottom.push({ i, label: (MONTHS[mon] ?? '').slice(0, 1) });
      if (dom === 1 && mon % 3 === 0) out.lines.push(i);
    } else {
      if (dom === 1 && mon === 0) {
        out.top.push({ i, label: year });
        out.lines.push(i);
      }
      if (dom === 1 && mon % 3 === 0) out.bottom.push({ i, label: 'Q' + String(mon / 3 + 1) });
    }
  }
  return out;
}

const isWorkday = (d: string, workingDays: readonly string[]): boolean =>
  workingDays.includes(WD[weekday(d)] ?? '');

/** The first working day on or after a date. */
export function workdayFrom(d: string, workingDays: readonly string[]): string {
  let x = d;
  for (let i = 0; i < 14 && !isWorkday(x, workingDays); i++) x = addDays(x, 1);
  return x;
}

/** Working days from a to b: positive forward, negative back (holidays are the server's business). */
export function workdaysBetween(a: string, b: string, workingDays: readonly string[]): number {
  if (!workingDays.length) return daysBetween(a, b);
  const step = b >= a ? 1 : -1;
  let n = 0;
  for (let d = a; d !== b; d = addDays(d, step)) {
    const next = addDays(d, step);
    if (isWorkday(step > 0 ? next : d, workingDays)) n += step;
  }
  return n;
}

export type DragMode = 'move' | 'resize' | 'link';
export type DragOutcome =
  | { kind: 'none' }
  | { kind: 'move'; startDate: string; days: number }
  | { kind: 'resize'; durationDays: number };

/** What letting go of a dragged bar means, in dates and working days. */
export function dragOutcome(
  mode: Exclude<DragMode, 'link'>,
  s: Pick<Scheduled, 'start' | 'finish' | 'durationDays' | 'milestone'>,
  dxDays: number,
  workingDays: readonly string[],
): DragOutcome {
  if (!dxDays) return { kind: 'none' };
  if (mode === 'move') {
    const startDate = workdayFrom(addDays(s.start, dxDays), workingDays);
    const days = workdaysBetween(s.start, startDate, workingDays);
    return days ? { kind: 'move', startDate, days } : { kind: 'none' };
  }
  if (s.milestone) return { kind: 'none' };
  // an end dropped on a day off counts as the next working day out, or the last one back
  let finish = addDays(s.finish, dxDays);
  for (let i = 0; i < 14 && !isWorkday(finish, workingDays) && workingDays.length; i++)
    finish = addDays(finish, dxDays > 0 ? 1 : -1);
  const durationDays = Math.max(1, s.durationDays + workdaysBetween(s.finish, finish, workingDays));
  return durationDays === s.durationDays ? { kind: 'none' } : { kind: 'resize', durationDays };
}

/** The rows left after folding: below a closed summary, or deeper than the level shown, rows hide. */
export function visibleRows<R extends Pick<Scheduled, 'id' | 'level'>>(
  rows: readonly R[],
  parentOf: ReadonlyMap<string, string | null>,
  collapsed: ReadonlySet<string>,
  level: number | null,
): R[] {
  const hidden = (id: string): boolean => {
    const seen = new Set<string>();
    for (let p = parentOf.get(id) ?? null; p && !seen.has(p); p = parentOf.get(p) ?? null) {
      if (collapsed.has(p)) return true;
      seen.add(p);
    }
    return false;
  };
  return rows.filter((r) => (level === null || r.level < level) && !hidden(r.id));
}

export type ColourRule = 'critical' | 'state' | 'kind' | 'type' | 'person';
export const COLOUR_RULES: { key: ColourRule; label: string }[] = [
  { key: 'critical', label: 'Critical path' },
  { key: 'state', label: 'State' },
  { key: 'kind', label: 'Kind' },
  { key: 'type', label: 'Type' },
  { key: 'person', label: 'Person' },
];
const STATE_COLOURS: Record<string, [string, string]> = {
  backlog: ['Backlog', '#8a8aa0'],
  unstarted: ['To do', '#6b7fd7'],
  started: ['In progress', '#d99a2b'],
  completed: ['Done', '#2f9e6a'],
  cancelled: ['Cancelled', '#b0b0b8'],
};
const KIND_COLOURS: Record<string, string> = {
  story: '#6b7fd7',
  task: '#4f8fbf',
  bug: '#d0563f',
  spike: '#9b6bd7',
  epic: '#7a5cc0',
  initiative: '#5b4aa8',
  milestone: '#444455',
};
const PALETTE = [
  '#4f8fbf',
  '#d99a2b',
  '#2f9e6a',
  '#9b6bd7',
  '#d0563f',
  '#3aa7a0',
  '#c05c9a',
  '#7d8f2e',
];

/** A bar's colour and the legend entry it belongs to; null keeps the critical-path look. */
export function barColour(
  rule: ColourRule,
  task: {
    kind: string;
    stateGroup: string;
    assigneeId: string | null;
    typeId?: string | null;
  },
  ctx: {
    types: ReadonlyMap<string, { name: string; color: string }>;
    people: readonly string[];
    name: (id: string | null) => string;
  },
): { colour: string; key: string } | null {
  switch (rule) {
    case 'critical':
      return null;
    case 'state': {
      const [label, colour] = STATE_COLOURS[task.stateGroup] ?? ['Other', '#8a8aa0'];
      return { colour, key: label };
    }
    case 'kind':
      return {
        colour: KIND_COLOURS[task.kind] ?? '#8a8aa0',
        key: task.kind.slice(0, 1).toUpperCase() + task.kind.slice(1),
      };
    case 'type': {
      const ty = task.typeId ? ctx.types.get(task.typeId) : undefined;
      return ty ? { colour: ty.color, key: ty.name } : { colour: '#8a8aa0', key: 'No type' };
    }
    case 'person': {
      if (!task.assigneeId) return { colour: '#8a8aa0', key: 'Nobody' };
      const i = Math.max(0, ctx.people.indexOf(task.assigneeId));
      return {
        colour: PALETTE[i % PALETTE.length] ?? '#4f8fbf',
        key: ctx.name(task.assigneeId) || 'Someone',
      };
    }
  }
}

/** The pieces of a split bar, and how many of its working days are done in each. */
export function barPieces(
  s: Pick<Scheduled, 'start' | 'finish' | 'durationDays' | 'percentDone'> & {
    segments?: { start: string; finish: string }[] | undefined;
  },
): { start: string; finish: string; done: number }[] {
  const parts = s.segments?.length ? s.segments : [{ start: s.start, finish: s.finish }];
  let left = (s.durationDays * s.percentDone) / 100;
  const whole = parts.reduce((n, p) => n + daysBetween(p.start, p.finish) + 1, 0);
  return parts.map((p) => {
    const len = daysBetween(p.start, p.finish) + 1;
    // done work fills the pieces in order, in proportion to their length
    const share = (len / Math.max(1, whole)) * s.durationDays;
    const done = Math.max(0, Math.min(1, left / Math.max(1e-9, share)));
    left -= share;
    return { ...p, done };
  });
}

interface Drag {
  id: string;
  mode: DragMode;
  x0: number;
  dx: number;
  shift: boolean;
  px: number;
  py: number;
}

export function GanttV2(props: {
  plan: PlanData;
  zoom: Zoom;
  critical: boolean;
  selected: string | null;
  name: (id: string | null) => string;
  onSelect: (id: string) => void;
  canEdit?: boolean;
  colour?: ColourRule;
  types?: ReadonlyMap<string, { name: string; color: string }>;
  level?: number | null;
  collapsed?: ReadonlySet<string>;
  onToggle?: (id: string) => void;
  onMove?: (id: string, startDate: string, days: number, withSuccessors: boolean) => void;
  onResize?: (id: string, durationDays: number) => void;
  onLink?: (predecessorId: string, successorId: string) => void;
}): ReactNode {
  const { plan } = props;
  const dw = dayWidth(props.zoom);
  const range = ganttSpan(plan, props.zoom);
  const w = Math.ceil(range.days * dw);
  const task = useMemo(() => new Map(plan.tasks.map((t) => [t.id, t])), [plan.tasks]);
  const parentOf = useMemo(() => new Map(plan.tasks.map((t) => [t.id, t.parentId])), [plan.tasks]);
  const collapsed = props.collapsed ?? new Set<string>();
  const rows = visibleRows(plan.schedule, parentOf, collapsed, props.level ?? null);
  const h = HEAD + rows.length * ROW;
  const x = (d: string): number => daysBetween(range.from, d) * dw;
  const end = (s: Pick<Scheduled, 'finish' | 'milestone'>): number =>
    x(s.finish) + (s.milestone ? 0 : dw);
  const y = (i: number): number => HEAD + i * ROW;
  const index = new Map(rows.map((r, i) => [r.id, i]));
  const base = new Map((plan.baseline?.variance ?? []).map((v) => [v.itemId, v]));
  const ticks = useMemo(
    () => axisTicks(props.zoom, range.from, range.days),
    [props.zoom, range.from, range.days],
  );
  const people = useMemo(
    () => [...new Set(plan.tasks.map((t) => t.assigneeId).filter((a): a is string => !!a))].sort(),
    [plan.tasks],
  );
  const rule = props.colour ?? 'critical';
  const colourOf = (id: string): { colour: string; key: string } | null => {
    const t = task.get(id);
    return t
      ? barColour(rule, t, { types: props.types ?? new Map(), people, name: props.name })
      : null;
  };
  const box = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  // [PCODE-266 | S15 | v0.1.0] a dropped bar, held until the plan answers (or a few seconds pass)
  const [settled, setSettled] = useState<{ id: string; mode: DragMode; px: number } | null>(null);
  useEffect(() => {
    setSettled(null);
  }, [plan.schedule]);
  useEffect(() => {
    if (!settled) return;
    const t = window.setTimeout(() => {
      setSettled(null);
    }, 8000);
    return () => {
      window.clearTimeout(t);
    };
  }, [settled]);
  useEffect(() => {
    if (box.current) box.current.scrollLeft = Math.max(0, x(plan.today) - 480);
  }, [props.zoom, plan.today]);

  // the drag runs on the window, so it keeps going when the pointer leaves the bar
  const live = useRef<Drag | null>(null);
  live.current = drag;
  const targetRef = useRef<string | null>(null);
  targetRef.current = target;
  useEffect(() => {
    if (!drag) return;
    const move = (e: PointerEvent): void => {
      const r = svg.current?.getBoundingClientRect();
      setDrag((d) =>
        d
          ? {
              ...d,
              dx: e.clientX - d.x0,
              shift: d.shift || e.shiftKey,
              px: e.clientX - (r?.left ?? 0),
              py: e.clientY - (r?.top ?? 0),
            }
          : d,
      );
    };
    const up = (): void => {
      const d = live.current;
      setDrag(null);
      setTarget(null);
      if (!d) return;
      const s = plan.schedule.find((r) => r.id === d.id);
      if (!s) return;
      if (d.mode === 'link') {
        const to = targetRef.current;
        if (to && to !== d.id) props.onLink?.(d.id, to);
        return;
      }
      const out = dragOutcome(d.mode, s, Math.round(d.dx / dw), plan.workingDays);
      // [PCODE-266 | S15 | v0.1.0] the bar stays where it was dropped until the new plan comes
      if (out.kind !== 'none')
        setSettled({ id: d.id, mode: d.mode, px: Math.round(d.dx / dw) * dw });
      if (out.kind === 'move') props.onMove?.(d.id, out.startDate, out.days, d.shift);
      else if (out.kind === 'resize') props.onResize?.(d.id, out.durationDays);
      else props.onSelect(d.id);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [drag !== null, dw]);

  const start = (id: string, mode: DragMode) => (e: React.PointerEvent) => {
    if (!props.canEdit) return;
    e.stopPropagation();
    e.preventDefault();
    const r = svg.current?.getBoundingClientRect();
    setDrag({
      id,
      mode,
      x0: e.clientX,
      dx: 0,
      shift: e.shiftKey,
      px: e.clientX - (r?.left ?? 0),
      py: e.clientY - (r?.top ?? 0),
    });
  };
  const shiftOf = (id: string): number =>
    drag && drag.id === id && drag.mode === 'move'
      ? Math.round(drag.dx / dw) * dw
      : !drag && settled?.id === id && settled.mode === 'move'
        ? settled.px
        : 0;
  const growOf = (id: string): number =>
    drag && drag.id === id && drag.mode === 'resize'
      ? Math.round(drag.dx / dw) * dw
      : !drag && settled?.id === id && settled.mode === 'resize'
        ? settled.px
        : 0;
  const kids = new Set(plan.tasks.map((t) => t.parentId).filter((p): p is string => !!p));
  // [PCODE-262 | S15 | v0.1.0] the commits and pull requests of each task
  const gitOf = new Map<string, NonNullable<PlanData['git']>>();
  for (const g of plan.git ?? []) gitOf.set(g.itemId, [...(gitOf.get(g.itemId) ?? []), g]);

  return (
    <div className={'pv-gantt' + (drag ? ' pv-gantt--drag' : '')} ref={box}>
      <div className="pv-gantt-left" role="table" aria-label="Tasks">
        <div className="pv-gantt-left-head" role="row">
          <span role="columnheader">WBS</span>
          <span role="columnheader">Task</span>
          <span role="columnheader">Who</span>
        </div>
        {rows.map((r) => {
          const t = task.get(r.id);
          const folds = kids.has(r.id) && props.onToggle;
          return (
            <div
              key={r.id}
              role="row"
              className={
                'pv-gantt-row' +
                (r.summary ? ' pv-gantt-row--summary' : '') +
                (props.selected === r.id ? ' pv-gantt-row--sel' : '')
              }
            >
              <span role="cell" className="pv-mono pv-muted">
                {r.wbs}
              </span>
              <span
                role="cell"
                className={'pv-gantt-name pv-indent-' + String(Math.min(3, r.level))}
                title={(t?.ref ?? '') + ' ' + (t?.title ?? '')}
              >
                {folds ? (
                  <button
                    type="button"
                    className="pv-fold"
                    aria-expanded={!collapsed.has(r.id)}
                    aria-label={(collapsed.has(r.id) ? 'Expand ' : 'Collapse ') + (t?.ref ?? '')}
                    onClick={() => {
                      props.onToggle?.(r.id);
                    }}
                  >
                    {collapsed.has(r.id) ? '▸' : '▾'}
                  </button>
                ) : null}
                {r.milestone ? <span className="pv-diamond" aria-hidden="true" /> : null}
                <button
                  type="button"
                  className="pv-gantt-pick"
                  onClick={() => {
                    props.onSelect(r.id);
                  }}
                >
                  {t?.title}
                </button>
              </span>
              <span role="cell">
                {t?.assigneeId ? (
                  <LiveAvatar id={t.assigneeId} name={props.name(t.assigneeId)} size="xs" />
                ) : null}
              </span>
            </div>
          );
        })}
      </div>
      <div className="pv-gantt-right">
        <svg
          ref={svg}
          width={w}
          height={h}
          className="pv-gantt-svg"
          role="img"
          aria-label="Schedule"
        >
          <defs>
            <marker
              id="pv-arrow"
              viewBox="0 0 8 8"
              refX="7"
              refY="4"
              markerWidth="7"
              markerHeight="7"
              orient="auto"
            >
              <path d="M0 0 8 4 0 8z" className="pv-dep-head" />
            </marker>
            <marker
              id="pv-arrow-crit"
              viewBox="0 0 8 8"
              refX="7"
              refY="4"
              markerWidth="7"
              markerHeight="7"
              orient="auto"
            >
              <path d="M0 0 8 4 0 8z" className="pv-dep-head pv-dep-head--crit" />
            </marker>
          </defs>
          {props.zoom === 'day' || props.zoom === 'week'
            ? Array.from({ length: range.days }, (_, i) => {
                const d = addDays(range.from, i);
                return isWorkday(d, plan.workingDays) ? null : (
                  <rect
                    key={d}
                    className="pv-weekend"
                    x={i * dw}
                    y={HEAD}
                    width={dw}
                    height={h - HEAD}
                  />
                );
              })
            : null}
          {ticks.lines.map((i) => (
            <line
              key={'l' + String(i)}
              className="pv-gridline"
              x1={i * dw}
              x2={i * dw}
              y1={18}
              y2={h}
            />
          ))}
          {ticks.top.map((t) => (
            <text key={'t' + String(t.i)} className="pv-axis" x={t.i * dw + 4} y={14}>
              {t.label}
            </text>
          ))}
          {ticks.bottom.map((t) => {
            const strong = ticks.lines.includes(t.i);
            return (
              <text
                key={'b' + String(t.i)}
                className={'pv-axis ' + (strong ? 'pv-axis--strong' : 'pv-axis--faint')}
                x={props.zoom === 'day' && !strong ? t.i * dw + dw / 2 : t.i * dw + 4}
                y={34}
                textAnchor={props.zoom === 'day' && !strong ? 'middle' : undefined}
              >
                {t.label}
              </text>
            );
          })}
          <line className="pv-gridline" x1="0" x2={w} y1={HEAD} y2={HEAD} />
          {rows.map((r, i) =>
            props.selected === r.id ? (
              <rect
                key={'sel' + r.id}
                className="pv-gantt-sel"
                x="0"
                y={y(i)}
                width={w}
                height={ROW}
              />
            ) : null,
          )}
          {plan.dependencies.map((d) => {
            const i = index.get(d.successorId);
            const j = index.get(d.predecessorId);
            const to = i !== undefined ? rows[i] : undefined;
            const from = j !== undefined ? rows[j] : undefined;
            if (!to || !from || i === undefined || j === undefined) return null;
            const startSide = d.kind === 'SS' || d.kind === 'SF';
            const toEnd = d.kind === 'FF' || d.kind === 'SF';
            const x1 = startSide ? x(from.start) : end(from);
            const x2 = toEnd ? end(to) : x(to.start) - (to.milestone ? 6 : 1);
            const y1 = y(j) + ROW / 2;
            const y2 = y(i) + ROW / 2;
            const crit = props.critical && to.critical && from.critical;
            const bend = startSide ? x1 - 6 : x1 + 6;
            return (
              <path
                key={d.id}
                className={'pv-dep' + (crit ? ' pv-dep--crit' : '')}
                d={
                  'M' +
                  String(x1) +
                  ' ' +
                  String(y1) +
                  ' H' +
                  String(bend) +
                  ' V' +
                  String(y2) +
                  ' H' +
                  String(x2)
                }
                markerEnd={crit ? 'url(#pv-arrow-crit)' : 'url(#pv-arrow)'}
              >
                <title>
                  {d.kind +
                    (d.lagDays ? ' ' + (d.lagDays > 0 ? '+' : '') + String(d.lagDays) + ' d' : '')}
                </title>
              </path>
            );
          })}
          {rows.map((r, i) => {
            const cy = y(i) + ROW / 2;
            const crit = props.critical && r.critical && rule === 'critical';
            const b = base.get(r.id);
            const t = task.get(r.id);
            const paint = colourOf(r.id);
            const off = shiftOf(r.id);
            const grow = growOf(r.id);
            const editable = props.canEdit && !r.summary;
            const pieces = barPieces(r);
            const barEnd = end(r) + off + grow;
            return (
              <g
                key={r.id}
                className={
                  'pv-gantt-item' +
                  (target === r.id ? ' pv-gantt-item--target' : '') +
                  (editable ? ' pv-gantt-item--edit' : '')
                }
                data-task={r.id}
                onClick={() => {
                  if (!props.canEdit) props.onSelect(r.id);
                }}
                onPointerEnter={() => {
                  if (drag?.mode === 'link' && drag.id !== r.id && !r.summary) setTarget(r.id);
                }}
                onPointerLeave={() => {
                  if (target === r.id) setTarget(null);
                }}
              >
                <title>
                  {(t?.ref ?? '') +
                    ' ' +
                    (t?.title ?? '') +
                    ': ' +
                    shortDate(r.start) +
                    ' – ' +
                    shortDate(r.finish) +
                    ', ' +
                    String(r.percentDone) +
                    ' % done' +
                    (r.critical ? ', critical' : ', float ' + String(r.totalFloat) + ' d') +
                    (r.constraintBroken ? ', its constraint cannot hold' : '') +
                    (editable ? '. Drag to move, Shift-drag to move what follows' : '')}
                </title>
                {b?.start && b.finish && !r.milestone ? (
                  <rect
                    className="pv-baseline"
                    x={x(b.start)}
                    y={cy + 7}
                    width={Math.max(2, x(b.finish) + dw - x(b.start))}
                    height="4"
                    rx="2"
                  />
                ) : null}
                {b?.start && r.milestone && b.start !== r.start ? (
                  <path
                    className="pv-baseline-ms"
                    d={'M' + String(x(b.start)) + ' ' + String(cy - 5) + ' l5 5 -5 5 -5 -5z'}
                  />
                ) : null}
                {r.milestone ? (
                  <path
                    className={'pv-milestone' + (crit ? ' pv-milestone--crit' : '')}
                    style={paint ? { fill: paint.colour } : undefined}
                    d={'M' + String(x(r.start) + off) + ' ' + String(cy - 8) + ' l8 8 -8 8 -8 -8z'}
                    onPointerDown={editable ? start(r.id, 'move') : undefined}
                  />
                ) : r.summary ? (
                  <path
                    className="pv-summary"
                    d={
                      'M' +
                      String(x(r.start)) +
                      ' ' +
                      String(cy + 4) +
                      ' V' +
                      String(cy - 5) +
                      ' H' +
                      String(end(r)) +
                      ' V' +
                      String(cy + 4) +
                      ' l-5 -4 H' +
                      String(x(r.start) + 5) +
                      'z'
                    }
                  />
                ) : (
                  <>
                    {pieces.length > 1
                      ? pieces
                          .slice(1)
                          .map((p, k) => (
                            <line
                              key={'gap' + String(k)}
                              className="pv-split-gap"
                              x1={
                                end({ finish: pieces[k]?.finish ?? p.start, milestone: false }) +
                                off
                              }
                              x2={x(p.start) + off}
                              y1={cy - 1}
                              y2={cy - 1}
                            />
                          ))
                      : null}
                    {pieces.map((p, k) => {
                      const px = x(p.start) + off;
                      const last = k === pieces.length - 1;
                      const pw = Math.max(
                        4,
                        end({ finish: p.finish, milestone: false }) -
                          x(p.start) +
                          (last ? grow : 0),
                      );
                      return (
                        <g key={'p' + String(k)}>
                          <rect
                            className={'pv-task-bar' + (crit ? ' pv-task-bar--crit' : '')}
                            style={
                              paint
                                ? {
                                    fill:
                                      'color-mix(in srgb, ' +
                                      paint.colour +
                                      ' 25%, var(--pv-card))',
                                  }
                                : undefined
                            }
                            x={px}
                            y={cy - 8}
                            width={pw}
                            height="14"
                            rx="4"
                            onPointerDown={editable ? start(r.id, 'move') : undefined}
                          />
                          <rect
                            className={'pv-task-done' + (crit ? ' pv-task-done--crit' : '')}
                            style={paint ? { fill: paint.colour } : undefined}
                            x={px}
                            y={cy - 8}
                            width={Math.max(0, pw * p.done)}
                            height="14"
                            rx="4"
                            pointerEvents="none"
                          />
                        </g>
                      );
                    })}
                    {editable ? (
                      <rect
                        className="pv-bar-grip"
                        x={barEnd - 5}
                        y={cy - 8}
                        width="6"
                        height="14"
                        onPointerDown={start(r.id, 'resize')}
                      >
                        <title>Drag to change the duration</title>
                      </rect>
                    ) : null}
                  </>
                )}
                {editable ? (
                  <circle
                    className="pv-link-dot"
                    cx={barEnd + (r.milestone ? 12 : 6)}
                    cy={cy - 1}
                    r="4"
                    onPointerDown={start(r.id, 'link')}
                  >
                    <title>Drag onto another task to make it wait for this one</title>
                  </circle>
                ) : null}
                {/* [PCODE-262 | S15 | v0.1.0] commits and pull requests on the bar, on their day */}
                {(gitOf.get(r.id) ?? []).map((g, k) => {
                  const gx = x(g.date) + dw / 2 + off;
                  const mark = (
                    <>
                      <title>
                        {(g.kind === 'pull_request' ? 'Pull request #' : 'Commit ') +
                          g.ref.slice(0, 10) +
                          (g.title ? ': ' + g.title : '') +
                          (g.state ? ' (' + g.state + ')' : '') +
                          ', ' +
                          shortDate(g.date)}
                      </title>
                      {g.kind === 'pull_request' ? (
                        <rect
                          className="pv-commit pv-commit--pr"
                          x={gx - 3.5}
                          y={cy - 15}
                          width="7"
                          height="7"
                          rx="1.5"
                        />
                      ) : (
                        <circle className="pv-commit" cx={gx} cy={cy - 11} r="3.5" />
                      )}
                    </>
                  );
                  return g.url ? (
                    <a key={'g' + String(k)} href={g.url} target="_blank" rel="noreferrer">
                      {mark}
                    </a>
                  ) : (
                    <g key={'g' + String(k)}>{mark}</g>
                  );
                })}
                {r.constraintBroken ? (
                  <text className="pv-bar-flag" x={x(r.start) + off - 10} y={cy + 4}>
                    !
                  </text>
                ) : null}
                {!r.summary ? (
                  <text
                    className="pv-bar-label"
                    x={barEnd + (r.milestone ? 12 : 6) + (editable ? 10 : 0)}
                    y={cy + 4}
                  >
                    {r.milestone ? shortDate(r.start) : String(r.percentDone) + ' %'}
                    {b?.finishSlip
                      ? (b.finishSlip > 0 ? ' · +' : ' · ') + String(b.finishSlip) + ' d'
                      : ''}
                    {r.violations.length ? ' · breaks a dependency' : ''}
                    {r.constraintBroken ? ' · constraint broken' : ''}
                    {drag?.id === r.id && drag.mode === 'move' && off
                      ? ' · ' +
                        (drag.shift ? 'with what follows, ' : '') +
                        shortDate(
                          workdayFrom(addDays(r.start, Math.round(off / dw)), plan.workingDays),
                        )
                      : ''}
                  </text>
                ) : null}
              </g>
            );
          })}
          {drag?.mode === 'link' ? (
            <line
              className="pv-link-line"
              x1={(() => {
                const s = rows.find((r) => r.id === drag.id);
                return s ? end(s) + 6 : 0;
              })()}
              y1={(index.get(drag.id) ?? 0) * ROW + HEAD + ROW / 2 - 1}
              x2={drag.px}
              y2={drag.py}
            />
          ) : null}
          <line className="pv-today" x1={x(plan.today)} x2={x(plan.today)} y1={18} y2={h} />
          <text className="pv-today-label" x={x(plan.today) + 4} y={h - 6}>
            today
          </text>
        </svg>
      </div>
    </div>
  );
}

/** The legend for a colour rule: one entry per colour on a bar (summaries and milestones have their own). */
export function colourLegend(
  rule: ColourRule,
  plan: Pick<PlanData, 'tasks' | 'schedule'>,
  ctx: Parameters<typeof barColour>[2],
): { key: string; colour: string }[] {
  const bars = new Set(plan.schedule.filter((x) => !x.summary && !x.milestone).map((x) => x.id));
  const out = new Map<string, string>();
  for (const t of plan.tasks) {
    if (!bars.has(t.id)) continue;
    const c = barColour(rule, t, ctx);
    if (c && !out.has(c.key)) out.set(c.key, c.colour);
  }
  return [...out].map(([key, colour]) => ({ key, colour }));
}
