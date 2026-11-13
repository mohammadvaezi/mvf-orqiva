// ── [PCODE-279 | S15 | v0.1.0] T29.1 Document blocks: callouts, math and Mermaid diagrams rendered by our own code ──
//    Why:  diagrams written as Mermaid text, drawn without the Mermaid library (no scripts from outside, no
//          HTML injected): flowcharts and sequence diagrams are read here and laid out as boxes, lines and
//          labels with coordinates, which the web app draws as SVG and the HTML export writes out. Other
//          diagram types are reported so the page shows their source.

export class DiagramError extends Error {}

export type Shape = 'box' | 'round' | 'diamond' | 'circle' | 'flag';
export interface FlowNode {
  id: string;
  label: string;
  shape: Shape;
}
export interface FlowEdge {
  from: string;
  to: string;
  label: string;
  style: 'solid' | 'dotted' | 'thick';
  arrow: boolean;
}
export interface Flowchart {
  kind: 'flowchart';
  dir: 'TD' | 'LR' | 'BT' | 'RL';
  nodes: FlowNode[];
  edges: FlowEdge[];
}

export interface SeqMessage {
  kind: 'message';
  from: string;
  to: string;
  text: string;
  dashed: boolean;
  arrow: boolean;
}
export interface SeqNote {
  kind: 'note';
  over: string[];
  side: 'over' | 'left' | 'right';
  text: string;
}
export interface Sequence {
  kind: 'sequence';
  participants: { id: string; label: string; actor: boolean }[];
  steps: (SeqMessage | SeqNote)[];
}

export type Diagram = Flowchart | Sequence;

const unquote = (s: string): string =>
  s
    .trim()
    .replace(/^"(.*)"$/, '$1')
    .replace(/<br\s*\/?>/gi, ' ');

// a node: A, A[box], A(round), A{diamond}, A((circle)), A>flag]
const NODE =
  /^([A-Za-z0-9_][\w-]*)\s*(?:(\(\()(.+?)\)\)|(\[)(.+?)\]|(\()(.+?)\)|(\{)(.+?)\}|(>)(.+?)\])?/;
// a link: --> --- -.-> -.- ==> === with an optional |label| after, or -- label --> in the middle
const LINK =
  /^\s*(?:(--|==|-\.)\s*([^-=>|.][^>|]*?)\s*(-->|==>|\.->|---|===|-\.-)|(-->|---|-\.->|-\.-|==>|===))\s*(?:\|([^|]*)\|)?\s*/;

function readFlowchart(lines: string[], head: string): Flowchart {
  const dir = (/\b(TD|TB|LR|BT|RL)\b/.exec(head)?.[1] ?? 'TD').replace(
    'TB',
    'TD',
  ) as Flowchart['dir'];
  const nodes = new Map<string, FlowNode>();
  const edges: FlowEdge[] = [];
  const node = (src: string): { id: string; rest: string } => {
    const m = NODE.exec(src);
    if (!m) throw new DiagramError('A node is expected at "' + src.slice(0, 30) + '"');
    const id = m[1] ?? '';
    const shapes: [string | undefined, string | undefined, Shape][] = [
      [m[2], m[3], 'circle'],
      [m[4], m[5], 'box'],
      [m[6], m[7], 'round'],
      [m[8], m[9], 'diamond'],
      [m[10], m[11], 'flag'],
    ];
    const found = shapes.find(([open]) => open !== undefined);
    const had = nodes.get(id);
    if (found) nodes.set(id, { id, label: unquote(found[1] ?? id), shape: found[2] });
    else if (!had) nodes.set(id, { id, label: id, shape: 'box' });
    return { id, rest: src.slice(m[0].length) };
  };
  for (const raw of lines) {
    const line = raw.replace(/%%.*$/, '').trim().replace(/;$/, '');
    if (!line || /^(classDef|class|style|linkStyle|click|subgraph|end)\b/.test(line)) continue;
    let { id, rest } = node(line);
    while (rest.trim()) {
      const l = LINK.exec(rest);
      if (!l) throw new DiagramError('A link is expected at "' + rest.trim().slice(0, 30) + '"');
      const op = l[3] ?? l[4] ?? '-->';
      const label = unquote(l[2] ?? l[5] ?? '');
      const next = node(rest.slice(l[0].length));
      edges.push({
        from: id,
        to: next.id,
        label,
        style: op.includes('.') ? 'dotted' : op.includes('=') ? 'thick' : 'solid',
        arrow: op.endsWith('>'),
      });
      id = next.id;
      rest = next.rest;
    }
  }
  if (!nodes.size) throw new DiagramError('The flowchart has no nodes');
  return { kind: 'flowchart', dir, nodes: [...nodes.values()], edges };
}

