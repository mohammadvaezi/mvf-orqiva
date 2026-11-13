// ── [PCODE-440 | S15 | v0.1.0] T37 Consistency: errors and loading are announced everywhere ──
// ── [PCODE-309 | S15 | v0.1.0] T31.8b Architecture graph, change coupling and bus factor on the code map ──
// ── [PCODE-308 | S15 | v0.1.0] T31.8a Code map by feature, sprint and version, and its time-lapse ──
// ── [PCODE-179 | S15 | v0.1.0] B4.5 Security and Code map live in the web app: posture, findings by risk, SBOM, policies, campaigns, treemap, hotspots, APIs, hygiene ──
//    Why:  the Code map tab of the approved design on the server's code scan. The treemap shows the
//          folders by size, coloured by health, agent share or how hot they are, and opens a folder's files
//          with their owner and the tasks behind them; hotspots are where change meets complexity, and one
//          click plans the refactor; the API inventory says which endpoints need no login and which task
//          made each; hygiene lists code without fingerprints and fingerprints of cancelled tasks.
// ── [PCODE-194 | S15 | v0.1.0] B8.2 VS Code: agents view and runs, findings as problems, code-map lens, test results per criterion ──
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api } from '../core/api.js';
import { treemap } from '../preview/codemap.js';
import { ByWork, OverTime } from './codework.js'; // [PCODE-308 | S15 | v0.1.0]
import { Architecture, Knowledge } from './codearch.js'; // [PCODE-309 | S15 | v0.1.0]
import { PIcon, type PIconName } from '../preview/picons.js';
import { Bar, Button, Card, Chip, Stat } from '../preview/ui.js';
import { ago } from './inbox.js';

const W = (ws: string, p: string): string => '/api/workspaces/' + ws + p;

interface Folder {
  path: string;
  files: number;
  lines: number;
  health: number;
  hotspot: number;
  agentShare: number;
}
export interface CodeFile {
  path: string;
  language: string;
  lines: number;
  complexity: number;
  churn: number;
  health: number;
  hotspot: number;
  agentShare: number;
  owner: string | null;
  tasks: string[];
}
interface CodeMap {
  totals: {
    files: number;
    lines: number;
    health: number;
    agentShare: number;
    fingerprinted: number;
    scannedAt: string | null;
  };
  folders: Folder[];
  hotspots: CodeFile[];
  owners: { author: string; lines: number; share: number }[];
}

type Colour = 'health' | 'agent' | 'hot';

/** The treemap class of a folder under a colouring. */
export function cellClass(
  f: Pick<Folder, 'health' | 'agentShare' | 'hotspot'>,
  colour: Colour,
): string {
  if (colour === 'agent') return 'pv-tm pv-tm--agent' + String(Math.round(f.agentShare * 4));
  if (colour === 'hot')
    return 'pv-tm pv-tm--health' + (f.hotspot >= 60 ? 'bad' : f.hotspot >= 25 ? 'mid' : 'good');
  return 'pv-tm pv-tm--health' + (f.health >= 8 ? 'good' : f.health >= 6 ? 'mid' : 'bad');
}

/** German number with one decimal: 7,5. */
const one = (n: number): string => (Math.round(n * 10) / 10).toFixed(1).replace('.', ',');
const pct = (n: number): string => String(Math.round(n * 100)) + ' %';
const kLines = (n: number): string => (n >= 1000 ? one(n / 1000) + 'k' : String(n)) + ' lines';

type View = 'map' | 'work' | 'time' | 'arch' | 'people' | 'hot' | 'apis' | 'hygiene'; // [PCODE-308 | S15 | v0.1.0] work, time [PCODE-309 | S15 | v0.1.0] arch, people

