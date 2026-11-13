// ── [PCODE-440 | S15 | v0.1.0] T37 Consistency: errors and loading are announced everywhere ──
// ── [PCODE-262 | S15 | v0.1.0] T27.4 Canvas views: timeline, mind map, portfolio; agents as resources and heat map; scenario diff; commits on bars ──
//    Why:  the same plan seen the other ways people need it: the timeline a steering meeting reads (one lane
//          per part of the project, milestones on their own), the mind map that shows how the work breaks
//          down and grows it, the portfolio of every project on one axis, the heat map of who (or which
//          agent) is loaded on which day, and what a scenario changes task by task.
import { useEffect, useState, type ReactNode } from 'react';
import { api } from '../core/api.js';
import { PIcon } from '../preview/picons.js';
import { Card, Chip } from '../preview/ui.js';
import type { PlanData } from './canvas.js';
import { axisTicks, ganttSpan } from './gantt.js';

const DAY = 86_400_000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const t0 = (iso: string): number => Date.parse(iso + 'T00:00:00Z');
const daysBetween = (a: string, b: string): number => Math.round((t0(b) - t0(a)) / DAY);
const shortDate = (d: string): string =>
  String(new Date(t0(d)).getUTCDate()) + ' ' + (MONTHS[new Date(t0(d)).getUTCMonth()] ?? '');

// ── timeline ──

export interface Lane {
  id: string;
  title: string;
  start: string;
  finish: string;
  percentDone: number;
  critical: boolean;
  /** the tasks under it, for the bar's inner marks */
  parts: { start: string; finish: string; done: boolean }[];
}

/** The lanes of the timeline: each top-level part with its span; loose top-level tasks share one lane. */
export function timelineLanes(plan: Pick<PlanData, 'tasks' | 'schedule'>): {
  lanes: Lane[];
  milestones: { id: string; title: string; date: string; critical: boolean }[];
} {
  const task = new Map(plan.tasks.map((t) => [t.id, t]));
  const top = plan.schedule.filter((s) => s.level === 0);
  const under = (id: string): typeof plan.schedule => {
    const kids = new Set([id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const t of plan.tasks)
        if (t.parentId && kids.has(t.parentId) && !kids.has(t.id)) {
          kids.add(t.id);
          grew = true;
        }
    }
    return plan.schedule.filter((s) => kids.has(s.id) && s.id !== id && !s.summary && !s.milestone);
  };
  const lanes: Lane[] = top
    .filter((s) => s.summary)
    .map((s) => ({
      id: s.id,
      title: task.get(s.id)?.title ?? '',
      start: s.start,
      finish: s.finish,
      percentDone: s.percentDone,
      critical: under(s.id).some((x) => x.critical),
      parts: under(s.id).map((x) => ({
        start: x.start,
        finish: x.finish,
        done: x.percentDone >= 100,
      })),
    }));
  const loose = top.filter((s) => !s.summary && !s.milestone);
  if (loose.length)
    lanes.push({
      id: 'loose',
      title: 'Other tasks',
      start: loose.map((s) => s.start).sort()[0] ?? '',
      finish:
        loose
          .map((s) => s.finish)
          .sort()
          .pop() ?? '',
      percentDone: Math.round(loose.reduce((n, s) => n + s.percentDone, 0) / loose.length),
      critical: loose.some((s) => s.critical),
      parts: loose.map((x) => ({ start: x.start, finish: x.finish, done: x.percentDone >= 100 })),
    });
  return {
    lanes,
    milestones: plan.schedule
      .filter((s) => s.milestone)
      .map((s) => ({
        id: s.id,
        title: task.get(s.id)?.title ?? '',
        date: s.start,
        critical: s.critical,
      })),
  };
}

const LANE = 46;
const HEAD = 44;

