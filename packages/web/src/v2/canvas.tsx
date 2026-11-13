// ── [PCODE-440 | S15 | v0.1.0] T37 Consistency: errors and loading are announced everywhere ──
// ── [PCODE-420 | S15 | v0.1.0] T37 medium: English screens use English number and date formats ──
// ── [PCODE-264 | S15 | v0.1.0] T27.6 Canvas pictures and sharing: PNG and PDF with page fitting, read-only share link with iCal subscription ──
// ── [PCODE-263 | S15 | v0.1.0] T27.5 Plan files: MS Project XML and CSV export and import, iCal of the plan ──
// ── [PCODE-262 | S15 | v0.1.0] T27.4 Canvas views: timeline, mind map, portfolio; agents as resources and heat map; scenario diff; commits on bars ──
// ── [PCODE-261 | S15 | v0.1.0] T27.3 Canvas grid: fill down, paste from Excel, formulas and roll-ups, indent and outdent, typed predecessors ──
// ── [PCODE-260 | S15 | v0.1.0] T27.2 Interactive Gantt: drag, resize, link, shift-drag, split, zoom, colour rules, outline levels ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-167 | S15 | v0.1.0] B2.3 Canvas live in the web app: Gantt with critical path and dependencies, baselines, scenarios, grid, workload and levelling, calendar ──
//    Why:  the Canvas tab of the approved design on the server's schedule (the shared engine): the Gantt
//          with dependencies, the critical path and a baseline to see what slipped; the grid that edits the
//          same tasks; scenarios that change the plan aside and merge or are discarded; workload per
//          person with levelling previewed before it applies; the month calendar. Every edit is a normal
//          task change, so Planning, VS Code and everyone else see it at once.
import {
  CONSTRAINT_TEXT,
  CONSTRAINT_TYPES,
  DATED_CONSTRAINTS,
  type ConstraintType,
  type Split,
} from '@orqiva/shared';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api } from '../core/api.js';
import type { EventHub } from '../core/hub.js';
import { PIcon, type PIconName } from '../preview/picons.js';
import { Button, Card, Chip } from '../preview/ui.js';
import type { ItemStore } from '../sync/items.js';
import { LiveAvatar } from './shell.js';
// [PCODE-260 | S15 | v0.1.0] the interactive Gantt lives in its own module
import { COLOUR_RULES, colourLegend, GanttV2, ZOOMS, type ColourRule, type Zoom } from './gantt.js';
export { GanttV2 };
// [PCODE-261 | S15 | v0.1.0] the grid as a spreadsheet, in its own module
import { GridV2, type DepEdit } from './grid.js';
export { GridV2 };
// [PCODE-262 | S15 | v0.1.0] the other views of the plan
import { ExportMenu, ImportCard } from './planio.js'; // [PCODE-263 | S15 | v0.1.0]
import { PictureMenu, SharePanel } from './sharing.js'; // [PCODE-264 | S15 | v0.1.0]
import {
  HeatMap,
  MindMapV2,
  PortfolioV2,
  ScenarioDiff,
  TimelineV2,
  type DiffLine,
} from './canvasviews.js';
import { fmtLocale } from '../core/locale.js'; // [PCODE-420 | S15 | v0.1.0]

const W = (ws: string, p: string): string => '/api/workspaces/' + ws + p;
const DAY = 86_400_000;

export interface PlanTask {
  id: string;
  ref: string;
  title: string;
  kind: string;
  stateGroup: string;
  assigneeId: string | null;
  estimate: number | null;
  parentId: string | null;
  sprintId: string | null;
  startDate: string | null;
  dueDate: string | null;
  durationDays: number | null;
  scheduleMode: string;
  // [PCODE-260 | S15 | v0.1.0] the type (for colours), the constraint and the pauses
  typeId?: string | null;
  agentId?: string | null; // [PCODE-262 | S15 | v0.1.0]
  constraintType?: string;
  constraintDate?: string | null;
  splits?: Split[];
}
export interface Scheduled {
  id: string;
  wbs: string;
  level: number;
  summary: boolean;
  milestone: boolean;
  start: string;
  finish: string;
  durationDays: number;
  percentDone: number;
  totalFloat: number;
  critical: boolean;
  violations: string[];
  constraintBroken?: boolean; // [PCODE-260 | S15 | v0.1.0]
  segments?: { start: string; finish: string }[];
}
export interface Dependency {
  id: string;
  predecessorId: string;
  successorId: string;
  kind: string;
  lagDays: number;
}
export interface PlanData {
  today: string;
  workingDays: string[];
  start: string;
  finish: string;
  tasks: PlanTask[];
  schedule: Scheduled[];
  dependencies: Dependency[];
  cycle: string[];
  ignored: string[];
  baseline: {
    id: string;
    name: string;
    finish: string | null;
    variance: {
      itemId: string;
      start: string | null;
      finish: string | null;
      startSlip: number | null;
      finishSlip: number | null;
    }[];
  } | null;
  scenario: {
    id: string;
    name: string;
    liveFinish: string;
    changed: number;
    diff?: DiffLine[]; // [PCODE-262 | S15 | v0.1.0]
  } | null;
  /** [PCODE-262 | S15 | v0.1.0] commits and pull requests of the tasks, for the bars */
  git?: {
    itemId: string;
    kind: string;
    ref: string;
    title: string;
    url: string;
    state: string;
    date: string;
  }[];
}
interface Baseline {
  id: string;
  name: string;
  tasks: number;
  createdAt: string;
}
interface Scenario {
  id: string;
  name: string;
  status: string;
  changed: number;
}
interface Workload {
  from: string;
  to: string;
  people: {
    userId: string;
    name: string;
    peak: number;
    overDays: number;
    days: { date: string; percent: number; taskIds: string[] }[];
    kind?: string; // [PCODE-262 | S15 | v0.1.0] a person or an agent
    tasksPerDay?: number;
  }[];
  levelling: {
    moves: { id: string; ref: string; from: string; to: string }[];
    finishBefore: string;
    finishAfter: string;
  };
}

