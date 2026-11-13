// ── [PCODE-440 | S15 | v0.1.0] T37 Consistency: errors and loading are announced everywhere ──
// ── [PCODE-309 | S15 | v0.1.0] T31.8b Architecture graph, change coupling and bus factor on the code map ──
//    Why:  "Architecture": the folders as a graph of their imports (cycles in red, named in words, the
//          strongest dependencies as a table too), and the files that change together, hidden coupling
//          across folders first. "Knowledge": per folder, how many people wrote most of it and who.
import { useEffect, useState, type ReactNode } from 'react';
import { api } from '../core/api.js';
import { Card, Chip } from '../preview/ui.js';

const W = (ws: string, p: string): string => '/api/workspaces/' + ws + p;

interface Graph {
  nodes: { id: string; files: number; lines: number }[];
  edges: { from: string; to: string; imports: number }[];
  cycles: string[][];
  withoutImports: number;
}
interface Coupling {
  commits: number;
  pairs: { a: string; b: string; together: number; degree: number; crossFolder: boolean }[];
}
export interface FolderKnowledge {
  path: string;
  lines: number;
  files: number;
  busFactor: number;
  owner: string | null;
  ownerShare: number;
  authors: number;
}

const MAX_NODES = 24;

/** Nodes on a circle, the biggest at the top; each with its radius from its lines. */
export function circleLayout(
  nodes: readonly { id: string; lines: number }[],
  size: { w: number; h: number },
): Map<string, { x: number; y: number; r: number; side: 'start' | 'middle' | 'end' }> {
  const out = new Map<
    string,
    { x: number; y: number; r: number; side: 'start' | 'middle' | 'end' }
  >();
  const max = Math.max(1, ...nodes.map((n) => n.lines));
  const cx = size.w / 2;
  const cy = size.h / 2;
  // room around the circle for the labels
  const R = Math.min(size.w, size.h) / 2 - 70;
  nodes.forEach((n, i) => {
    const t = (i / Math.max(1, nodes.length)) * 2 * Math.PI - Math.PI / 2;
    out.set(n.id, {
      x: nodes.length === 1 ? cx : cx + R * Math.cos(t),
      y: nodes.length === 1 ? cy : cy + R * Math.sin(t),
      r: 8 + 22 * Math.sqrt(n.lines / max),
      // the label sits outside the circle, on the side the node is on
      side:
        nodes.length === 1 || Math.abs(Math.cos(t)) < 0.3
          ? 'middle'
          : Math.cos(t) > 0
            ? 'start'
            : 'end',
    });
  });
  return out;
}

/** The part of the folders' paths they share ("packages/server/src/"), left out of their labels. */
export function commonPrefix(ids: readonly string[]): string {
  if (ids.length < 2) return '';
  const parts = ids.map((i) => i.split('/'));
  const first = parts[0] ?? [];
  let k = 0;
  while (k < first.length - 1 && parts.every((p) => p.length > k + 1 && p[k] === first[k])) k++;
  return k ? first.slice(0, k).join('/') + '/' : '';
}

/** A cycle in words: at most four folders named. */
export function cycleText(c: readonly string[], prefix: string): string {
  const names = c.map((x) => x.slice(prefix.length) || x);
  return names.length > 4
    ? names.slice(0, 4).join(' ⇄ ') + ' and ' + String(names.length - 4) + ' more'
    : names.join(' ⇄ ');
}

/** A busFactor of 1 is a risk; 0 means nobody but agents wrote it. */
export function busText(k: Pick<FolderKnowledge, 'busFactor' | 'owner' | 'ownerShare'>): string {
  if (!k.busFactor) return 'written by agents only';
  if (k.busFactor === 1)
    return (
      'only ' + (k.owner ?? 'one person') + ' (' + String(Math.round(k.ownerShare * 100)) + ' %)'
    );
  return String(k.busFactor) + ' people know most of it';
}