export function TimelineV2(props: { plan: PlanData; onSelect: (id: string) => void }): ReactNode {
  const { plan } = props;
  const zoom = 'month';
  const range = ganttSpan(plan, zoom);
  const dw = 4.2;
  const w = Math.ceil(range.days * dw);
  const ticks = axisTicks(zoom, range.from, range.days);
  const { lanes, milestones } = timelineLanes(plan);
  const x = (d: string): number => daysBetween(range.from, d) * dw;
  const msRow = milestones.length ? 1 : 0;
  const h = HEAD + (lanes.length + msRow) * LANE + 8;
  return (
    <Card flush title="Timeline">
      <div className="pv-grid-scroll">
        <svg
          width={Math.max(w, 600)}
          height={h}
          className="pv-gantt-svg"
          role="img"
          aria-label="Timeline"
        >
          {ticks.lines.map((i) => (
            <line key={i} className="pv-gridline" x1={i * dw} x2={i * dw} y1={18} y2={h} />
          ))}
          {ticks.top.map((t) => (
            <text key={'t' + String(t.i)} className="pv-axis" x={t.i * dw + 4} y={14}>
              {t.label}
            </text>
          ))}
          {ticks.bottom.map((t) => (
            <text
              key={'b' + String(t.i)}
              className="pv-axis pv-axis--strong"
              x={t.i * dw + 4}
              y={34}
            >
              {t.label}
            </text>
          ))}
          {milestones.length ? (
            <g>
              <text className="pv-tl-lane" x={6} y={HEAD + 16}>
                Milestones
              </text>
              {milestones.map((m) => (
                <g
                  key={m.id}
                  className="pv-gantt-item"
                  onClick={() => {
                    props.onSelect(m.id);
                  }}
                >
                  <path
                    className={'pv-milestone' + (m.critical ? ' pv-milestone--crit' : '')}
                    d={'M' + String(x(m.date)) + ' ' + String(HEAD + 20) + ' l8 8 -8 8 -8 -8z'}
                  />
                  <text className="pv-bar-label" x={x(m.date) + 11} y={HEAD + 32}>
                    {m.title} · {shortDate(m.date)}
                  </text>
                </g>
              ))}
            </g>
          ) : null}
          {lanes.map((l, i) => {
            const y = HEAD + (i + msRow) * LANE;
            const x1 = x(l.start);
            const bw = Math.max(6, x(l.finish) + dw - x1);
            return (
              <g
                key={l.id}
                className="pv-gantt-item"
                onClick={() => {
                  if (l.id !== 'loose') props.onSelect(l.id);
                }}
              >
                <title>
                  {l.title +
                    ': ' +
                    shortDate(l.start) +
                    ' – ' +
                    shortDate(l.finish) +
                    ', ' +
                    String(l.percentDone) +
                    ' % done'}
                </title>
                <line
                  className="pv-gridline"
                  x1={0}
                  x2={Math.max(w, 600)}
                  y1={y + LANE}
                  y2={y + LANE}
                />
                <text className="pv-tl-lane" x={6} y={y + 14}>
                  {l.title}
                </text>
                <rect
                  className={'pv-tl-bar' + (l.critical ? ' pv-tl-bar--crit' : '')}
                  x={x1}
                  y={y + 20}
                  width={bw}
                  height={18}
                  rx={5}
                />
                <rect
                  className="pv-tl-done"
                  x={x1}
                  y={y + 20}
                  width={(bw * l.percentDone) / 100}
                  height={18}
                  rx={5}
                />
                {l.parts.map((p, k) => (
                  <rect
                    key={k}
                    className={'pv-tl-part' + (p.done ? ' pv-tl-part--done' : '')}
                    x={x(p.start)}
                    y={y + 36}
                    width={Math.max(2, x(p.finish) + dw - x(p.start))}
                    height={2}
                  />
                ))}
                <text className="pv-bar-label" x={x1 + bw + 6} y={y + 33}>
                  {String(l.percentDone)} % · {shortDate(l.finish)}
                </text>
              </g>
            );
          })}
          <line className="pv-today" x1={x(plan.today)} x2={x(plan.today)} y1={18} y2={h} />
        </svg>
      </div>
    </Card>
  );
}

// ── mind map ──

export interface MindNode {
  id: string;
  title: string;
  ref: string;
  percentDone: number;
  kind: string;
  depth: number;
  /** vertical slot in leaf units */
  y: number;
  children: MindNode[];
}