/** A sequence arrow: dashed or solid, with a head or an open end. */
const ARROWS: Record<string, { dashed: boolean; arrow: boolean }> = {
  '->>': { dashed: false, arrow: true },
  '-->>': { dashed: true, arrow: true },
  '->': { dashed: false, arrow: false },
  '-->': { dashed: true, arrow: false },
  '-x': { dashed: false, arrow: true },
  '--x': { dashed: true, arrow: true },
};

function readSequence(lines: string[]): Sequence {
  const parts = new Map<string, { id: string; label: string; actor: boolean }>();
  const steps: Sequence['steps'] = [];
  const meet = (id: string): string => {
    const k = id.trim();
    if (!parts.has(k)) parts.set(k, { id: k, label: k, actor: false });
    return k;
  };
  for (const raw of lines) {
    const line = raw.replace(/%%.*$/, '').trim();
    if (
      !line ||
      /^(autonumber|activate|deactivate|loop|alt|else|opt|par|and|end|rect)\b/.test(line)
    )
      continue;
    const p = /^(participant|actor)\s+(\S+?)(?:\s+as\s+(.+))?$/.exec(line);
    if (p) {
      parts.set(p[2] ?? '', {
        id: p[2] ?? '',
        label: unquote(p[3] ?? p[2] ?? ''),
        actor: p[1] === 'actor',
      });
      continue;
    }
    const n = /^note\s+(over|left of|right of)\s+([^:]+):\s*(.*)$/i.exec(line);
    if (n) {
      const side = (n[1] ?? 'over').toLowerCase().startsWith('left')
        ? 'left'
        : (n[1] ?? '').toLowerCase().startsWith('right')
          ? 'right'
          : 'over';
      steps.push({
        kind: 'note',
        side,
        over: (n[2] ?? '').split(',').map((x) => meet(x)),
        text: unquote(n[3] ?? ''),
      });
      continue;
    }
    const m = /^([^\s:]+?)\s*(-->>|->>|-->|->|--x|-x)[+-]?\s*([^\s:]+)\s*:\s*(.*)$/.exec(line);
    if (!m) throw new DiagramError('A message is expected at "' + line.slice(0, 30) + '"');
    const kind = ARROWS[m[2] ?? '->>'];
    steps.push({
      kind: 'message',
      from: meet(m[1] ?? ''),
      to: meet(m[3] ?? ''),
      text: unquote(m[4] ?? ''),
      dashed: kind?.dashed ?? false,
      arrow: kind?.arrow ?? true,
    });
  }
  if (!parts.size) throw new DiagramError('The sequence has no participants');
  return { kind: 'sequence', participants: [...parts.values()], steps };
}

/** Reads a Mermaid text: a flowchart or a sequence diagram. */
export function readDiagram(src: string): Diagram {
  const lines = src.replace(/\r/g, '').split('\n');
  const first = lines.findIndex((l) => l.trim() && !l.trim().startsWith('%%'));
  const head = (lines[first] ?? '').trim();
  if (/^(graph|flowchart)\b/.test(head)) return readFlowchart(lines.slice(first + 1), head);
  if (/^sequenceDiagram\b/.test(head)) return readSequence(lines.slice(first + 1));
  throw new DiagramError(
    (head.split(/\s/)[0] ?? 'This') +
      ' diagrams are not drawn yet; flowcharts and sequence diagrams are',
  );
}