// [PCODE-262 | S15 | v0.1.0] timeline, mind map and portfolio join the views
type View = 'gantt' | 'grid' | 'timeline' | 'mindmap' | 'workload' | 'calendar' | 'portfolio';
const VIEWS: { key: View; label: string; icon: PIconName }[] = [
  { key: 'gantt', label: 'Gantt', icon: 'canvas' },
  { key: 'grid', label: 'Grid', icon: 'documents' },
  { key: 'timeline', label: 'Timeline', icon: 'releases' },
  { key: 'mindmap', label: 'Mind map', icon: 'ideation' },
  { key: 'workload', label: 'Workload', icon: 'people' },
  { key: 'calendar', label: 'Calendar', icon: 'time' },
  { key: 'portfolio', label: 'Portfolio', icon: 'overview' },
];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const t0 = (iso: string): number => Date.parse(iso + 'T00:00:00Z');
const iso = (t: number): string => new Date(t).toISOString().slice(0, 10);
/** Calendar days from a to b. */
export const daysBetween = (a: string, b: string): number => Math.round((t0(b) - t0(a)) / DAY);
export const addDays = (d: string, n: number): string => iso(t0(d) + n * DAY);
export const shortDate = (d: string): string =>
  String(new Date(t0(d)).getUTCDate()) + ' ' + (MONTHS[new Date(t0(d)).getUTCMonth()] ?? '');
const weekday = (d: string): number => new Date(t0(d)).getUTCDay();

/** The span the Gantt draws: a few days around the plan and today, at most a year. */
export function ganttRange(plan: Pick<PlanData, 'start' | 'finish' | 'today'>): {
  from: string;
  days: number;
} {
  const lo = [plan.start, plan.today].sort()[0] ?? plan.today;
  const hi = [plan.finish, plan.today].sort()[1] ?? plan.today;
  const from = addDays(lo, -((weekday(lo) + 6) % 7) - 7);
  return { from, days: Math.min(366, Math.max(42, daysBetween(from, hi) + 21)) };
}

/** Weekly load: the mean of the working days of each week, in percent of one person. */
export function weekly(
  days: { date: string; percent: number }[],
): { week: string; percent: number }[] {
  const out = new Map<string, number[]>();
  for (const d of days) {
    const monday = addDays(d.date, -((weekday(d.date) + 6) % 7));
    out.set(monday, [...(out.get(monday) ?? []), d.percent]);
  }
  return [...out].map(([week, v]) => ({
    week,
    percent: Math.round(v.reduce((a, b) => a + b, 0) / v.length),
  }));
}

// [PCODE-260 | S15 | v0.1.0] a choice remembered in this browser, when it is still one of the choices
function remembered<V extends string>(key: string, allowed: readonly V[], fallback: V): V {
  try {
    const v = window.localStorage.getItem(key);
    return allowed.includes(v as V) ? (v as V) : fallback;
  } catch {
    return fallback;
  }
}
function remember(key: string, v: string): void {
  try {
    window.localStorage.setItem(key, v);
  } catch {
    // private window: the choice lasts for this page only
  }
}

