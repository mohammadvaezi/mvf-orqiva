// ── [PCODE-440 | S15 | v0.1.0] T37 Consistency: errors and loading are announced everywhere ──
// ── [PCODE-315 | S15 | v0.1.0] T32.3a Cypress and Allure import, defects in the trace, leakage and burndown ──
// ── [PCODE-147 | S15 | v0.1.0] Show the traceability graph from idea to deploy ──
//    Why:  the chain from a decision to a deploy, drawn as columns from intent (left) to delivery (right),
//          in our own SVG: no drawing library, no inline styles (the page's CSP), every node a link to its
//          page, and the gaps marked where a test or code is missing.
import { useEffect, useState, type ReactNode } from 'react';
import { api } from './core/api.js';

export interface TraceNode {
  id: string;
  kind: string;
  label: string;
  sub: string;
  status: string;
  href: string | null;
}
export interface Trace {
  nodes: TraceNode[];
  edges: { from: string; to: string }[];
  gaps: { node: string; text: string }[];
}

const COLUMN: Record<string, number> = {
  idea: 0,
  proposal: 1,
  item: 2,
  criterion: 3,
  test: 4,
  commit: 5,
  pr: 5,
  file: 5,
  finding: 5,
  deploy: 6,
  defect: 5, // [PCODE-315 | S15 | v0.1.0]
};
const KIND_TEXT: Record<string, string> = {
  idea: 'Idea',
  proposal: 'Proposal',
  item: 'Task',
  criterion: 'Criterion',
  test: 'Test',
  commit: 'Commit',
  pr: 'Pull request',
  file: 'Code',
  finding: 'Finding',
  deploy: 'Deploy',
  defect: 'Bug',
};

export const NODE_W = 180;
export const NODE_H = 52;
const GAP_X = 40;
const GAP_Y = 14;

/** Positions of the nodes: one column per kind of step, rows in the order they came, empty columns dropped. */
export function layoutTrace(t: Trace): {
  pos: Map<string, { x: number; y: number }>;
  width: number;
  height: number;
} {
  const used = [...new Set(t.nodes.map((n) => COLUMN[n.kind] ?? 0))].sort((a, b) => a - b);
  const colOf = new Map(used.map((c, i) => [c, i]));
  const rows = new Map<number, number>();
  const pos = new Map<string, { x: number; y: number }>();
  for (const n of t.nodes) {
    const col = colOf.get(COLUMN[n.kind] ?? 0) ?? 0;
    const row = rows.get(col) ?? 0;
    rows.set(col, row + 1);
    pos.set(n.id, { x: col * (NODE_W + GAP_X), y: row * (NODE_H + GAP_Y) });
  }
  const tallest = Math.max(1, ...rows.values());
  return {
    pos,
    width: Math.max(1, used.length) * (NODE_W + GAP_X) - GAP_X,
    height: tallest * (NODE_H + GAP_Y) - GAP_Y,
  };
}

const cut = (s: string, n: number): string => (s.length > n ? s.slice(0, n - 1) + '…' : s);

export function TraceGraph(props: { trace: Trace; go: (p: string) => void }): ReactNode {
  const { trace } = props;
  if (!trace.nodes.length) return <p className="pe-muted">Nothing to trace yet.</p>;
  const { pos, width, height } = layoutTrace(trace);
  const gapNodes = new Set(trace.gaps.map((g) => g.node));
  return (
    <div className="pe-trace">
      <div className="pe-trace-scroll">
        <svg
          className="pe-trace-svg"
          width={width + 8}
          height={height + 8}
          viewBox={'-4 -4 ' + String(width + 8) + ' ' + String(height + 8)}
          role="img"
          aria-label="Traceability graph"
        >
          {trace.edges.map((e) => {
            const a = pos.get(e.from);
            const b = pos.get(e.to);
            if (!a || !b) return null;
            const x1 = a.x + NODE_W;
            const y1 = a.y + NODE_H / 2;
            const x2 = b.x;
            const y2 = b.y + NODE_H / 2;
            const mid = (x1 + x2) / 2;
            return (
              <path
                key={e.from + '>' + e.to}
                className="pe-trace-edge"
                d={
                  'M' +
                  String(x1) +
                  ' ' +
                  String(y1) +
                  ' C' +
                  String(mid) +
                  ' ' +
                  String(y1) +
                  ' ' +
                  String(mid) +
                  ' ' +
                  String(y2) +
                  ' ' +
                  String(x2) +
                  ' ' +
                  String(y2)
                }
              />
            );
          })}
          {trace.nodes.map((n) => {
            const p = pos.get(n.id);
            if (!p) return null;
            const box = (
              <g
                className={
                  'pe-trace-node pe-trace-node--' +
                  n.kind +
                  (gapNodes.has(n.id) ? ' pe-trace-node--gap' : '')
                }
                transform={'translate(' + String(p.x) + ' ' + String(p.y) + ')'}
              >
                <rect width={NODE_W} height={NODE_H} rx="10" />
                <text className="pe-trace-kind" x="10" y="16">
                  {KIND_TEXT[n.kind] ?? n.kind}
                  {n.status ? ' · ' + cut(n.status, 14) : ''}
                </text>
                <text className="pe-trace-label" x="10" y="34">
                  {cut(n.label, 24)}
                </text>
                {n.sub ? (
                  <text className="pe-trace-sub" x="10" y="47">
                    {cut(n.sub, 30)}
                  </text>
                ) : null}
                <title>{n.label + (n.sub ? ' — ' + n.sub : '')}</title>
              </g>
            );
            const href = n.href;
            return href ? (
              <a
                key={n.id}
                href={href}
                onClick={(e) => {
                  if (href.startsWith('/')) {
                    e.preventDefault();
                    props.go(href);
                  }
                }}
              >
                {box}
              </a>
            ) : (
              <g key={n.id}>{box}</g>
            );
          })}
        </svg>
      </div>
      {trace.gaps.length ? (
        <ul className="pe-trace-gaps" aria-label="Gaps">
          {trace.gaps.map((g, i) => (
            <li key={i}>
              <strong>{trace.nodes.find((n) => n.id === g.node)?.label ?? ''}</strong>: {g.text}
            </li>
          ))}
        </ul>
      ) : (
        <p className="pe-small pe-muted">
          No gaps: every criterion has a test and every finished task has code.
        </p>
      )}
    </div>
  );
}

/** The trace of a task or an idea, loaded and drawn in a panel. */
export function TracePanel(props: {
  workspaceId: string;
  itemId?: string;
  ideaId?: string;
  go: (p: string) => void;
}): ReactNode {
  const [trace, setTrace] = useState<Trace | null>(null);
  const q = props.ideaId ? 'ideaId=' + props.ideaId : 'itemId=' + (props.itemId ?? '');
  useEffect(() => {
    void api<Trace>('GET', '/api/workspaces/' + props.workspaceId + '/trace?' + q).then((r) => {
      if (r.ok) setTrace(r.data);
    });
  }, [props.workspaceId, q]);
  return (
    <section aria-label="Traceability" className="pe-panel">
      <div className="pe-panel-head">
        <div>
          <h2 className="pe-panel-title">Traceability</h2>
          <p className="pe-panel-subtitle">From the decision that asked for it to where it runs.</p>
        </div>
      </div>
      {trace ? (
        <TraceGraph trace={trace} go={props.go} />
      ) : (
        <p className="pe-muted" role="status">
          Loading…
        </p>
      )}
    </section>
  );
}