// ── layout ──
export interface Box {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  shape: Shape | 'actor' | 'note';
}
export interface Line {
  points: { x: number; y: number }[];
  label: string;
  style: 'solid' | 'dotted' | 'thick' | 'dashed';
  arrow: boolean;
  /** where the label goes */
  lx: number;
  ly: number;
}
export interface Layout {
  width: number;
  height: number;
  boxes: Box[];
  lines: Line[];
  /** sequence diagrams: the lifelines */
  lifelines: { x: number; y1: number; y2: number }[];
}

/** About how wide a text is at 13 px. */
export const textWidth = (s: string): number => Math.ceil(s.length * 7.2);

const GAP = 48;
const RANK = 64;
const PAD = 16;

function layoutFlow(f: Flowchart): Layout {
  const ids = f.nodes.map((n) => n.id);
  // ranks: the longest path from a source, cycles broken by first appearance
  const rank = new Map(ids.map((id) => [id, 0]));
  const order = new Map(ids.map((id, i) => [id, i]));
  // back edges (those closing a cycle, found depth first in the order of appearance) do not rank
  const backward = new Set<FlowEdge>();
  const state = new Map<string, 'open' | 'done'>();
  const visit = (id: string): void => {
    state.set(id, 'open');
    for (const e of f.edges.filter((x) => x.from === id)) {
      const s2 = state.get(e.to);
      if (s2 === 'open') backward.add(e);
      else if (!s2) visit(e.to);
    }
    state.set(id, 'done');
  };
  for (const id of ids) if (!state.get(id)) visit(id);
  for (let pass = 0; pass < ids.length; pass++) {
    let moved = false;
    for (const e of f.edges) {
      if (backward.has(e)) continue;
      const r = (rank.get(e.from) ?? 0) + 1;
      if (r > (rank.get(e.to) ?? 0)) {
        rank.set(e.to, r);
        moved = true;
      }
    }
    if (!moved) break;
  }
  const size = new Map(
    f.nodes.map((n) => {
      const w = Math.max(48, textWidth(n.label) + 2 * PAD);
      const h = n.shape === 'diamond' ? 56 : n.shape === 'circle' ? Math.max(48, w * 0.6) : 36;
      return [
        n.id,
        { w: n.shape === 'diamond' ? w + 24 : n.shape === 'circle' ? Math.max(w, h) : w, h },
      ];
    }),
  );
  const layers: string[][] = [];
  for (const id of ids) (layers[rank.get(id) ?? 0] ??= []).push(id);
  // one barycentre pass orders each layer by its parents
  for (let l = 1; l < layers.length; l++) {
    const prev = layers[l - 1] ?? [];
    const at = (id: string): number => {
      const ps = f.edges
        .filter((e) => e.to === id && prev.includes(e.from))
        .map((e) => prev.indexOf(e.from));
      return ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : (order.get(id) ?? 0);
    };
    layers[l] = [...(layers[l] ?? [])].sort((a, b) => at(a) - at(b));
  }
  const vertical = f.dir === 'TD' || f.dir === 'BT';
  const boxes: Box[] = [];
  const across = layers.map((layer) =>
    layer.reduce(
      (n, id) => n + (vertical ? (size.get(id)?.w ?? 0) : (size.get(id)?.h ?? 0)) + GAP,
      -GAP,
    ),
  );
  const widest = Math.max(...across, 0);
  const depthOf = layers.map((layer) =>
    Math.max(...layer.map((id) => (vertical ? (size.get(id)?.h ?? 0) : (size.get(id)?.w ?? 0)))),
  );
  let along = PAD;
  layers.forEach((layer, l) => {
    let pos = PAD + (widest - (across[l] ?? 0)) / 2;
    for (const id of layer) {
      const s = size.get(id) ?? { w: 0, h: 0 };
      const n = f.nodes.find((x) => x.id === id);
      const d = depthOf[l] ?? 0;
      boxes.push({
        id,
        label: n?.label ?? id,
        shape: n?.shape ?? 'box',
        w: s.w,
        h: s.h,
        x: vertical ? pos : along + (d - s.w) / 2,
        y: vertical ? along + (d - s.h) / 2 : pos,
      });
      pos += (vertical ? s.w : s.h) + GAP;
    }
    along += (depthOf[l] ?? 0) + RANK;
  });
  let width = vertical ? widest + 2 * PAD : along - RANK + PAD;
  let height = vertical ? along - RANK + PAD : widest + 2 * PAD;
  // bottom-up and right-to-left are mirrored
  if (f.dir === 'BT') for (const b of boxes) b.y = height - b.y - b.h;
  if (f.dir === 'RL') for (const b of boxes) b.x = width - b.x - b.w;
  const centre = (id: string) => {
    const b: Box = boxes.find((x) => x.id === id) ?? {
      id,
      label: '',
      shape: 'box',
      x: 0,
      y: 0,
      w: 0,
      h: 0,
    };
    return { b, cx: b.x + b.w / 2, cy: b.y + b.h / 2 };
  };
  /** where a line towards (tx, ty) leaves a box */
  /** where a line from the centre towards (tx, ty) leaves the node's outline */
  const edge = (b: Box, tx: number, ty: number) => {
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    const dx = tx - cx;
    const dy = ty - cy;
    if (!dx && !dy) return { x: cx, y: cy };
    const rx = b.w / 2;
    const ry = b.h / 2;
    const s =
      b.shape === 'diamond'
        ? 1 / (Math.abs(dx) / rx + Math.abs(dy) / ry)
        : b.shape === 'circle'
          ? 1 / Math.sqrt((dx / rx) ** 2 + (dy / ry) ** 2)
          : Math.min(dx ? rx / Math.abs(dx) : Infinity, dy ? ry / Math.abs(dy) : Infinity);
    return { x: cx + dx * s, y: cy + dy * s };
  };
  // links between the same two nodes are drawn side by side, not on top of each other
  const pair = (e: FlowEdge): string => [e.from, e.to].sort().join(' -- ');
  const siblings = new Map<string, FlowEdge[]>();
  for (const e of f.edges)
    if (e.from !== e.to) siblings.set(pair(e), [...(siblings.get(pair(e)) ?? []), e]);
  const lines: Line[] = f.edges.map((e) => {
    const a = centre(e.from);
    const z = centre(e.to);
    let points: { x: number; y: number }[];
    if (e.from === e.to) {
      const r = a.b;
      points = [
        { x: r.x + r.w, y: r.y + r.h / 3 },
        { x: r.x + r.w + 24, y: r.y + r.h / 3 },
        { x: r.x + r.w + 24, y: r.y + (2 * r.h) / 3 },
        { x: r.x + r.w, y: r.y + (2 * r.h) / 3 },
      ];
    } else {
      const group = siblings.get(pair(e)) ?? [e];
      const k = group.indexOf(e) - (group.length - 1) / 2;
      // a perpendicular shift, the same side for both directions of the pair
      const [p0, p1] = e.from < e.to ? [a, z] : [z, a];
      const len = Math.hypot(p1.cx - p0.cx, p1.cy - p0.cy) || 1;
      const ox = (-(p1.cy - p0.cy) / len) * k * 12;
      const oy = ((p1.cx - p0.cx) / len) * k * 12;
      const from = edge(a.b, z.cx + ox, z.cy + oy);
      const to = edge(z.b, a.cx + ox, a.cy + oy);
      points = [
        { x: from.x + ox, y: from.y + oy },
        { x: to.x + ox, y: to.y + oy },
      ];
    }
    const mid = points[Math.floor((points.length - 1) / 2)] ?? { x: 0, y: 0 };
    const end = points[Math.ceil((points.length - 1) / 2)] ?? mid;
    return {
      points,
      label: e.label,
      style: e.style,
      arrow: e.arrow,
      lx: (mid.x + end.x) / 2,
      ly: (mid.y + end.y) / 2,
    };
  });
  width = Math.max(
    width,
    ...boxes.map(
      (b) => b.x + b.w + PAD + (f.edges.some((e) => e.from === e.to && e.from === b.id) ? 24 : 0),
    ),
  );
  height = Math.max(height, ...boxes.map((b) => b.y + b.h + PAD));
  return { width: Math.ceil(width), height: Math.ceil(height), boxes, lines, lifelines: [] };
}