export function CanvasPage(props: {
  workspaceId: string;
  projectId: string;
  store: ItemStore;
  hub: EventHub;
  canEdit: boolean;
  go: (p: string) => void;
}): ReactNode {
  const { workspaceId, projectId } = props;
  const P = (p: string): string => W(workspaceId, '/projects/' + projectId + p);
  const [view, setView] = useState<View>(() => {
    try {
      const v = window.localStorage.getItem('pe-canvas-view');
      return VIEWS.some((x) => x.key === v) ? (v as View) : 'gantt';
    } catch {
      return 'gantt';
    }
  });
  const [plan, setPlan] = useState<PlanData | null>(null);
  const [baselines, setBaselines] = useState<Baseline[]>([]);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [baselineId, setBaselineId] = useState('');
  const [scenarioId, setScenarioId] = useState('');
  const [people, setPeople] = useState<{ id: string; name: string }[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  // [PCODE-260 | S15 | v0.1.0] zoom, colours and the outline, remembered
  const [zoom, setZoomState] = useState<Zoom>(() =>
    remembered(
      'pe-canvas-zoom',
      ZOOMS.map((z) => z.key),
      'day',
    ),
  );
  const [colour, setColourState] = useState<ColourRule>(() =>
    remembered(
      'pe-canvas-colour',
      COLOUR_RULES.map((c) => c.key),
      'critical',
    ),
  );
  const setZoom = (z: Zoom): void => {
    setZoomState(z);
    remember('pe-canvas-zoom', z);
  };
  const setColour = (c: ColourRule): void => {
    setColourState(c);
    remember('pe-canvas-colour', c);
  };
  const [level, setLevel] = useState<number | null>(null);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [types, setTypes] = useState<ReadonlyMap<string, { name: string; color: string }>>(
    new Map(),
  );
  const [critical, setCritical] = useState(true);
  const [projectName, setProjectName] = useState(''); // [PCODE-262 | S15 | v0.1.0]
  const [importing, setImporting] = useState(false); // [PCODE-263 | S15 | v0.1.0]
  const [sharing, setSharing] = useState(false); // [PCODE-264 | S15 | v0.1.0]
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const q = new URLSearchParams();
    if (baselineId) q.set('baselineId', baselineId);
    if (scenarioId) q.set('scenarioId', scenarioId);
    const [p, b, s] = await Promise.all([
      api<PlanData>('GET', P('/plan' + (q.toString() ? '?' + q.toString() : ''))),
      api<Baseline[]>('GET', P('/baselines')),
      props.canEdit ? api<Scenario[]>('GET', P('/scenarios')) : Promise.resolve(null),
    ]);
    if (p.ok) setPlan(p.data);
    else setError(p.error.message);
    if (b.ok) setBaselines(b.data);
    if (s?.ok) setScenarios(s.data.filter((x) => x.status === 'open'));
  }, [workspaceId, projectId, baselineId, scenarioId, props.canEdit]);
  useEffect(() => {
    void load();
    let timer: number | null = null;
    const off = props.hub.on((e) => {
      if (e.projectid !== projectId && e.type !== 'orqiva.workspace.resync') return;
      if (timer !== null) return;
      timer = window.setTimeout(() => {
        timer = null;
        void load();
      }, 400);
    });
    return () => {
      off();
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [load, props.hub, projectId]);
  useEffect(() => {
    // [PCODE-262 | S15 | v0.1.0] the project's name for the mind map
    void api<{ name: string }>('GET', P('')).then((r) => {
      if (r.ok) setProjectName(r.data.name);
    });
    // [PCODE-260 | S15 | v0.1.0] the project's types, for colours by type
    void api<{ id: string; name: string; color: string }[]>('GET', P('/item-types')).then((r) => {
      if (r.ok) setTypes(new Map(r.data.map((x) => [x.id, { name: x.name, color: x.color }])));
    });
  }, [workspaceId, projectId]);
  useEffect(() => {
    if (props.canEdit)
      void api<{ userId: string; name: string }[]>('GET', W(workspaceId, '/members')).then((r) => {
        if (r.ok) setPeople(r.data.map((m) => ({ id: m.userId, name: m.name })));
      });
  }, [workspaceId, props.canEdit]);

  const call = async (
    method: 'POST' | 'PATCH' | 'DELETE',
    path: string,
    body?: unknown,
  ): Promise<boolean> => {
    const r = await api(method, W(workspaceId, path), body);
    if (!r.ok) setError(r.error.message);
    await load();
    return r.ok;
  };
  /** A grid edit: into the chosen scenario, else onto the task itself. */
  const edit = (
    taskId: string,
    change: {
      startDate?: string | null;
      durationDays?: number | null;
      percentDone?: number | null;
      // [PCODE-260 | S15 | v0.1.0] scheduling, the constraint and the pauses (live only)
      scheduleMode?: string;
      title?: string; // [PCODE-261 | S15 | v0.1.0] the grid edits titles and people too
      assigneeId?: string | null;
      constraintType?: string;
      constraintDate?: string | null;
      splits?: Split[];
    },
  ): void => {
    if (scenarioId) {
      // a scenario changes dates, durations and people; how far a task is stays live
      const rest = Object.fromEntries(
        Object.entries(change).filter(
          ([k]) => k === 'startDate' || k === 'durationDays' || k === 'assigneeId',
        ),
      );
      if (Object.keys(rest).length)
        void call('PATCH', '/scenarios/' + scenarioId, { changes: { [taskId]: rest } });
    } else props.store.update(taskId, change);
  };
  // [PCODE-261 | S15 | v0.1.0] typed predecessors: removed, changed, then added, one call each
  const applyDeps = async (e: DepEdit): Promise<void> => {
    const fail = (r: { ok: boolean; error?: { message: string } }): void => {
      if (!r.ok && r.error) setError(r.error.message);
    };
    for (const id of e.remove) fail(await api('DELETE', W(workspaceId, '/dependencies/' + id)));
    for (const c of e.change)
      fail(
        await api('PATCH', W(workspaceId, '/dependencies/' + c.id), {
          kind: c.kind,
          lagDays: c.lagDays,
        }),
      );
    for (const d of e.add)
      fail(await api('POST', P('/dependencies'), { ...d, successorId: e.successorId }));
    await load();
  };
  /** Rows pasted past the end of the grid become tasks of the project. */
  const createRows = async (
    list: { title: string; startDate?: string; durationDays?: number }[],
  ): Promise<void> => {
    for (const row of list) {
      const r = await api('POST', P('/items'), row);
      if (!r.ok) {
        setError(r.error.message);
        break;
      }
    }
    await load();
  };
  const pick = (v: View): void => {
    setView(v);
    try {
      window.localStorage.setItem('pe-canvas-view', v);
    } catch {
      // private window: the choice lasts for this page only
    }
  };
  const name = (id: string | null): string => people.find((p) => p.id === id)?.name ?? '';

  return (
    <div className="pv-stack">
      <div className="pv-toolbar">
        <nav className="pv-subtabs pv-subtabs--inline" aria-label="Canvas view">
          {VIEWS.filter(
            (v) => props.canEdit || (v.key !== 'workload' && v.key !== 'portfolio'),
          ).map((v) => (
            <button
              key={v.key}
              type="button"
              className="pv-subtab"
              aria-pressed={view === v.key}
              onClick={() => {
                pick(v.key);
              }}
            >
              <PIcon name={v.icon} size={14} />
              {v.label}
            </button>
          ))}
        </nav>
        <span className="pv-spacer" />
        {view === 'gantt' ? (
          <>
            <div className="pv-segmented" role="radiogroup" aria-label="Zoom">
              {ZOOMS.map((z) => (
                <button
                  key={z.key}
                  type="button"
                  role="radio"
                  aria-checked={zoom === z.key}
                  className="pv-seg"
                  onClick={() => {
                    setZoom(z.key);
                  }}
                >
                  {z.label}
                </button>
              ))}
            </div>
            {/* [PCODE-260 | S15 | v0.1.0] colour rule and outline level */}
            <select
              className="v2-input v2-input--sm"
              aria-label="Colour bars by"
              value={colour}
              onChange={(e) => {
                setColour(e.target.value as ColourRule);
              }}
            >
              {COLOUR_RULES.map((c) => (
                <option key={c.key} value={c.key}>
                  Colour: {c.label}
                </option>
              ))}
            </select>
            <select
              className="v2-input v2-input--sm"
              aria-label="Outline level"
              value={level === null ? '' : String(level)}
              onChange={(e) => {
                setLevel(e.target.value ? Number(e.target.value) : null);
                setCollapsed(new Set());
              }}
            >
              <option value="">All levels</option>
              <option value="1">Level 1</option>
              <option value="2">Level 2</option>
              <option value="3">Level 3</option>
            </select>
            <label className="pv-switch">
              <input
                type="checkbox"
                checked={critical}
                onChange={(e) => {
                  setCritical(e.target.checked);
                }}
              />
              <span>Critical path</span>
            </label>
          </>
        ) : null}
        {/* [PCODE-263 | S15 | v0.1.0] plan files out and in */}
        <ExportMenu workspaceId={workspaceId} projectId={projectId} />
        {/* [PCODE-264 | S15 | v0.1.0] a picture of the Gantt, and a read-only link */}
        {plan && view === 'gantt' ? (
          <PictureMenu
            plan={plan}
            zoom={zoom}
            critical={critical}
            title={projectName || 'Plan'}
            onError={setError}
          />
        ) : null}
        {props.canEdit ? (
          <Button
            size="sm"
            kind="ghost"
            icon="external"
            onClick={() => {
              setSharing(true);
            }}
          >
            Share
          </Button>
        ) : null}
        {props.canEdit ? (
          <Button
            size="sm"
            kind="ghost"
            icon="plus"
            onClick={() => {
              setImporting(true);
            }}
          >
            Import
          </Button>
        ) : null}
        <BaselinePicker
          baselines={baselines}
          value={baselineId}
          canEdit={props.canEdit}
          onPick={setBaselineId}
          onSave={(n) => call('POST', '/projects/' + projectId + '/baselines', { name: n })}
        />
        {props.canEdit ? (
          <ScenarioPicker
            scenarios={scenarios}
            value={scenarioId}
            plan={plan}
            onPick={setScenarioId}
            onCreate={async (n) => {
              const r = await api<{ id: string }>('POST', P('/scenarios'), { name: n });
              if (r.ok) setScenarioId(r.data.id);
              else setError(r.error.message);
              await load();
            }}
            onMerge={() => {
              void call('POST', '/scenarios/' + scenarioId + '/merge').then((ok) => {
                if (ok) setScenarioId('');
              });
            }}
            onDiscard={() => {
              void call('DELETE', '/scenarios/' + scenarioId).then((ok) => {
                if (ok) setScenarioId('');
              });
            }}
          />
        ) : null}
      </div>
      {sharing ? (
        <SharePanel
          workspaceId={workspaceId}
          projectId={projectId}
          onClose={() => {
            setSharing(false);
          }}
        />
      ) : null}
      {importing ? (
        <ImportCard
          workspaceId={workspaceId}
          projectId={projectId}
          onDone={() => void load()}
          onClose={() => {
            setImporting(false);
          }}
        />
      ) : null}
      {error ? (
        <p className="v2-error" role="alert">
          {error}{' '}
          <button
            type="button"
            className="pv-link"
            onClick={() => {
              setError('');
            }}
          >
            Dismiss
          </button>
        </p>
      ) : null}
      {/* [PCODE-262 | S15 | v0.1.0] what the chosen scenario changes, task by task */}
      {plan?.scenario && (view === 'gantt' || view === 'grid') ? (
        <ScenarioDiff diff={plan.scenario.diff ?? []} name={name} onSelect={setSelected} />
      ) : null}
      {plan?.cycle.length ? (
        <p className="v2-error" role="alert">
          Some tasks wait for each other in a loop; those links are ignored until one is removed.
        </p>
      ) : null}
      {!plan ? (
        <p className="pv-muted" role="status">
          Loading…
        </p>
      ) : null}
      {plan && !plan.schedule.length ? (
        <Card>
          <div className="pv-empty">
            <PIcon name="canvas" size={28} />
            <strong>No tasks to schedule yet.</strong>
            <span>
              Tasks of the project appear here with their dates, durations and dependencies.
            </span>
          </div>
        </Card>
      ) : null}
      {plan && plan.schedule.length && view === 'gantt' ? (
        <>
          <Card flush>
            <GanttV2
              plan={plan}
              zoom={zoom}
              critical={critical}
              selected={selected}
              name={name}
              onSelect={setSelected}
              // [PCODE-260 | S15 | v0.1.0] dragging, linking and folding
              canEdit={props.canEdit}
              colour={colour}
              types={types}
              level={level}
              collapsed={collapsed}
              onToggle={(id) => {
                const next = new Set(collapsed);
                if (next.has(id)) next.delete(id);
                else next.add(id);
                setCollapsed(next);
              }}
              onMove={(id, startDate, days, withSuccessors) => {
                if (withSuccessors)
                  void call('POST', '/projects/' + projectId + '/plan/shift', {
                    itemId: id,
                    days,
                    withSuccessors: true,
                    ...(scenarioId ? { scenarioId } : {}),
                  });
                else edit(id, { startDate });
              }}
              onResize={(id, durationDays) => {
                edit(id, { durationDays });
              }}
              onLink={(predecessorId, successorId) =>
                void call('POST', '/projects/' + projectId + '/dependencies', {
                  predecessorId,
                  successorId,
                  kind: 'FS',
                  lagDays: 0,
                })
              }
            />
          </Card>
          <div className="pv-gantt-legend">
            <span>
              <span className="pv-key pv-key--bar" /> Task, filled part done
            </span>
            {colour === 'critical' ? (
              <span>
                <span className="pv-key pv-key--crit" /> Critical path
              </span>
            ) : (
              colourLegend(colour, plan, { types, people: [], name }).map((c) => (
                <span key={c.key}>
                  <span className="pv-key" style={{ background: c.colour }} /> {c.key}
                </span>
              ))
            )}
            {plan.git?.length ? (
              <span>
                <span className="pv-key pv-key--commit" /> Commit or pull request
              </span>
            ) : null}
            {props.canEdit ? (
              <span className="pv-muted">
                Drag a bar to move it, its end to change the duration, its dot onto another task to
                link them; Shift-drag moves what follows too.
              </span>
            ) : null}
            {plan.baseline ? (
              <span>
                <span className="pv-key pv-key--base" /> Baseline “{plan.baseline.name}”
              </span>
            ) : null}
            <span>
              <span className="pv-key pv-key--ms" /> Milestone
            </span>
          </div>
          {selected ? (
            <TaskDetail
              plan={plan}
              id={selected}
              canEdit={props.canEdit}
              name={name}
              onAdd={(b) => void call('POST', '/projects/' + projectId + '/dependencies', b)}
              onRemove={(id) => void call('DELETE', '/dependencies/' + id)}
              go={props.go}
              scenario={Boolean(scenarioId)}
              onChange={(ch) => {
                edit(selected, ch);
              }}
            />
          ) : null}
        </>
      ) : null}
      {plan && plan.schedule.length && view === 'grid' ? (
        <GridV2
          plan={plan}
          canEdit={props.canEdit}
          scenario={Boolean(scenarioId)}
          name={name}
          onEdit={edit}
          // [PCODE-261 | S15 | v0.1.0] people, typed predecessors, pasted rows, indent and outdent
          people={people}
          onDeps={(e) => void applyDeps(e)}
          onCreate={(list) => void createRows(list)}
          onParent={(id, parentId) => {
            props.store.update(id, { parentId });
          }}
        />
      ) : null}
      {view === 'workload' && props.canEdit ? (
        <WorkloadV2
          workspaceId={workspaceId}
          projectId={projectId}
          hub={props.hub}
          onApplied={() => void load()}
          onError={setError}
        />
      ) : null}
      {plan && view === 'calendar' ? <CalendarV2 plan={plan} /> : null}
      {/* [PCODE-262 | S15 | v0.1.0] timeline, mind map, portfolio */}
      {plan && plan.schedule.length && view === 'timeline' ? (
        <TimelineV2
          plan={plan}
          onSelect={(id) => {
            setSelected(id);
            pick('gantt');
          }}
        />
      ) : null}
      {plan && view === 'mindmap' ? (
        <>
          <MindMapV2
            plan={plan}
            projectName={projectName}
            canEdit={props.canEdit && !scenarioId}
            onSelect={setSelected}
            onAdd={(parentId, title) =>
              void call('POST', '/projects/' + projectId + '/items', {
                title,
                ...(parentId ? { parentId } : {}),
              })
            }
          />
          {selected ? (
            <TaskDetail
              plan={plan}
              id={selected}
              canEdit={props.canEdit}
              name={name}
              onAdd={(b) => void call('POST', '/projects/' + projectId + '/dependencies', b)}
              onRemove={(id) => void call('DELETE', '/dependencies/' + id)}
              go={props.go}
              scenario={Boolean(scenarioId)}
              onChange={(ch) => {
                edit(selected, ch);
              }}
            />
          ) : null}
        </>
      ) : null}
      {view === 'portfolio' && props.canEdit ? (
        <PortfolioV2 workspaceId={workspaceId} go={props.go} />
      ) : null}
    </div>
  );
}

function BaselinePicker(props: {
  baselines: Baseline[];
  value: string;
  canEdit: boolean;
  onPick: (id: string) => void;
  onSave: (name: string) => Promise<boolean>;
}): ReactNode {
  const [naming, setNaming] = useState(false);
  const [n, setN] = useState('');
  return (
    <span className="v2-inline">
      <select
        className="pv-select"
        aria-label="Baseline"
        value={props.value}
        onChange={(e) => {
          props.onPick(e.target.value);
        }}
      >
        <option value="">No baseline</option>
        {props.baselines.map((b) => (
          <option key={b.id} value={b.id}>
            Baseline “{b.name}” ({new Date(b.createdAt).toLocaleDateString(fmtLocale())})
          </option>
        ))}
      </select>
      {props.canEdit ? (
        naming ? (
          <form
            className="v2-inline"
            onSubmit={(e) => {
              e.preventDefault();
              if (!n.trim()) return;
              void props.onSave(n.trim()).then((ok) => {
                if (ok) {
                  setNaming(false);
                  setN('');
                }
              });
            }}
          >
            <input
              className="v2-input"
              aria-label="Baseline name"
              placeholder="Name, e.g. Plan v2"
              value={n}
              onChange={(e) => {
                setN(e.target.value);
              }}
            />
            <button
              type="submit"
              className="pv-btn pv-btn--primary pv-btn--sm"
              disabled={!n.trim()}
            >
              Save
            </button>
          </form>
        ) : (
          <Button
            size="sm"
            kind="ghost"
            icon="plus"
            onClick={() => {
              setNaming(true);
            }}
          >
            Save baseline
          </Button>
        )
      ) : null}
    </span>
  );
}

function ScenarioPicker(props: {
  scenarios: Scenario[];
  value: string;
  plan: PlanData | null;
  onPick: (id: string) => void;
  onCreate: (name: string) => Promise<void>;
  onMerge: () => void;
  onDiscard: () => void;
}): ReactNode {
  const [naming, setNaming] = useState(false);
  const [n, setN] = useState('');
  const sc = props.plan?.scenario;
  return (
    <span className="v2-inline">
      <select
        className="pv-select"
        aria-label="Scenario"
        value={props.value}
        onChange={(e) => {
          props.onPick(e.target.value);
        }}
      >
        <option value="">Live plan</option>
        {props.scenarios.map((s) => (
          <option key={s.id} value={s.id}>
            Scenario: {s.name}
          </option>
        ))}
      </select>
      {props.value && sc ? (
        <>
          <Chip
            tone={
              sc.liveFinish < (props.plan?.finish ?? '')
                ? 'danger'
                : sc.liveFinish > (props.plan?.finish ?? '')
                  ? 'success'
                  : 'neutral'
            }
          >
            ends {shortDate(props.plan?.finish ?? sc.liveFinish)} · live {shortDate(sc.liveFinish)}{' '}
            · {sc.changed} changed
          </Chip>
          <Button size="sm" kind="primary" disabled={!sc.changed} onClick={props.onMerge}>
            Merge
          </Button>
          <Button size="sm" kind="ghost" onClick={props.onDiscard}>
            Discard
          </Button>
        </>
      ) : naming ? (
        <form
          className="v2-inline"
          onSubmit={(e) => {
            e.preventDefault();
            if (!n.trim()) return;
            void props.onCreate(n.trim()).then(() => {
              setNaming(false);
              setN('');
            });
          }}
        >
          <input
            className="v2-input"
            aria-label="Scenario name"
            placeholder="e.g. Pilot a week earlier"
            value={n}
            onChange={(e) => {
              setN(e.target.value);
            }}
          />
          <button type="submit" className="pv-btn pv-btn--primary pv-btn--sm" disabled={!n.trim()}>
            Branch
          </button>
        </form>
      ) : (
        <Button
          size="sm"
          kind="ghost"
          icon="plus"
          onClick={() => {
            setNaming(true);
          }}
        >
          Scenario
        </Button>
      )}
    </span>
  );
}

// [PCODE-260 | S15 | v0.1.0]
/** In the task panel: auto or manual, the constraint, and the pauses of a split task. */
function PlanRules(props: {
  t: PlanTask;
  s: Scheduled;
  canEdit: boolean;
  pause: { after: number; gap: number };
  setPause: (p: { after: number; gap: number }) => void;
  onChange: (ch: {
    scheduleMode?: string;
    constraintType?: string;
    constraintDate?: string | null;
    splits?: Split[];
  }) => void;
}): ReactNode {
  const { t, s } = props;
  const kind = (t.constraintType ?? 'asap') as ConstraintType;
  const splits = t.splits ?? [];
  const dis = !props.canEdit;
  return (
    <>
      <span>Scheduling</span>
      <span className="v2-inline">
        <span className="pv-segmented" role="radiogroup" aria-label="Scheduling">
          {(['auto', 'manual'] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={t.scheduleMode === m}
              className="pv-seg"
              disabled={dis}
              onClick={() => {
                if (t.scheduleMode !== m) props.onChange({ scheduleMode: m });
              }}
            >
              {m === 'auto' ? 'Automatic' : 'By hand'}
            </button>
          ))}
        </span>
      </span>
      <span>Constraint</span>
      <span className="v2-inline">
        <select
          className="v2-input v2-input--sm"
          aria-label="Constraint"
          value={kind}
          disabled={dis}
          onChange={(e) => {
            const next = e.target.value as ConstraintType;
            props.onChange({
              constraintType: next,
              constraintDate: DATED_CONSTRAINTS.has(next) ? (t.constraintDate ?? s.start) : null,
            });
          }}
        >
          {CONSTRAINT_TYPES.map((c) => (
            <option key={c} value={c}>
              {CONSTRAINT_TEXT[c]}
            </option>
          ))}
        </select>
        {DATED_CONSTRAINTS.has(kind) ? (
          <input
            type="date"
            className="v2-input v2-input--sm"
            aria-label="Constraint date"
            disabled={dis}
            value={t.constraintDate ?? ''}
            onChange={(e) => {
              if (e.target.value) props.onChange({ constraintDate: e.target.value });
            }}
          />
        ) : null}
        {s.constraintBroken ? (
          <span className="pv-text-danger pv-small">cannot hold with its dependencies</span>
        ) : null}
      </span>
      <span>Split</span>
      <span className="v2-inline">
        {splits.length
          ? [...splits]
              .sort((a, b) => a.after - b.after)
              .map((x) => (
                <span key={x.after} className="v2-dep">
                  after {x.after} d, pause {x.gap} d
                  {props.canEdit ? (
                    <button
                      type="button"
                      className="pv-mini-btn"
                      aria-label={'Remove the pause after ' + String(x.after) + ' days'}
                      onClick={() => {
                        props.onChange({ splits: splits.filter((y) => y.after !== x.after) });
                      }}
                    >
                      ×
                    </button>
                  ) : null}
                </span>
              ))
          : 'in one piece'}
        {props.canEdit && !s.milestone && s.durationDays > 1 ? (
          <>
            <span className="pv-small pv-muted">pause after</span>
            <input
              className="v2-input v2-num"
              type="number"
              min={1}
              max={Math.max(1, s.durationDays - 1)}
              aria-label="Pause after working days"
              value={props.pause.after}
              onChange={(e) => {
                props.setPause({
                  ...props.pause,
                  after: Math.max(1, Math.round(Number(e.target.value) || 1)),
                });
              }}
            />
            <span className="pv-small pv-muted">for</span>
            <input
              className="v2-input v2-num"
              type="number"
              min={1}
              max={365}
              aria-label="Pause length in working days"
              value={props.pause.gap}
              onChange={(e) => {
                props.setPause({
                  ...props.pause,
                  gap: Math.max(1, Math.round(Number(e.target.value) || 1)),
                });
              }}
            />
            <button
              type="button"
              className="pv-btn pv-btn--sm"
              disabled={
                props.pause.after >= s.durationDays ||
                splits.some((x) => x.after === props.pause.after)
              }
              onClick={() => {
                props.onChange({ splits: [...splits, props.pause] });
              }}
            >
              Split
            </button>
          </>
        ) : null}
      </span>
    </>
  );
}

