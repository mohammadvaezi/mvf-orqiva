// ── [PCODE-156 | S15 | v0.1.0] D4 preview: Versions, Security, Code map and Releases ──
//    Why:  the Code map tab: the code as the fingerprints describe it. A treemap shows which feature,
//          sprint and author (person or agent) each part of the code belongs to and how healthy it is; a
//          time-lapse replays the sprints; the API inventory names the task, owner and tests of every
//          endpoint; hotspots show where change and complexity meet; the review queue orders pull requests
//          by risk and shows AI comments in a side-by-side diff with "why does this code exist".
import { useState, type ReactNode } from 'react';
import { APIS, AREAS, DIFF, HOTSPOTS, REVIEW_QUEUE } from './data4.js';
import { person } from './data.js';
import { PIcon, type PIconName } from './picons.js';
import { Avatar, Bar, Button, Card, Chip, Stat } from './ui.js';

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
  i: number;
}

/** Splits the area in two by weight, alternating direction: good enough for a handful of areas. */
export function treemap(
  weights: number[],
  x: number,
  y: number,
  w: number,
  h: number,
  offset = 0,
): Rect[] {
  if (!weights.length) return [];
  if (weights.length === 1) return [{ x, y, w, h, i: offset }];
  const total = weights.reduce((a, b) => a + b, 0);
  let acc = 0;
  let cut = 0;
  while (cut < weights.length - 1 && acc + (weights[cut] ?? 0) <= total / 2)
    acc += weights[cut++] ?? 0;
  if (cut === 0) {
    acc = weights[0] ?? 0;
    cut = 1;
  }
  const share = acc / total;
  const left = weights.slice(0, cut);
  const right = weights.slice(cut);
  return w >= h
    ? [
        ...treemap(left, x, y, w * share, h, offset),
        ...treemap(right, x + w * share, y, w * (1 - share), h, offset + cut),
      ]
    : [
        ...treemap(left, x, y, w, h * share, offset),
        ...treemap(right, x, y + h * share, w, h * (1 - share), offset + cut),
      ];
}

type Colour = 'feature' | 'agent' | 'health' | 'sprint';
const SPRINTS = ['S9', 'S10', 'S11', 'S12', 'S13', 'S14'];