/** The tree of the project for the mind map, laid out left to right with leaves in slots. */
export function mindTree(
  plan: Pick<PlanData, 'tasks' | 'schedule'>,
  collapsed: ReadonlySet<string>,
): {
  roots: MindNode[];
  slots: number;
} {
  const sched = new Map(plan.schedule.map((s) => [s.id, s]));
  const kids = new Map<string | null, PlanData['tasks']>();
  const ids = new Set(plan.tasks.map((t) => t.id));
  for (const t of plan.tasks) {
    if (!sched.has(t.id)) continue;
    const p = t.parentId && ids.has(t.parentId) ? t.parentId : null;
    kids.set(p, [...(kids.get(p) ?? []), t]);
  }
  const order = (list: PlanData['tasks']): PlanData['tasks'] =>
    [...list].sort((a, b) =>
      (sched.get(a.id)?.wbs ?? '').localeCompare(sched.get(b.id)?.wbs ?? '', undefined, {
        numeric: true,
      }),
    );
  let slot = 0;
  const build = (t: PlanData['tasks'][number], depth: number, seen: Set<string>): MindNode => {
    const below = collapsed.has(t.id) || seen.has(t.id) ? [] : order(kids.get(t.id) ?? []);
    const children = below.map((k) => build(k, depth + 1, new Set([...seen, t.id])));
    const y = children.length
      ? ((children[0]?.y ?? 0) + (children[children.length - 1]?.y ?? 0)) / 2
      : slot++;
    return {
      id: t.id,
      title: t.title,
      ref: t.ref,
      percentDone: sched.get(t.id)?.percentDone ?? 0,
      kind: t.kind,
      depth,
      y,
      children,
    };
  };
  const roots = order(kids.get(null) ?? []).map((t) => build(t, 1, new Set()));
  return { roots, slots: Math.max(1, slot) };
}

const MW = 210;
const MH = 34;
const SLOT = 44;

