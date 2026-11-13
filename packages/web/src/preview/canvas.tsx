// ── [PCODE-154 | S15 | v0.1.0] D2 preview: Ideation, Planning and Canvas ──
//    Why:  the Canvas tab: the project-management views of MS Project and its peers on the same tasks as
//          Planning, connected to the code. The Gantt shows dependencies, the critical path, a baseline to
//          compare against, milestones and the commits that really moved each bar; the grid edits the same
//          rows; workload shows who (person or agent) is over-booked and what levelling would move; the
//          calendar, mind map and portfolio answer the remaining "when" and "what" questions.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CALENDAR, EPICS, GANTT, TASKS, TODAY, WORKLOAD, type GRow } from './data2.js';
import { PROJECTS, person } from './data.js';
import { PIcon, type PIconName } from './picons.js';
import { Avatar, Button, Card, Chip } from './ui.js';

const START = new Date(2026, 8, 1);
const dateOf = (d: number): Date =>
  new Date(START.getFullYear(), START.getMonth(), START.getDate() + d);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const short = (d: number): string =>
  String(dateOf(d).getDate()) + ' ' + (MONTHS[dateOf(d).getMonth()] ?? '');
const ROW = 32;
const HEAD = 44;
const SPAN = 64;

function Gantt(props: {
  rows: GRow[];
  zoom: 'day' | 'week';
  critical: boolean;
  baseline: boolean;
  commits: boolean;
  selected: string | null;
  onSelect: (wbs: string) => void;
}): ReactNode {
  const dw = props.zoom === 'day' ? 26 : 12;
  const w = SPAN * dw;
  const h = HEAD + props.rows.length * ROW;
  const x = (d: number): number => d * dw;
  const y = (i: number): number => HEAD + i * ROW;
  const index = new Map(props.rows.map((r, i) => [r.wbs, i]));
  // opens with today in view, a little left of the middle
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (box.current) box.current.scrollLeft = Math.max(0, x(TODAY) - 520);
  }, [props.zoom]);
  return (
    <div className="pv-gantt" ref={box}>
      <div className="pv-gantt-left" role="table" aria-label="Tasks">
        <div className="pv-gantt-left-head" role="row">
          <span role="columnheader">WBS</span>
          <span role="columnheader">Task</span>
          <span role="columnheader">Who</span>
        </div>
        {props.rows.map((r) => (
          <button
            key={r.wbs}
            type="button"
            role="row"
            className={
              'pv-gantt-row' +
              (r.summary ? ' pv-gantt-row--summary' : '') +
              (props.selected === r.wbs ? ' pv-gantt-row--sel' : '')
            }
            onClick={() => {
              props.onSelect(r.wbs);
            }}
          >
            <span role="cell" className="pv-mono pv-muted">
              {r.wbs}
            </span>
            <span role="cell" className={'pv-gantt-name pv-indent-' + String(r.level)}>
              {r.milestone ? <span className="pv-diamond" aria-hidden="true" /> : null}
              {r.name}
            </span>
            <span role="cell">{r.who ? <Avatar id={r.who} size="xs" /> : null}</span>
          </button>
        ))}
      </div>
      <div className="pv-gantt-right">
        <svg width={w} height={h} className="pv-gantt-svg" role="img" aria-label="Schedule">
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
          {Array.from({ length: SPAN }, (_, d) => {
            const day = dateOf(d).getDay();
            const weekend = day === 0 || day === 6;
            return (
              <g key={d}>
                {weekend ? (
                  <rect className="pv-weekend" x={x(d)} y={HEAD} width={dw} height={h - HEAD} />
                ) : null}
                {day === 1 ? (
                  <>
                    <line className="pv-gridline" x1={x(d)} x2={x(d)} y1={18} y2={h} />
                    <text className="pv-axis" x={x(d) + 4} y={14}>
                      {'Week ' + String(Math.floor(d / 7) + 36)}
                    </text>
                    <text className="pv-axis pv-axis--strong" x={x(d) + 4} y={34}>
                      {short(d)}
                    </text>
                  </>
                ) : props.zoom === 'day' && day !== 2 ? (
                  <text
                    className="pv-axis pv-axis--faint"
                    x={x(d) + dw / 2}
                    y={34}
                    textAnchor="middle"
                  >
                    {dateOf(d).getDate()}
                  </text>
                ) : null}
              </g>
            );
          })}
          <line className="pv-gridline" x1="0" x2={w} y1={HEAD} y2={HEAD} />
          {props.rows.map((r, i) =>
            props.selected === r.wbs ? (
              <rect
                key={'sel' + r.wbs}
                className="pv-gantt-sel"
                x="0"
                y={y(i)}
                width={w}
                height={ROW}
              />
            ) : null,
          )}
          {/* dependencies, drawn first so bars sit on top */}
          {props.rows.flatMap((r, i) =>
            (r.deps ?? []).map((dep) => {
              const j = index.get(dep);
              const from = j !== undefined ? props.rows[j] : undefined;
              if (!from || j === undefined) return null;
              const x1 = x(from.start + from.dur);
              const y1 = y(j) + ROW / 2;
              const x2 = x(r.start) - (r.milestone ? 6 : 1);
              const y2 = y(i) + ROW / 2;
              const crit = props.critical && r.critical && from.critical;
              return (
                <path
                  key={dep + '>' + r.wbs}
                  className={'pv-dep' + (crit ? ' pv-dep--crit' : '')}
                  d={'M' + String(x1) + ' ' + String(y1) + ' h6 V' + String(y2) + ' H' + String(x2)}
                  markerEnd={crit ? 'url(#pv-arrow-crit)' : 'url(#pv-arrow)'}
                />
              );
            }),
          )}
          {props.rows.map((r, i) => {
            const cy = y(i) + ROW / 2;
            const crit = props.critical && r.critical;
            return (
              <g
                key={r.wbs}
                className="pv-gantt-item"
                onClick={() => {
                  props.onSelect(r.wbs);
                }}
              >
                <title>
                  {r.name +
                    ': ' +
                    short(r.start) +
                    ' – ' +
                    short(r.start + r.dur) +
                    ', ' +
                    String(r.done) +
                    ' % done'}
                </title>
                {props.baseline && r.baseStart !== undefined && !r.milestone ? (
                  <rect
                    className="pv-baseline"
                    x={x(r.baseStart)}
                    y={cy + 7}
                    width={Math.max(2, x(r.baseDur ?? 0))}
                    height="4"
                    rx="2"
                  />
                ) : null}
                {props.baseline &&
                r.milestone &&
                r.baseStart !== undefined &&
                r.baseStart !== r.start ? (
                  <path
                    className="pv-baseline-ms"
                    d={'M' + String(x(r.baseStart)) + ' ' + String(cy - 5) + ' l5 5 -5 5 -5 -5z'}
                  />
                ) : null}
                {r.milestone ? (
                  <path
                    className={'pv-milestone' + (crit ? ' pv-milestone--crit' : '')}
                    d={'M' + String(x(r.start)) + ' ' + String(cy - 8) + ' l8 8 -8 8 -8 -8z'}
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
                      String(x(r.start + r.dur)) +
                      ' V' +
                      String(cy + 4) +
                      ' l-5 -4 H' +
                      String(x(r.start) + 5) +
                      'z'
                    }
                  />
                ) : (
                  <>
                    <rect
                      className={'pv-task-bar' + (crit ? ' pv-task-bar--crit' : '')}
                      x={x(r.start)}
                      y={cy - 8}
                      width={Math.max(4, x(r.dur))}
                      height="14"
                      rx="4"
                    />
                    <rect
                      className={'pv-task-done' + (crit ? ' pv-task-done--crit' : '')}
                      x={x(r.start)}
                      y={cy - 8}
                      width={Math.max(0, (x(r.dur) * r.done) / 100)}
                      height="14"
                      rx="4"
                    />
                  </>
                )}
                {props.commits
                  ? (r.commits ?? []).map((c) => (
                      <circle key={c} className="pv-commit" cx={x(c) + dw / 2} cy={cy - 12} r="2.6">
                        <title>{'Commit on ' + short(c)}</title>
                      </circle>
                    ))
                  : null}
                {!r.summary ? (
                  <text
                    className="pv-bar-label"
                    x={x(r.start + r.dur) + (r.milestone ? 12 : 6)}
                    y={cy + 4}
                  >
                    {r.milestone ? short(r.start) : String(r.done) + ' %'}
                  </text>
                ) : null}
              </g>
            );
          })}
          <line className="pv-today" x1={x(TODAY)} x2={x(TODAY)} y1={18} y2={h} />
          <text className="pv-today-label" x={x(TODAY) + 4} y={h - 6}>
            today
          </text>
        </svg>
      </div>
    </div>
  );
}