export function CodeMapPage(props: {
  workspaceId: string;
  projectId: string;
  canEdit: boolean;
  go: (p: string) => void;
}): ReactNode {
  const [view, setView] = useState<View>('map');
  const views: { key: View; label: string; icon: PIconName }[] = [
    { key: 'map', label: 'Map', icon: 'codemap' },
    // [PCODE-308 | S15 | v0.1.0] the code by feature, sprint and version, and over time
    { key: 'work', label: 'By work', icon: 'planning' },
    { key: 'time', label: 'Over time', icon: 'activity' },
    // [PCODE-309 | S15 | v0.1.0] the import graph with coupling, and who knows what
    { key: 'arch', label: 'Architecture', icon: 'codemap' },
    { key: 'people', label: 'Knowledge', icon: 'people' },
    { key: 'hot', label: 'Hotspots', icon: 'incident' },
    { key: 'apis', label: 'APIs', icon: 'external' },
    { key: 'hygiene', label: 'Hygiene', icon: 'check' },
  ];
  const base = {
    workspaceId: props.workspaceId,
    projectId: props.projectId,
    canEdit: props.canEdit,
    go: props.go,
  };
  return (
    <div className="pv-stack">
      <nav className="pv-subtabs" aria-label="Code map view">
        {views.map((v) => (
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
      {view === 'map' ? <MapView {...base} /> : null}
      {view === 'work' ? <ByWork {...base} /> : null}
      {view === 'time' ? <OverTime {...base} /> : null}
      {view === 'arch' ? <Architecture {...base} /> : null}
      {view === 'people' ? <Knowledge {...base} /> : null}
      {view === 'hot' ? <Hotspots {...base} /> : null}
      {view === 'apis' ? <Apis {...base} /> : null}
      {view === 'hygiene' ? <Hygiene {...base} /> : null}
    </div>
  );
}

function useCodeMap(
  workspaceId: string,
  projectId: string,
  depth: number,
): { map: CodeMap | null; error: string | null } {
  const [map, setMap] = useState<CodeMap | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void api<CodeMap>(
      'GET',
      W(workspaceId, '/projects/' + projectId + '/code-map?depth=' + String(depth)),
    ).then((r) => {
      if (r.ok) setMap(r.data);
      else setError(r.error.message);
    });
  }, [workspaceId, projectId, depth]);
  return { map, error };
}

const NO_SCAN = (
  <Card>
    <p className="pv-empty">
      No code scan yet. A scan sends every file with its size, complexity, churn and authors to the
      project’s code-scan API.
    </p>
  </Card>
);

// [PCODE-194 | S15 | v0.1.0] ?file=a/b/c.ts (the VS Code lens) opens on that file's folder
export function folderOf(file: string, depth: number): string {
  const dirs = file.split('/').slice(0, -1);
  return dirs.length ? dirs.slice(0, depth).join('/') : '(root)';
}
const fileInQuery = (): string | null => new URLSearchParams(window.location.search).get('file');

function MapView(props: {
  workspaceId: string;
  projectId: string;
  go: (p: string) => void;
}): ReactNode {
  const [depth, setDepth] = useState(2);
  const [colour, setColour] = useState<Colour>('health');
  const [sel, setSel] = useState<string | null>(() => {
    const f = fileInQuery();
    return f ? folderOf(f, 2) : null;
  });
  const [files, setFiles] = useState<CodeFile[]>([]);
  const { map, error } = useCodeMap(props.workspaceId, props.projectId, depth);
  const folders = map?.folders ?? [];
  const current = folders.find((f) => f.path === sel) ?? folders[0];
  useEffect(() => {
    if (!current) return;
    void api<CodeFile[]>(
      'GET',
      W(
        props.workspaceId,
        '/projects/' +
          props.projectId +
          '/code-map/files?prefix=' +
          encodeURIComponent(current.path === '(root)' ? '' : current.path),
      ),
    ).then((r) => {
      if (r.ok)
        setFiles(current.path === '(root)' ? r.data.filter((f) => !f.path.includes('/')) : r.data);
    });
  }, [current, props.workspaceId, props.projectId]);
  if (!map) return <p className="pv-muted">{error ?? 'Loading the code map…'}</p>;
  if (!map.totals.files) return NO_SCAN;
  const rects = treemap(
    folders.map((f) => Math.max(1, f.lines)),
    0,
    0,
    800,
    360,
  );
  const t = map.totals;
  return (
    <div className="pv-stack">
      <div className="pv-stats">
        <Stat
          label="Code"
          value={kLines(t.lines)}
          sub={
            String(t.files) +
            ' files' +
            (t.scannedAt ? ' · scanned ' + ago(t.scannedAt) + ' ago' : '')
          }
          icon="codemap"
        />
        <Stat
          label="Code health"
          value={one(t.health) + ' of 10'}
          tone={t.health < 6 ? 'danger' : t.health < 8 ? 'warning' : 'success'}
          icon="check"
        />
        <Stat label="Written by agents" value={pct(t.agentShare)} icon="agents" />
        <Stat
          label="Files with a fingerprint"
          value={pct(t.fingerprinted)}
          tone={t.fingerprinted < 0.8 ? 'warning' : undefined}
          icon="flag"
        />
      </div>
      <div className="pv-split">
        <Card
          title="Code by folder"
          action={
            <span className="pv-page-actions">
              <select
                className="v2-input v2-input--sm"
                aria-label="Folder depth"
                value={String(depth)}
                onChange={(e) => {
                  setDepth(Number(e.target.value));
                  setSel(null);
                }}
              >
                {[1, 2, 3, 4].map((d) => (
                  <option key={d} value={String(d)}>
                    {d} level{d === 1 ? '' : 's'}
                  </option>
                ))}
              </select>
              <span className="pv-segmented" role="radiogroup" aria-label="Colour by">
                {(
                  [
                    ['health', 'Health'],
                    ['agent', 'Agent share'],
                    ['hot', 'Hotspots'],
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
              </span>
            </span>
          }
        >
          <svg
            className="pv-treemap"
            viewBox="0 0 800 360"
            role="img"
            aria-label="Treemap of the code by folder"
          >
            {rects.map((r) => {
              const f = folders[r.i];
              if (!f) return null;
              const big = r.w > 240 && r.h > 50;
              return (
                <g
                  key={f.path}
                  className="pv-tm-cell"
                  onClick={() => {
                    setSel(f.path);
                  }}
                >
                  <title>{f.path + ' · ' + kLines(f.lines) + ' · health ' + one(f.health)}</title>
                  <rect
                    className={
                      cellClass(f, colour) + (current?.path === f.path ? ' pv-tm--sel' : '')
                    }
                    x={r.x + 2}
                    y={r.y + 2}
                    width={Math.max(0, r.w - 4)}
                    height={Math.max(0, r.h - 4)}
                    rx="6"
                  />
                  {r.w > 60 && r.h > 28 ? (
                    <text className="pv-tm-label" x={r.x + 12} y={r.y + 24}>
                      {f.path.split('/').pop()}
                    </text>
                  ) : null}
                  {big ? (
                    <text className="pv-tm-sub" x={r.x + 12} y={r.y + 42}>
                      {kLines(f.lines) +
                        ' · health ' +
                        one(f.health) +
                        ' · ' +
                        pct(f.agentShare) +
                        ' agents'}
                    </text>
                  ) : null}
                </g>
              );
            })}
          </svg>
        </Card>
        {current ? (
          <Card title={current.path}>
            <div className="pv-kv">
              <span>Size</span>
              <span>
                {kLines(current.lines)} in {current.files} files
              </span>
              <span>Code health</span>
              <span className={current.health < 6 ? 'pv-text-danger' : ''}>
                {one(current.health)} of 10
              </span>
              <span>Hottest file</span>
              <span>{current.hotspot} of 100</span>
            </div>
            <Bar
              value={current.agentShare * 100}
              max={100}
              tone="agent"
              label={pct(current.agentShare) + ' by agents'}
            />
            <ul className="pv-files">
              {files.slice(0, 40).map((f) => (
                <li key={f.path}>
                  <PIcon name="ide" size={13} />
                  <span className="pv-mono pv-small">{f.path}</span>
                  <span className={'pv-small ' + (f.health < 6 ? 'pv-text-danger' : 'pv-muted')}>
                    {one(f.health)}
                  </span>
                  {f.tasks.length ? (
                    <span className="pv-muted pv-small pv-mono">
                      {f.tasks.slice(0, 3).join(' ')}
                    </span>
                  ) : (
                    <Chip tone="warning">no fingerprint</Chip>
                  )}
                </li>
              ))}
            </ul>
            {map.owners.length ? (
              <>
                <h3 className="v2-h3">Who wrote the code</h3>
                <ul className="pv-share">
                  {map.owners.slice(0, 6).map((o) => (
                    <li key={o.author} className="pv-share-row pv-share-row--wide">
                      <span className="pv-share-label">{o.author}</span>
                      <Bar
                        value={o.share * 100}
                        max={100}
                        tone={/agent/i.test(o.author) ? 'agent' : 'primary'}
                      />
                      <span className="pv-share-value pv-small">{pct(o.share)}</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </Card>
        ) : null}
      </div>
    </div>
  );
}

function Hotspots(props: {
  workspaceId: string;
  projectId: string;
  canEdit: boolean;
  go: (p: string) => void;
}): ReactNode {
  const { map, error } = useCodeMap(props.workspaceId, props.projectId, 2);
  const [planned, setPlanned] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  if (!map) return <p className="pv-muted">{error ?? 'Loading…'}</p>;
  if (!map.totals.files) return NO_SCAN;
  const top = map.hotspots.filter((f) => f.hotspot > 0).slice(0, 15);
  const w = 900;
  const h = 260;
  const maxChurn = Math.max(1, ...top.map((f) => f.churn));
  const maxCx = Math.max(1, ...top.map((f) => f.complexity));
  const plan = async (f: CodeFile): Promise<void> => {
    const r = await api<{ id: string; ref: string }>(
      'POST',
      W(props.workspaceId, '/projects/' + props.projectId + '/items'),
      {
        title: ('Refactor ' + f.path).slice(0, 255),
        description:
          'A hotspot of the code map: changed ' +
          String(f.churn) +
          ' times in 90 days, complexity ' +
          String(f.complexity) +
          ', health ' +
          one(f.health) +
          ' of 10.' +
          (f.tasks.length ? '\n\nTasks behind it: ' + f.tasks.join(', ') : ''),
      },
    );
    if (r.ok) setPlanned({ ...planned, [f.path]: r.data.ref });
    else setErr(r.error.message);
  };
  return (
    <div className="pv-stack">
      <Card title="Change × complexity">
        {top.length ? (
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
            {top.map((f) => {
              const cx = 40 + (f.churn / maxChurn) * (w - 70);
              const cy = h - 30 - (f.complexity / maxCx) * (h - 50);
              return (
                <g key={f.path}>
                  <title>{f.path}</title>
                  <circle
                    className={'pv-hot-dot' + (f.health < 6 ? ' pv-hot-dot--bad' : '')}
                    cx={cx}
                    cy={cy}
                    r={5 + Math.min(8, f.lines / 200)}
                  />
                  <text
                    className="pv-axis pv-axis--strong"
                    x={cx > w * 0.7 ? cx - 12 : cx + 10}
                    y={cy + 4}
                    textAnchor={cx > w * 0.7 ? 'end' : 'start'}
                  >
                    {f.path.split('/').pop()}
                  </text>
                </g>
              );
            })}
          </svg>
        ) : (
          <p className="pv-muted">No file changed often enough to be a hotspot.</p>
        )}
      </Card>
      <Card flush title="Hotspots">
        {err ? (
          <p className="v2-error v2-pad" role="alert">
            {err}
          </p>
        ) : null}
        <div className="pv-grid-scroll">
          <table className="pv-table">
            <thead>
              <tr>
                <th>File</th>
                <th className="pv-num">Hot</th>
                <th className="pv-num">Health</th>
                <th>Owner</th>
                <th>By agents</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {top.map((f) => (
                <tr key={f.path}>
                  <td className="pv-mono pv-small">{f.path}</td>
                  <td className="pv-num">{f.hotspot}</td>
                  <td className={'pv-num ' + (f.health < 6 ? 'pv-text-danger' : '')}>
                    {one(f.health)}
                  </td>
                  <td className="v2-nowrap">{f.owner ?? '—'}</td>
                  <td className="pv-cell-bar">
                    <Bar value={f.agentShare * 100} max={100} tone="agent" />
                  </td>
                  <td>
                    {planned[f.path] ? (
                      <Chip tone="success" icon="check">
                        {planned[f.path]}
                      </Chip>
                    ) : props.canEdit ? (
                      <Button size="sm" kind="ghost" onClick={() => void plan(f)}>
                        Plan a refactor
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

interface Endpoint {
  id: string;
  kind: string;
  method: string;
  path: string;
  summary: string;
  auth: string;
  tag: string;
  itemId: string | null;
  itemRef: string | null;
  tests: number;
  source: string;
}

function Apis(props: {
  workspaceId: string;
  projectId: string;
  canEdit: boolean;
  go: (p: string) => void;
}): ReactNode {
  const P = W(props.workspaceId, '/projects/' + props.projectId);
  const [list, setList] = useState<Endpoint[] | null>(null);
  const [tasks, setTasks] = useState<{ id: string; ref: string; title: string }[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    const r = await api<Endpoint[]>('GET', P + '/api-endpoints');
    if (r.ok) setList(r.data);
    else setError(r.error.message);
  }, [P]);
  useEffect(() => {
    void load();
    if (props.canEdit)
      void api<{ id: string; ref: string; title: string }[]>('GET', P + '/items').then((r) => {
        if (r.ok) setTasks(r.data.slice(0, 500));
      });
  }, [load, P, props.canEdit]);
  const upload = async (file: File): Promise<void> => {
    setError(null);
    let doc: unknown;
    try {
      doc = JSON.parse(await file.text());
    } catch {
      setError(file.name + ' is not JSON: send the OpenAPI 3 document as JSON.');
      return;
    }
    const r = await api<{ endpoints: number; removed: number; unauthenticated: number }>(
      'POST',
      P + '/api-endpoints/import',
      { openapi: doc },
    );
    if (!r.ok) setError(r.error.message);
    else {
      setNote(
        String(r.data.endpoints) +
          ' endpoints read, ' +
          String(r.data.removed) +
          ' gone, ' +
          String(r.data.unauthenticated) +
          ' without a login',
      );
      void load();
    }
  };
  const link = async (e: Endpoint, itemId: string): Promise<void> => {
    const r = await api('PATCH', W(props.workspaceId, '/api-endpoints/' + e.id), {
      itemId: itemId || null,
    });
    if (!r.ok) setError(r.error.message);
    void load();
  };
  if (!list) return <p className="pv-muted">{error ?? 'Loading…'}</p>;
  const open = list.filter((e) => e.auth === 'none').length;
  return (
    <Card
      flush
      title={
        'API inventory · ' +
        String(list.length) +
        (open ? ' · ' + String(open) + ' without login' : '')
      }
      action={
        props.canEdit ? (
          <label className="pv-btn pv-btn--secondary pv-btn--sm">
            <PIcon name="plus" size={14} />
            Read OpenAPI (JSON)
            <input
              className="v2-file-hidden"
              type="file"
              accept="application/json,.json"
              aria-label="OpenAPI document"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void upload(f);
                e.target.value = '';
              }}
            />
          </label>
        ) : null
      }
    >
      {error ? (
        <p className="v2-error v2-pad" role="alert">
          {error}
        </p>
      ) : null}
      {note ? <p className="pv-muted pv-small v2-pad">{note}</p> : null}
      {list.length ? (
        <div className="pv-grid-scroll">
          <table className="pv-table">
            <thead>
              <tr>
                <th>Endpoint</th>
                <th>Task</th>
                <th className="pv-num">Tests</th>
                <th>Access</th>
              </tr>
            </thead>
            <tbody>
              {list.map((e) => (
                <tr key={e.id}>
                  <td>
                    <span className={'pv-method pv-method--' + e.method.toLowerCase()}>
                      {e.method}
                    </span>{' '}
                    <span className="pv-mono">{e.path}</span>
                    {e.summary ? (
                      <span className="pv-muted pv-block pv-small">{e.summary}</span>
                    ) : null}
                  </td>
                  <td>
                    {props.canEdit ? (
                      <select
                        className="v2-input v2-input--sm"
                        aria-label={'Task of ' + e.method + ' ' + e.path}
                        value={e.itemId ?? ''}
                        onChange={(x) => void link(e, x.target.value)}
                      >
                        <option value="">no task</option>
                        {tasks.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.ref} {t.title}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className={e.itemRef ? 'pv-mono' : 'pv-text-warning'}>
                        {e.itemRef ?? 'no task'}
                      </span>
                    )}
                  </td>
                  <td className={'pv-num ' + (e.tests ? '' : 'pv-text-danger')}>{e.tests}</td>
                  <td>
                    {e.auth === 'none' ? (
                      <Chip tone="danger">no login</Chip>
                    ) : (
                      <Chip>{e.auth}</Chip>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="pv-empty">
          No API inventory yet. Read the project’s OpenAPI document to list every endpoint.
        </p>
      )}
    </Card>
  );
}

interface HygieneData {
  unfingerprinted: { path: string; lines: number }[];
  unfingerprintedLines: number;
  cancelledTasks: { ref: string; title: string; paths: string[] }[];
}

function Hygiene(props: {
  workspaceId: string;
  projectId: string;
  canEdit: boolean;
  go: (p: string) => void;
}): ReactNode {
  const { map } = useCodeMap(props.workspaceId, props.projectId, 1);
  const [h, setH] = useState<HygieneData | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void api<HygieneData>(
      'GET',
      W(props.workspaceId, '/projects/' + props.projectId + '/code-hygiene'),
    ).then((r) => {
      if (r.ok) setH(r.data);
      else setError(r.error.message);
    });
  }, [props.workspaceId, props.projectId]);
  if (!h || !map) return <p className="pv-muted">{error ?? 'Loading…'}</p>;
  if (!map.totals.files) return NO_SCAN;
  return (
    <div className="pv-stack">
      <div className="pv-stats">
        <Stat
          label="Files with a fingerprint"
          value={pct(map.totals.fingerprinted)}
          sub={kLines(h.unfingerprintedLines) + ' without'}
          icon="codemap"
        />
        <Stat
          label="Fingerprints of cancelled tasks"
          value={String(h.cancelledTasks.length)}
          sub="code still there, task cancelled"
          tone={h.cancelledTasks.length ? 'warning' : undefined}
          icon="flag"
        />
      </div>
      <Card flush title="Code without a fingerprint">
        {h.unfingerprinted.length ? (
          <ul className="pv-rows">
            {h.unfingerprinted.slice(0, 50).map((f) => (
              <li key={f.path} className="pv-row pv-row--static">
                <span className="pv-kind pv-kind--request">
                  <PIcon name="codemap" size={15} />
                </span>
                <span className="pv-row-main">
                  <span className="pv-row-title pv-mono">{f.path}</span>
                  <span className="pv-row-sub">
                    {kLines(f.lines)} · no task says why this code exists
                  </span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="pv-empty">Every file carries a fingerprint.</p>
        )}
      </Card>
      {h.cancelledTasks.length ? (
        <Card flush title="Fingerprints of cancelled tasks">
          <ul className="pv-rows">
            {h.cancelledTasks.map((t) => (
              <li key={t.ref} className="pv-row pv-row--static">
                <span className="pv-row-main">
                  <span className="pv-row-title">
                    <span className="pv-mono pv-muted">{t.ref}</span> {t.title}
                  </span>
                  <span className="pv-row-sub pv-mono">{t.paths.slice(0, 5).join(' · ')}</span>
                </span>
                <Chip tone="warning">remove or re-assign</Chip>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