export function MindMapV2(props: {
  plan: PlanData;
  projectName: string;
  canEdit: boolean;
  onSelect: (id: string) => void;
  onAdd: (parentId: string | null, title: string) => void;
}): ReactNode {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [adding, setAdding] = useState<{ parent: string | null; title: string } | null>(null);
  const { roots, slots } = mindTree(props.plan, collapsed);
  const kidsOf = new Set(props.plan.tasks.map((t) => t.parentId).filter((p): p is string => !!p));
  const all: MindNode[] = [];
  const walk = (n: MindNode): void => {
    all.push(n);
    n.children.forEach(walk);
  };
  roots.forEach(walk);
  const depth = Math.max(1, ...all.map((n) => n.depth));
  const w = 40 + (depth + 1) * (MW + 50);
  const h = Math.max(120, slots * SLOT + 20);
  const nx = (d: number): number => 20 + d * (MW + 50);
  const ny = (y: number): number => 10 + y * SLOT;
  const rootY = roots.length ? ((roots[0]?.y ?? 0) + (roots[roots.length - 1]?.y ?? 0)) / 2 : 0;
  const link = (x1: number, y1: number, x2: number, y2: number): string =>
    'M' +
    String(x1) +
    ' ' +
    String(y1) +
    ' C' +
    String(x1 + 30) +
    ' ' +
    String(y1) +
    ' ' +
    String(x2 - 30) +
    ' ' +
    String(y2) +
    ' ' +
    String(x2) +
    ' ' +
    String(y2);
  const node = (n: MindNode): ReactNode => (
    <g key={n.id} className="pv-mind-node">
      {n.children.map((c) => (
        <path
          key={'l' + c.id}
          className="pv-mind-link"
          d={link(nx(n.depth) + MW, ny(n.y) + MH / 2, nx(c.depth), ny(c.y) + MH / 2)}
        />
      ))}
      <foreignObject x={nx(n.depth)} y={ny(n.y)} width={MW} height={MH}>
        <div className={'pv-mind-box pv-mind-box--' + n.kind}>
          {kidsOf.has(n.id) ? (
            <button
              type="button"
              className="pv-fold"
              aria-expanded={!collapsed.has(n.id)}
              aria-label={(collapsed.has(n.id) ? 'Expand ' : 'Collapse ') + n.ref}
              onClick={() => {
                const next = new Set(collapsed);
                if (next.has(n.id)) next.delete(n.id);
                else next.add(n.id);
                setCollapsed(next);
              }}
            >
              {collapsed.has(n.id) ? '▸' : '▾'}
            </button>
          ) : null}
          <button
            type="button"
            className="pv-mind-title"
            title={n.ref + ' ' + n.title}
            onClick={() => {
              props.onSelect(n.id);
            }}
          >
            {n.title}
          </button>
          <span className="pv-mind-pct">{n.percentDone}%</span>
          {props.canEdit ? (
            <button
              type="button"
              className="pv-mind-add"
              aria-label={'Add a task under ' + n.ref}
              onClick={() => {
                setAdding({ parent: n.id, title: '' });
              }}
            >
              +
            </button>
          ) : null}
        </div>
      </foreignObject>
      {n.children.map(node)}
    </g>
  );
  return (
    <Card flush title="Mind map">
      {adding ? (
        <form
          className="v2-inline v2-pad"
          onSubmit={(e) => {
            e.preventDefault();
            if (!adding.title.trim()) return;
            props.onAdd(adding.parent, adding.title.trim());
            setAdding(null);
          }}
        >
          <span className="pv-small pv-muted">
            New task under{' '}
            {adding.parent
              ? (props.plan.tasks.find((t) => t.id === adding.parent)?.title ?? '')
              : props.projectName}
          </span>
          <input
            className="v2-input v2-input--sm"
            aria-label="Title of the new task"
            autoFocus
            value={adding.title}
            onChange={(e) => {
              setAdding({ ...adding, title: e.target.value });
            }}
          />
          <button type="submit" className="pv-btn pv-btn--primary pv-btn--sm">
            Add
          </button>
          <button
            type="button"
            className="pv-btn pv-btn--sm"
            onClick={() => {
              setAdding(null);
            }}
          >
            Cancel
          </button>
        </form>
      ) : null}
      <div className="pv-grid-scroll">
        <svg width={w} height={h} className="pv-mind" role="img" aria-label="Mind map">
          {roots.map((r) => (
            <path
              key={'root' + r.id}
              className="pv-mind-link"
              d={link(nx(0) + MW, ny(rootY) + MH / 2, nx(1), ny(r.y) + MH / 2)}
            />
          ))}
          <foreignObject x={nx(0)} y={ny(rootY)} width={MW} height={MH}>
            <div className="pv-mind-box pv-mind-box--root">
              <span className="pv-mind-title">{props.projectName}</span>
              {props.canEdit ? (
                <button
                  type="button"
                  className="pv-mind-add"
                  aria-label="Add a task at the top"
                  onClick={() => {
                    setAdding({ parent: null, title: '' });
                  }}
                >
                  +
                </button>
              ) : null}
            </div>
          </foreignObject>
          {roots.map(node)}
        </svg>
      </div>
    </Card>
  );
}

// ── portfolio ──

export interface PortfolioPlan {
  today: string;
  projects: {
    id: string;
    key: string;
    name: string;
    tasks: number;
    start: string | null;
    finish: string | null;
    percentDone: number;
    critical: number;
    late: number;
    baseline: { name: string; finish: string; slip: number } | null;
    milestones: { id: string; title: string; date: string }[];
  }[];
}

