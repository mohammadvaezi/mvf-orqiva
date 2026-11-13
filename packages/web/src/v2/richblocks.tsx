// ── [PCODE-279 | S15 | v0.1.0] T29.1 Document blocks: callouts, math and Mermaid diagrams rendered by our own code ──
//    Why:  math as MathML elements and Mermaid diagrams as SVG elements, both built from the shared
//          parsers as React elements (never HTML strings), and the source shown with the reason when it
//          cannot be read.
import {
  layoutDiagram,
  readDiagram,
  texToMath,
  textWidth,
  type Box,
  type Layout,
  type MathNode,
} from '@orqiva/shared';
import { createElement, useId, type ReactNode } from 'react';

function mathEl(n: MathNode, key: string): ReactNode {
  return createElement(
    n.tag,
    { key, ...(n.attrs ?? {}) },
    n.children ? n.children.map((c, i) => mathEl(c, key + '.' + String(i))) : n.text,
  );
}

/** TeX drawn by the browser as MathML; its source in code when the subset cannot read it. */
export function MathView(props: { tex: string; display?: boolean }): ReactNode {
  try {
    return (
      <span className={props.display ? 'v2-math v2-math--block' : 'v2-math'}>
        {mathEl(texToMath(props.tex, props.display), 'm')}
      </span>
    );
  } catch (e) {
    return (
      <code className="v2-math-error" title={e instanceof Error ? e.message : 'Not read'}>
        {props.display ? '$$' + props.tex + '$$' : '$' + props.tex + '$'}
      </code>
    );
  }
}

function shapeOf(b: Box): ReactNode {
  const { x, y, w, h } = b;
  switch (b.shape) {
    case 'round':
      return <rect x={x} y={y} width={w} height={h} rx={h / 2} />;
    case 'diamond':
      return (
        <polygon
          points={[
            [x + w / 2, y],
            [x + w, y + h / 2],
            [x + w / 2, y + h],
            [x, y + h / 2],
          ]
            .map((p) => p.join(','))
            .join(' ')}
        />
      );
    case 'circle':
      return <ellipse cx={x + w / 2} cy={y + h / 2} rx={w / 2} ry={h / 2} />;
    case 'flag':
      return (
        <polygon
          points={[
            [x, y],
            [x + w, y],
            [x + w, y + h],
            [x, y + h],
            [x + 12, y + h / 2],
          ]
            .map((p) => p.join(','))
            .join(' ')}
        />
      );
    case 'note':
      return <rect x={x} y={y} width={w} height={h} rx={3} className="v2-dia-note" />;
    case 'actor':
      return <rect x={x} y={y} width={w} height={h} rx={h / 2} className="v2-dia-actor" />;
    default:
      return <rect x={x} y={y} width={w} height={h} rx={4} />;
  }
}

/** A laid-out diagram as SVG. */
export function DiagramSvg(props: { layout: Layout; title: string }): ReactNode {
  const id = useId().replace(/:/g, '');
  const l = props.layout;
  return (
    <svg
      className="v2-dia"
      viewBox={'0 0 ' + String(l.width) + ' ' + String(l.height)}
      width={l.width}
      role="img"
      aria-label={props.title}
    >
      <defs>
        <marker
          id={'a' + id}
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerUnits="userSpaceOnUse"
          markerWidth="9"
          markerHeight="9"
          orient="auto-start-reverse"
        >
          <path d="M0,0 L10,5 L0,10 z" className="v2-dia-head" />
        </marker>
      </defs>
      {l.lifelines.map((ln, i) => (
        <line
          key={'ll' + String(i)}
          x1={ln.x}
          y1={ln.y1}
          x2={ln.x}
          y2={ln.y2}
          className="v2-dia-life"
        />
      ))}
      {l.lines.map((ln, i) => (
        <g key={'l' + String(i)} className={'v2-dia-line v2-dia-line--' + ln.style}>
          <polyline
            points={ln.points.map((p) => String(p.x) + ',' + String(p.y)).join(' ')}
            markerEnd={ln.arrow ? 'url(#a' + id + ')' : undefined}
          />
          {ln.label ? (
            <>
              <rect
                x={ln.lx - textWidth(ln.label) / 2 - 3}
                y={ln.ly - 12}
                width={textWidth(ln.label) + 6}
                height={16}
                className="v2-dia-label-bg"
              />
              <text x={ln.lx} y={ln.ly} textAnchor="middle" className="v2-dia-label">
                {ln.label}
              </text>
            </>
          ) : null}
        </g>
      ))}
      {l.boxes.map((b) => (
        <g key={b.id} className={'v2-dia-box v2-dia-box--' + b.shape}>
          {shapeOf(b)}
          <text x={b.x + b.w / 2} y={b.y + b.h / 2 + 4.5} textAnchor="middle">
            {b.label}
          </text>
        </g>
      ))}
    </svg>
  );
}

/** A Mermaid block: the diagram, or its source with why it is not drawn. */
export function MermaidView(props: { src: string }): ReactNode {
  let layout: Layout | null = null;
  let why = '';
  try {
    layout = layoutDiagram(readDiagram(props.src));
  } catch (e) {
    why = e instanceof Error ? e.message : 'The diagram could not be read';
  }
  return (
    <figure className="v2-md-code v2-md-diagram">
      {layout ? (
        <div className="v2-scroll">
          <DiagramSvg layout={layout} title="Diagram" />
        </div>
      ) : (
        <>
          <figcaption>Mermaid diagram: {why}</figcaption>
          <pre>
            <code>{props.src}</code>
          </pre>
        </>
      )}
    </figure>
  );
}

export const CALLOUTS = ['note', 'tip', 'important', 'warning', 'caution'] as const;
export type CalloutKind = (typeof CALLOUTS)[number];
const CALLOUT_TITLE: Record<CalloutKind, string> = {
  note: 'Note',
  tip: 'Tip',
  important: 'Important',
  warning: 'Warning',
  caution: 'Caution',
};

export function Callout(props: {
  kind: CalloutKind;
  title: string;
  children: ReactNode;
}): ReactNode {
  return (
    <aside className={'v2-callout v2-callout--' + props.kind} role="note">
      <strong className="v2-callout-title">{props.title || CALLOUT_TITLE[props.kind]}</strong>
      <div>{props.children}</div>
    </aside>
  );
}