export function Architecture(props: { workspaceId: string; projectId: string }): ReactNode {
  const [depth, setDepth] = useState(2);
  const [graph, setGraph] = useState<Graph | null>(null);
  const [coupling, setCoupling] = useState<Coupling | null>(null);
  const base = W(props.workspaceId, '/projects/' + props.projectId + '/code-map');
  useEffect(() => {
    void api<Graph>('GET', base + '/graph?depth=' + String(depth)).then((r) => {
      if (r.ok) setGraph(r.data);
    });
    void api<Coupling>('GET', base + '/coupling?depth=' + String(depth)).then((r) => {
      if (r.ok) setCoupling(r.data);
    });
  }, [base, depth]);
  if (!graph)
    return (
      <p className="pv-muted" role="status">
        Loading the architecture…
      </p>
    );
  const nodes = graph.nodes.slice(0, MAX_NODES);
  const shown = new Set(nodes.map((n) => n.id));
  const edges = graph.edges.filter((e) => shown.has(e.from) && shown.has(e.to));
  const at = circleLayout(nodes, { w: 800, h: 520 });
  const inCycle = new Set(graph.cycles.flat());
  const prefix = commonPrefix(graph.nodes.map((n) => n.id));
  const cyclic = (e: Graph['edges'][number]): boolean =>
    graph.cycles.some((c) => c.includes(e.from) && c.includes(e.to));
  const maxImports = Math.max(1, ...edges.map((e) => e.imports));
  return (
    <div className="pv-stack">
      <Card
        title="Architecture: which folders import which"
        action={
          <select
            className="v2-input v2-input--sm"
            aria-label="Folder depth"
            value={String(depth)}
            onChange={(e) => {
              setDepth(Number(e.target.value));
            }}
          >
            {[1, 2, 3, 4].map((d) => (
              <option key={d} value={String(d)}>
                {d} level{d === 1 ? '' : 's'}
              </option>
            ))}
          </select>
        }
      >
        {!graph.nodes.length ? (
          <p className="pv-empty">No code scan yet: run orq docs scan.</p>
        ) : (
          <>
            <p className="pv-small" role="status">
              {graph.cycles.length
                ? String(graph.cycles.length) +
                  ' import cycle' +
                  (graph.cycles.length === 1 ? '' : 's') +
                  ': ' +
                  graph.cycles.map((c) => cycleText(c, prefix)).join('; ')
                : 'No import cycles between folders.'}
              {graph.nodes.length > MAX_NODES
                ? ' The ' + String(MAX_NODES) + ' biggest folders are drawn.'
                : ''}
            </p>
            <div className="v2-ca-scroll">
              <svg
                className="v2-ca-graph"
                viewBox="0 0 800 520"
                role="img"
                aria-label="Folders and the imports between them"
              >
                <defs>
                  <marker
                    id="v2-ca-arrow"
                    viewBox="0 0 10 10"
                    refX="9"
                    refY="5"
                    markerWidth="7"
                    markerHeight="7"
                    orient="auto-start-reverse"
                  >
                    <path d="M0,0 L10,5 L0,10 z" className="v2-ca-head" />
                  </marker>
                </defs>
                {edges.map((e) => {
                  const a = at.get(e.from);
                  const b = at.get(e.to);
                  if (!a || !b) return null;
                  const dx = b.x - a.x;
                  const dy = b.y - a.y;
                  const len = Math.max(1, Math.hypot(dx, dy));
                  // a small bend, so two folders importing each other show two arrows
                  const mx = (a.x + b.x) / 2 - (dy / len) * 18;
                  const my = (a.y + b.y) / 2 + (dx / len) * 18;
                  const ex = b.x - (dx / len) * (b.r + 3);
                  const ey = b.y - (dy / len) * (b.r + 3);
                  return (
                    <path
                      key={e.from + '>' + e.to}
                      className={
                        'v2-ca-edge v2-ca-w' +
                        String(Math.ceil((e.imports / maxImports) * 3)) +
                        (cyclic(e) ? ' v2-ca-cyclic' : '')
                      }
                      d={
                        'M' +
                        String(a.x) +
                        ',' +
                        String(a.y) +
                        ' Q' +
                        String(mx) +
                        ',' +
                        String(my) +
                        ' ' +
                        String(ex) +
                        ',' +
                        String(ey)
                      }
                      markerEnd="url(#v2-ca-arrow)"
                    >
                      <title>{e.from + ' imports ' + e.to + ' ' + String(e.imports) + '×'}</title>
                    </path>
                  );
                })}
                {nodes.map((n) => {
                  const p = at.get(n.id);
                  if (!p) return null;
                  return (
                    <g key={n.id}>
                      <title>
                        {n.id + ' · ' + String(n.lines) + ' lines · ' + String(n.files) + ' files'}
                      </title>
                      <circle
                        className={'v2-ca-node' + (inCycle.has(n.id) ? ' v2-ca-node--cycle' : '')}
                        cx={p.x}
                        cy={p.y}
                        r={p.r}
                      />
                      <text
                        className={'v2-ca-label v2-ca-label--' + p.side}
                        x={
                          p.side === 'start'
                            ? p.x + p.r + 5
                            : p.side === 'end'
                              ? p.x - p.r - 5
                              : p.x
                        }
                        y={p.side === 'middle' ? p.y + (p.y < 260 ? -p.r - 6 : p.r + 14) : p.y + 4}
                      >
                        {n.id.slice(prefix.length) || n.id}
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>
            {edges.length ? (
              <details>
                <summary className="pv-small">The strongest dependencies as a list</summary>
                <ul className="pv-small v2-ca-list">
                  {edges.slice(0, 15).map((e) => (
                    <li key={e.from + '>' + e.to}>
                      <span className="pv-mono">{e.from}</span> imports{' '}
                      <span className="pv-mono">{e.to}</span> {e.imports}×
                      {cyclic(e) ? <span className="pv-text-danger"> · in a cycle</span> : null}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
            {graph.withoutImports ? (
              <p className="pv-small pv-muted">
                {graph.withoutImports} file{graph.withoutImports === 1 ? '' : 's'} came from a scan
                without imports; run orq docs scan again.
              </p>
            ) : null}
          </>
        )}
      </Card>
      <Card title="Files that change together">
        {!coupling ? (
          <p className="pv-muted" role="status">
            Loading…
          </p>
        ) : coupling.pairs.length ? (
          <>
            <p className="pv-small">
              From {coupling.commits} commits. A pair in different folders is coupling nothing in
              the structure shows.
            </p>
            <div className="v2-ec-scroll">
              <table className="v2-ec-table pv-small">
                <thead>
                  <tr>
                    <th scope="col">Files</th>
                    <th scope="col">Together</th>
                    <th scope="col">Strength</th>
                  </tr>
                </thead>
                <tbody>
                  {coupling.pairs.slice(0, 20).map((p) => (
                    <tr key={p.a + p.b}>
                      <th scope="row" className="pv-mono">
                        {p.a}
                        <br />
                        {p.b}
                      </th>
                      <td>{p.together}×</td>
                      <td>
                        {Math.round(p.degree * 100)} %{' '}
                        {p.crossFolder ? <Chip tone="warning">across folders</Chip> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <p className="pv-small pv-muted">
            {coupling.commits
              ? 'No files changed together often enough (three times or more).'
              : 'No commits with their files yet: connect the repository to see this.'}
          </p>
        )}
      </Card>
    </div>
  );
}

export function Knowledge(props: { workspaceId: string; projectId: string }): ReactNode {
  const [rows, setRows] = useState<FolderKnowledge[] | null>(null);
  const [depth, setDepth] = useState(2);
  useEffect(() => {
    void api<FolderKnowledge[]>(
      'GET',
      W(
        props.workspaceId,
        '/projects/' + props.projectId + '/code-map/knowledge?depth=' + String(depth),
      ),
    ).then((r) => {
      if (r.ok) setRows(r.data);
    });
  }, [props.workspaceId, props.projectId, depth]);
  if (!rows)
    return (
      <p className="pv-muted" role="status">
        Loading…
      </p>
    );
  const single = rows.filter((r) => r.busFactor === 1);
  return (
    <Card
      title="Who knows the code"
      action={
        <select
          className="v2-input v2-input--sm"
          aria-label="Folder depth"
          value={String(depth)}
          onChange={(e) => {
            setDepth(Number(e.target.value));
          }}
        >
          {[1, 2, 3, 4].map((d) => (
            <option key={d} value={String(d)}>
              {d} level{d === 1 ? '' : 's'}
            </option>
          ))}
        </select>
      }
    >
      <p className="pv-small" role="status">
        {single.length
          ? String(single.length) +
            ' folder' +
            (single.length === 1 ? '' : 's') +
            ' rest on one person: pair someone with them, or write it down.'
          : 'No folder rests on one person.'}{' '}
        The bus factor is the fewest people who wrote more than half of a folder; agents do not
        count.
      </p>
      <div className="v2-ec-scroll">
        <table className="v2-ec-table pv-small">
          <thead>
            <tr>
              <th scope="col">Folder</th>
              <th scope="col">Bus factor</th>
              <th scope="col">Knows it best</th>
              <th scope="col">Size</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.path}>
                <th scope="row" className="pv-mono">
                  {r.path}
                </th>
                <td>
                  <Chip
                    tone={r.busFactor === 1 ? 'danger' : r.busFactor === 2 ? 'warning' : 'success'}
                  >
                    {r.busFactor || '–'}
                  </Chip>{' '}
                  {busText(r)}
                </td>
                <td>
                  {r.owner ?? '–'}
                  {r.authors > 1 ? <span className="pv-muted"> · {r.authors} people</span> : null}
                </td>
                <td>
                  {r.lines} lines · {r.files} files
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