export function PortfolioV2(props: {
  workspaceId: string;
  go: (p: string) => void;
  data?: PortfolioPlan;
}): ReactNode {
  const [data, setData] = useState<PortfolioPlan | null>(props.data ?? null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (props.data) return;
    void api<PortfolioPlan>('GET', '/api/workspaces/' + props.workspaceId + '/plan/portfolio').then(
      (r) => {
        if (r.ok) setData(r.data);
        else setError(r.error.message);
      },
    );
  }, [props.workspaceId, props.data]);
  if (error)
    return (
      <p className="v2-error" role="alert">
        {error}
      </p>
    );
  if (!data)
    return (
      <p className="pv-muted" role="status">
        Loading…
      </p>
    );
  const dated = data.projects.filter((p) => p.start && p.finish);
  const span = {
    start: [data.today, ...dated.map((p) => p.start ?? '')].sort()[0] ?? data.today,
    finish: [data.today, ...dated.map((p) => p.finish ?? '')].sort().pop() ?? data.today,
    today: data.today,
  };
  const range = ganttSpan(span, 'month');
  const dw = 3;
  const W2 = Math.ceil(range.days * dw);
  const ticks = axisTicks('month', range.from, range.days);
  const x = (d: string): number => daysBetween(range.from, d) * dw;
  return (
    <Card flush title="Portfolio: every project on one axis">
      <div className="pv-grid-scroll">
        <table className="pv-table pv-portfolio">
          <thead>
            <tr>
              <th>Project</th>
              <th className="pv-num">Tasks</th>
              <th className="pv-num">Done</th>
              <th>Finish</th>
              <th className="pv-num">Slip</th>
              <th className="pv-num">Critical</th>
              <th className="pv-num">Late</th>
              <th>
                <svg width={W2} height={22} aria-hidden="true">
                  {ticks.bottom.map((t) => (
                    <text key={t.i} className="pv-axis pv-axis--strong" x={t.i * dw + 3} y={16}>
                      {t.label}
                    </text>
                  ))}
                </svg>
              </th>
            </tr>
          </thead>
          <tbody>
            {data.projects.map((p) => (
              <tr key={p.id}>
                <td>
                  <button
                    type="button"
                    className="pv-link-btn"
                    onClick={() => {
                      props.go('/projects/' + p.id + '/canvas');
                    }}
                  >
                    <span className="pv-mono pv-muted">{p.key}</span> {p.name}
                  </button>
                </td>
                <td className="pv-num">{p.tasks}</td>
                <td className="pv-num">{String(p.percentDone) + ' %'}</td>
                <td>{p.finish ? shortDate(p.finish) : '—'}</td>
                <td
                  className={
                    'pv-num ' + (p.baseline && p.baseline.slip > 0 ? 'pv-text-danger' : 'pv-muted')
                  }
                >
                  {p.baseline
                    ? (p.baseline.slip > 0 ? '+' : '') + String(p.baseline.slip) + ' d'
                    : '—'}
                </td>
                <td className="pv-num">{p.critical || '—'}</td>
                <td className="pv-num">
                  {p.late ? (
                    <Chip tone="warning">{p.late}</Chip>
                  ) : (
                    <span className="pv-muted">—</span>
                  )}
                </td>
                <td>
                  <svg width={W2} height={24} role="img" aria-label={p.name + ' on the axis'}>
                    {ticks.lines.map((i) => (
                      <line
                        key={i}
                        className="pv-gridline"
                        x1={i * dw}
                        x2={i * dw}
                        y1={0}
                        y2={24}
                      />
                    ))}
                    {p.start && p.finish ? (
                      <>
                        <rect
                          className="pv-tl-bar"
                          x={x(p.start)}
                          y={6}
                          width={Math.max(4, x(p.finish) + dw - x(p.start))}
                          height={12}
                          rx={4}
                        />
                        <rect
                          className="pv-tl-done"
                          x={x(p.start)}
                          y={6}
                          width={(Math.max(4, x(p.finish) + dw - x(p.start)) * p.percentDone) / 100}
                          height={12}
                          rx={4}
                        />
                      </>
                    ) : null}
                    {p.milestones.map((m) => (
                      <path
                        key={m.id}
                        className="pv-milestone"
                        d={'M' + String(x(m.date)) + ' 6 l6 6 -6 6 -6 -6z'}
                      >
                        <title>{m.title + ' · ' + shortDate(m.date)}</title>
                      </path>
                    ))}
                    <line
                      className="pv-today"
                      x1={x(data.today)}
                      x2={x(data.today)}
                      y1={0}
                      y2={24}
                    />
                  </svg>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!data.projects.length ? (
        <div className="pv-empty">
          <PIcon name="canvas" size={28} />
          <strong>No open projects.</strong>
        </div>
      ) : null}
    </Card>
  );
}

// ── scenario diff ──

export interface DiffLine {
  itemId: string;
  ref: string;
  title: string;
  startFrom: string;
  startTo: string;
  finishFrom: string;
  finishTo: string;
  durationFrom: number;
  durationTo: number;
  assigneeFrom: string | null;
  assigneeTo: string | null;
  direct: boolean;
}

export function ScenarioDiff(props: {
  diff: DiffLine[];
  name: (id: string | null) => string;
  onSelect: (id: string) => void;
}): ReactNode {
  if (!props.diff.length)
    return (
      <Card title="What the scenario changes">
        <p className="pv-muted pv-small">Nothing differs from the live plan yet.</p>
      </Card>
    );
  const moved = (a: string, b: string): string =>
    a === b ? shortDate(a) : shortDate(a) + ' → ' + shortDate(b);
  return (
    <Card flush title={'What the scenario changes: ' + String(props.diff.length) + ' tasks'}>
      <table className="pv-table">
        <thead>
          <tr>
            <th>Task</th>
            <th>Start</th>
            <th>Finish</th>
            <th className="pv-num">Duration</th>
            <th>Who</th>
            <th>Why</th>
          </tr>
        </thead>
        <tbody>
          {props.diff.map((d) => (
            <tr key={d.itemId}>
              <td>
                <button
                  type="button"
                  className="pv-link-btn"
                  onClick={() => {
                    props.onSelect(d.itemId);
                  }}
                >
                  <span className="pv-mono pv-muted">{d.ref}</span> {d.title}
                </button>
              </td>
              <td className={d.startFrom !== d.startTo ? 'pv-text-warning' : 'pv-muted'}>
                {moved(d.startFrom, d.startTo)}
              </td>
              <td
                className={
                  d.finishTo > d.finishFrom
                    ? 'pv-text-danger'
                    : d.finishTo < d.finishFrom
                      ? 'pv-text-success'
                      : 'pv-muted'
                }
              >
                {moved(d.finishFrom, d.finishTo)}
              </td>
              <td className="pv-num">
                {d.durationFrom === d.durationTo
                  ? String(d.durationTo) + ' d'
                  : String(d.durationFrom) + ' → ' + String(d.durationTo) + ' d'}
              </td>
              <td>
                {d.assigneeFrom === d.assigneeTo
                  ? props.name(d.assigneeTo) || '—'
                  : (props.name(d.assigneeFrom) || 'nobody') +
                    ' → ' +
                    (props.name(d.assigneeTo) || 'nobody')}
              </td>
              <td>{d.direct ? <Chip tone="primary">changed</Chip> : <Chip>follows</Chip>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

// ── heat map ──

/** A colour for a day's load: from calm to hot, red above a full day. */
export function heatColour(percent: number): string {
  if (percent <= 0) return 'transparent';
  if (percent > 100)
    return (
      'color-mix(in srgb, var(--pv-bad) ' +
      String(Math.min(100, 45 + (percent - 100) / 4)) +
      '%, var(--pv-card))'
    );
  return (
    'color-mix(in srgb, var(--pe-primary) ' +
    String(Math.round(12 + (percent / 100) * 58)) +
    '%, var(--pv-card))'
  );
}

export function HeatMap(props: {
  people: {
    userId: string;
    name: string;
    kind?: string;
    tasksPerDay?: number;
    days: { date: string; percent: number; taskIds: string[] }[];
  }[];
}): ReactNode {
  const days = props.people[0]?.days.map((d) => d.date) ?? [];
  return (
    <div className="pv-grid-scroll">
      <table className="pv-heatmap" aria-label="Load per day">
        <thead>
          <tr>
            <th />
            {days.map((d) => (
              <th key={d} className="pv-heatmap-day" title={d}>
                <span>{new Date(t0(d)).getUTCDay() === 1 ? shortDate(d) : ''}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {props.people.map((p) => (
            <tr key={p.userId}>
              <th scope="row" className="pv-heatmap-who">
                {p.name}
                {p.kind === 'agent' ? (
                  <span className="pv-muted pv-small">
                    {' · agent, ' + String(p.tasksPerDay ?? 1) + ' a day'}
                  </span>
                ) : null}
              </th>
              {p.days.map((d) => (
                <td
                  key={d.date}
                  className={'pv-heatmap-cell' + (d.percent > 100 ? ' pv-heatmap-cell--over' : '')}
                  style={{ background: heatColour(d.percent) }}
                  title={
                    p.name +
                    ', ' +
                    shortDate(d.date) +
                    ': ' +
                    String(d.percent) +
                    ' %, ' +
                    String(d.taskIds.length) +
                    (d.taskIds.length === 1 ? ' task' : ' tasks')
                  }
                />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="pv-muted pv-small pv-pad">
        Each square is a working day; the darker, the fuller. Red is more than a full day (for an
        agent, more tasks than it carries a day).
      </p>
    </div>
  );
}