function MapView(): ReactNode {
  const [colour, setColour] = useState<Colour>('feature');
  const [sel, setSel] = useState(0);
  const [lapse, setLapse] = useState(5);
  const sorted = [...AREAS].sort((a, b) => b.loc - a.loc);
  const rects = treemap(
    sorted.map((a) => a.loc),
    0,
    0,
    800,
    360,
  );
  const area = sorted[sel];
  const cls = (i: number): string => {
    const a = sorted[i];
    if (!a) return '';
    const upTo = SPRINTS.indexOf(a.sprint);
    const faded = upTo > lapse ? ' pv-tm--future' : '';
    if (colour === 'feature') return 'pv-tm pv-tm--tone' + String(a.tone) + faded;
    if (colour === 'agent') return 'pv-tm pv-tm--agent' + String(Math.round(a.agent * 4)) + faded;
    if (colour === 'health')
      return (
        'pv-tm pv-tm--health' + (a.health >= 8 ? 'good' : a.health >= 6 ? 'mid' : 'bad') + faded
      );
    return 'pv-tm pv-tm--sprint' + String(Math.max(0, upTo)) + faded;
  };
  return (
    <div className="pv-split">
      <Card
        title="Code by feature (from fingerprints)"
        action={
          <div className="pv-segmented" role="radiogroup" aria-label="Colour by">
            {(
              [
                ['feature', 'Feature'],
                ['agent', 'Agent share'],
                ['health', 'Health'],
                ['sprint', 'Sprint'],
              ] as [Colour, string][]
            ).map(([k, l]) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={colour === k}
                className="pv-seg"
                onClick={() => {
                  setColour(k);
                }}
              >
                {l}
              </button>
            ))}
          </div>
        }
      >
        <svg
          className="pv-treemap"
          viewBox="0 0 800 360"
          role="img"
          aria-label="Treemap of the code"
        >
          {rects.map((r) => {
            const a = sorted[r.i];
            if (!a) return null;
            return (
              <g
                key={a.name}
                className="pv-tm-cell"
                onClick={() => {
                  setSel(r.i);
                }}
              >
                <rect
                  className={cls(r.i) + (sel === r.i ? ' pv-tm--sel' : '')}
                  x={r.x + 2}
                  y={r.y + 2}
                  width={Math.max(0, r.w - 4)}
                  height={Math.max(0, r.h - 4)}
                  rx="6"
                />
                <text className="pv-tm-label" x={r.x + 12} y={r.y + 24}>
                  {a.name}
                </text>
                <text className="pv-tm-sub" x={r.x + 12} y={r.y + 42}>
                  {(a.loc / 1000).toFixed(1) +
                    'k lines · ' +
                    a.sprint +
                    ' · ' +
                    String(Math.round(a.agent * 100)) +
                    ' % by agents'}
                </text>
              </g>
            );
          })}
        </svg>
        <div className="pv-lapse">
          <Button
            size="sm"
            kind="ghost"
            icon="play"
            onClick={() => {
              setLapse((l) => (l >= SPRINTS.length - 1 ? 0 : l + 1));
            }}
          >
            Time-lapse
          </Button>
          <input
            type="range"
            min={0}
            max={SPRINTS.length - 1}
            value={lapse}
            aria-label="Up to sprint"
            onChange={(e) => {
              setLapse(Number(e.target.value));
            }}
          />
          <span className="pv-mono pv-small">up to {SPRINTS[lapse]}</span>
        </div>
      </Card>
      {area ? (
        <Card title={area.name}>
          <div className="pv-kv">
            <span>Size</span>
            <span>{area.loc.toLocaleString('en')} lines</span>
            <span>Last sprint</span>
            <span>{area.sprint}</span>
            <span>Written by agents</span>
            <span>{Math.round(area.agent * 100)} %</span>
            <span>Code health</span>
            <span className={area.health < 6 ? 'pv-text-danger' : ''}>
              {area.health.toFixed(1)} of 10
            </span>
          </div>
          <Bar value={area.agent * 100} max={100} tone="agent" label="agent share" />
          <ul className="pv-files">
            {area.files.map((f) => (
              <li key={f}>
                <PIcon name="ide" size={13} />
                <span className="pv-mono">src/{f}</span>
              </li>
            ))}
          </ul>
          <div className="pv-page-actions">
            <Button size="sm" icon="search">
              Everything NWL-188 touched
            </Button>
            <Button size="sm" kind="ghost" icon="ide">
              Open in VS Code
            </Button>
          </div>
        </Card>
      ) : null}
    </div>
  );
}