function layoutSequence(sq: Sequence): Layout {
  const ROW = 40;
  const TOP = PAD;
  const colW = sq.participants.map((p) => Math.max(80, textWidth(p.label) + 2 * PAD));
  // a column is wide enough for the longest message that starts or ends next to it
  const gaps = sq.participants.map(() => 60);
  for (const s of sq.steps)
    if (s.kind === 'message') {
      const i = sq.participants.findIndex((p) => p.id === s.from);
      const j = sq.participants.findIndex((p) => p.id === s.to);
      const lo = Math.min(i, j);
      const span = Math.max(1, Math.abs(j - i));
      gaps[lo] = Math.max(gaps[lo] ?? 0, (textWidth(s.text) + 24) / span);
    }
  const xs: number[] = [];
  let x = PAD;
  sq.participants.forEach((_, i) => {
    xs.push(x + (colW[i] ?? 0) / 2);
    x += (colW[i] ?? 0) + (gaps[i] ?? 0);
  });
  const xOf = (id: string): number => xs[sq.participants.findIndex((p) => p.id === id)] ?? 0;
  const boxes: Box[] = sq.participants.map((p, i) => ({
    id: p.id,
    label: p.label,
    shape: p.actor ? 'actor' : 'box',
    w: colW[i] ?? 80,
    h: 36,
    x: (xs[i] ?? 0) - (colW[i] ?? 80) / 2,
    y: TOP,
  }));
  const lines: Line[] = [];
  let y = TOP + 36 + ROW;
  for (const s of sq.steps) {
    if (s.kind === 'message') {
      const a = xOf(s.from);
      const b = xOf(s.to);
      if (s.from === s.to)
        lines.push({
          points: [
            { x: a, y },
            { x: a + 36, y },
            { x: a + 36, y: y + 16 },
            { x: a, y: y + 16 },
          ],
          label: s.text,
          style: s.dashed ? 'dashed' : 'solid',
          arrow: s.arrow,
          lx: a + 40 + textWidth(s.text) / 2,
          ly: y - 6,
        });
      else
        lines.push({
          points: [
            { x: a, y },
            { x: b, y },
          ],
          label: s.text,
          style: s.dashed ? 'dashed' : 'solid',
          arrow: s.arrow,
          lx: (a + b) / 2,
          ly: y - 6,
        });
      y += s.from === s.to ? ROW + 16 : ROW;
    } else {
      const cols = s.over.map(xOf);
      const w = Math.max(
        textWidth(s.text) + 2 * PAD,
        s.side === 'over' && cols.length > 1 ? Math.max(...cols) - Math.min(...cols) + 40 : 0,
      );
      const cx =
        s.side === 'over'
          ? (Math.min(...cols) + Math.max(...cols)) / 2
          : s.side === 'left'
            ? Math.min(...cols) - 12 - w / 2
            : Math.max(...cols) + 12 + w / 2;
      boxes.push({
        id: 'note' + String(boxes.length),
        label: s.text,
        shape: 'note',
        w,
        h: 28,
        x: cx - w / 2,
        y: y - 18,
      });
      y += ROW;
    }
  }
  const bottom = y - ROW / 2;
  const minX = Math.min(PAD, ...boxes.map((b) => b.x));
  if (minX < PAD) {
    const shift = PAD - minX;
    for (const b of boxes) b.x += shift;
    for (const l of lines) {
      l.lx += shift;
      for (const p of l.points) p.x += shift;
    }
    for (let i = 0; i < xs.length; i++) xs[i] = (xs[i] ?? 0) + shift;
  }
  const width =
    Math.max(...boxes.map((b) => b.x + b.w), ...lines.map((l) => l.lx + textWidth(l.label) / 2)) +
    PAD;
  return {
    width: Math.ceil(width),
    height: Math.ceil(bottom + PAD),
    boxes,
    lines,
    lifelines: xs.map((lx) => ({ x: lx, y1: TOP + 36, y2: bottom })),
  };
}

/** Where everything of a diagram goes. */
export const layoutDiagram = (d: Diagram): Layout =>
  d.kind === 'flowchart' ? layoutFlow(d) : layoutSequence(d);
