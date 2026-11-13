// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-154 | S15 | v0.1.0] D2 preview: Ideation, Planning and Canvas ──
//    Why:  the Planning tab. A sprint has a goal, a scope snapshot taken at its start (so additions show),
//          and the capacity of people and agents. The Planner agent drafts; people accept line by line and
//          then own everything: create, edit, move, delete. Board, backlog, draft, capacity, reports and
//          retro are views of the same tasks, and every change is live in VS Code too.
import { useState, type ReactNode } from 'react';
import {
  CAPACITY,
  CFD,
  DRAFT,
  EPICS,
  RETRO,
  SPRINT,
  TASKS,
  VELOCITY,
  type PTask,
  type State,
} from './data2.js';
import { euro, person, project } from './data.js';
import { PIcon, type PIconName } from './picons.js';
import { Avatar, Bar, Button, Card, Chip, Kbd, MiniBurndown, Stat } from './ui.js';

const COLUMNS: { state: State; wip?: number }[] = [
  { state: 'Todo' },
  { state: 'In Progress', wip: 4 },
  { state: 'Review', wip: 3 },
  { state: 'Test', wip: 3 },
  { state: 'Blocked' },
  { state: 'Done' },
];

const PRIORITY_ICON: Record<PTask['priority'], { icon: PIconName; tone: string; label: string }> = {
  urgent: { icon: 'incident', tone: 'pv-text-danger', label: 'Urgent' },
  high: { icon: 'arrowRight', tone: 'pv-text-warning pv-rot-up', label: 'High' },
  medium: { icon: 'more', tone: 'pv-muted', label: 'Medium' },
  low: { icon: 'arrowRight', tone: 'pv-muted pv-rot-down', label: 'Low' },
};

const epic = (k: string) => EPICS.find((e) => e.key === k);

function TaskCard(props: {
  t: PTask;
  pkey: string;
  onOpen: () => void;
  onDrag: () => void;
}): ReactNode {
  const t = props.t;
  const pr = PRIORITY_ICON[t.priority];
  const doneCriteria = t.criteria.filter((c) => c.done).length;
  return (
    <button
      type="button"
      className={'pv-card-task' + (t.state === 'Blocked' ? ' pv-card-task--blocked' : '')}
      draggable
      onDragStart={props.onDrag}
      onClick={props.onOpen}
    >
      <span className="pv-card-task-top">
        <span className="pv-mono pv-muted">
          {props.pkey}-{t.n}
        </span>
        {t.added ? <Chip tone="warning">added</Chip> : null}
        {t.carried ? <Chip tone="neutral">carried {t.carried}×</Chip> : null}
        <span className="pv-spacer" />
        <span className={pr.tone} title={pr.label}>
          <PIcon name={pr.icon} size={14} />
        </span>
      </span>
      <span className="pv-card-task-title">{t.title}</span>
      <span className="pv-card-task-foot">
        <span className={'pv-epic pv-epic--' + String(epic(t.epic)?.tone ?? 1)}>
          {epic(t.epic)?.name}
        </span>
        <span className="pv-spacer" />
        {t.pr ? (
          <span className="pv-muted pv-small" title="Pull request">
            <PIcon name="git" size={12} /> {t.pr}
          </span>
        ) : null}
        {t.criteria.length ? (
          <span className="pv-muted pv-small" title="Acceptance criteria met">
            <PIcon name="check" size={12} /> {doneCriteria}/{t.criteria.length}
          </span>
        ) : null}
        {t.points !== null ? <span className="pv-points">{t.points}</span> : null}
        {t.assignee ? <Avatar id={t.assignee} size="xs" /> : null}
      </span>
    </button>
  );
}

