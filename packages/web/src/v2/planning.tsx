// ── [PCODE-440 | S15 | v0.1.0] T37 Consistency: errors and loading are announced everywhere ──
// ── [PCODE-436 | S15 | v0.1.0] T37 low: Untangle the three folder import cycles ──
// ── [PCODE-434 | S15 | v0.1.0] T37 low: Board WIP limits and custom-field filters in the screen ──
// ── [PCODE-420 | S15 | v0.1.0] T37 medium: English screens use English number and date formats ──
// ── [PCODE-271 | S15 | v0.1.0] Project tabs fixes from the deep UX check: handover double page, service accounts, lifecycle name, extraction duplicates, AI cases picker, webhook events, overdue sprint, tab overflow ──
// ── [PCODE-269 | S15 | v0.1.0] UX check fixes: no service accounts in people pickers, search leaves on opening a conversation, epic chips open the epic ──
// ── [PCODE-268 | S15 | v0.1.0] Planning fixes from the UX check: sprint dates in the screen, link hint, bulk bar under the top bar ──
// ── [PCODE-257 | S15 | v0.1.0] T26.6 Hierarchy: initiatives, custom item types, custom fields ──
// ── [PCODE-256 | S15 | v0.1.0] T26.5 Planning charts: burndown and burnup in points, cumulative flow, control chart, lead time ──
// ── [PCODE-255 | S15 | v0.1.0] T26.4 Planning details: keys, bulk edit, undo, shared views, item history, Git moves, bug SLAs ──
// ── [PCODE-254 | S15 | v0.1.0] T26.3 Flow and backlog: links, WIP limits, warnings, definition of done, triage, templates, recurring tasks ──
// ── [PCODE-253 | S15 | v0.1.0] T26.2 Capacity from profiles, absences, holidays and agents; Planner proposes assignees and new stories ──
// ── [PCODE-252 | S15 | v0.1.0] T26.1 Estimation: units, async planning poker, suggestions from similar tasks, estimate vs actual ──
// ── [PCODE-246 | S15 | v0.1.0] T25.1 Agent triggers act: assignment, label, mention, CI failure, schedule, webhook ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-166 | S15 | v0.1.0] B2.2 Planning live in the web app: sprint header, board, backlog, Planner draft, capacity, reports, retro ──
//    Why:  the Planning tab of the approved design on the project's real tasks. The sprint header tells
//          the goal, how much of the scope is done, the scope at the start and what was added, and the
//          capacity; the views below are the same live tasks (edits go through the offline queue and
//          reach everyone, VS Code too): board, backlog, the Planner's draft decided line by line,
//          capacity, reports with the sprint review, and the retro board.
import { estimateText, type EstimateUnit } from '@orqiva/shared';
import { useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '../core/api.js';
import type { EventHub } from '../core/hub.js';
import { rankBetween, byRank } from '../core/ranking.js';
import { PIcon, type PIconName } from '../preview/picons.js';
import { Bar, Button, Card, Chip, Kbd, MiniBurndown, Stat } from '../preview/ui.js';
import type { Item, ItemStore } from '../sync/items.js';
import { LiveAvatar } from './shell.js';
import {
  EstimateField,
  EstimatePanel,
  EstimateVsActual,
  UNIT_LABEL,
  UnitContext,
  useEstimateUnit,
} from './estimation.js'; // [PCODE-252 | S15 | v0.1.0]
import {
  ChecksPanel,
  LinksPanel,
  TemplatesCard,
  TriageCard,
  useWarnings,
  type Warning,
} from './flowui.js'; // [PCODE-254 | S15 | v0.1.0]
import {
  BulkBar,
  KeysHelp,
  typing,
  UndoToast,
  useBugSlas,
  ViewsMenu,
  type BulkResult,
} from './plankeys.js'; // [PCODE-255 | S15 | v0.1.0]
import { BurnCharts, FlowCharts } from './flowcharts.js'; // [PCODE-256 | S15 | v0.1.0]
import { InitiativesCard, ShapePanel, TypeNames, useShape } from './hierarchyui.js'; // [PCODE-257 | S15 | v0.1.0]
import { slaLeftText } from '@orqiva/shared';
import { createContext } from 'react';
import { fmtLocale } from '../core/locale.js'; // [PCODE-420 | S15 | v0.1.0]

/** [PCODE-255 | S15 | v0.1.0] the task the keys act on, and the tasks selected for a bulk change */
const PlanSelContext = createContext<{ focusId: string | null; selected: ReadonlySet<string> }>({
  focusId: null,
  selected: new Set(),
});

const W = (ws: string, p: string): string => '/api/workspaces/' + ws + p;

export interface LiveState {
  id: string;
  name: string;
  group: string;
  color: string;
  wipLimit?: number | null; // [PCODE-254 | S15 | v0.1.0]
}
export interface LiveSprint {
  id: string;
  name: string;
  goal: string;
  startDate: string | null;
  endDate: string | null;
  status: 'planned' | 'active' | 'completed';
  itemCount: number;
  doneCount: number;
  estimateTotal: number;
  estimateDone: number;
  goalMet?: boolean | null;
  addedCount?: number;
}
interface Person {
  id: string;
  name: string;
}
interface CapacityData {
  members: {
    userId: string;
    name: string;
    points: number;
    // [PCODE-253 | S15 | v0.1.0] derived from the profile, the days, holidays and absences
    derived?: number;
    manual?: boolean;
    hours?: number;
    absentDays?: number;
    focusFactor?: number;
  }[];
  window?: { from: string; to: string; days: number };
  agents?: {
    agentId: string;
    name: string;
    sprintBudgetCents: number | null;
    tasks: number;
    points: number;
  }[];
  capacity: number;
  committed: number;
  unestimated: number;
  velocity: number | null;
  velocitySprints: number;
}
interface Line {
  id: string;
  ref: string;
  title: string;
  estimate: number | null;
  carriedCount: number;
}
export interface SprintReport {
  sprint: { id: string; name: string; goal: string; goalMet: boolean | null; status: string };
  committed: { items: number; points: number };
  completed: { items: number; points: number };
  added: Line[];
  removed: { id: string; ref: string; title: string }[];
  notDone: Line[];
  carried: Line[];
  demo: Line[];
}
interface DraftLine {
  id: string;
  ref: string;
  title: string;
  estimate: number | null;
  why: string;
  confidence: number;
  decision: string | null;
  reason: string;
  assigneeName?: string | null; // [PCODE-253 | S15 | v0.1.0]
}
// [PCODE-253 | S15 | v0.1.0] a story the Planner proposes
interface NewStory {
  id: string;
  title: string;
  description: string;
  estimate: number | null;
  why: string;
  assigneeName: string | null;
  decision: string | null;
  reason: string;
  itemId: string | null;
}
interface Draft {
  id: string;
  status: string;
  room: number;
  basis: string;
  reasons: string;
  considered: string[];
  note: string;
  createdAt: string;
  lines: DraftLine[];
  newItems?: NewStory[];
}
interface RetroNote {
  id: string;
  kind: 'well' | 'improve' | 'action';
  body: string;
  authorId: string | null;
  authorName: string | null;
  votes: number;
  votedByMe: boolean;
  itemId: string | null;
  itemRef: string | null;
}

type View = 'board' | 'backlog' | 'draft' | 'capacity' | 'reports' | 'retro';
const VIEWS: { key: View; label: string; icon: PIconName }[] = [
  { key: 'board', label: 'Board', icon: 'planning' },
  { key: 'backlog', label: 'Backlog', icon: 'overview' },
  { key: 'draft', label: 'Planner’s draft', icon: 'sparkle' },
  { key: 'capacity', label: 'Capacity', icon: 'people' },
  { key: 'reports', label: 'Reports', icon: 'insights' },
  { key: 'retro', label: 'Retro', icon: 'review' },
];

export const PRIORITY: Record<string, { icon: PIconName; tone: string; label: string }> = {
  urgent: { icon: 'incident', tone: 'pv-text-danger', label: 'Urgent' },
  high: { icon: 'arrowRight', tone: 'pv-text-warning pv-rot-up', label: 'High' },
  medium: { icon: 'more', tone: 'pv-muted', label: 'Medium' },
  low: { icon: 'arrowRight', tone: 'pv-muted pv-rot-down', label: 'Low' },
};
// [PCODE-257 | S15 | v0.1.0] an initiative above the epics
export const KINDS = ['story', 'task', 'bug', 'spike', 'epic', 'initiative', 'milestone'] as const;

/** The sprint people look at first: the active one, else the next planned, else the latest. */
export function defaultSprint(sprints: readonly LiveSprint[]): LiveSprint | null {
  return (
    sprints.find((s) => s.status === 'active') ??
    sprints.find((s) => s.status === 'planned') ??
    sprints[sprints.length - 1] ??
    null
  );
}

/** The epic a task belongs to: its nearest ancestor of kind epic. */
export function epicOf(item: Item, byId: ReadonlyMap<string, Item>): Item | null {
  let p = item.parentId ? byId.get(item.parentId) : undefined;
  for (let i = 0; p && i < 20; i++) {
    if (p.kind === 'epic') return p;
    p = p.parentId ? byId.get(p.parentId) : undefined;
  }
  return null;
}

const points = (items: readonly Item[]): number => items.reduce((n, i) => n + (i.estimate ?? 0), 0);
const toneOf = (id: string): number => {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return (h % 6) + 1;
};

export function PlanningV2(props: {
  workspaceId: string;
  projectId: string;
  projectKey: string;
  states: LiveState[];
  store: ItemStore;
  hub: EventHub;
  canEdit: boolean;
  meId: string;
  go: (p: string) => void;
}): ReactNode {
  const { workspaceId, projectId, store } = props;
  const unit = useEstimateUnit(workspaceId, projectId); // [PCODE-252 | S15 | v0.1.0]
  // [PCODE-257 | S15 | v0.1.0] the project's own type names, for cards and rows
  const shape = useShape(workspaceId, projectId);
  const typeNames = useMemo(() => new Map(shape.types.map((x) => [x.id, x.name])), [shape.types]);
  const [view, setView] = useState<View>(() => {
    try {
      const v = window.localStorage.getItem('pe-planning-view');
      return VIEWS.some((x) => x.key === v) ? (v as View) : 'board';
    } catch {
      return 'board';
    }
  });
  const [sprints, setSprints] = useState<LiveSprint[]>([]);
  const [sprintId, setSprintId] = useState<string | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [agents, setAgents] = useState<Person[]>([]); // [PCODE-246 | S15 | v0.1.0]
  const [open, setOpen] = useState<string | null>(null);
  const [report, setReport] = useState<SprintReport | null>(null);
  const [capacity, setCapacity] = useState<CapacityData | null>(null);
  const [error, setError] = useState('');
  // [PCODE-255 | S15 | v0.1.0] keys, selection, undo
  const [focusId, setFocusId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<string | null>(null);
  const [keysOpen, setKeysOpen] = useState(false);

  const loadSprints = useCallback(async () => {
    const r = await api<LiveSprint[]>('GET', W(workspaceId, '/projects/' + projectId + '/sprints'));
    if (r.ok) setSprints(r.data);
  }, [workspaceId, projectId]);
  const sprint = sprints.find((s) => s.id === sprintId) ?? defaultSprint(sprints);
  const loadSprintData = useCallback(async () => {
    if (!sprint) return;
    const [rep, cap] = await Promise.all([
      api<SprintReport>('GET', W(workspaceId, '/sprints/' + sprint.id + '/report')),
      props.canEdit
        ? api<CapacityData>('GET', W(workspaceId, '/sprints/' + sprint.id + '/capacity'))
        : Promise.resolve(null),
    ]);
    if (rep.ok) setReport(rep.data);
    if (cap?.ok) setCapacity(cap.data);
  }, [workspaceId, sprint?.id, props.canEdit]);

  useEffect(() => {
    void store.loadProject(projectId);
    void loadSprints();
    if (props.canEdit)
      void api<{ userId: string; name: string; service?: boolean }[]>(
        'GET',
        W(workspaceId, '/members'),
      ).then((r) => {
        // [PCODE-269 | S15 | v0.1.0] tasks go to people (or agents), not to machine accounts
        if (r.ok)
          setPeople(r.data.filter((m) => !m.service).map((m) => ({ id: m.userId, name: m.name })));
      });
    // [PCODE-246 | S15 | v0.1.0] the agents that can take a task
    if (props.canEdit)
      void api<{ id: string; name: string; key: string; enabled: boolean }[]>(
        'GET',
        W(workspaceId, '/agents'),
      ).then((r) => {
        if (r.ok)
          setAgents(
            r.data
              .filter((a) => a.enabled && a.key !== 'reader')
              .map((a) => ({ id: a.id, name: a.name })),
          );
      });
    return props.hub.on((e) => {
      if (e.type === 'orqiva.workspace.resync') void store.loadProject(projectId);
      if (e.projectid === projectId) void loadSprints();
    });
  }, [workspaceId, projectId, store, props.hub, props.canEdit, loadSprints]);
  useEffect(() => {
    void loadSprintData();
    return props.hub.on((e) => {
      if (e.projectid === projectId) void loadSprintData();
    });
  }, [loadSprintData, props.hub, projectId]);

  const items = store.items(projectId);
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const group = useMemo(() => new Map(props.states.map((s) => [s.id, s.group])), [props.states]);
  const inSprint = sprint
    ? items.filter((i) => i.sprintId === sprint.id && group.get(i.stateId) !== 'cancelled')
    : [];
  const done = inSprint.filter((i) => group.get(i.stateId) === 'completed');
  // [PCODE-255 | S15 | v0.1.0] bugs' fix times, and the order the keys walk
  const slas = useBugSlas(
    workspaceId,
    projectId,
    items.map((i) => i.id + i.stateId + (i.priority ?? '')).join(),
  );
  const columnOrder = props.states.filter((s) => s.group !== 'cancelled');
  const order: Item[] =
    view === 'board'
      ? columnOrder.flatMap((c) => inSprint.filter((i) => i.stateId === c.id).sort(byRank))
      : view === 'backlog'
        ? [
            ...inSprint.slice().sort(byRank),
            ...items
              .filter(
                (i) =>
                  !i.sprintId &&
                  i.kind !== 'epic' &&
                  i.kind !== 'initiative' &&
                  !i.triage &&
                  !['completed', 'cancelled'].includes(group.get(i.stateId) ?? ''),
              )
              .sort(byRank),
          ]
        : [];
  const undo = useCallback((): void => {
    const n = store.undo();
    setToast(n ? 'Undone (' + String(n) + (n === 1 ? ' task)' : ' tasks)') : 'Nothing to undo');
  }, [store]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !typing(e)) {
        e.preventDefault();
        undo();
        return;
      }
      if (typing(e) || e.ctrlKey || e.metaKey || e.altKey) return;
      const at = order.findIndex((i) => i.id === focusId);
      const focus = at >= 0 ? order[at] : undefined;
      const go = (n: number): void => {
        const next = order[Math.max(0, Math.min(order.length - 1, (at < 0 ? -1 : at) + n))];
        if (!next) return;
        setFocusId(next.id);
        document
          .querySelector('[data-item="' + next.id + '"]')
          ?.scrollIntoView({ block: 'nearest' });
      };
      if (e.key === 'j' || e.key === 'ArrowDown') go(1);
      else if (e.key === 'k' || e.key === 'ArrowUp') go(-1);
      else if (e.key === '?') setKeysOpen(true);
      else if (e.key === 'Escape') {
        setSelected(new Set());
        setKeysOpen(false);
      } else if (e.key === 'c' && view === 'backlog' && props.canEdit) {
        e.preventDefault();
        document
          .querySelector<HTMLInputElement>('.pv-add-input, input[placeholder^="Add an item"]')
          ?.focus();
      } else if (!focus) return;
      else if (e.key === 'Enter' || e.key === 'o') setOpen(focus.id);
      else if (e.key === 'e') {
        setOpen(focus.id);
        setTimeout(() => document.querySelector<HTMLInputElement>('.pv-title-input')?.focus(), 50);
      } else if (e.key === 'x')
        setSelected((sel) => {
          const n = new Set(sel);
          if (n.has(focus.id)) n.delete(focus.id);
          else n.add(focus.id);
          return n;
        });
      else if (e.key === 'a' && props.canEdit) {
        store.update(focus.id, { assigneeId: props.meId });
        setToast(focus.ref + ' is yours');
      } else if (e.key === 'm' && props.canEdit) {
        const ci = columnOrder.findIndex((c) => c.id === focus.stateId);
        const next = columnOrder[ci + 1];
        if (next) {
          store.update(focus.id, { stateId: next.id });
          setToast(focus.ref + ' moved to ' + next.name);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [order, focusId, view, props.canEdit, props.meId, store, columnOrder, undo]);
  const bulkDone = (r: BulkResult, what: string): void => {
    store.remember(
      new Map(r.before.map((b) => [b.id, b.fields as Parameters<ItemStore['update']>[1]])),
    );
    void store.loadProject(projectId);
    setSelected(new Set());
    setToast(
      String(r.updated + r.deleted) +
        ' tasks ' +
        what +
        (r.refused.length
          ? '; ' +
            String(r.refused.length) +
            ' held back (' +
            r.refused.map((x) => x.ref).join(', ') +
            ')'
          : ''),
    );
  };
  // [PCODE-254 | S15 | v0.1.0] the sprint's warnings, read again when its tasks change
  const warnings = useWarnings(
    workspaceId,
    projectId,
    sprint?.id ?? null,
    inSprint.map((i) => i.id + i.stateId + String(i.version)).join(),
  );
  const added = new Set(
    report?.sprint.id === sprint?.id ? (report?.added.map((x) => x.id) ?? []) : [],
  );
  const name = (id: string | null): string =>
    people.find((p) => p.id === id)?.name ?? (id === props.meId ? 'You' : 'Someone');
  const current = open ? byId.get(open) : undefined;
  const pick = (v: View): void => {
    setView(v);
    try {
      window.localStorage.setItem('pe-planning-view', v);
    } catch {
      // private window: the choice lasts for this page only
    }
  };

  return (
    // [PCODE-252 | S15 | v0.1.0] cards and lists show estimates in the project's unit
    <UnitContext.Provider value={unit}>
      <PlanSelContext.Provider value={{ focusId, selected }}>
        <TypeNames.Provider value={typeNames}>
          <div className={'pv-planning' + (current ? ' pv-planning--drawer' : '')}>
            <div className="pv-stack">
              {/* [PCODE-255 | S15 | v0.1.0] the bulk bar, the keys, the undo note */}
              {selected.size && props.canEdit ? (
                <BulkBar
                  workspaceId={workspaceId}
                  projectId={projectId}
                  ids={[...selected]}
                  states={props.states}
                  sprints={sprints}
                  people={people}
                  onDone={bulkDone}
                  onClear={() => {
                    setSelected(new Set());
                  }}
                  onError={setError}
                />
              ) : null}
              {keysOpen ? (
                <KeysHelp
                  onClose={() => {
                    setKeysOpen(false);
                  }}
                />
              ) : null}
              {toast ? (
                <UndoToast
                  text={toast}
                  canUndo={store.canUndo()}
                  onUndo={undo}
                  onClose={() => {
                    setToast(null);
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
              <SprintHeader
                workspaceId={workspaceId}
                projectId={projectId}
                sprints={sprints}
                sprint={sprint}
                donePoints={points(done)}
                scopePoints={points(inSprint)}
                report={report?.sprint.id === sprint?.id ? report : null}
                capacity={capacity}
                canEdit={props.canEdit}
                onPick={setSprintId}
                onChanged={() => {
                  void loadSprints();
                  void loadSprintData();
                }}
                onError={setError}
              />
              <nav className="pv-subtabs" aria-label="Planning view">
                {VIEWS.filter(
                  (v) =>
                    props.canEdit ||
                    (v.key !== 'draft' && v.key !== 'capacity' && v.key !== 'retro'),
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
              {view === 'board' ? (
                <BoardV2
                  items={inSprint}
                  workspaceId={workspaceId}
                  projectId={projectId}
                  slas={slas}
                  warnings={warnings}
                  onWarn={setError}
                  states={props.states}
                  byId={byId}
                  added={added}
                  pkey={props.projectKey}
                  meId={props.meId}
                  name={name}
                  canEdit={props.canEdit}
                  onOpen={setOpen}
                  onMove={(id, stateId) => {
                    store.update(id, { stateId });
                  }}
                />
              ) : null}
              {/* [PCODE-257 | S15 | v0.1.0] */}
              {view === 'backlog' ? (
                <InitiativesCard
                  workspaceId={workspaceId}
                  projectId={projectId}
                  onOpen={setOpen}
                  version={items.map((i) => i.id + i.stateId + String(i.version)).join()}
                />
              ) : null}
              {/* [PCODE-254 | S15 | v0.1.0] what waits in triage, and the templates */}
              {view === 'backlog' ? (
                <TriageCard
                  workspaceId={workspaceId}
                  projectId={projectId}
                  canEdit={props.canEdit}
                  onOpen={setOpen}
                  onChanged={() => void store.loadProject(projectId)}
                />
              ) : null}
              {view === 'backlog' ? (
                <BacklogV2
                  items={items}
                  group={group}
                  sprint={sprint}
                  byId={byId}
                  name={name}
                  canEdit={props.canEdit}
                  onOpen={setOpen}
                  onUpdate={(id, f) => {
                    store.update(id, f);
                  }}
                  onAdd={(title) => {
                    const last = items
                      .filter((i) => !i.sprintId)
                      .sort(byRank)
                      .at(-1);
                    store.create(projectId, title, { rank: rankBetween(last?.rank, undefined) });
                  }}
                />
              ) : null}
              {/* [PCODE-254 | S15 | v0.1.0] */}
              {view === 'backlog' ? (
                <TemplatesCard
                  workspaceId={workspaceId}
                  projectId={projectId}
                  sprintId={sprint?.id ?? null}
                  canEdit={props.canEdit}
                  onMade={() => void store.loadProject(projectId)}
                />
              ) : null}
              {view === 'draft' && sprint ? (
                <DraftV2
                  workspaceId={workspaceId}
                  sprint={sprint}
                  onChanged={() => void loadSprintData()}
                />
              ) : null}
              {view === 'capacity' && sprint ? (
                <CapacityV2
                  workspaceId={workspaceId}
                  sprint={sprint}
                  capacity={capacity}
                  items={inSprint}
                  canEdit={props.canEdit}
                  onChanged={setCapacity}
                  onError={setError}
                />
              ) : null}
              {view === 'reports' ? (
                <ReportsV2
                  workspaceId={workspaceId}
                  projectId={projectId}
                  sprints={sprints}
                  report={report?.sprint.id === sprint?.id ? report : null}
                  capacity={capacity}
                  sprintId={sprint?.id ?? null}
                />
              ) : null}
              {view === 'retro' && sprint ? (
                <RetroV2
                  workspaceId={workspaceId}
                  sprint={sprint}
                  meId={props.meId}
                  hub={props.hub}
                  go={props.go}
                  onError={setError}
                />
              ) : null}
              {!sprint && (view === 'draft' || view === 'capacity' || view === 'retro') ? (
                <Card>
                  <div className="pv-empty">
                    <PIcon name="planning" size={28} />
                    <strong>No sprint yet.</strong>
                    <span>Create a sprint from the sprint menu above to plan it.</span>
                  </div>
                </Card>
              ) : null}
            </div>
            {current ? (
              <TaskDrawer
                item={current}
                states={props.states}
                sprints={sprints}
                people={people}
                agents={agents}
                epics={items.filter((i) => i.kind === 'epic')}
                initiatives={items.filter((i) => i.kind === 'initiative')}
                canEdit={props.canEdit}
                onChange={(f) => {
                  store.update(current.id, f);
                }}
                onClose={() => {
                  setOpen(null);
                }}
                go={props.go}
                workspaceId={workspaceId}
                unit={unit}
              />
            ) : null}
          </div>
        </TypeNames.Provider>
      </PlanSelContext.Provider>
    </UnitContext.Provider>
  );
}

// [PCODE-271 | S15 | v0.1.0]
/** Calendar days since a sprint's end date (0 or less: not past it). */
export function overdueDays(end: string | null | undefined, now = new Date()): number {
  if (!end) return 0;
  const today = Date.parse(now.toISOString().slice(0, 10) + 'T00:00:00Z');
  return Math.round((today - Date.parse(end + 'T00:00:00Z')) / 86_400_000);
}
// [PCODE-268 | S15 | v0.1.0]
const isoPlus = (d: string, n: number): string =>
  new Date(Date.parse(d + 'T00:00:00Z') + n * 86_400_000).toISOString().slice(0, 10);
/** The next Monday (today when it is one), as the start of a new sprint. */
export function nextMonday(now = new Date()): string {
  const today = now.toISOString().slice(0, 10);
  const wd = new Date(today + 'T00:00:00Z').getUTCDay();
  return isoPlus(today, (8 - wd) % 7);
}

function SprintHeader(props: {
  workspaceId: string;
  projectId: string;
  sprints: LiveSprint[];
  sprint: LiveSprint | null;
  donePoints: number;
  scopePoints: number;
  report: SprintReport | null;
  capacity: CapacityData | null;
  canEdit: boolean;
  onPick: (id: string) => void;
  onChanged: () => void;
  onError: (m: string) => void;
}): ReactNode {
  const s = props.sprint;
  const [creating, setCreating] = useState(false);
  const [closing, setClosing] = useState(false);
  const [newName, setNewName] = useState('');
  const [goal, setGoal] = useState('');
  // [PCODE-268 | S15 | v0.1.0] a sprint's days: two weeks from the next Monday unless chosen
  const [newStart, setNewStart] = useState(() => nextMonday());
  const [newEnd, setNewEnd] = useState(() => isoPlus(nextMonday(), 11));
  const [editing, setEditing] = useState<{
    name: string;
    goal: string;
    start: string;
    end: string;
  } | null>(null);
  const call = async (method: 'POST' | 'PATCH', path: string, body?: unknown): Promise<boolean> => {
    const r = await api(method, W(props.workspaceId, path), body);
    if (!r.ok) props.onError(r.error.message);
    else props.onChanged();
    return r.ok;
  };
  const days =
    s?.startDate && s.endDate
      ? Math.max(1, Math.round((Date.parse(s.endDate) - Date.parse(s.startDate)) / 86_400_000) + 1)
      : null;
  const day =
    s?.startDate && days
      ? Math.min(
          days,
          Math.max(0, Math.round((Date.now() - Date.parse(s.startDate)) / 86_400_000) + 1),
        )
      : null;
  const atStart = props.report?.committed.points ?? null;
  const addedPts = props.report ? props.report.added.reduce((n, x) => n + (x.estimate ?? 0), 0) : 0;
  return (
    <Card className="pv-sprint-head">
      <div className="pv-sprint-row">
        <div>
          <div className="pv-sprint-title">
            {props.sprints.length ? (
              <select
                aria-label="Sprint"
                className="pv-sprint-select"
                value={s?.id ?? ''}
                onChange={(e) => {
                  props.onPick(e.target.value);
                }}
              >
                {props.sprints.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                    {x.status === 'active' ? '' : ' (' + x.status + ')'}
                  </option>
                ))}
              </select>
            ) : (
              <strong>No sprint yet</strong>
            )}
            {s ? (
              <span className="pv-muted">
                {s.startDate ?? 'no start'} – {s.endDate ?? 'no end'}
                {day && days && s.status === 'active' && overdueDays(s.endDate) <= 0
                  ? ' · day ' + String(day) + ' of ' + String(days)
                  : ''}
                {/* [PCODE-271 | S15 | v0.1.0] a sprint left open after its end says so */}
                {s.status === 'active' && overdueDays(s.endDate) > 0 ? (
                  <>
                    {' '}
                    <Chip tone="warning">
                      {'ended ' + String(overdueDays(s.endDate)) + ' d ago: complete it'}
                    </Chip>
                  </>
                ) : null}
              </span>
            ) : null}
            {/* [PCODE-268 | S15 | v0.1.0] the sprint's name, goal and days, changed here */}
            {s && props.canEdit && s.status !== 'completed' && !editing ? (
              <button
                type="button"
                className="pv-link-btn pv-small"
                onClick={() => {
                  setEditing({
                    name: s.name,
                    goal: s.goal,
                    start: s.startDate ?? nextMonday(),
                    end: s.endDate ?? isoPlus(s.startDate ?? nextMonday(), 11),
                  });
                }}
              >
                Edit
              </button>
            ) : null}
          </div>
          {s ? (
            <div className="pv-sprint-goal">
              <PIcon name="flag" size={15} /> Goal:{' '}
              {s.goal || <span className="pv-muted">none set</span>}{' '}
              {s.status === 'completed' ? (
                s.goalMet === true ? (
                  <Chip tone="success">met</Chip>
                ) : s.goalMet === false ? (
                  <Chip tone="danger">missed</Chip>
                ) : null
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="pv-sprint-figures">
          {s ? (
            <>
              <div>
                <span className="pv-muted pv-small">Done</span>
                <strong className="pv-num">
                  {props.donePoints} / {props.scopePoints} pt
                </strong>
              </div>
              <div>
                <span className="pv-muted pv-small">Scope at start</span>
                <strong className="pv-num">
                  {atStart !== null && s.status !== 'planned' ? String(atStart) + ' pt' : '—'}{' '}
                  {addedPts ? <span className="pv-text-warning">+{addedPts}</span> : null}
                </strong>
              </div>
              {props.capacity ? (
                <div>
                  <span className="pv-muted pv-small">Capacity</span>
                  <strong className="pv-num">
                    {props.capacity.capacity || (props.capacity.velocity ?? '—')} pt
                  </strong>
                </div>
              ) : null}
            </>
          ) : null}
          {props.canEdit && s?.status === 'planned' ? (
            <Button
              kind="primary"
              icon="play"
              onClick={() => void call('POST', '/sprints/' + s.id + '/start')}
            >
              Start sprint
            </Button>
          ) : null}
          {props.canEdit && s?.status === 'active' ? (
            <Button
              onClick={() => {
                setClosing(true);
              }}
            >
              Complete sprint
            </Button>
          ) : null}
          {props.canEdit ? (
            <Button
              kind="ghost"
              icon="plus"
              onClick={() => {
                setCreating((c) => !c);
              }}
            >
              New sprint
            </Button>
          ) : null}
        </div>
      </div>
      {s ? (
        <Bar
          value={props.donePoints}
          max={Math.max(1, props.scopePoints)}
          {...(day && days && s.status === 'active'
            ? { marker: (props.scopePoints * day) / days }
            : {})}
          tone="success"
        />
      ) : null}
      {creating ? (
        <form
          className="v2-inline v2-pad"
          onSubmit={(e) => {
            e.preventDefault();
            if (!newName.trim()) return;
            void call('POST', '/projects/' + props.projectId + '/sprints', {
              name: newName.trim(),
              ...(goal.trim() ? { goal: goal.trim() } : {}),
              ...(newStart ? { startDate: newStart } : {}),
              ...(newEnd ? { endDate: newEnd } : {}),
            }).then((ok) => {
              if (ok) {
                setCreating(false);
                setNewName('');
                setGoal('');
              }
            });
          }}
        >
          <input
            className="v2-input"
            placeholder="Sprint name"
            aria-label="Sprint name"
            value={newName}
            onChange={(e) => {
              setNewName(e.target.value);
            }}
          />
          <input
            className="v2-input v2-grow"
            placeholder="Goal"
            aria-label="Goal"
            value={goal}
            onChange={(e) => {
              setGoal(e.target.value);
            }}
          />
          <input
            className="v2-input"
            type="date"
            aria-label="Sprint starts"
            value={newStart}
            onChange={(e) => {
              setNewStart(e.target.value);
            }}
          />
          <input
            className="v2-input"
            type="date"
            aria-label="Sprint ends"
            min={newStart || undefined}
            value={newEnd}
            onChange={(e) => {
              setNewEnd(e.target.value);
            }}
          />
          <button
            type="submit"
            className="pv-btn pv-btn--primary pv-btn--sm"
            disabled={!newName.trim() || (!!newStart && !!newEnd && newEnd < newStart)}
          >
            Create
          </button>
        </form>
      ) : null}
      {editing && s ? (
        <form
          className="v2-inline v2-pad"
          onSubmit={(e) => {
            e.preventDefault();
            if (!editing.name.trim()) return;
            void call('PATCH', '/sprints/' + s.id, {
              name: editing.name.trim(),
              goal: editing.goal.trim(),
              startDate: editing.start || null,
              endDate: editing.end || null,
            }).then((ok) => {
              if (ok) setEditing(null);
            });
          }}
        >
          <input
            className="v2-input"
            aria-label="Sprint name"
            value={editing.name}
            onChange={(e) => {
              setEditing({ ...editing, name: e.target.value });
            }}
          />
          <input
            className="v2-input v2-grow"
            aria-label="Goal"
            placeholder="Goal"
            value={editing.goal}
            onChange={(e) => {
              setEditing({ ...editing, goal: e.target.value });
            }}
          />
          <input
            className="v2-input"
            type="date"
            aria-label="Sprint starts"
            value={editing.start}
            onChange={(e) => {
              setEditing({ ...editing, start: e.target.value });
            }}
          />
          <input
            className="v2-input"
            type="date"
            aria-label="Sprint ends"
            min={editing.start || undefined}
            value={editing.end}
            onChange={(e) => {
              setEditing({ ...editing, end: e.target.value });
            }}
          />
          <button
            type="submit"
            className="pv-btn pv-btn--primary pv-btn--sm"
            disabled={
              !editing.name.trim() ||
              (!!editing.start && !!editing.end && editing.end < editing.start)
            }
          >
            Save
          </button>
          <button
            type="button"
            className="pv-btn pv-btn--sm"
            onClick={() => {
              setEditing(null);
            }}
          >
            Cancel
          </button>
        </form>
      ) : null}
      {closing && s ? (
        <CompleteSprint
          sprint={s}
          next={props.sprints.filter((x) => x.status === 'planned')}
          onCancel={() => {
            setClosing(false);
          }}
          onDone={(moveTo, goalMet) => {
            void call('POST', '/sprints/' + s.id + '/complete', { moveTo, goalMet }).then((ok) => {
              if (ok) setClosing(false);
            });
          }}
        />
      ) : null}
    </Card>
  );
}

function CompleteSprint(props: {
  sprint: LiveSprint;
  next: LiveSprint[];
  onCancel: () => void;
  onDone: (moveTo: string | null, goalMet: boolean | null) => void;
}): ReactNode {
  const [moveTo, setMoveTo] = useState(props.next[0]?.id ?? '');
  const [met, setMet] = useState<'yes' | 'no' | ''>('');
  const open = props.sprint.itemCount - props.sprint.doneCount;
  return (
    <div className="v2-pad v2-complete" role="group" aria-label="Complete the sprint">
      <p>
        <strong>{open}</strong> {open === 1 ? 'task is' : 'tasks are'} not finished; each is counted
        as carried over.
      </p>
      <div className="v2-inline">
        <label className="v2-field">
          <span>Unfinished tasks go to</span>
          <select
            className="v2-input"
            value={moveTo}
            onChange={(e) => {
              setMoveTo(e.target.value);
            }}
          >
            {props.next.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
            <option value="">The backlog</option>
          </select>
        </label>
        <fieldset className="v2-field v2-plain">
          <legend>Goal “{props.sprint.goal || 'none set'}”</legend>
          <span className="v2-inline">
            <label className="v2-switch">
              <input
                type="radio"
                name="goal"
                checked={met === 'yes'}
                onChange={() => {
                  setMet('yes');
                }}
              />{' '}
              met
            </label>
            <label className="v2-switch">
              <input
                type="radio"
                name="goal"
                checked={met === 'no'}
                onChange={() => {
                  setMet('no');
                }}
              />{' '}
              missed
            </label>
          </span>
        </fieldset>
        <Button
          kind="primary"
          icon="check"
          onClick={() => {
            props.onDone(moveTo || null, met === '' ? null : met === 'yes');
          }}
        >
          Complete
        </Button>
        <Button kind="ghost" onClick={props.onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function TaskCardV2(props: {
  item: Item;
  sla?: string | undefined; // [PCODE-255 | S15 | v0.1.0]
  warning?: string | undefined; // [PCODE-254 | S15 | v0.1.0]
  epic: Item | null;
  added: boolean;
  name: (id: string | null) => string;
  onOpen: () => void;
  onDrag: () => void;
  draggable: boolean;
  finished: boolean;
}): ReactNode {
  const unit = useContext(UnitContext); // [PCODE-252 | S15 | v0.1.0]
  const t = props.item;
  const pr = PRIORITY[t.priority ?? 'none'];
  const sel = useContext(PlanSelContext); // [PCODE-255 | S15 | v0.1.0]
  const typeNames = useContext(TypeNames); // [PCODE-257 | S15 | v0.1.0]
  return (
    <button
      type="button"
      data-item={t.id}
      className={
        'pv-card-task' +
        (sel.focusId === t.id ? ' pk-focus' : '') +
        (sel.selected.has(t.id) ? ' pk-selected' : '')
      }
      draggable={props.draggable}
      onDragStart={props.onDrag}
      onClick={props.onOpen}
    >
      <span className="pv-card-task-top">
        <span className="pv-mono pv-muted">{t.ref}</span>
        {props.added ? <Chip tone="warning">added</Chip> : null}
        {t.carriedCount ? <Chip>carried {t.carriedCount}×</Chip> : null}
        {t.typeId && typeNames.get(t.typeId) ? (
          <Chip>{typeNames.get(t.typeId)}</Chip>
        ) : t.kind && t.kind !== 'story' && t.kind !== 'task' ? (
          <Chip>{t.kind}</Chip>
        ) : null}
        <span className="pv-spacer" />
        {pr ? (
          <span className={pr.tone} title={pr.label}>
            <PIcon name={pr.icon} size={14} />
          </span>
        ) : null}
      </span>
      <span className="pv-card-task-title">{t.title}</span>
      <span className="pv-card-task-foot">
        {props.epic ? (
          <span className={'pv-epic pv-epic--' + String(toneOf(props.epic.id))}>
            {props.epic.title}
          </span>
        ) : null}
        <span className="pv-spacer" />
        {t.ready === false && !props.finished ? (
          <span className="pv-small pv-text-warning">not ready</span>
        ) : null}
        {props.sla && !props.finished ? (
          <span
            className={'pk-sla' + (Date.parse(props.sla) < Date.now() ? ' pk-sla--over' : '')}
            title={'Fix by ' + props.sla.slice(0, 16).replace('T', ' ') + ' UTC'}
          >
            {slaLeftText(props.sla)}
          </span>
        ) : null}
        {props.warning && !props.finished ? (
          <span className="fl-warn" title={props.warning} aria-label={props.warning}>
            !
          </span>
        ) : null}
        {t.estimate !== null ? (
          <span className="pv-points">{estimateText(t.estimate, unit).replace(' pt', '')}</span>
        ) : null}
        {t.assigneeId ? (
          <LiveAvatar id={t.assigneeId} name={props.name(t.assigneeId)} size="xs" />
        ) : null}
      </span>
    </button>
  );
}

type Quick = 'mine' | 'bugs' | 'notReady' | 'blocked';

export function BoardV2(props: {
  items: Item[];
  // [PCODE-255 | S15 | v0.1.0] for saved views, and bugs' fix times
  workspaceId?: string;
  projectId?: string;
  slas?: ReadonlyMap<string, string>;
  warnings?: Warning[]; // [PCODE-254 | S15 | v0.1.0]
  onWarn?: (m: string) => void;
  states: LiveState[];
  byId: ReadonlyMap<string, Item>;
  added: ReadonlySet<string>;
  pkey: string;
  meId: string;
  name: (id: string | null) => string;
  canEdit: boolean;
  onOpen: (id: string) => void;
  onMove: (id: string, stateId: string) => void;
}): ReactNode {
  const [lanes, setLanes] = useState<'none' | 'epic' | 'person'>('none');
  const [quick, setQuick] = useState<Set<Quick>>(new Set());
  const [dragging, setDragging] = useState<string | null>(null);
  // [PCODE-434 | S15 | v0.1.0] WIP limits set in the column's head; the server keeps them
  const [limits, setLimits] = useState<Record<string, number | null>>({});
  const [setting, setSetting] = useState<string | null>(null);
  const limitOf = (c: { id: string; wipLimit?: number | null }): number | null =>
    c.id in limits ? (limits[c.id] ?? null) : (c.wipLimit ?? null);
  const saveLimit = (stateId: string, text: string): void => {
    setSetting(null);
    const n = text.trim() === '' ? null : Math.round(Number(text));
    if (n !== null && (!Number.isFinite(n) || n < 1 || n > 999)) return;
    if (!props.workspaceId || !props.projectId) return;
    void api(
      'PUT',
      '/api/workspaces/' +
        props.workspaceId +
        '/projects/' +
        props.projectId +
        '/states/' +
        stateId +
        '/wip',
      { limit: n },
    ).then((r) => {
      if (r.ok) setLimits((x) => ({ ...x, [stateId]: n }));
      else props.onWarn?.(r.error.message);
    });
  };
  // a sprint task still in a backlog state shows in that state's column instead of vanishing
  const columns = props.states.filter(
    (s) =>
      s.group !== 'cancelled' &&
      (s.group !== 'backlog' || props.items.some((i) => i.stateId === s.id)),
  );
  const blockedState = new Set(props.states.filter((s) => /block/i.test(s.name)).map((s) => s.id));
  const shown = props.items.filter(
    (t) =>
      (!quick.has('mine') || t.assigneeId === props.meId) &&
      (!quick.has('bugs') || t.kind === 'bug') &&
      (!quick.has('notReady') || t.ready === false) &&
      (!quick.has('blocked') || blockedState.has(t.stateId)),
  );
  const epic = (t: Item): Item | null => epicOf(t, props.byId);
  const laneKeys: { key: string; label: string | null }[] =
    lanes === 'epic'
      ? [
          ...new Map(shown.map((t) => [epic(t)?.id ?? '', epic(t)?.title ?? 'No epic'])).entries(),
        ].map(([key, label]) => ({ key, label }))
      : lanes === 'person'
        ? [...new Set(shown.map((t) => t.assigneeId ?? ''))].map((key) => ({
            key,
            label: key ? props.name(key) : 'Unassigned',
          }))
        : [{ key: '', label: null }];
  const inLane = (t: Item, k: string): boolean =>
    lanes === 'none' || (lanes === 'epic' ? (epic(t)?.id ?? '') === k : (t.assigneeId ?? '') === k);
  const toggle = (q: Quick): void => {
    setQuick((s) => {
      const n = new Set(s);
      if (n.has(q)) n.delete(q);
      else n.add(q);
      return n;
    });
  };
  return (
    <div className="pv-stack">
      <div className="pv-toolbar">
        <div className="pv-segmented" role="radiogroup" aria-label="Swimlanes">
          {(['none', 'epic', 'person'] as const).map((l) => (
            <button
              key={l}
              type="button"
              role="radio"
              aria-checked={lanes === l}
              className="pv-seg"
              onClick={() => {
                setLanes(l);
              }}
            >
              {l === 'none' ? 'No lanes' : l === 'epic' ? 'By epic' : 'By person'}
            </button>
          ))}
        </div>
        <span className="v2-inline" role="group" aria-label="Quick filters">
          {(
            [
              ['mine', 'Mine'],
              ['blocked', 'Blocked'],
              ['bugs', 'Bugs'],
              ['notReady', 'Not ready'],
            ] as [Quick, string][]
          ).map(([q, l]) => (
            <button
              key={q}
              type="button"
              className="pv-filter-chip"
              aria-pressed={quick.has(q)}
              onClick={() => {
                toggle(q);
              }}
            >
              {l}
            </button>
          ))}
        </span>
        <span className="pv-spacer" />
        {/* [PCODE-255 | S15 | v0.1.0] */}
        {props.workspaceId && props.projectId ? (
          <ViewsMenu
            workspaceId={props.workspaceId}
            projectId={props.projectId}
            current={{ lanes, quick: [...quick] }}
            onApply={(v) => {
              setLanes(v.lanes === 'epic' || v.lanes === 'person' ? v.lanes : 'none');
              setQuick(
                new Set(
                  v.quick.filter((q): q is Quick =>
                    ['mine', 'blocked', 'bugs', 'notReady'].includes(q),
                  ),
                ),
              );
            }}
          />
        ) : null}
        {props.canEdit ? (
          <span className="pv-hint">Drag a card to move it · ? for keys</span>
        ) : null}
      </div>
      {!props.items.length ? (
        <Card>
          <div className="pv-empty">
            <PIcon name="planning" size={28} />
            <strong>This sprint has no tasks.</strong>
            <span>Take tasks from the backlog, or ask the Planner for a draft.</span>
          </div>
        </Card>
      ) : (
        <div className="pv-board v2-board">
          {columns.map((c) => {
            const list = shown.filter((t) => t.stateId === c.id);
            return (
              <div
                key={c.id}
                className="pv-col"
                onDragOver={(e) => {
                  e.preventDefault();
                }}
                onDrop={() => {
                  // [PCODE-254 | S15 | v0.1.0] a full column takes the card, and says so
                  if (
                    dragging !== null &&
                    props.canEdit &&
                    limitOf(c) &&
                    !list.some((x) => x.id === dragging) &&
                    list.length >= (limitOf(c) ?? 0)
                  )
                    props.onWarn?.(
                      c.name +
                        ' is at its WIP limit of ' +
                        String(limitOf(c)) +
                        '; finish something first.',
                    );
                  if (dragging !== null && props.canEdit) props.onMove(dragging, c.id);
                  setDragging(null);
                }}
              >
                <div className="pv-col-head">
                  <span className={'pv-state-dot pv-state-dot--' + c.group} />
                  <strong>{c.name}</strong>
                  <span
                    className={
                      'pv-num ' +
                      (limitOf(c) && list.length > (limitOf(c) ?? 0)
                        ? 'pv-text-danger'
                        : 'pv-muted')
                    }
                    title={limitOf(c) ? 'WIP limit ' + String(limitOf(c)) : undefined}
                  >
                    {list.length}
                    {limitOf(c) ? ' / ' + String(limitOf(c)) : ''}
                  </span>
                  {/* [PCODE-434 | S15 | v0.1.0] setting the column's limit */}
                  {props.canEdit && props.workspaceId && props.projectId ? (
                    setting === c.id ? (
                      <input
                        className="v2-input v2-input--sm pv-wip-input"
                        type="number"
                        min={1}
                        max={999}
                        autoFocus
                        aria-label={'WIP limit of ' + c.name}
                        placeholder="none"
                        defaultValue={limitOf(c) ?? ''}
                        onBlur={(e) => {
                          saveLimit(c.id, e.target.value);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') e.currentTarget.blur();
                          if (e.key === 'Escape') setSetting(null);
                        }}
                      />
                    ) : (
                      <button
                        type="button"
                        className="pv-link-btn pv-small"
                        aria-label={'Set the WIP limit of ' + c.name}
                        onClick={() => {
                          setSetting(c.id);
                        }}
                      >
                        Limit
                      </button>
                    )
                  ) : null}
                  <span className="pv-spacer" />
                  <span className="pv-muted pv-small pv-num">{points(list)} pt</span>
                </div>
                {laneKeys.map((l) => {
                  const lane = list.filter((t) => inLane(t, l.key));
                  return (
                    <div key={l.key} className="pv-lane">
                      {/* [PCODE-269 | S15 | v0.1.0] an epic's lane head opens the epic */}
                      {l.label && lanes === 'epic' && l.key ? (
                        <button
                          type="button"
                          className="pv-lane-head pv-link-btn"
                          onClick={() => {
                            props.onOpen(l.key);
                          }}
                        >
                          {l.label}
                        </button>
                      ) : l.label ? (
                        <div className="pv-lane-head">{l.label}</div>
                      ) : null}
                      {lane.sort(byRank).map((t) => (
                        <TaskCardV2
                          key={t.id}
                          item={t}
                          warning={props.warnings
                            ?.filter((w) => w.itemId === t.id)
                            .map((w) => w.text)
                            .join('; ')}
                          sla={props.slas?.get(t.id)}
                          epic={epic(t)}
                          added={props.added.has(t.id)}
                          name={props.name}
                          draggable={props.canEdit}
                          finished={c.group === 'completed'}
                          onOpen={() => {
                            props.onOpen(t.id);
                          }}
                          onDrag={() => {
                            setDragging(t.id);
                          }}
                        />
                      ))}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function BacklogV2(props: {
  items: Item[];
  group: ReadonlyMap<string, string>;
  sprint: LiveSprint | null;
  byId: ReadonlyMap<string, Item>;
  name: (id: string | null) => string;
  canEdit: boolean;
  onOpen: (id: string) => void;
  onUpdate: (id: string, f: Parameters<ItemStore['update']>[1]) => void;
  onAdd: (title: string) => void;
}): ReactNode {
  const unit = useContext(UnitContext); // [PCODE-252 | S15 | v0.1.0]
  const sel = useContext(PlanSelContext); // [PCODE-255 | S15 | v0.1.0]
  const typeNames = useContext(TypeNames); // [PCODE-257 | S15 | v0.1.0]
  const [title, setTitle] = useState('');
  const open = (i: Item): boolean =>
    props.group.get(i.stateId) !== 'completed' && props.group.get(i.stateId) !== 'cancelled';
  const sprintItems = props.sprint
    ? props.items.filter((i) => i.sprintId === props.sprint?.id).sort(byRank)
    : [];
  const backlog = props.items
    // [PCODE-254 | S15 | v0.1.0] what waits in triage is not in the backlog yet
    // [PCODE-257 | S15 | v0.1.0] initiatives and epics group the backlog; they are not in it
    .filter(
      (i) => !i.sprintId && open(i) && i.kind !== 'epic' && i.kind !== 'initiative' && !i.triage,
    )
    .sort(byRank);
  const move = (i: Item, dir: -1 | 1): void => {
    const at = backlog.indexOf(i);
    const a = backlog[at + dir];
    const b = backlog[at + dir * 2];
    if (!a) return;
    props.onUpdate(i.id, {
      rank: dir < 0 ? rankBetween(b?.rank, a.rank) : rankBetween(a.rank, b?.rank),
    });
  };
  const row = (t: Item, inSprint: boolean): ReactNode => {
    const epic = epicOf(t, props.byId);
    return (
      <tr
        key={t.id}
        data-item={t.id}
        className={
          'pv-click-row' +
          (sel.focusId === t.id ? ' pk-focus' : '') +
          (sel.selected.has(t.id) ? ' pk-selected' : '')
        }
      >
        <td className="pv-rank">
          {!inSprint && props.canEdit ? (
            <>
              <button
                type="button"
                className="pv-mini-btn"
                aria-label={'Move ' + t.ref + ' up'}
                onClick={() => {
                  move(t, -1);
                }}
              >
                ▲
              </button>
              <button
                type="button"
                className="pv-mini-btn"
                aria-label={'Move ' + t.ref + ' down'}
                onClick={() => {
                  move(t, 1);
                }}
              >
                ▼
              </button>
            </>
          ) : null}
        </td>
        <td className="pv-mono pv-cell-ref">
          <button
            type="button"
            className="pv-link-btn"
            onClick={() => {
              props.onOpen(t.id);
            }}
          >
            {t.ref}
          </button>
        </td>
        <td className="pv-cell-grow">
          {t.title}{' '}
          {t.typeId && typeNames.get(t.typeId) ? (
            <Chip>{typeNames.get(t.typeId)}</Chip>
          ) : t.kind && t.kind !== 'story' && t.kind !== 'task' ? (
            <Chip>{t.kind}</Chip>
          ) : null}
          {t.carriedCount ? <Chip>carried {t.carriedCount}×</Chip> : null}
        </td>
        <td>
          {/* [PCODE-269 | S15 | v0.1.0] the epic opens in the drawer (there it goes under an initiative) */}
          {epic ? (
            <button
              type="button"
              className={'pv-epic pv-epic--' + String(toneOf(epic.id)) + ' pv-epic--open'}
              title={'Open the epic ' + epic.ref}
              onClick={() => {
                props.onOpen(epic.id);
              }}
            >
              {epic.title}
            </button>
          ) : null}
        </td>
        <td>
          <button
            type="button"
            className="v2-chip-btn"
            disabled={!props.canEdit}
            title="Definition of ready: criteria, estimate, no open questions"
            onClick={() => {
              props.onUpdate(t.id, { ready: !t.ready });
            }}
          >
            {t.ready ? <Chip tone="success">ready</Chip> : <Chip tone="warning">not ready</Chip>}
          </button>
        </td>
        <td className="pv-num">
          {t.estimate !== null ? (
            estimateText(t.estimate, unit)
          ) : (
            <span className="pv-text-warning">?</span>
          )}
        </td>
        <td>
          {t.assigneeId ? (
            <LiveAvatar id={t.assigneeId} name={props.name(t.assigneeId)} size="xs" />
          ) : (
            <span className="pv-muted">—</span>
          )}
        </td>
        <td>
          {!inSprint ? (
            props.canEdit && props.sprint && props.sprint.status !== 'completed' ? (
              <Button
                size="sm"
                kind="ghost"
                onClick={() => {
                  props.onUpdate(t.id, { sprintId: props.sprint?.id ?? null });
                }}
              >
                To sprint
              </Button>
            ) : null
          ) : props.canEdit && props.sprint?.status !== 'completed' ? (
            <Button
              size="sm"
              kind="ghost"
              onClick={() => {
                props.onUpdate(t.id, { sprintId: null });
              }}
            >
              To backlog
            </Button>
          ) : null}
        </td>
      </tr>
    );
  };
  return (
    <div className="pv-stack">
      {props.sprint ? (
        <Card flush title={props.sprint.name + ' · ' + String(points(sprintItems)) + ' points'}>
          {sprintItems.length ? (
            <table className="pv-table">
              <tbody>{sprintItems.map((t) => row(t, true))}</tbody>
            </table>
          ) : (
            <p className="pv-muted v2-pad">Nothing in this sprint yet.</p>
          )}
        </Card>
      ) : null}
      <Card
        flush
        title={'Backlog · ' + String(backlog.length) + ' items, ranked'}
        action={<Chip>Definition of ready: criteria, estimate, no open questions</Chip>}
      >
        {props.canEdit ? (
          <form
            className="pv-quick-add"
            onSubmit={(e) => {
              e.preventDefault();
              if (title.trim()) props.onAdd(title.trim());
              setTitle('');
            }}
          >
            <PIcon name="plus" size={16} />
            <input
              value={title}
              placeholder="Add an item to the end of the backlog…"
              aria-label="New item"
              onChange={(e) => {
                setTitle(e.target.value);
              }}
            />
            <Kbd>Enter</Kbd>
          </form>
        ) : null}
        <table className="pv-table">
          <tbody>{backlog.map((t) => row(t, false))}</tbody>
        </table>
      </Card>
    </div>
  );
}

function DraftV2(props: {
  workspaceId: string;
  sprint: LiveSprint;
  onChanged: () => void;
}): ReactNode {
  const [draft, setDraft] = useState<Draft | null | undefined>(undefined);
  const [choice, setChoice] = useState<Record<string, boolean>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const show = (d: Draft | null): void => {
    setDraft(d);
    setChoice(
      Object.fromEntries(
        (d?.lines ?? []).filter((l) => !l.decision).map((l) => [l.id, l.confidence >= 0.7]),
      ),
    );
  };
  useEffect(() => {
    void api<Draft | null>(
      'GET',
      W(props.workspaceId, '/sprints/' + props.sprint.id + '/plan/draft'),
    ).then((r) => {
      show(r.ok ? r.data : null);
    });
  }, [props.workspaceId, props.sprint.id]);
  const ask = async (): Promise<void> => {
    setBusy(true);
    setError('');
    const r = await api<{ draftId: string }>(
      'POST',
      W(props.workspaceId, '/sprints/' + props.sprint.id + '/plan/draft'),
      note.trim() ? { note: note.trim() } : undefined,
    );
    if (!r.ok) setError(r.error.message);
    else {
      const d = await api<Draft | null>(
        'GET',
        W(props.workspaceId, '/sprints/' + props.sprint.id + '/plan/draft'),
      );
      show(d.ok ? d.data : null);
      setNote('');
    }
    setBusy(false);
  };
  const decide = async (): Promise<void> => {
    if (!draft) return;
    const open = draft.lines.filter((l) => !l.decision);
    const openNew = (draft.newItems ?? []).filter((n) => !n.decision); // [PCODE-253 | S15 | v0.1.0]
    setBusy(true);
    const r = await api<{ draft: Draft }>(
      'POST',
      W(props.workspaceId, '/plan-drafts/' + draft.id + '/decide'),
      {
        accept: open.filter((l) => choice[l.id]).map((l) => l.id),
        decline: open
          .filter((l) => !choice[l.id])
          .map((l) => ({ itemId: l.id, reason: reasons[l.id] ?? '' })),
        acceptNew: openNew.filter((n) => choice[n.id]).map((n) => n.id),
        declineNew: openNew.filter((n) => !choice[n.id]).map((n) => ({ id: n.id })),
      },
    );
    setBusy(false);
    if (!r.ok) setError(r.error.message);
    else {
      show(r.data.draft);
      props.onChanged();
    }
  };
  const open = [
    ...(draft?.lines.filter((l) => !l.decision) ?? []),
    ...(draft?.newItems?.filter((n) => !n.decision) ?? []),
  ];
  const picked = open.filter((l) => choice[l.id]);
  return (
    <div className="pv-split">
      <Card
        flush
        title={
          <span className="pv-who">
            <LiveAvatar id="planner" name="Planner" size="xs" agent /> Planner’s draft for{' '}
            {props.sprint.name}
          </span>
        }
        action={
          draft ? (
            <span className="pv-muted pv-small">
              Made{' '}
              {new Date(draft.createdAt).toLocaleString(fmtLocale(), {
                dateStyle: 'short',
                timeStyle: 'short',
              })}{' '}
              · room {draft.room} points by {draft.basis}
            </span>
          ) : null
        }
      >
        {error ? (
          <p className="v2-error v2-pad" role="alert">
            {error}
          </p>
        ) : null}
        {draft === undefined ? (
          <p className="pv-muted v2-pad" role="status">
            Loading…
          </p>
        ) : null}
        {draft === null ? (
          <div className="pv-empty">
            <PIcon name="sparkle" size={28} />
            <strong>No draft yet.</strong>
            <span>
              The Planner proposes backlog tasks within the sprint’s room, with a reason for each.
              Nothing changes until you decide.
            </span>
          </div>
        ) : null}
        {draft ? (
          <ul className="pv-draft">
            {draft.lines.map((d) => (
              <li
                key={d.id}
                className={
                  (d.decision ? d.decision === 'accepted' : choice[d.id])
                    ? 'pv-draft-row pv-draft-row--on'
                    : 'pv-draft-row'
                }
              >
                <label className="pv-draft-check">
                  <input
                    type="checkbox"
                    aria-label={'Take ' + d.ref}
                    disabled={Boolean(d.decision)}
                    checked={d.decision ? d.decision === 'accepted' : (choice[d.id] ?? false)}
                    onChange={(e) => {
                      setChoice((c) => ({ ...c, [d.id]: e.target.checked }));
                    }}
                  />
                </label>
                <span className="pv-row-main">
                  <span className="pv-row-title">
                    <span className="pv-mono pv-muted">{d.ref}</span> {d.title}
                  </span>
                  <span className="pv-row-sub">
                    Why: {d.why || '—'}
                    {d.assigneeName ? ' · for ' + d.assigneeName : ''}
                  </span>
                  {d.decision === 'declined' && d.reason ? (
                    <span className="pv-row-sub">Declined: {d.reason}</span>
                  ) : null}
                  {!d.decision && !choice[d.id] ? (
                    <input
                      className="v2-input v2-reason"
                      placeholder="Why not (optional, kept with the task)"
                      aria-label={'Reason to decline ' + d.ref}
                      value={reasons[d.id] ?? ''}
                      onChange={(e) => {
                        setReasons((r) => ({ ...r, [d.id]: e.target.value }));
                      }}
                    />
                  ) : null}
                </span>
                {d.decision ? (
                  <Chip tone={d.decision === 'accepted' ? 'success' : 'neutral'}>{d.decision}</Chip>
                ) : (
                  <Chip
                    tone={
                      d.confidence >= 0.8 ? 'success' : d.confidence >= 0.7 ? 'info' : 'warning'
                    }
                  >
                    {Math.round(d.confidence * 100)} % sure
                  </Chip>
                )}
                <span className="pv-points">{d.estimate ?? '?'}</span>
              </li>
            ))}
            {/* [PCODE-253 | S15 | v0.1.0] stories the backlog lacks */}
            {(draft.newItems ?? []).map((n) => (
              <li
                key={n.id}
                className={
                  (n.decision ? n.decision === 'accepted' : choice[n.id])
                    ? 'pv-draft-row pv-draft-row--on'
                    : 'pv-draft-row'
                }
              >
                <label className="pv-draft-check">
                  <input
                    type="checkbox"
                    aria-label={'Make the story ' + n.title}
                    disabled={Boolean(n.decision)}
                    checked={n.decision ? n.decision === 'accepted' : (choice[n.id] ?? false)}
                    onChange={(e) => {
                      setChoice((c) => ({ ...c, [n.id]: e.target.checked }));
                    }}
                  />
                </label>
                <span className="pv-row-main">
                  <span className="pv-row-title">
                    <Chip tone="agent">new story</Chip> {n.title}
                  </span>
                  <span className="pv-row-sub">
                    Why: {n.why || '—'}
                    {n.assigneeName ? ' · for ' + n.assigneeName : ''}
                  </span>
                  {n.description ? <span className="pv-row-sub">{n.description}</span> : null}
                </span>
                {n.decision ? (
                  <Chip tone={n.decision === 'accepted' ? 'success' : 'neutral'}>{n.decision}</Chip>
                ) : null}
                <span className="pv-points">{n.estimate ?? '?'}</span>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="pv-draft-foot">
          {open.length ? (
            <Button kind="primary" icon="check" disabled={busy} onClick={() => void decide()}>
              Accept {picked.length} selected
              {open.length - picked.length
                ? ', decline ' + String(open.length - picked.length)
                : ''}
            </Button>
          ) : null}
          <input
            className="v2-input v2-grow"
            placeholder={
              draft ? 'A note for the redo (optional)' : 'A note for the Planner (optional)'
            }
            aria-label="Note for the Planner"
            value={note}
            onChange={(e) => {
              setNote(e.target.value);
            }}
          />
          <Button
            kind={open.length ? 'ghost' : 'primary'}
            icon="sparkle"
            disabled={busy || props.sprint.status === 'completed'}
            onClick={() => void ask()}
          >
            {busy ? 'Working…' : draft ? 'Ask the Planner to redo' : 'Ask the Planner'}
          </Button>
        </div>
      </Card>
      <div className="pv-stack">
        {draft?.reasons ? (
          <Card title="The Planner’s reasons">
            <p className="pv-small">{draft.reasons}</p>
          </Card>
        ) : null}
        {draft?.considered.length ? (
          <Card title="What the Planner considered">
            <ul className="pv-changes">
              {draft.considered.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </Card>
        ) : null}
        {draft?.note ? (
          <Card title="Your note for this draft">
            <p className="pv-small">{draft.note}</p>
          </Card>
        ) : null}
      </div>
    </div>
  );
}

function CapacityV2(props: {
  workspaceId: string;
  sprint: LiveSprint;
  capacity: CapacityData | null;
  items: Item[];
  canEdit: boolean;
  onChanged: (c: CapacityData) => void;
  onError: (m: string) => void;
}): ReactNode {
  const c = props.capacity;
  const [edit, setEdit] = useState<Record<string, number>>({});
  if (!c)
    return (
      <p className="pv-muted" role="status">
        Loading…
      </p>
    );
  const save = async (): Promise<void> => {
    const r = await api<CapacityData>(
      'PUT',
      W(props.workspaceId, '/sprints/' + props.sprint.id + '/capacity'),
      {
        entries: Object.entries(edit).map(([userId, points]) => ({ userId, points })),
      },
    );
    if (r.ok) {
      props.onChanged(r.data);
      setEdit({});
    } else props.onError(r.error.message);
  };
  return (
    <div className="pv-stack">
      <div className="pv-stats">
        <Stat label="Capacity" value={String(c.capacity) + ' pt'} icon="people" />
        <Stat
          label="Committed"
          value={String(c.committed) + ' pt'}
          tone={c.capacity && c.committed > c.capacity ? 'danger' : undefined}
          icon="planning"
          sub={c.unestimated ? String(c.unestimated) + ' without an estimate' : undefined}
        />
        <Stat
          label="Velocity"
          value={c.velocity === null ? '—' : String(c.velocity) + ' pt'}
          sub={
            c.velocitySprints
              ? 'average of the last ' + String(c.velocitySprints) + ' sprints'
              : 'after the first finished sprint'
          }
          icon="insights"
        />
        <Stat
          label="Room left"
          value={
            String(Math.max(0, (c.capacity || Math.floor(c.velocity ?? 0)) - c.committed)) + ' pt'
          }
          icon="check"
        />
      </div>
      <Card
        flush
        title={'Capacity of ' + props.sprint.name}
        action={
          props.canEdit && Object.keys(edit).length ? (
            <Button size="sm" kind="primary" onClick={() => void save()}>
              Save
            </Button>
          ) : null
        }
      >
        <table className="pv-table">
          <thead>
            <tr>
              <th>Who</th>
              <th>From the profile</th>
              <th className="pv-num">Points available</th>
              <th>Assigned in the sprint</th>
            </tr>
          </thead>
          <tbody>
            {c.members.map((m) => {
              const assigned = points(props.items.filter((i) => i.assigneeId === m.userId));
              const avail = edit[m.userId] ?? m.points;
              return (
                <tr key={m.userId}>
                  <td>
                    <span className="pv-who">
                      <LiveAvatar id={m.userId} name={m.name} size="xs" />
                      {m.name}
                    </span>
                  </td>
                  {/* [PCODE-253 | S15 | v0.1.0] what the profile, days and absences give */}
                  <td className="pv-small pv-muted">
                    {m.derived !== undefined
                      ? String(m.derived) +
                        ' pt · ' +
                        String(m.hours ?? 0) +
                        ' h at ' +
                        String(Math.round((m.focusFactor ?? 0) * 100)) +
                        ' % focus' +
                        (m.absentDays ? ' · away ' + String(m.absentDays) + ' d' : '')
                      : '—'}
                    {m.manual ? <Chip>set by hand</Chip> : null}
                  </td>
                  <td className="pv-num">
                    {props.canEdit ? (
                      <input
                        className="v2-input v2-num"
                        type="number"
                        min={0}
                        max={1000}
                        aria-label={'Points of ' + m.name}
                        value={avail}
                        onChange={(e) => {
                          setEdit((x) => ({
                            ...x,
                            [m.userId]: Math.max(0, Math.min(1000, Number(e.target.value) || 0)),
                          }));
                        }}
                      />
                    ) : (
                      avail
                    )}
                  </td>
                  <td className="pv-cell-bar">
                    <Bar
                      value={assigned}
                      max={Math.max(1, avail)}
                      tone={assigned > avail ? 'danger' : 'primary'}
                    />
                    <span
                      className={
                        'pv-small pv-num ' + (assigned > avail ? 'pv-text-danger' : 'pv-muted')
                      }
                    >
                      {assigned} of {avail}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {/* [PCODE-253 | S15 | v0.1.0] */}
        <p className="pv-muted pv-small v2-pad">
          {c.window
            ? String(c.window.days) +
              ' working days, ' +
              c.window.from +
              ' to ' +
              c.window.to +
              ', without holidays. '
            : ''}
          Points come from each person’s hours a week and focus factor, less approved absences; a
          number typed here wins. Counted are people with a role in the project or a task in it.
        </p>
      </Card>
      {c.agents?.length ? (
        <Card flush title="Agents">
          <table className="pv-table">
            <thead>
              <tr>
                <th>Agent</th>
                <th className="pv-num">Budget for the sprint</th>
                <th className="pv-num">Tasks in the sprint</th>
              </tr>
            </thead>
            <tbody>
              {c.agents.map((x) => (
                <tr key={x.agentId}>
                  <td>
                    <span className="pv-who">
                      <LiveAvatar id={x.agentId} name={x.name} size="xs" agent />
                      {x.name}
                    </span>
                  </td>
                  <td className="pv-num">
                    {x.sprintBudgetCents === null
                      ? 'no day budget'
                      : (x.sprintBudgetCents / 100).toFixed(2).replace('.', ',') + ' €'}
                  </td>
                  <td className="pv-num">
                    {x.tasks} ({x.points} pt)
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : null}
    </div>
  );
}

interface Burndown {
  sprintId: string;
  name: string;
  total: number;
  days: { date: string; remaining: number | null }[];
}

/** Ideal line from the total down to zero, and the remaining work so far. */
export function burndownSeries(b: Burndown): { actual: number[]; ideal: number[]; days: number } {
  const n = Math.max(1, b.days.length - 1);
  return {
    actual: b.days.map((d) => d.remaining).filter((v): v is number => v !== null),
    ideal: b.days.map((_, i) => Math.round((b.total * (n - i)) / n)),
    days: n,
  };
}

function ReportsV2(props: {
  workspaceId: string;
  projectId: string;
  sprintId?: string | null; // [PCODE-256 | S15 | v0.1.0]
  sprints: LiveSprint[];
  report: SprintReport | null;
  capacity: CapacityData | null;
}): ReactNode {
  const [burn, setBurn] = useState<Burndown | null>(null);
  useEffect(() => {
    void api<{ burndown: Burndown | null }>(
      'GET',
      W(props.workspaceId, '/projects/' + props.projectId + '/stats'),
    ).then((r) => {
      if (r.ok) setBurn(r.data.burndown);
    });
  }, [props.workspaceId, props.projectId, props.report]);
  const finished = props.sprints.filter((s) => s.status === 'completed').slice(-8);
  const max = Math.max(1, ...finished.map((s) => Math.max(s.estimateTotal, s.estimateDone)));
  const r = props.report;
  const scopeChange = r ? r.added.reduce((n, x) => n + (x.estimate ?? 0), 0) : 0;
  const w = 520;
  const h = 180;
  const bw = 22;
  return (
    <div className="pv-stack">
      <div className="pv-stats">
        <Stat
          label="Average velocity"
          value={
            props.capacity?.velocity === null || !props.capacity
              ? '—'
              : String(props.capacity.velocity) + ' pt'
          }
          sub={
            props.capacity?.velocitySprints
              ? 'last ' + String(props.capacity.velocitySprints) + ' sprints'
              : undefined
          }
          icon="insights"
        />
        <Stat
          label="Scope change"
          value={(scopeChange ? '+' : '') + String(scopeChange) + ' pt'}
          sub={
            r?.added.length ? String(r.added.length) + ' added after the start' : 'nothing added'
          }
          tone={scopeChange ? 'warning' : undefined}
          icon="planning"
        />
        <Stat
          label="Done"
          value={r ? String(r.completed.points) + ' of ' + String(r.committed.points) + ' pt' : '—'}
          sub="against the scope at the start"
          icon="check"
        />
        <Stat
          label="Carried over"
          value={r ? String(r.carried.length) : '—'}
          sub="tasks carried at least once"
          icon="time"
          tone={r?.carried.length ? 'warning' : undefined}
        />
      </div>
      <div className="pv-split pv-split--even">
        <Card
          title="Velocity"
          action={
            <span className="pv-legend-inline">
              <span className="pv-swatch pv-swatch--ideal" /> committed{' '}
              <span className="pv-swatch pv-swatch--actual" /> done
            </span>
          }
        >
          {finished.length ? (
            <svg
              className="pv-chart"
              viewBox={'0 0 ' + String(w) + ' ' + String(h)}
              role="img"
              aria-label="Velocity per sprint"
            >
              {finished.map((s, i) => {
                const x = 40 + i * 60;
                const hc = (s.estimateTotal / max) * (h - 30);
                const hd = (s.estimateDone / max) * (h - 30);
                return (
                  <g key={s.id}>
                    <rect
                      className="pv-bar-committed"
                      x={x}
                      y={h - 20 - hc}
                      width={bw}
                      height={hc}
                      rx="3"
                    >
                      <title>{s.name + ' committed ' + String(s.estimateTotal)}</title>
                    </rect>
                    <rect
                      className="pv-bar-done"
                      x={x + bw + 3}
                      y={h - 20 - hd}
                      width={bw}
                      height={hd}
                      rx="3"
                    >
                      <title>{s.name + ' done ' + String(s.estimateDone)}</title>
                    </rect>
                    <text className="pv-axis" x={x + bw} y={h - 4} textAnchor="middle">
                      {s.name.replace(/^Sprint\s*/i, 'S')}
                    </text>
                  </g>
                );
              })}
            </svg>
          ) : (
            <p className="pv-muted">Velocity shows after the first finished sprint.</p>
          )}
        </Card>
        <Card title={burn ? 'Burndown, ' + burn.name : 'Burndown'}>
          {burn && burn.days.length > 1 ? (
            <MiniBurndown {...burndownSeries(burn)} />
          ) : (
            <p className="pv-muted">The burndown shows while a sprint with dates is active.</p>
          )}
        </Card>
      </div>
      {/* [PCODE-256 | S15 | v0.1.0] burnup and burndown of any sprint, flow, cycle and lead times */}
      {props.sprintId ? (
        <BurnCharts workspaceId={props.workspaceId} sprintId={props.sprintId} />
      ) : null}
      <FlowCharts workspaceId={props.workspaceId} projectId={props.projectId} />
      {/* [PCODE-252 | S15 | v0.1.0] */}
      <EstimateVsActual
        workspaceId={props.workspaceId}
        projectId={props.projectId}
        sprintId={r?.sprint.id ?? null}
      />
      {r ? (
        <Card title={'Sprint review · ' + r.sprint.name}>
          <div className="v2-review">
            <ReviewList title="Demo list (done)" lines={r.demo} empty="Nothing finished yet." />
            <ReviewList title="Added after the start" lines={r.added} empty="Nothing was added." />
            <ReviewList title="Not done" lines={r.notDone} empty="Everything is done." />
            <ReviewList
              title="Carried over before"
              lines={r.carried}
              empty="Nothing was carried over."
            />
            {r.removed.length ? (
              <ReviewList
                title="Taken out after the start"
                lines={r.removed.map((x) => ({ ...x, estimate: null, carriedCount: 0 }))}
                empty=""
              />
            ) : null}
          </div>
        </Card>
      ) : null}
    </div>
  );
}

function ReviewList(props: { title: string; lines: Line[]; empty: string }): ReactNode {
  return (
    <section>
      <h3 className="v2-h3">
        {props.title} <span className="pv-muted pv-num">{props.lines.length}</span>
      </h3>
      {props.lines.length ? (
        <ul className="pv-rows pv-rows--tight">
          {props.lines.map((l) => (
            <li key={l.id} className="pv-row pv-row--static">
              <span className="pv-mono pv-muted">{l.ref}</span>
              <span className="pv-row-main">
                <span className="pv-row-title pv-wrap">{l.title}</span>
              </span>
              {l.carriedCount ? <Chip>carried {l.carriedCount}×</Chip> : null}
              {l.estimate !== null ? <span className="pv-points">{l.estimate}</span> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="pv-muted pv-small">{props.empty}</p>
      )}
    </section>
  );
}

function RetroV2(props: {
  workspaceId: string;
  sprint: LiveSprint;
  meId: string;
  hub: EventHub;
  go: (p: string) => void;
  onError: (m: string) => void;
}): ReactNode {
  const [notes, setNotes] = useState<RetroNote[] | null>(null);
  const [text, setText] = useState<Record<string, string>>({});
  const load = useCallback(async () => {
    const r = await api<RetroNote[]>(
      'GET',
      W(props.workspaceId, '/sprints/' + props.sprint.id + '/retro'),
    );
    if (r.ok) setNotes(r.data);
  }, [props.workspaceId, props.sprint.id]);
  useEffect(() => {
    void load();
  }, [load]);
  const act = async (method: 'POST' | 'DELETE', path: string, body?: unknown): Promise<void> => {
    const r = await api(method, W(props.workspaceId, path), body);
    if (!r.ok) props.onError(r.error.message);
    await load();
  };
  const column = (kind: RetroNote['kind'], title: string, tone: string): ReactNode => (
    <Card title={title}>
      <ul className={kind === 'action' ? 'pv-rows pv-rows--tight' : 'pv-stickies'}>
        {(notes ?? [])
          .filter((n) => n.kind === kind)
          .map((n) =>
            kind === 'action' ? (
              <li key={n.id} className="pv-row pv-row--static">
                {n.authorId ? (
                  <LiveAvatar id={n.authorId} name={n.authorName ?? ''} size="xs" />
                ) : null}
                <span className="pv-row-main">
                  <span className="pv-row-title pv-wrap">{n.body}</span>
                </span>
                <VoteButton
                  note={n}
                  onVote={() => void act('POST', '/retro-notes/' + n.id + '/vote')}
                />
                {n.itemId ? (
                  <a
                    href={'/items/' + n.itemId}
                    className="pv-link"
                    onClick={(e) => {
                      e.preventDefault();
                      props.go('/items/' + (n.itemId ?? ''));
                    }}
                  >
                    {n.itemRef}
                  </a>
                ) : (
                  <Button
                    size="sm"
                    onClick={() => void act('POST', '/retro-notes/' + n.id + '/task')}
                  >
                    Make a task
                  </Button>
                )}
              </li>
            ) : (
              <li key={n.id} className={'pv-sticky ' + tone}>
                <span>{n.body}</span>
                <span className="v2-sticky-foot">
                  <span className="pv-small pv-muted">{n.authorName}</span>
                  <VoteButton
                    note={n}
                    onVote={() => void act('POST', '/retro-notes/' + n.id + '/vote')}
                  />
                  {n.authorId === props.meId ? (
                    <button
                      type="button"
                      className="pv-mini-btn"
                      aria-label="Remove note"
                      onClick={() => void act('DELETE', '/retro-notes/' + n.id)}
                    >
                      ×
                    </button>
                  ) : null}
                </span>
              </li>
            ),
          )}
      </ul>
      <form
        className="v2-inline"
        onSubmit={(e) => {
          e.preventDefault();
          const body = text[kind]?.trim();
          if (!body) return;
          void act('POST', '/sprints/' + props.sprint.id + '/retro', { kind, body }).then(() => {
            setText((t) => ({ ...t, [kind]: '' }));
          });
        }}
      >
        <input
          className="v2-input v2-grow"
          placeholder="Add a note…"
          aria-label={'Add to ' + title}
          value={text[kind] ?? ''}
          onChange={(e) => {
            setText((t) => ({ ...t, [kind]: e.target.value }));
          }}
        />
      </form>
    </Card>
  );
  return (
    <div className="pv-retro">
      {column('well', 'Went well', 'pv-sticky--good')}
      {column('improve', 'To improve', 'pv-sticky--bad')}
      {column('action', 'Actions', '')}
    </div>
  );
}

function VoteButton(props: { note: RetroNote; onVote: () => void }): ReactNode {
  return (
    <button
      type="button"
      className="v2-vote"
      aria-pressed={props.note.votedByMe}
      title={props.note.votedByMe ? 'Take your vote back' : 'Vote'}
      onClick={props.onVote}
    >
      ▲ {props.note.votes}
    </button>
  );
}

function TaskDrawer(props: {
  item: Item;
  states: LiveState[];
  sprints: LiveSprint[];
  people: Person[];
  agents: Person[]; // [PCODE-246 | S15 | v0.1.0]
  epics: Item[];
  initiatives?: Item[]; // [PCODE-257 | S15 | v0.1.0]
  canEdit: boolean;
  onChange: (f: Parameters<ItemStore['update']>[1]) => void;
  onClose: () => void;
  go: (p: string) => void;
  workspaceId: string; // [PCODE-252 | S15 | v0.1.0]
  unit: EstimateUnit;
}): ReactNode {
  const t = props.item;
  const [title, setTitle] = useState(t.title);
  useEffect(() => {
    setTitle(t.title);
  }, [t.id, t.title]);
  const dis = !props.canEdit;
  return (
    <aside className="pv-drawer" aria-label={'Task ' + t.ref}>
      <header className="pv-drawer-head">
        <span className="pv-mono pv-muted">{t.ref}</span>
        <Chip>{t.kind ?? 'task'}</Chip>
        <span className="pv-spacer" />
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
        <button type="button" className="pv-icon-btn" aria-label="Close" onClick={props.onClose}>
          <PIcon name="x" />
        </button>
      </header>
      <div className="pv-drawer-body">
        <input
          className="pv-title-input"
          value={title}
          aria-label="Title"
          disabled={dis}
          onChange={(e) => {
            setTitle(e.target.value);
          }}
          onBlur={() => {
            if (title.trim() && title.trim() !== t.title) props.onChange({ title: title.trim() });
          }}
        />
        <div className="pv-props">
          <label>
            <span>State</span>
            <select
              value={t.stateId}
              disabled={dis}
              onChange={(e) => {
                props.onChange({ stateId: e.target.value });
              }}
            >
              {props.states.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Kind</span>
            <select
              value={t.kind ?? 'task'}
              disabled={dis}
              onChange={(e) => {
                props.onChange({ kind: e.target.value });
              }}
            >
              {KINDS.map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Assignee</span>
            <select
              value={t.assigneeId ?? ''}
              disabled={dis}
              onChange={(e) => {
                props.onChange({ assigneeId: e.target.value || null });
              }}
            >
              <option value="">Nobody</option>
              {props.people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          {/* [PCODE-246 | S15 | v0.1.0] an agent that takes the task starts when its trigger says so */}
          <label>
            <span>Agent</span>
            <select
              value={t.agentId ?? ''}
              disabled={dis}
              onChange={(e) => {
                props.onChange({ agentId: e.target.value || null });
              }}
            >
              <option value="">None</option>
              {props.agents.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>{UNIT_LABEL[props.unit]}</span>
            <EstimateField
              unit={props.unit}
              value={t.estimate}
              disabled={dis}
              onChange={(v) => {
                props.onChange({ estimate: v });
              }}
            />
          </label>
          <label>
            <span>Priority</span>
            <select
              value={t.priority ?? 'none'}
              disabled={dis}
              onChange={(e) => {
                props.onChange({ priority: e.target.value });
              }}
            >
              {['urgent', 'high', 'medium', 'low', 'none'].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <label>
            {/* [PCODE-257 | S15 | v0.1.0] an epic belongs to an initiative, the rest to an epic */}
            <span>{t.kind === 'epic' ? 'Initiative' : 'Epic'}</span>
            <select
              value={t.parentId ?? ''}
              disabled={dis || t.kind === 'initiative'}
              onChange={(e) => {
                props.onChange({ parentId: e.target.value || null });
              }}
            >
              <option value="">None</option>
              {(t.kind === 'epic' ? (props.initiatives ?? []) : props.epics)
                .filter((e) => e.id !== t.id)
                .map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.ref} {e.title}
                  </option>
                ))}
            </select>
          </label>
          <label>
            <span>Sprint</span>
            <select
              value={t.sprintId ?? ''}
              disabled={dis}
              onChange={(e) => {
                props.onChange({ sprintId: e.target.value || null });
              }}
            >
              <option value="">Backlog</option>
              {props.sprints
                .filter((s) => s.status !== 'completed' || s.id === t.sprintId)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            <span>Ready</span>
            <input
              type="checkbox"
              checked={t.ready ?? false}
              disabled={dis}
              onChange={(e) => {
                props.onChange({ ready: e.target.checked });
              }}
            />
          </label>
          <label>
            <span>Start</span>
            <input
              type="date"
              value={t.startDate ?? ''}
              disabled={dis}
              onChange={(e) => {
                props.onChange({ startDate: e.target.value || null });
              }}
            />
          </label>
          <label>
            <span>Due</span>
            <input
              type="date"
              value={t.dueDate ?? ''}
              disabled={dis}
              min={t.startDate ?? undefined}
              onChange={(e) => {
                props.onChange({ dueDate: e.target.value || null });
              }}
            />
          </label>
          <label>
            <span>Days</span>
            <input
              type="number"
              min={0}
              max={3650}
              disabled={dis || t.kind === 'milestone'}
              value={t.durationDays ?? ''}
              onChange={(e) => {
                props.onChange({
                  durationDays:
                    e.target.value === ''
                      ? null
                      : Math.max(0, Math.min(3650, Math.round(Number(e.target.value)))),
                });
              }}
            />
          </label>
        </div>
        {/* [PCODE-252 | S15 | v0.1.0] a suggestion and planning poker */}
        <EstimatePanel
          key={t.id}
          workspaceId={props.workspaceId}
          itemId={t.id}
          unit={props.unit}
          canEdit={props.canEdit}
          onEstimate={(v) => {
            props.onChange({ estimate: v });
          }}
        />
        {/* [PCODE-254 | S15 | v0.1.0] */}
        {/* [PCODE-257 | S15 | v0.1.0] the project's type and fields */}
        <ShapePanel
          key={'shape' + t.id}
          workspaceId={props.workspaceId}
          projectId={t.projectId}
          typeId={t.typeId}
          custom={t.custom}
          people={props.people}
          canEdit={props.canEdit}
          onChange={(f) => {
            props.onChange(f.custom ? { custom: f.custom } : { typeId: f.typeId ?? null });
          }}
        />
        <ChecksPanel
          key={'checks' + t.id}
          workspaceId={props.workspaceId}
          projectId={t.projectId}
          itemId={t.id}
          checks={t.checks}
          canEdit={props.canEdit}
        />
        <LinksPanel
          key={'links' + t.id}
          workspaceId={props.workspaceId}
          itemId={t.id}
          example={t.ref.replace(/-\d+$/, '-12')} // [PCODE-268 | S15 | v0.1.0]
          canEdit={props.canEdit}
          onChanged={() => {
            props.onChange({});
          }}
        />
        {t.carriedCount ? (
          <p className="pv-small pv-text-warning">
            Carried over {t.carriedCount} {t.carriedCount === 1 ? 'time' : 'times'}.
          </p>
        ) : null}
        {t.description ? <p className="pv-small pv-pre">{t.description.slice(0, 600)}</p> : null}
      </div>
    </aside>
  );
}

/** The Planning tab: reads the project's key and states, then shows the planning views. */
export function PlanningPage(
  props: Omit<Parameters<typeof PlanningV2>[0], 'projectKey' | 'states'>,
): ReactNode {
  const [project, setProject] = useState<{ key: string; states: LiveState[] } | null | undefined>(
    undefined,
  );
  useEffect(() => {
    void api<{ key: string; states: LiveState[] }>(
      'GET',
      W(props.workspaceId, '/projects/' + props.projectId),
    ).then((r) => {
      setProject(r.ok ? r.data : null);
    });
  }, [props.workspaceId, props.projectId]);
  if (project === undefined)
    return (
      <p className="pv-muted v2-pad" role="status">
        Loading…
      </p>
    );
  if (project === null)
    return (
      <div className="pv-empty">
        <strong>This project cannot be opened.</strong>
      </div>
    );
  return <PlanningV2 {...props} projectKey={project.key} states={project.states} />;
}