function TaskDetail(props: {
  plan: PlanData;
  id: string;
  canEdit: boolean;
  name: (id: string | null) => string;
  onAdd: (b: { predecessorId: string; successorId: string; kind: string; lagDays: number }) => void;
  onRemove: (dependencyId: string) => void;
  go: (p: string) => void;
  // [PCODE-260 | S15 | v0.1.0] scheduling, the constraint and the pauses
  scenario?: boolean;
  onChange?: (ch: {
    scheduleMode?: string;
    constraintType?: string;
    constraintDate?: string | null;
    splits?: Split[];
  }) => void;
}): ReactNode {
  const s = props.plan.schedule.find((x) => x.id === props.id);
  const t = props.plan.tasks.find((x) => x.id === props.id);
  const [pause, setPause] = useState({ after: 1, gap: 1 });
  const [pred, setPred] = useState('');
  const [kind, setKind] = useState('FS');
  const [lag, setLag] = useState(0);
  if (!s || !t) return null;
  const ref = new Map(props.plan.tasks.map((x) => [x.id, x]));
  const before = props.plan.dependencies.filter((d) => d.successorId === t.id);
  const after = props.plan.dependencies.filter((d) => d.predecessorId === t.id);
  const v = props.plan.baseline?.variance.find((x) => x.itemId === t.id);
  const leaves = props.plan.schedule.filter(
    (x) => !x.summary && x.id !== t.id && !before.some((d) => d.predecessorId === x.id),
  );
  return (
    <Card
      title={s.wbs + ' · ' + t.ref + ' ' + t.title}
      action={
        <Button
          size="sm"
          kind="ghost"
          icon="external"
          onClick={() => {
            props.go('/items/' + t.id);
          }}
        >
          Open the task
        </Button>
      }
    >
      <div className="pv-kv pv-kv--wide">
        <span>Dates</span>
        <span>
          {shortDate(s.start)} – {shortDate(s.finish)} · {s.durationDays} working{' '}
          {s.durationDays === 1 ? 'day' : 'days'} ·{' '}
          {t.scheduleMode === 'manual' ? 'scheduled by hand' : 'scheduled by its dependencies'}
        </span>
        <span>Float</span>
        <span>
          {s.critical ? (
            <span className="pv-text-danger">0 days (critical)</span>
          ) : (
            String(s.totalFloat) + ' working days'
          )}
        </span>
        <span>Baseline</span>
        <span>
          {v?.start
            ? shortDate(v.start) + ' – ' + shortDate(v.finish ?? v.start)
            : props.plan.baseline
              ? 'not in the baseline'
              : 'choose a baseline to compare'}
          {v?.finishSlip ? (
            <span className={v.finishSlip > 0 ? 'pv-text-danger' : 'pv-text-success'}>
              {' '}
              · {Math.abs(v.finishSlip)} days {v.finishSlip > 0 ? 'late' : 'early'}
            </span>
          ) : null}
        </span>
        <span>Who</span>
        <span>{t.assigneeId ? props.name(t.assigneeId) || 'Someone' : '—'}</span>
        <span>Waits for</span>
        <span className="v2-deps">
          {before.length
            ? before.map((d) => (
                <span key={d.id} className="v2-dep">
                  <span className="pv-mono">{ref.get(d.predecessorId)?.ref}</span> {d.kind}
                  {d.lagDays ? (d.lagDays > 0 ? ' +' : ' ') + String(d.lagDays) + 'd' : ''}
                  {props.canEdit ? (
                    <button
                      type="button"
                      className="pv-mini-btn"
                      aria-label={'Remove the link to ' + (ref.get(d.predecessorId)?.ref ?? '')}
                      onClick={() => {
                        props.onRemove(d.id);
                      }}
                    >
                      ×
                    </button>
                  ) : null}
                </span>
              ))
            : '—'}
          {s.violations.length ? (
            <span className="pv-text-danger">
              {' '}
              · starts before {s.violations.map((x) => ref.get(x)?.ref).join(', ')} allows
            </span>
          ) : null}
        </span>
        <span>Blocks</span>
        <span>{after.length ? after.map((d) => ref.get(d.successorId)?.ref).join(', ') : '—'}</span>
        {/* [PCODE-260 | S15 | v0.1.0] how it is scheduled, held and split */}
        {!s.summary ? (
          <PlanRules
            t={t}
            s={s}
            canEdit={props.canEdit && !props.scenario}
            pause={pause}
            setPause={setPause}
            onChange={(ch) => props.onChange?.(ch)}
          />
        ) : null}
      </div>
      {props.scenario && props.canEdit && !s.summary ? (
        <p className="pv-small pv-muted">
          Scheduling, constraints and splits change the live plan; leave the scenario to edit them.
        </p>
      ) : null}
      {props.canEdit && !s.summary ? (
        <form
          className="v2-inline"
          onSubmit={(e) => {
            e.preventDefault();
            if (!pred) return;
            props.onAdd({ predecessorId: pred, successorId: t.id, kind, lagDays: lag });
            setPred('');
            setLag(0);
          }}
        >
          <span className="pv-small pv-muted">Add a predecessor</span>
          <select
            className="v2-input"
            aria-label="Predecessor"
            value={pred}
            onChange={(e) => {
              setPred(e.target.value);
            }}
          >
            <option value="">Choose a task…</option>
            {leaves.map((x) => (
              <option key={x.id} value={x.id}>
                {x.wbs} {ref.get(x.id)?.ref} {ref.get(x.id)?.title}
              </option>
            ))}
          </select>
          <select
            className="v2-input"
            aria-label="Kind of link"
            value={kind}
            onChange={(e) => {
              setKind(e.target.value);
            }}
          >
            <option value="FS">finish → start</option>
            <option value="SS">start → start</option>
            <option value="FF">finish → finish</option>
            <option value="SF">start → finish</option>
          </select>
          <input
            className="v2-input v2-num"
            type="number"
            min={-365}
            max={365}
            aria-label="Lag in working days"
            value={lag}
            onChange={(e) => {
              setLag(Math.max(-365, Math.min(365, Math.round(Number(e.target.value) || 0))));
            }}
          />
          <span className="pv-small pv-muted">days lag</span>
          <button type="submit" className="pv-btn pv-btn--primary pv-btn--sm" disabled={!pred}>
            Link
          </button>
        </form>
      ) : null}
    </Card>
  );
}