function Board(props: {
  tasks: PTask[];
  pkey: string;
  onOpen: (n: number) => void;
  onMove: (n: number, s: State) => void;
}): ReactNode {
  const [lanes, setLanes] = useState<'none' | 'epic' | 'person'>('none');
  const [dragging, setDragging] = useState<number | null>(null);
  const sprint = props.tasks.filter((t) => t.state !== 'Backlog');
  const laneKeys: { key: string; label: ReactNode }[] =
    lanes === 'epic'
      ? EPICS.map((e) => ({ key: e.key, label: e.name }))
      : lanes === 'person'
        ? [...new Set(sprint.map((t) => t.assignee))].map((a) => ({
            key: a,
            label: person(a).name,
          }))
        : [{ key: '', label: null }];
  const inLane = (t: PTask, k: string): boolean =>
    lanes === 'none' || (lanes === 'epic' ? t.epic === k : t.assignee === k);
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
        <Chip icon="filter">Quick filters: mine · blocked · agents · bugs</Chip>
        <span className="pv-spacer" />
        <span className="pv-hint">Drag a card to move it · WIP limits per column</span>
      </div>
      <div className="pv-board">
        {COLUMNS.map((c) => {
          const items = sprint.filter((t) => t.state === c.state);
          const over = c.wip !== undefined && items.length > c.wip;
          return (
            <div
              key={c.state}
              className={'pv-col' + (over ? ' pv-col--over' : '')}
              onDragOver={(e) => {
                e.preventDefault();
              }}
              onDrop={() => {
                if (dragging !== null) props.onMove(dragging, c.state);
                setDragging(null);
              }}
            >
              <div className="pv-col-head">
                <span
                  className={'pv-state-dot pv-state-dot--' + c.state.replace(' ', '').toLowerCase()}
                />
                <strong>{c.state}</strong>
                <span className="pv-muted pv-num">
                  {items.length}
                  {c.wip !== undefined ? ' / ' + String(c.wip) : ''}
                </span>
                <span className="pv-spacer" />
                <span className="pv-muted pv-small pv-num">
                  {items.reduce((s, t) => s + (t.points ?? 0), 0)} pt
                </span>
              </div>
              {laneKeys.map((l) => {
                const laneItems = items.filter((t) => inLane(t, l.key));
                return (
                  <div key={l.key} className="pv-lane">
                    {l.label ? <div className="pv-lane-head">{l.label}</div> : null}
                    {laneItems.map((t) => (
                      <TaskCard
                        key={t.n}
                        t={t}
                        pkey={props.pkey}
                        onOpen={() => {
                          props.onOpen(t.n);
                        }}
                        onDrag={() => {
                          setDragging(t.n);
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
    </div>
  );
}

function Backlog(props: {
  tasks: PTask[];
  pkey: string;
  onOpen: (n: number) => void;
  onRank: (n: number, dir: -1 | 1) => void;
  onToSprint: (n: number) => void;
  onAdd: (title: string) => void;
}): ReactNode {
  const [title, setTitle] = useState('');
  const sprint = props.tasks.filter((t) => t.state !== 'Backlog');
  const backlog = props.tasks.filter((t) => t.state === 'Backlog');
  const row = (t: PTask, inSprint: boolean): ReactNode => (
    <tr key={t.n} className="pv-click-row">
      <td className="pv-rank">
        {!inSprint ? (
          <>
            <button
              type="button"
              className="pv-mini-btn"
              aria-label="Move up"
              onClick={() => {
                props.onRank(t.n, -1);
              }}
            >
              ▲
            </button>
            <button
              type="button"
              className="pv-mini-btn"
              aria-label="Move down"
              onClick={() => {
                props.onRank(t.n, 1);
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
            props.onOpen(t.n);
          }}
        >
          {props.pkey}-{t.n}
        </button>
      </td>
      <td className="pv-cell-grow">
        {t.title}
        {t.type !== 'story' ? <Chip>{t.type}</Chip> : null}
      </td>
      <td>
        <span className={'pv-epic pv-epic--' + String(epic(t.epic)?.tone ?? 1)}>
          {epic(t.epic)?.name}
        </span>
      </td>
      <td>{t.ready ? <Chip tone="success">ready</Chip> : <Chip tone="warning">not ready</Chip>}</td>
      <td className="pv-num">{t.points ?? <span className="pv-text-warning">?</span>}</td>
      <td>
        {t.assignee ? <Avatar id={t.assignee} size="xs" /> : <span className="pv-muted">—</span>}
      </td>
      <td>
        {!inSprint ? (
          <Button
            size="sm"
            kind="ghost"
            onClick={() => {
              props.onToSprint(t.n);
            }}
          >
            To sprint
          </Button>
        ) : (
          <Chip tone="primary">{t.state}</Chip>
        )}
      </td>
    </tr>
  );
  return (
    <div className="pv-stack">
      <Card
        flush
        title={
          SPRINT.name + ' · ' + String(sprint.reduce((s, t) => s + (t.points ?? 0), 0)) + ' points'
        }
      >
        <table className="pv-table">
          <tbody>{sprint.map((t) => row(t, true))}</tbody>
        </table>
      </Card>
      <Card
        flush
        title={'Backlog · ' + String(backlog.length) + ' items, ranked'}
        action={<Chip>Definition of ready: criteria, estimate, no open questions</Chip>}
      >
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
            placeholder="Add an item to the end of the backlog…  (C anywhere)"
            aria-label="New item"
            onChange={(e) => {
              setTitle(e.target.value);
            }}
          />
          <Kbd>Enter</Kbd>
        </form>
        <table className="pv-table">
          <tbody>{backlog.map((t) => row(t, false))}</tbody>
        </table>
      </Card>
    </div>
  );
}

function Draft(props: { pkey: string; onAccept: (ns: number[]) => void }): ReactNode {
  const [choice, setChoice] = useState<Record<number, boolean>>(
    Object.fromEntries(DRAFT.map((d) => [d.n, d.confidence >= 0.7])),
  );
  const [accepted, setAccepted] = useState(false);
  const picked = DRAFT.filter((d) => choice[d.n]);
  const load = 21 + picked.reduce((s, d) => s + d.points, 0);
  return (
    <div className="pv-split">
      <Card
        flush
        title={
          <span className="pv-who">
            <Avatar id="a-planner" size="xs" /> Planner’s draft for Sprint 15
          </span>
        }
        action={
          <span className="pv-muted pv-small">
            Made 09:02 from backlog rank, capacity and the next milestone · cost {euro(0.41, 2)}
          </span>
        }
      >
        <ul className="pv-draft">
          {DRAFT.map((d) => (
            <li
              key={d.n}
              className={choice[d.n] ? 'pv-draft-row pv-draft-row--on' : 'pv-draft-row'}
            >
              <label className="pv-draft-check">
                <input
                  type="checkbox"
                  checked={choice[d.n] ?? false}
                  onChange={(e) => {
                    setChoice((c) => ({ ...c, [d.n]: e.target.checked }));
                  }}
                />
              </label>
              <span className="pv-row-main">
                <span className="pv-row-title">
                  <span className="pv-mono pv-muted">
                    {props.pkey}-{d.n}
                  </span>{' '}
                  {d.title}
                </span>
                <span className="pv-row-sub">Why: {d.why}</span>
              </span>
              <Chip
                tone={d.confidence >= 0.8 ? 'success' : d.confidence >= 0.7 ? 'info' : 'warning'}
              >
                {Math.round(d.confidence * 100)} % sure
              </Chip>
              <span className="pv-points">{d.points}</span>
            </li>
          ))}
        </ul>
        <div className="pv-draft-foot">
          {accepted ? (
            <Chip tone="success" icon="check">
              {picked.length} items moved into Sprint 15; declined items stay in the backlog with
              your reason
            </Chip>
          ) : (
            <>
              <Button
                kind="primary"
                icon="check"
                onClick={() => {
                  setAccepted(true);
                  props.onAccept(picked.map((d) => d.n));
                }}
              >
                Accept {picked.length} selected
              </Button>
              <Button kind="ghost">Ask Planner to redo with a note</Button>
            </>
          )}
        </div>
      </Card>
      <div className="pv-stack">
        <Card title="Sprint 15 capacity">
          <div className="pv-spend-head">
            <span className="pv-big pv-num">{load}</span>
            <span className="pv-muted">of 32 points · carry-over 13 included</span>
          </div>
          <Bar value={load} max={32} tone={load > 32 ? 'danger' : 'success'} />
          <p className="pv-muted pv-small">
            People 26 points (Tim off Mon–Tue) · agents 6 points within {euro(220)} budget.
          </p>
        </Card>
        <Card title="What the Planner considered">
          <ul className="pv-changes">
            <li>Milestone “Pilot with 40 trucks” on 30 Oct</li>
            <li>Velocity of the last 5 sprints: 29 points on average</li>
            <li>2 backlog items not ready (no estimate) were left out</li>
            <li>Dependency: NWL-193 waits for NWL-199</li>
          </ul>
        </Card>
      </div>
    </div>
  );
}

function Capacity(): ReactNode {
  const total = CAPACITY.reduce((s, c) => s + c.points, 0);
  return (
    <Card flush title={'Capacity of Sprint 14 · ' + String(total) + ' points'}>
      <table className="pv-table">
        <thead>
          <tr>
            <th>Who</th>
            <th className="pv-num">Hours</th>
            <th className="pv-num">Focus</th>
            <th>Absent or budget</th>
            <th className="pv-num">Points</th>
            <th>Assigned</th>
          </tr>
        </thead>
        <tbody>
          {CAPACITY.map((c) => {
            const assigned = TASKS.filter(
              (t) => t.assignee === c.who && t.state !== 'Backlog',
            ).reduce((s, t) => s + (t.points ?? 0), 0);
            return (
              <tr key={c.who}>
                <td>
                  <span className="pv-who">
                    <Avatar id={c.who} size="xs" />
                    {person(c.who).name}
                  </span>
                </td>
                <td className="pv-num">{c.hours || '—'}</td>
                <td className="pv-num">{Math.round(c.focus * 100)} %</td>
                <td className="pv-muted">{c.off || '—'}</td>
                <td className="pv-num">{c.points}</td>
                <td className="pv-cell-bar">
                  <Bar
                    value={assigned}
                    max={c.points}
                    tone={assigned > c.points ? 'danger' : 'primary'}
                  />
                  <span
                    className={
                      'pv-small pv-num ' + (assigned > c.points ? 'pv-text-danger' : 'pv-muted')
                    }
                  >
                    {assigned} of {c.points}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}

function Velocity(): ReactNode {
  const w = 520;
  const h = 180;
  const max = 40;
  const bw = 26;
  return (
    <svg
      className="pv-chart"
      viewBox={'0 0 ' + String(w) + ' ' + String(h)}
      role="img"
      aria-label="Velocity per sprint"
    >
      {[10, 20, 30, 40].map((v) => (
        <g key={v}>
          <line
            className="pv-gridline"
            x1="30"
            x2={w}
            y1={h - 20 - (v / max) * (h - 30)}
            y2={h - 20 - (v / max) * (h - 30)}
          />
          <text className="pv-axis" x="24" y={h - 16 - (v / max) * (h - 30)} textAnchor="end">
            {v}
          </text>
        </g>
      ))}
      {VELOCITY.map((s, i) => {
        const x = 50 + i * 78;
        const hc = (s.committed / max) * (h - 30);
        const hd = (s.done / max) * (h - 30);
        return (
          <g key={s.sprint}>
            <rect className="pv-bar-committed" x={x} y={h - 20 - hc} width={bw} height={hc} rx="3">
              <title>{s.sprint + ' committed ' + String(s.committed)}</title>
            </rect>
            <rect
              className="pv-bar-done"
              x={x + bw + 4}
              y={h - 20 - hd}
              width={bw}
              height={hd}
              rx="3"
            >
              <title>{s.sprint + ' done ' + String(s.done)}</title>
            </rect>
            <text className="pv-axis" x={x + bw + 2} y={h - 4} textAnchor="middle">
              {s.sprint}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function Cfd(): ReactNode {
  const w = 520;
  const h = 180;
  const total = 34;
  const x = (i: number): number => 10 + (i / 9) * (w - 20);
  const y = (v: number): number => h - 10 - (v / total) * (h - 20);
  const band = (lo: number, hi: number): string => {
    const top = CFD.map(
      (d, i) => x(i).toFixed(1) + ',' + y(d.slice(0, hi).reduce((a, b) => a + b, 0)).toFixed(1),
    );
    const bot = CFD.map(
      (d, i) => x(i).toFixed(1) + ',' + y(d.slice(0, lo).reduce((a, b) => a + b, 0)).toFixed(1),
    ).reverse();
    return [...top, ...bot].join(' ');
  };
  return (
    <svg
      className="pv-chart"
      viewBox={'0 0 ' + String(w) + ' ' + String(h)}
      role="img"
      aria-label="Cumulative flow"
    >
      <polygon className="pv-cfd-done" points={band(0, 1)} />
      <polygon className="pv-cfd-review" points={band(1, 2)} />
      <polygon className="pv-cfd-progress" points={band(2, 3)} />
      <polygon className="pv-cfd-todo" points={band(3, 4)} />
    </svg>
  );
}

function Reports(): ReactNode {
  const p = project('NWL');
  return (
    <div className="pv-stack">
      <div className="pv-stats">
        <Stat label="Average velocity" value="29 pt" sub="last 5 sprints" icon="insights" />
        <Stat label="Cycle time" value="2.8 days" sub="median, stories" icon="time" />
        <Stat
          label="Scope change"
          value="+3 pt"
          sub="NWL-196 added on day 4"
          tone="warning"
          icon="planning"
        />
        <Stat label="Estimate accuracy" value="86 %" sub="points vs actual hours" icon="check" />
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
          <Velocity />
        </Card>
        <Card title="Burndown, Sprint 14">
          {p ? <MiniBurndown actual={p.burndown} ideal={p.ideal} days={p.sprint.days} /> : null}
        </Card>
        <Card
          title="Cumulative flow"
          action={
            <span className="pv-muted pv-small">Done · Review/Test · In progress · Todo</span>
          }
        >
          <Cfd />
        </Card>
        <Card title="Where time goes (cycle time by state)">
          <ul className="pv-share">
            {[
              ['Todo → start', 0.6],
              ['In progress', 1.4],
              ['Waiting for review', 0.5],
              ['Review', 0.2],
              ['Test', 0.4],
            ].map(([l, v]) => (
              <li key={String(l)} className="pv-share-row pv-share-row--wide">
                <span className="pv-share-label">{l}</span>
                <Bar value={Number(v)} max={1.5} />
                <span className="pv-share-value pv-num">{v} d</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}

function Retro(): ReactNode {
  const [made, setMade] = useState<string[]>(
    RETRO.actions.filter((a) => a.task).map((a) => a.text),
  );
  return (
    <div className="pv-retro">
      <Card title="Went well">
        <ul className="pv-stickies">
          {RETRO.well.map((x) => (
            <li key={x} className="pv-sticky pv-sticky--good">
              {x}
            </li>
          ))}
        </ul>
      </Card>
      <Card title="To improve">
        <ul className="pv-stickies">
          {RETRO.better.map((x) => (
            <li key={x} className="pv-sticky pv-sticky--bad">
              {x}
            </li>
          ))}
        </ul>
      </Card>
      <Card title="Actions">
        <ul className="pv-rows pv-rows--tight">
          {RETRO.actions.map((a) => (
            <li key={a.text} className="pv-row pv-row--static">
              <Avatar id={a.who} size="xs" />
              <span className="pv-row-main">
                <span className="pv-row-title pv-wrap">{a.text}</span>
              </span>
              {made.includes(a.text) ? (
                <Chip tone="success" icon="check">
                  task in Sprint 15
                </Chip>
              ) : (
                <Button
                  size="sm"
                  onClick={() => {
                    setMade((m) => [...m, a.text]);
                  }}
                >
                  Make a task
                </Button>
              )}
            </li>
          ))}
        </ul>
        <p className="pv-muted pv-small">
          Open actions from the last retro appear here until they are done.
        </p>
      </Card>
    </div>
  );
}

function Detail(props: {
  t: PTask;
  pkey: string;
  onChange: (t: PTask) => void;
  onClose: () => void;
  onDelete: () => void;
}): ReactNode {
  const t = props.t;
  const [sub, setSub] = useState('');
  return (
    <aside className="pv-drawer" aria-label={'Task ' + props.pkey + '-' + String(t.n)}>
      <header className="pv-drawer-head">
        <span className="pv-mono pv-muted">
          {props.pkey}-{t.n}
        </span>
        <Chip>{t.type}</Chip>
        <span className="pv-spacer" />
        <Button
          size="sm"
          kind="ghost"
          icon="ide"
          title="Opens the task in VS Code and runs orq start"
        >
          Start in VS Code
        </Button>
        <button type="button" className="pv-icon-btn" aria-label="Close" onClick={props.onClose}>
          <PIcon name="x" />
        </button>
      </header>
      <div className="pv-drawer-body">
        <input
          className="pv-title-input"
          value={t.title}
          aria-label="Title"
          onChange={(e) => {
            props.onChange({ ...t, title: e.target.value });
          }}
        />
        <div className="pv-props">
          <label>
            <span>State</span>
            <select
              value={t.state}
              onChange={(e) => {
                props.onChange({ ...t, state: e.target.value as State });
              }}
            >
              {['Backlog', 'Todo', 'In Progress', 'Review', 'Test', 'Blocked', 'Done'].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Assignee</span>
            <select
              value={t.assignee}
              onChange={(e) => {
                props.onChange({ ...t, assignee: e.target.value });
              }}
            >
              <option value="">Nobody</option>
              {['mara', 'lea', 'tim', 'sara', 'ole', 'a-coder', 'a-tester'].map((id) => (
                <option key={id} value={id}>
                  {person(id).name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Points</span>
            <input
              type="number"
              value={t.points ?? ''}
              onChange={(e) => {
                props.onChange({
                  ...t,
                  points: e.target.value === '' ? null : Number(e.target.value),
                });
              }}
            />
          </label>
          <label>
            <span>Priority</span>
            <select
              value={t.priority}
              onChange={(e) => {
                props.onChange({ ...t, priority: e.target.value as PTask['priority'] });
              }}
            >
              {['urgent', 'high', 'medium', 'low'].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Epic</span>
            <select
              value={t.epic}
              onChange={(e) => {
                props.onChange({ ...t, epic: e.target.value });
              }}
            >
              {EPICS.map((e) => (
                <option key={e.key} value={e.key}>
                  {e.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Sprint</span>
            <select defaultValue="14">
              <option value="14">Sprint 14</option>
              <option value="15">Sprint 15</option>
              <option value="">Backlog</option>
            </select>
          </label>
        </div>
        <section className="pv-drawer-section">
          <h3>Acceptance criteria</h3>
          <ul className="pv-checklist">
            {t.criteria.map((c, i) => (
              <li key={c.text}>
                <label>
                  <input
                    type="checkbox"
                    checked={c.done}
                    onChange={(e) => {
                      props.onChange({
                        ...t,
                        criteria: t.criteria.map((x, j) =>
                          j === i ? { ...x, done: e.target.checked } : x,
                        ),
                      });
                    }}
                  />
                  <span>{c.text}</span>
                </label>
              </li>
            ))}
            {!t.criteria.length ? (
              <li className="pv-text-warning">No criteria yet: not ready for a sprint.</li>
            ) : null}
          </ul>
        </section>
        <section className="pv-drawer-section">
          <h3>Sub-tasks</h3>
          <ul className="pv-checklist">
            {(t.subtasks ?? []).map((s, i) => (
              <li key={s.text}>
                <label>
                  <input
                    type="checkbox"
                    checked={s.done}
                    onChange={(e) => {
                      props.onChange({
                        ...t,
                        subtasks: (t.subtasks ?? []).map((x, j) =>
                          j === i ? { ...x, done: e.target.checked } : x,
                        ),
                      });
                    }}
                  />
                  <span>{s.text}</span>
                </label>
              </li>
            ))}
          </ul>
          <form
            className="pv-quick-add pv-quick-add--small"
            onSubmit={(e) => {
              e.preventDefault();
              if (sub.trim())
                props.onChange({
                  ...t,
                  subtasks: [...(t.subtasks ?? []), { text: sub.trim(), done: false }],
                });
              setSub('');
            }}
          >
            <PIcon name="plus" size={14} />
            <input
              value={sub}
              placeholder="Add a sub-task"
              aria-label="New sub-task"
              onChange={(e) => {
                setSub(e.target.value);
              }}
            />
          </form>
        </section>
        <section className="pv-drawer-section">
          <h3>Linked</h3>
          <div className="pv-kv">
            <span>Requirement</span>
            <span>R-04 · PRD v3 of I-11</span>
            <span>Pull request</span>
            <span>{t.pr ? t.pr + ' · checks passed · 2 AI comments' : '—'}</span>
            <span>Code</span>
            <span>
              9 blocks in 4 files carry {props.pkey}-{t.n}
            </span>
            <span>Tests</span>
            <span>6 cases · 5 passing</span>
            <span>Blocked by</span>
            <span>{t.blockedBy ? props.pkey + '-' + String(t.blockedBy) : '—'}</span>
          </div>
        </section>
        <section className="pv-drawer-section">
          <h3>History</h3>
          <ul className="pv-history">
            <li>
              <Avatar id="a-coder" size="xs" /> Coder pushed 3 commits · 09:41
            </li>
            <li>
              <Avatar id="lea" size="xs" /> Lea moved it to Review · yesterday 17:02
            </li>
            <li>
              <Avatar id="a-planner" size="xs" /> Planner estimated 8 points (similar: NWL-77,
              NWL-140) · 29 Sep
            </li>
          </ul>
        </section>
      </div>
      <footer className="pv-drawer-foot">
        <Button kind="danger" size="sm" icon="x" onClick={props.onDelete}>
          Delete
        </Button>
        <span className="pv-spacer" />
        <span className="pv-hint">Saved as you type · Undo with Ctrl Z</span>
      </footer>
    </aside>
  );
}

const VIEWS: { key: string; label: string; icon: PIconName }[] = [
  { key: 'board', label: 'Board', icon: 'canvas' },
  { key: 'backlog', label: 'Backlog', icon: 'planning' },
  { key: 'draft', label: 'AI draft', icon: 'sparkle' },
  { key: 'capacity', label: 'Capacity', icon: 'people' },
  { key: 'reports', label: 'Reports', icon: 'insights' },
  { key: 'retro', label: 'Retro', icon: 'request' },
];

export function PlanningTab(props: { pkey: string }): ReactNode {
  const [view, setView] = useState('board');
  const [tasks, setTasks] = useState<PTask[]>(TASKS);
  const [open, setOpen] = useState<number | null>(null);
  const current = tasks.find((t) => t.n === open);
  const done = tasks.filter((t) => t.state === 'Done').reduce((s, t) => s + (t.points ?? 0), 0);
  const scope = tasks.filter((t) => t.state !== 'Backlog').reduce((s, t) => s + (t.points ?? 0), 0);
  const update = (t: PTask): void => {
    setTasks((all) => all.map((x) => (x.n === t.n ? t : x)));
  };
  return (
    <div className={'pv-planning' + (current ? ' pv-planning--drawer' : '')}>
      <div className="pv-stack">
        <Card className="pv-sprint-head">
          <div className="pv-sprint-row">
            <div>
              <div className="pv-sprint-title">
                <select aria-label="Sprint" className="pv-sprint-select" defaultValue="14">
                  <option value="14">{SPRINT.name}</option>
                  <option value="15">Sprint 15 (planned)</option>
                  <option value="13">Sprint 13 (closed)</option>
                </select>
                <span className="pv-muted">
                  {SPRINT.start} – {SPRINT.end} · day {SPRINT.day} of {SPRINT.days}
                </span>
              </div>
              <div className="pv-sprint-goal">
                <PIcon name="flag" size={15} /> Goal: {SPRINT.goal}{' '}
                <Chip tone="success">on track</Chip>
              </div>
            </div>
            <div className="pv-sprint-figures">
              <div>
                <span className="pv-muted pv-small">Done</span>
                <strong className="pv-num">
                  {done} / {scope} pt
                </strong>
              </div>
              <div>
                <span className="pv-muted pv-small">Scope at start</span>
                <strong className="pv-num">
                  {SPRINT.committed} pt <span className="pv-text-warning">+{SPRINT.added}</span>
                </strong>
              </div>
              <div>
                <span className="pv-muted pv-small">Capacity</span>
                <strong className="pv-num">67 pt</strong>
              </div>
              <Button>Complete sprint</Button>
            </div>
          </div>
          <Bar
            value={done}
            max={scope}
            marker={(scope * SPRINT.day) / SPRINT.days}
            tone="success"
          />
        </Card>
        <nav className="pv-subtabs" aria-label="Planning view">
          {VIEWS.map((v) => (
            <button
              key={v.key}
              type="button"
              className="pv-subtab"
              aria-pressed={view === v.key}
              onClick={() => {
                setView(v.key);
              }}
            >
              <PIcon name={v.icon} size={14} />
              {v.label}
              {v.key === 'draft' ? (
                <span className="pv-subtab-count pv-subtab-count--new">5 new</span>
              ) : null}
            </button>
          ))}
        </nav>
        {view === 'board' ? (
          <Board
            tasks={tasks}
            pkey={props.pkey}
            onOpen={setOpen}
            onMove={(n, s) => {
              setTasks((all) => all.map((t) => (t.n === n ? { ...t, state: s } : t)));
            }}
          />
        ) : null}
        {view === 'backlog' ? (
          <Backlog
            tasks={tasks}
            pkey={props.pkey}
            onOpen={setOpen}
            onRank={(n, dir) => {
              setTasks((all) => {
                const i = all.findIndex((t) => t.n === n);
                const j = i + dir;
                const a = all[i];
                const b = all[j];
                if (!a || !b || b.state !== 'Backlog') return all;
                const copy = [...all];
                copy[i] = b;
                copy[j] = a;
                return copy;
              });
            }}
            onToSprint={(n) => {
              setTasks((all) =>
                all.map((t) => (t.n === n ? { ...t, state: 'Todo', added: true } : t)),
              );
            }}
            onAdd={(title) => {
              setTasks((all) => [
                ...all,
                {
                  n: Math.max(...all.map((t) => t.n)) + 1,
                  title,
                  epic: 'E1',
                  state: 'Backlog',
                  assignee: '',
                  points: null,
                  priority: 'medium',
                  type: 'story',
                  ready: false,
                  criteria: [],
                },
              ]);
            }}
          />
        ) : null}
        {view === 'draft' ? <Draft pkey={props.pkey} onAccept={() => undefined} /> : null}
        {view === 'capacity' ? <Capacity /> : null}
        {view === 'reports' ? <Reports /> : null}
        {view === 'retro' ? <Retro /> : null}
      </div>
      {current ? (
        <Detail
          t={current}
          pkey={props.pkey}
          onChange={update}
          onClose={() => {
            setOpen(null);
          }}
          onDelete={() => {
            setTasks((all) => all.filter((t) => t.n !== current.n));
            setOpen(null);
          }}
        />
      ) : null}
    </div>
  );
}