function Grid(props: { rows: GRow[]; onChange: (r: GRow) => void }): ReactNode {
  return (
    <Card flush>
      <div className="pv-grid-scroll">
        <table className="pv-table pv-sheet">
          <thead>
            <tr>
              <th>WBS</th>
              <th>Task</th>
              <th>Start</th>
              <th>Finish</th>
              <th className="pv-num">Duration</th>
              <th>Predecessors</th>
              <th>Resource</th>
              <th className="pv-num">% done</th>
              <th className="pv-num">Variance</th>
            </tr>
          </thead>
          <tbody>
            {props.rows.map((r) => {
              const variance =
                r.baseStart !== undefined ? r.start + r.dur - (r.baseStart + (r.baseDur ?? 0)) : 0;
              return (
                <tr key={r.wbs} className={r.summary ? 'pv-sheet-summary' : ''}>
                  <td className="pv-mono pv-muted">{r.wbs}</td>
                  <td className={'pv-indent-' + String(r.level)}>
                    <input
                      className="pv-cell-input"
                      value={r.name}
                      aria-label={'Name of ' + r.wbs}
                      onChange={(e) => {
                        props.onChange({ ...r, name: e.target.value });
                      }}
                    />
                  </td>
                  <td className="pv-num">{short(r.start)}</td>
                  <td className="pv-num">{short(r.start + r.dur)}</td>
                  <td className="pv-num">
                    {r.summary || r.milestone ? (
                      String(r.dur) + ' d'
                    ) : (
                      <input
                        className="pv-cell-input pv-cell-input--num"
                        type="number"
                        min={1}
                        value={r.dur}
                        aria-label={'Duration of ' + r.wbs}
                        onChange={(e) => {
                          props.onChange({ ...r, dur: Math.max(1, Number(e.target.value)) });
                        }}
                      />
                    )}
                  </td>
                  <td className="pv-mono">{(r.deps ?? []).map((d) => d + ' FS').join(', ')}</td>
                  <td>{r.who ? person(r.who).name : ''}</td>
                  <td className="pv-num">
                    {r.summary ? (
                      String(r.done) + ' %'
                    ) : (
                      <input
                        className="pv-cell-input pv-cell-input--num"
                        type="number"
                        min={0}
                        max={100}
                        step={5}
                        value={r.done}
                        aria-label={'Percent done of ' + r.wbs}
                        onChange={(e) => {
                          props.onChange({
                            ...r,
                            done: Math.min(100, Math.max(0, Number(e.target.value))),
                          });
                        }}
                      />
                    )}
                  </td>
                  <td className={'pv-num ' + (variance > 0 ? 'pv-text-danger' : 'pv-muted')}>
                    {variance > 0 ? '+' + String(variance) + ' d' : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="pv-muted pv-small pv-pad">
        Edit a duration or % done: the Gantt follows. Paste rows from Excel, fill down with Ctrl D,
        indent with Tab.
      </p>
    </Card>
  );
}

function Workload(): ReactNode {
  const [levelled, setLevelled] = useState(false);
  const weeks = Array.from({ length: 8 }, (_, i) => short(i * 7));
  const value = (who: string, v: number, i: number): number =>
    levelled && v > 100
      ? who === 'lea' && i === 4
        ? 95
        : who === 'tim' && i === 5
          ? 100
          : 100
      : v;
  return (
    <div className="pv-stack">
      <Card
        flush
        title="Workload per week (% of capacity)"
        action={
          levelled ? (
            <span className="pv-page-actions">
              <Chip tone="success" icon="check">
                Preview: 4 tasks move, pilot date unchanged
              </Chip>
              <Button size="sm" kind="primary">
                Apply levelling
              </Button>
              <Button
                size="sm"
                kind="ghost"
                onClick={() => {
                  setLevelled(false);
                }}
              >
                Discard
              </Button>
            </span>
          ) : (
            <Button
              size="sm"
              kind="primary"
              icon="sparkle"
              onClick={() => {
                setLevelled(true);
              }}
            >
              Level resources
            </Button>
          )
        }
      >
        <table className="pv-table pv-heat">
          <thead>
            <tr>
              <th>Who</th>
              {weeks.map((wk) => (
                <th key={wk} className="pv-num">
                  {wk}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {WORKLOAD.map((r) => (
              <tr key={r.who}>
                <td>
                  <span className="pv-who">
                    <Avatar id={r.who} size="xs" />
                    {person(r.who).name}
                  </span>
                </td>
                {r.weeks.map((v0, i) => {
                  const v = value(r.who, v0, i);
                  return (
                    <td
                      key={i}
                      className={
                        'pv-heat-cell pv-heat-' +
                        (v > 100 ? 'over' : v >= 80 ? 'full' : v >= 50 ? 'mid' : 'low')
                      }
                    >
                      {v}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      {levelled ? (
        <Card title="What levelling would change">
          <ul className="pv-changes">
            <li>
              NWL-190 ETA recalculation moves from Tim to the Coder agent (estimated {'€'}24), weeks
              5–6.
            </li>
            <li>3.2 CSV export at scale starts 2 days later, inside its float.</li>
            <li>4.1 Load test moves 1 day; still before G3.</li>
            <li>No change to the critical path or the pilot on 30 Oct.</li>
          </ul>
        </Card>
      ) : null}
    </div>
  );
}

function Calendar(): ReactNode {
  // October 2026 starts on a Thursday
  const lead = 3;
  const cells = Array.from({ length: 35 }, (_, i) => i - lead + 1);
  return (
    <Card
      flush
      title="October 2026"
      action={
        <Button size="sm" kind="ghost" icon="external">
          Subscribe (iCal)
        </Button>
      }
    >
      <div className="pv-cal">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
          <div key={d} className="pv-cal-head">
            {d}
          </div>
        ))}
        {cells.map((d, i) => (
          <div
            key={i}
            className={
              'pv-cal-cell' +
              (d < 1 || d > 31 ? ' pv-cal-cell--out' : '') +
              (d === 4 ? ' pv-cal-cell--today' : '') +
              (i % 7 >= 5 ? ' pv-cal-cell--weekend' : '')
            }
          >
            {d >= 1 && d <= 31 ? <span className="pv-cal-day">{d}</span> : null}
            {CALENDAR.filter((c) => c.day === d).map((c) => (
              <span key={c.text} className={'pv-cal-item pv-cal-item--' + c.kind}>
                {c.text}
              </span>
            ))}
          </div>
        ))}
      </div>
    </Card>
  );
}

function MindMap(): ReactNode {
  const [picked, setPicked] = useState<string[]>([]);
  const ideas = ['Night delivery mode', 'Driver chat', 'Fuel price alerts'];
  const groups = EPICS.map((e) => ({
    e,
    items: TASKS.filter((t) => t.epic === e.key)
      .slice(0, 4)
      .map((t) => t.title),
  }));
  const rows: { label: string; kind: 'epic' | 'task' | 'idea'; group: number }[] = [];
  groups.forEach((g, gi) => {
    for (const it of g.items) rows.push({ label: it, kind: 'task', group: gi });
  });
  for (const i of ideas) rows.push({ label: i, kind: 'idea', group: groups.length });
  const h = rows.length * 30 + 20;
  const yOf = (i: number): number => 20 + i * 30;
  const groupY = (gi: number): number => {
    const ys = rows
      .map((r, i) => (r.group === gi ? yOf(i) : null))
      .filter((v): v is number => v !== null);
    return ys.length ? (Math.min(...ys) + Math.max(...ys)) / 2 : 0;
  };
  const rootY = h / 2;
  return (
    <Card
      title="Mind map"
      action={
        <span className="pv-page-actions">
          <span className="pv-muted pv-small">
            Dashed nodes are ideas, not tasks yet. Pick some and convert.
          </span>
          <Button size="sm" kind="primary" icon="plus">
            {'Convert ' + String(picked.length) + ' to tasks'}
          </Button>
        </span>
      }
    >
      <svg
        className="pv-mind"
        viewBox={'0 0 900 ' + String(h)}
        role="img"
        aria-label="Mind map of the project"
      >
        {[
          ...groups.map((g, gi) => ({ label: g.e.name, y: groupY(gi), gi })),
          { label: 'New ideas', y: groupY(groups.length), gi: groups.length },
        ].map((g) => (
          <g key={g.label}>
            <path
              className="pv-mind-link"
              d={
                'M150 ' +
                String(rootY) +
                ' C 220 ' +
                String(rootY) +
                ', 220 ' +
                String(g.y) +
                ', 290 ' +
                String(g.y)
              }
            />
            {rows.map((r, i) =>
              r.group === g.gi ? (
                <path
                  key={r.label}
                  className="pv-mind-link"
                  d={
                    'M450 ' +
                    String(g.y) +
                    ' C 500 ' +
                    String(g.y) +
                    ', 500 ' +
                    String(yOf(i)) +
                    ', 560 ' +
                    String(yOf(i))
                  }
                />
              ) : null,
            )}
            <rect className="pv-mind-epic" x="290" y={g.y - 14} width="160" height="28" rx="14" />
            <text
              className="pv-mind-text pv-mind-text--epic"
              x="370"
              y={g.y + 4}
              textAnchor="middle"
            >
              {g.label}
            </text>
          </g>
        ))}
        <rect className="pv-mind-root" x="20" y={rootY - 18} width="130" height="36" rx="18" />
        <text className="pv-mind-text pv-mind-text--root" x="85" y={rootY + 5} textAnchor="middle">
          Fleet portal
        </text>
        {rows.map((r, i) => (
          <g
            key={r.label}
            className="pv-mind-node"
            onClick={() => {
              if (r.kind === 'idea')
                setPicked((p) =>
                  p.includes(r.label) ? p.filter((x) => x !== r.label) : [...p, r.label],
                );
            }}
          >
            <rect
              className={'pv-mind-' + r.kind + (picked.includes(r.label) ? ' pv-mind-picked' : '')}
              x="560"
              y={yOf(i) - 12}
              width="320"
              height="24"
              rx="6"
            />
            <text className="pv-mind-text" x="572" y={yOf(i) + 4}>
              {r.label}
            </text>
          </g>
        ))}
      </svg>
    </Card>
  );
}

function Portfolio(): ReactNode {
  const lanes: { key: string; spans: [string, number, number][]; ms: [string, number][] }[] = [
    {
      key: 'NWL',
      spans: [
        ['Ideation', 0, 12],
        ['Build', 12, 30],
        ['Test', 42, 10],
        ['Release', 52, 8],
      ],
      ms: [['Pilot', 59]],
    },
    {
      key: 'HEL',
      spans: [
        ['Build', 0, 20],
        ['Test', 20, 26],
        ['Release', 46, 6],
      ],
      ms: [['Store', 46]],
    },
    {
      key: 'AUR',
      spans: [
        ['Planning', 30, 8],
        ['Build', 38, 26],
      ],
      ms: [['Sandbox', 74 - 10]],
    },
    {
      key: 'NWD',
      spans: [
        ['Build', 0, 18],
        ['Release', 18, 16],
      ],
      ms: [['Stores', 32]],
    },
    { key: 'PE', spans: [['Design D1–D7', 33, 31]], ms: [['Gate A1', 63]] },
  ];
  const dw = 12;
  const w = SPAN * dw + 120;
  return (
    <Card
      title="All projects"
      action={
        <span className="pv-muted pv-small">
          Phases and milestones · drag to shift a project (asks for confirmation)
        </span>
      }
    >
      <svg
        className="pv-portfolio"
        viewBox={'0 0 ' + String(w) + ' ' + String(lanes.length * 44 + 30)}
        role="img"
        aria-label="Portfolio timeline"
      >
        {Array.from({ length: SPAN }, (_, d) =>
          dateOf(d).getDay() === 1 ? (
            <g key={d}>
              <line
                className="pv-gridline"
                x1={120 + d * dw}
                x2={120 + d * dw}
                y1="0"
                y2={lanes.length * 44 + 30}
              />
              <text className="pv-axis" x={124 + d * dw} y="12">
                {short(d)}
              </text>
            </g>
          ) : null,
        )}
        {lanes.map((l, i) => {
          const p = PROJECTS.find((x) => x.key === l.key);
          const y = 24 + i * 44;
          return (
            <g key={l.key}>
              <text className="pv-mind-text pv-mind-text--epic" x="8" y={y + 18}>
                {l.key + ' ' + (p?.name ?? '')}
              </text>
              {l.spans.map(([n, s, d]) => (
                <g key={n}>
                  <rect
                    className={
                      'pv-phase-bar pv-phase-bar--' + (n.split(' ')[0] ?? '').toLowerCase()
                    }
                    x={120 + s * dw}
                    y={y + 4}
                    width={d * dw}
                    height="22"
                    rx="5"
                  />
                  <text className="pv-phase-text" x={124 + s * dw} y={y + 19}>
                    {n}
                  </text>
                </g>
              ))}
              {l.ms.map(([n, d]) => (
                <g key={n}>
                  <path
                    className="pv-milestone"
                    d={'M' + String(120 + d * dw) + ' ' + String(y + 7) + ' l8 8 -8 8 -8 -8z'}
                  />
                  <text className="pv-bar-label" x={130 + d * dw} y={y + 19}>
                    {n}
                  </text>
                </g>
              ))}
            </g>
          );
        })}
        <line
          className="pv-today"
          x1={120 + TODAY * dw}
          x2={120 + TODAY * dw}
          y1="16"
          y2={lanes.length * 44 + 30}
        />
      </svg>
    </Card>
  );
}

const VIEWS: { key: string; label: string; icon: PIconName }[] = [
  { key: 'gantt', label: 'Gantt', icon: 'canvas' },
  { key: 'grid', label: 'Grid', icon: 'overview' },
  { key: 'workload', label: 'Workload', icon: 'people' },
  { key: 'calendar', label: 'Calendar', icon: 'planning' },
  { key: 'mind', label: 'Mind map', icon: 'ideation' },
  { key: 'portfolio', label: 'Portfolio', icon: 'projects' },
];

/** Recomputes starts so each task begins after its predecessors (finish-to-start), and summary spans. */
export function schedule(rows: GRow[]): GRow[] {
  const out = rows.map((r) => ({ ...r }));
  const by = new Map(out.map((r) => [r.wbs, r]));
  for (const r of out) {
    if (r.summary) continue;
    const after = Math.max(
      -1,
      ...(r.deps ?? []).map((d) => {
        const p = by.get(d);
        return p ? p.start + p.dur : -1;
      }),
    );
    if (after > r.start) r.start = after;
  }
  for (const s of out.filter((r) => r.summary)) {
    const kids = out.filter((r) => !r.summary && r.wbs.startsWith(s.wbs + '.'));
    if (!kids.length) continue;
    s.start = Math.min(...kids.map((k) => k.start));
    s.dur = Math.max(...kids.map((k) => k.start + k.dur)) - s.start;
    s.done = Math.round(
      kids.reduce((a, k) => a + k.done * Math.max(1, k.dur), 0) /
        kids.reduce((a, k) => a + Math.max(1, k.dur), 0),
    );
  }
  return out;
}

export function CanvasTab(): ReactNode {
  const [view, setView] = useState('gantt');
  const [rows, setRows] = useState<GRow[]>(GANTT);
  const [zoom, setZoom] = useState<'day' | 'week'>('day');
  const [critical, setCritical] = useState(true);
  const [baseline, setBaseline] = useState(true);
  const [commits, setCommits] = useState(true);
  const [selected, setSelected] = useState<string | null>('2.2');
  const sel = rows.find((r) => r.wbs === selected);
  const update = (r: GRow): void => {
    setRows((all) => schedule(all.map((x) => (x.wbs === r.wbs ? r : x))));
  };
  return (
    <div className="pv-stack">
      <div className="pv-toolbar">
        <nav className="pv-subtabs pv-subtabs--inline" aria-label="Canvas view">
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
            </button>
          ))}
        </nav>
        <span className="pv-spacer" />
        {view === 'gantt' ? (
          <>
            <div className="pv-segmented" role="radiogroup" aria-label="Zoom">
              <button
                type="button"
                role="radio"
                aria-checked={zoom === 'day'}
                className="pv-seg"
                onClick={() => {
                  setZoom('day');
                }}
              >
                Days
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={zoom === 'week'}
                className="pv-seg"
                onClick={() => {
                  setZoom('week');
                }}
              >
                Weeks
              </button>
            </div>
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
            <label className="pv-switch">
              <input
                type="checkbox"
                checked={baseline}
                onChange={(e) => {
                  setBaseline(e.target.checked);
                }}
              />
              <span>Baseline 1 (29 Sep)</span>
            </label>
            <label className="pv-switch">
              <input
                type="checkbox"
                checked={commits}
                onChange={(e) => {
                  setCommits(e.target.checked);
                }}
              />
              <span>Commits</span>
            </label>
          </>
        ) : null}
        <select className="pv-select" aria-label="Scenario" defaultValue="live">
          <option value="live">Live plan</option>
          <option value="a">Scenario: pilot one week earlier</option>
          <option value="b">Scenario: without Tim in week 6</option>
        </select>
        <Button size="sm" icon="external">
          Export
        </Button>
      </div>
      {view === 'gantt' ? (
        <>
          <Card flush>
            <Gantt
              rows={rows}
              zoom={zoom}
              critical={critical}
              baseline={baseline}
              commits={commits}
              selected={selected}
              onSelect={setSelected}
            />
          </Card>
          <div className="pv-gantt-legend">
            <span>
              <span className="pv-key pv-key--bar" /> Task, filled part done
            </span>
            <span>
              <span className="pv-key pv-key--crit" /> Critical path
            </span>
            <span>
              <span className="pv-key pv-key--base" /> Baseline
            </span>
            <span>
              <span className="pv-key pv-key--commit" /> Commit (from fingerprints)
            </span>
            <span>
              <span className="pv-key pv-key--ms" /> Milestone
            </span>
          </div>
          {sel ? (
            <Card title={sel.wbs + ' ' + sel.name}>
              <div className="pv-kv pv-kv--wide">
                <span>Dates</span>
                <span>
                  {short(sel.start)} – {short(sel.start + sel.dur)} · {sel.dur} working days
                </span>
                <span>Baseline</span>
                <span>
                  {sel.baseStart !== undefined
                    ? short(sel.baseStart) + ' – ' + short(sel.baseStart + (sel.baseDur ?? 0))
                    : '—'}
                  {sel.baseStart !== undefined &&
                  sel.start + sel.dur > sel.baseStart + (sel.baseDur ?? 0) ? (
                    <span className="pv-text-danger">
                      {' '}
                      · {sel.start + sel.dur - sel.baseStart - (sel.baseDur ?? 0)} days late
                    </span>
                  ) : null}
                </span>
                <span>Float</span>
                <span>{sel.critical ? '0 days (critical)' : '4 days'}</span>
                <span>Code</span>
                <span>
                  {(sel.commits ?? []).length} commits · last{' '}
                  {sel.commits?.length ? short(sel.commits[sel.commits.length - 1] ?? 0) : '—'} ·
                  open in code map
                </span>
                <span>Depends on</span>
                <span>{(sel.deps ?? []).join(', ') || '—'}</span>
              </div>
            </Card>
          ) : null}
        </>
      ) : null}
      {view === 'grid' ? <Grid rows={rows} onChange={update} /> : null}
      {view === 'workload' ? <Workload /> : null}
      {view === 'calendar' ? <Calendar /> : null}
      {view === 'mind' ? <MindMap /> : null}
      {view === 'portfolio' ? <Portfolio /> : null}
    </div>
  );
}