function Apis(): ReactNode {
  return (
    <Card
      flush
      title="API inventory · from the code and the fingerprints"
      action={<Chip icon="ide">OpenAPI generated 5 min ago</Chip>}
    >
      <table className="pv-table">
        <thead>
          <tr>
            <th>Endpoint or event</th>
            <th>Created by</th>
            <th>Owner</th>
            <th className="pv-num">Tests</th>
            <th>Access</th>
            <th>Use</th>
          </tr>
        </thead>
        <tbody>
          {APIS.map((a) => (
            <tr key={a.method + a.path}>
              <td>
                <span className={'pv-method pv-method--' + a.method.toLowerCase()}>{a.method}</span>{' '}
                <span className="pv-mono">{a.path}</span>
              </td>
              <td className={a.task.startsWith('—') ? 'pv-text-warning' : 'pv-mono'}>{a.task}</td>
              <td>{a.owner === '?' ? <Chip tone="warning">nobody</Chip> : person(a.owner).name}</td>
              <td className={'pv-num ' + (a.tests ? '' : 'pv-text-danger')}>{a.tests}</td>
              <td>
                {a.auth === 'none' ? <Chip tone="danger">no auth</Chip> : <Chip>{a.auth}</Chip>}
              </td>
              <td className="pv-muted">{a.calls}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function Hotspots(): ReactNode {
  const w = 420;
  const h = 260;
  return (
    <div className="pv-split pv-split--even">
      <Card title="Change × complexity">
        <svg
          className="pv-chart"
          viewBox={'0 0 ' + String(w) + ' ' + String(h)}
          role="img"
          aria-label="Hotspots"
        >
          <line className="pv-gridline" x1="40" x2={w} y1={h - 30} y2={h - 30} />
          <line className="pv-gridline" x1="40" x2="40" y1="0" y2={h - 30} />
          <rect
            className="pv-hot-zone"
            x={40 + (w - 40) / 2}
            y="0"
            width={(w - 40) / 2}
            height={(h - 30) / 2}
          />
          <text className="pv-axis" x={w - 4} y={h - 12} textAnchor="end">
            changes in 90 days →
          </text>
          <text className="pv-axis" x="44" y="12">
            ↑ complexity
          </text>
          {HOTSPOTS.map((s) => {
            const cx = 40 + (s.churn / 40) * (w - 60);
            const cy = h - 30 - (s.complexity / 55) * (h - 50);
            return (
              <g key={s.file}>
                <circle
                  className={'pv-hot-dot' + (s.health < 6 ? ' pv-hot-dot--bad' : '')}
                  cx={cx}
                  cy={cy}
                  r={6 + s.authors * 2}
                />
                <text className="pv-axis pv-axis--strong" x={cx + 10} y={cy + 4}>
                  {s.file.split('/').pop()}
                </text>
              </g>
            );
          })}
        </svg>
      </Card>
      <Card flush title="Hotspots">
        <table className="pv-table">
          <thead>
            <tr>
              <th>File</th>
              <th className="pv-num">Health</th>
              <th>By agents</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {HOTSPOTS.map((s) => (
              <tr key={s.file}>
                <td className="pv-mono pv-small">{s.file}</td>
                <td className={'pv-num ' + (s.health < 6 ? 'pv-text-danger' : '')}>
                  {s.health.toFixed(1)}
                </td>
                <td className="pv-cell-bar">
                  <Bar value={s.agentShare * 100} max={100} tone="agent" />
                </td>
                <td>
                  <Button size="sm" kind="ghost">
                    Plan a refactor
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function Review(): ReactNode {
  const [accepted, setAccepted] = useState<boolean | null>(null);
  return (
    <div className="pv-stack">
      <Card flush title="Review queue · riskiest first">
        <table className="pv-table">
          <tbody>
            {REVIEW_QUEUE.map((r) => (
              <tr key={r.pr} className="pv-click-row">
                <td className="pv-mono pv-cell-ref">#{r.pr}</td>
                <td className="pv-cell-grow">
                  {r.title}
                  <span className="pv-muted pv-block pv-small">
                    {r.risk} · checklist: {r.checklist}
                  </span>
                </td>
                <td>
                  <span className="pv-who">
                    <Avatar id={r.reviewer} size="xs" />
                    {person(r.reviewer).name}
                  </span>
                </td>
                <td className={r.sla === 'over' ? 'pv-text-danger' : 'pv-muted'}>
                  waiting {r.wait}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <div className="pv-split">
        <Card
          title="#318 · src/dispatch/route.ts"
          action={<Chip tone="info">3 of 14 files viewed</Chip>}
        >
          <div className="pv-diff-table" role="table" aria-label="Side-by-side diff">
            {DIFF.map((d) => (
              <div key={d.n} className="pv-diff-row" role="row">
                <span className="pv-diff-n">{d.n}</span>
                <code className={'pv-diff-old' + (d.kind === 'change' ? ' pv-diff-old--del' : '')}>
                  {d.old}
                </code>
                <code className={'pv-diff-new pv-diff-new--' + d.kind}>{d.neu}</code>
              </div>
            ))}
          </div>
          <div className="pv-ai-comment">
            <div className="pv-thread-head">
              <Avatar id="a-reviewer" size="xs" />
              <strong>Reviewer</strong>
              <span className="pv-muted pv-small">on line 86</span>
            </div>
            <p>
              Falling back to the last route hides the timeout from the dispatcher. Suggest showing
              “route not updated, try again” and logging the timeout.
            </p>
            {accepted === null ? (
              <div className="pv-page-actions">
                <Button
                  size="sm"
                  kind="primary"
                  onClick={() => {
                    setAccepted(true);
                  }}
                >
                  Accept and ask Coder to change
                </Button>
                <Button
                  size="sm"
                  kind="ghost"
                  onClick={() => {
                    setAccepted(false);
                  }}
                >
                  Dismiss
                </Button>
              </div>
            ) : (
              <Chip tone={accepted ? 'success' : 'neutral'}>
                {accepted ? 'Accepted · Coder is on it (NWL-188)' : 'Dismissed with a note'}
              </Chip>
            )}
          </div>
        </Card>
        <Card title="Why does this code exist?">
          <div className="pv-kv">
            <span>Fingerprint</span>
            <span className="pv-mono pv-small">[NWL-188 | S14 | v1.4.0]</span>
            <span>Task</span>
            <span>Live re-routing for dispatchers</span>
            <span>Requirement</span>
            <span>R-04 ETA window (PRD v3 of I-11)</span>
            <span>Decision</span>
            <span>ADR-007: one WebSocket, server writes</span>
            <span>Written by</span>
            <span>Coder, reviewed by Lea</span>
            <span>Tests</span>
            <span>C-388, C-391 (flaky)</span>
          </div>
        </Card>
      </div>
    </div>
  );
}

function Hygiene(): ReactNode {
  return (
    <div className="pv-stack">
      <div className="pv-stats">
        <Stat label="Code with a fingerprint" value="95 %" sub="640 lines without" icon="codemap" />
        <Stat
          label="Fingerprints of closed tasks"
          value="12"
          sub="code still there, task cancelled"
          tone="warning"
          icon="flag"
        />
        <Stat
          label="Unused code"
          value="2 files"
          sub="no calls in 60 days"
          tone="warning"
          icon="x"
        />
        <Stat label="Drift" value="3 blocks" sub="edited by another task" icon="git" />
      </div>
      <Card flush title="To clean up">
        <ul className="pv-rows">
          {[
            [
              'src/old/import.ts',
              'No fingerprint, endpoint /import/legacy has no auth and no calls in 60 days',
              'Plan removal',
            ],
            [
              'src/old/table.tsx',
              'Deprecated in the UI kit; still used in 9 places',
              'Plan migration',
            ],
            [
              'src/tours/export.ts:40–88',
              'Fingerprint NWL-77, edited by NWL-191 without a new fingerprint',
              'Fix fingerprint',
            ],
          ].map(([f, s, a]) => (
            <li key={f} className="pv-row pv-row--static">
              <span className="pv-kind pv-kind--request">
                <PIcon name="codemap" size={15} />
              </span>
              <span className="pv-row-main">
                <span className="pv-row-title pv-mono">{f}</span>
                <span className="pv-row-sub">{s}</span>
              </span>
              <Button size="sm">{a}</Button>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

const VIEWS: { key: string; label: string; icon: PIconName }[] = [
  { key: 'map', label: 'Map', icon: 'codemap' },
  { key: 'apis', label: 'APIs', icon: 'external' },
  { key: 'hot', label: 'Hotspots', icon: 'incident' },
  { key: 'review', label: 'Review', icon: 'review' },
  { key: 'hygiene', label: 'Hygiene', icon: 'check' },
];

export function CodeMapTab(): ReactNode {
  const [view, setView] = useState('map');
  return (
    <div className="pv-stack">
      <div className="pv-toolbar">
        <nav className="pv-subtabs" aria-label="Code map view">
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
        <label className="pv-tree-search pv-code-search">
          <PIcon name="search" size={14} />
          <input
            placeholder="sprint:S14 feature:dispatch type:endpoint"
            aria-label="Search the code map"
          />
        </label>
      </div>
      {view === 'map' ? <MapView /> : null}
      {view === 'apis' ? <Apis /> : null}
      {view === 'hot' ? <Hotspots /> : null}
      {view === 'review' ? <Review /> : null}
      {view === 'hygiene' ? <Hygiene /> : null}
    </div>
  );
}