function WorkloadV2(props: {
  workspaceId: string;
  projectId: string;
  hub: EventHub;
  onApplied: () => void;
  onError: (m: string) => void;
}): ReactNode {
  const [data, setData] = useState<Workload | null>(null);
  const [preview, setPreview] = useState(false);
  const [byDay, setByDay] = useState(false); // [PCODE-262 | S15 | v0.1.0] the heat map by day
  const load = useCallback(async () => {
    const r = await api<Workload>(
      'GET',
      W(props.workspaceId, '/projects/' + props.projectId + '/workload'),
    );
    if (r.ok) setData(r.data);
    else props.onError(r.error.message);
  }, [props.workspaceId, props.projectId]);
  useEffect(() => {
    void load();
    return props.hub.on((e) => {
      if (e.projectid === props.projectId) void load();
    });
  }, [load, props.hub, props.projectId]);
  if (!data)
    return (
      <p className="pv-muted" role="status">
        Loading…
      </p>
    );
  const weeks = [...new Set(data.people.flatMap((p) => weekly(p.days).map((w) => w.week)))].sort();
  const lev = data.levelling;
  return (
    <div className="pv-stack">
      <Card
        flush
        title={byDay ? 'Workload by day' : 'Workload per week (% of one person)'}
        action={
          preview ? (
            <span className="pv-page-actions">
              <Chip tone={lev.finishAfter > lev.finishBefore ? 'warning' : 'success'} icon="check">
                {lev.moves.length} {lev.moves.length === 1 ? 'task moves' : 'tasks move'}, finish{' '}
                {lev.finishAfter === lev.finishBefore
                  ? 'unchanged'
                  : shortDate(lev.finishBefore) + ' → ' + shortDate(lev.finishAfter)}
              </Chip>
              <Button
                size="sm"
                kind="primary"
                disabled={!lev.moves.length}
                onClick={() => {
                  void api(
                    'POST',
                    W(props.workspaceId, '/projects/' + props.projectId + '/plan/level'),
                  ).then((r) => {
                    if (!r.ok) props.onError(r.error.message);
                    setPreview(false);
                    props.onApplied();
                    void load();
                  });
                }}
              >
                Apply levelling
              </Button>
              <Button
                size="sm"
                kind="ghost"
                onClick={() => {
                  setPreview(false);
                }}
              >
                Discard
              </Button>
            </span>
          ) : (
            <span className="pv-page-actions">
              <span className="pv-segmented" role="radiogroup" aria-label="Show the load">
                {[false, true].map((d) => (
                  <button
                    key={String(d)}
                    type="button"
                    role="radio"
                    aria-checked={byDay === d}
                    className="pv-seg"
                    onClick={() => {
                      setByDay(d);
                    }}
                  >
                    {d ? 'Heat map' : 'Weeks'}
                  </button>
                ))}
              </span>
              <Button
                size="sm"
                kind="primary"
                icon="sparkle"
                disabled={!data.people.some((p) => p.overDays && p.kind !== 'agent')}
                onClick={() => {
                  setPreview(true);
                }}
              >
                Level resources
              </Button>
            </span>
          )
        }
      >
        {data.people.length && byDay ? <HeatMap people={data.people} /> : null}
        {data.people.length && !byDay ? (
          <div className="pv-grid-scroll">
            <table className="pv-table pv-heat">
              <thead>
                <tr>
                  <th>Who</th>
                  {weeks.map((wk) => (
                    <th key={wk} className="pv-num">
                      {shortDate(wk)}
                    </th>
                  ))}
                  <th className="pv-num">Days over</th>
                </tr>
              </thead>
              <tbody>
                {data.people.map((p) => {
                  const byWeek = new Map(weekly(p.days).map((w) => [w.week, w.percent]));
                  return (
                    <tr key={p.userId}>
                      <td>
                        <span className="pv-who">
                          {p.kind === 'agent' ? (
                            <PIcon name="agents" size={16} />
                          ) : (
                            <LiveAvatar id={p.userId} name={p.name} size="xs" />
                          )}
                          {p.name}
                          {p.kind === 'agent' ? (
                            <Chip tone="agent">agent · {p.tasksPerDay} a day</Chip>
                          ) : null}
                        </span>
                      </td>
                      {weeks.map((wk) => {
                        const v = byWeek.get(wk) ?? 0;
                        return (
                          <td
                            key={wk}
                            className={
                              'pv-heat-cell pv-heat-' +
                              (v > 100 ? 'over' : v >= 80 ? 'full' : v >= 50 ? 'mid' : 'low')
                            }
                          >
                            {v}
                          </td>
                        );
                      })}
                      <td className={'pv-num ' + (p.overDays ? 'pv-text-danger' : 'pv-muted')}>
                        {p.overDays}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
        {!data.people.length ? (
          <p className="pv-muted v2-pad">
            Nobody has scheduled work in the next eight weeks. Assign tasks with dates or durations
            to see the load.
          </p>
        ) : null}
      </Card>
      {preview && lev.moves.length ? (
        <Card title="What levelling would move" flush>
          <ul className="pv-rows pv-rows--tight">
            {lev.moves.map((m) => (
              <li key={m.id} className="pv-row pv-row--static">
                <span className="pv-mono">{m.ref}</span>
                <span className="pv-row-main">
                  <span className="pv-row-title">
                    {shortDate(m.from)} → {shortDate(m.to)}
                  </span>
                </span>
                <Chip>+{daysBetween(m.from, m.to)} days</Chip>
              </li>
            ))}
          </ul>
          <p className="pv-muted pv-small pv-pad">
            Critical tasks keep their place; others wait until their person is free. Applying sets
            their start dates.
          </p>
        </Card>
      ) : null}
    </div>
  );
}

function CalendarV2(props: { plan: PlanData }): ReactNode {
  const [month, setMonth] = useState(props.plan.today.slice(0, 7));
  const first = month + '-01';
  const lead = (weekday(first) + 6) % 7;
  const next = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 1));
  const daysIn = Math.round((next.getTime() - t0(first)) / DAY);
  const cells = Array.from({ length: Math.ceil((lead + daysIn) / 7) * 7 }, (_, i) => i - lead + 1);
  const task = new Map(props.plan.tasks.map((t) => [t.id, t]));
  const on = (day: string): { text: string; kind: string }[] =>
    props.plan.schedule.flatMap((s) => {
      const t = task.get(s.id);
      if (!t || s.summary) return [];
      if (s.milestone) return s.start === day ? [{ text: '◆ ' + t.title, kind: 'milestone' }] : [];
      const out: { text: string; kind: string }[] = [];
      if (s.start === day && s.finish !== day)
        out.push({ text: t.ref + ' starts', kind: 'sprint' });
      if (s.finish === day) out.push({ text: t.ref + ' ' + t.title, kind: 'task' });
      return out;
    });
  const shift = (n: number): void => {
    const d = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + n, 1));
    setMonth(d.toISOString().slice(0, 7));
  };
  return (
    <Card
      flush
      title={(MONTHS[Number(month.slice(5, 7)) - 1] ?? '') + ' ' + month.slice(0, 4)}
      action={
        <span className="v2-inline">
          <Button
            size="sm"
            kind="ghost"
            onClick={() => {
              shift(-1);
            }}
          >
            ‹ Earlier
          </Button>
          <Button
            size="sm"
            kind="ghost"
            onClick={() => {
              setMonth(props.plan.today.slice(0, 7));
            }}
          >
            Today
          </Button>
          <Button
            size="sm"
            kind="ghost"
            onClick={() => {
              shift(1);
            }}
          >
            Later ›
          </Button>
        </span>
      }
    >
      <div className="pv-cal">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
          <div key={d} className="pv-cal-head">
            {d}
          </div>
        ))}
        {cells.map((d, i) => {
          const day = d >= 1 && d <= daysIn ? month + '-' + String(d).padStart(2, '0') : null;
          return (
            <div
              key={i}
              className={
                'pv-cal-cell' +
                (!day ? ' pv-cal-cell--out' : '') +
                (day === props.plan.today ? ' pv-cal-cell--today' : '') +
                (i % 7 >= 5 ? ' pv-cal-cell--weekend' : '')
              }
            >
              {day ? <span className="pv-cal-day">{d}</span> : null}
              {day
                ? on(day).map((c, k) => (
                    <span key={k} className={'pv-cal-item pv-cal-item--' + c.kind}>
                      {c.text}
                    </span>
                  ))
                : null}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
