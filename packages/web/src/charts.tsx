// ── [PCODE-114 | S15 | v0.1.0] Add the Home dashboard and project overview with our own charts ──
//    Why:  charts drawn by us as SVG: a donut, weekly bars, a burndown line and horizontal bars. No chart
//          library ships. Colours come from the theme (series classes) or from the data (a state's own
//          colour, as an SVG attribute: the page's CSP allows no inline styles). Every chart has a caption,
//          a native tooltip per mark and the same numbers as a table for screen readers.
import { useId, type ReactNode } from 'react';

export interface Slice {
  label: string;
  value: number;
  color: string;
}

function DataTable(props: {
  caption: string;
  head: string[];
  rows: (string | number)[][];
}): ReactNode {
  return (
    <table className="pe-visually-hidden">
      <caption>{props.caption}</caption>
      <thead>
        <tr>
          {props.head.map((h) => (
            <th key={h} scope="col">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {props.rows.map((r) => (
          <tr key={String(r[0])}>
            {r.map((c, i) => (
              <td key={i}>{c}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Legend(props: {
  items: { label: string; className?: string; color?: string; value?: ReactNode }[];
}): ReactNode {
  return (
    <ul className="pe-legend">
      {props.items.map((i) => (
        <li key={i.label}>
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <rect width="10" height="10" rx="3" className={i.className} fill={i.color} />
          </svg>
          <span>{i.label}</span>
          {i.value !== undefined ? <span className="pe-legend-value">{i.value}</span> : null}
        </li>
      ))}
    </ul>
  );
}

/** The arc of one donut slice, from angle a to b (radians, 0 = top). */
export function arc(cx: number, cy: number, r: number, a: number, b: number): string {
  const p = (t: number): string =>
    (cx + r * Math.sin(t)).toFixed(2) + ' ' + (cy - r * Math.cos(t)).toFixed(2);
  const large = b - a > Math.PI ? 1 : 0;
  return 'M ' + p(a) + ' A ' + String(r) + ' ' + String(r) + ' 0 ' + String(large) + ' 1 ' + p(b);
}

export function Donut(props: {
  title: string;
  slices: Slice[];
  center?: string;
  centerLabel?: string;
}): ReactNode {
  const shown = props.slices.filter((s) => s.value > 0);
  const total = shown.reduce((n, s) => n + s.value, 0);
  const gap = shown.length > 1 ? 0.02 : 0;
  let at = 0;
  return (
    <figure className="pe-chart pe-chart--donut">
      <div className="pe-donut-wrap">
        <svg
          viewBox="0 0 120 120"
          width="160"
          height="160"
          role="img"
          aria-label={
            props.title + ': ' + shown.map((s) => s.label + ' ' + String(s.value)).join(', ')
          }
        >
          <circle cx="60" cy="60" r="46" className="pe-chart-track" fill="none" strokeWidth="16" />
          {total > 0
            ? shown.map((s) => {
                const from = at;
                const to = at + (s.value / total) * Math.PI * 2;
                at = to;
                const whole = shown.length === 1;
                return whole ? (
                  <circle
                    key={s.label}
                    cx="60"
                    cy="60"
                    r="46"
                    fill="none"
                    stroke={s.color}
                    strokeWidth="16"
                  >
                    <title>{s.label + ': ' + String(s.value)}</title>
                  </circle>
                ) : (
                  <path
                    key={s.label}
                    d={arc(60, 60, 46, from + gap, to - gap)}
                    fill="none"
                    stroke={s.color}
                    strokeWidth="16"
                  >
                    <title>
                      {s.label +
                        ': ' +
                        String(s.value) +
                        ' (' +
                        String(Math.round((s.value / total) * 100)) +
                        '%)'}
                    </title>
                  </path>
                );
              })
            : null}
          <text x="60" y="58" textAnchor="middle" className="pe-donut-number">
            {props.center ?? String(total)}
          </text>
          <text x="60" y="74" textAnchor="middle" className="pe-donut-label">
            {props.centerLabel ?? 'tasks'}
          </text>
        </svg>
        <Legend items={shown.map((s) => ({ label: s.label, color: s.color, value: s.value }))} />
      </div>
      <DataTable
        caption={props.title}
        head={['Part', 'Count']}
        rows={shown.map((s) => [s.label, s.value])}
      />
    </figure>
  );
}

const W = 640;
const H = 220;
const PAD = { top: 12, right: 8, bottom: 28, left: 32 };

/** Rounded steps for an axis: 0, 2, 4 … so the gridlines land on readable numbers. */
export function ticks(max: number): number[] {
  if (max <= 0) return [0, 1];
  const raw = max / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = 0; v <= max + step * 0.001; v += step) out.push(Math.round(v * 1000) / 1000);
  if ((out[out.length - 1] ?? 0) < max) out.push((out[out.length - 1] ?? 0) + step);
  return out;
}

const shortDate = (iso: string): string => {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
};

function Grid(props: { values: number[]; top: number; y: (v: number) => number }): ReactNode {
  return (
    <g>
      {props.values.map((v) => (
        <g key={v}>
          <line
            x1={PAD.left}
            x2={W - PAD.right}
            y1={props.y(v)}
            y2={props.y(v)}
            className="pe-chart-grid"
          />
          <text x={PAD.left - 6} y={props.y(v) + 4} textAnchor="end" className="pe-chart-axis">
            {v}
          </text>
        </g>
      ))}
    </g>
  );
}

export function WeeklyBars(props: {
  title: string;
  weeks: { week: string; created: number; completed: number }[];
}): ReactNode {
  const max = Math.max(1, ...props.weeks.flatMap((w) => [w.created, w.completed]));
  const grid = ticks(max);
  const top = grid[grid.length - 1] ?? max;
  const plotH = H - PAD.top - PAD.bottom;
  const y = (v: number): number => PAD.top + plotH - (v / top) * plotH;
  const slot = (W - PAD.left - PAD.right) / Math.max(1, props.weeks.length);
  const bar = Math.min(14, slot / 3);
  const id = useId();
  return (
    <figure className="pe-chart">
      <Legend
        items={[
          {
            label: 'Created',
            className: 'pe-series-1',
            value: props.weeks.reduce((n, w) => n + w.created, 0),
          },
          {
            label: 'Finished',
            className: 'pe-series-2',
            value: props.weeks.reduce((n, w) => n + w.completed, 0),
          },
        ]}
      />
      <svg
        viewBox={'0 0 ' + String(W) + ' ' + String(H)}
        width="100%"
        role="img"
        aria-labelledby={id}
      >
        <title id={id}>{props.title}</title>
        <Grid values={grid} top={top} y={y} />
        {props.weeks.map((w, i) => {
          const x = PAD.left + i * slot + slot / 2;
          return (
            <g key={w.week}>
              <rect
                x={x - bar - 1}
                y={y(w.created)}
                width={bar}
                height={Math.max(0, y(0) - y(w.created))}
                rx="3"
                className="pe-series-1"
              >
                <title>
                  {'Week of ' + shortDate(w.week) + ': ' + String(w.created) + ' created'}
                </title>
              </rect>
              <rect
                x={x + 1}
                y={y(w.completed)}
                width={bar}
                height={Math.max(0, y(0) - y(w.completed))}
                rx="3"
                className="pe-series-2"
              >
                <title>
                  {'Week of ' + shortDate(w.week) + ': ' + String(w.completed) + ' finished'}
                </title>
              </rect>
              {i % 2 === props.weeks.length % 2 ? (
                <text x={x} y={H - 8} textAnchor="middle" className="pe-chart-axis">
                  {shortDate(w.week)}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      <DataTable
        caption={props.title}
        head={['Week of', 'Created', 'Finished']}
        rows={props.weeks.map((w) => [w.week, w.created, w.completed])}
      />
    </figure>
  );
}

export function Burndown(props: {
  title: string;
  total: number;
  days: { date: string; remaining: number | null }[];
}): ReactNode {
  const grid = ticks(Math.max(1, props.total));
  const top = grid[grid.length - 1] ?? props.total;
  const plotH = H - PAD.top - PAD.bottom;
  const y = (v: number): number => PAD.top + plotH - (v / top) * plotH;
  const n = props.days.length;
  const x = (i: number): number =>
    PAD.left + (n <= 1 ? 0 : (i / (n - 1)) * (W - PAD.left - PAD.right));
  const actual = props.days.flatMap((d, i) =>
    d.remaining === null ? [] : [[x(i), y(d.remaining)] as const],
  );
  const path = actual
    .map(([px, py], i) => (i ? 'L' : 'M') + px.toFixed(1) + ' ' + py.toFixed(1))
    .join(' ');
  const last = actual[actual.length - 1];
  const id = useId();
  return (
    <figure className="pe-chart">
      <Legend
        items={[
          { label: 'Remaining', className: 'pe-series-1' },
          { label: 'Ideal', className: 'pe-series-muted' },
        ]}
      />
      <svg
        viewBox={'0 0 ' + String(W) + ' ' + String(H)}
        width="100%"
        role="img"
        aria-labelledby={id}
      >
        <title id={id}>{props.title}</title>
        <Grid values={grid} top={top} y={y} />
        <line x1={x(0)} y1={y(props.total)} x2={x(n - 1)} y2={y(0)} className="pe-chart-ideal" />
        {path ? <path d={path} className="pe-chart-line" fill="none" /> : null}
        {actual.map(([px, py], i) => (
          <circle key={i} cx={px} cy={py} r="3.5" className="pe-chart-point">
            <title>
              {shortDate(props.days[i]?.date ?? '') +
                ': ' +
                String(props.days[i]?.remaining ?? '') +
                ' remaining'}
            </title>
          </circle>
        ))}
        {last ? (
          <line
            x1={last[0]}
            x2={last[0]}
            y1={PAD.top}
            y2={H - PAD.bottom}
            className="pe-chart-today"
          />
        ) : null}
        {props.days.map((d, i) =>
          i === 0 || i === n - 1 || (n <= 15 && i % 2 === 0) ? (
            <text key={d.date} x={x(i)} y={H - 8} textAnchor="middle" className="pe-chart-axis">
              {shortDate(d.date)}
            </text>
          ) : null,
        )}
      </svg>
      <DataTable
        caption={props.title}
        head={['Day', 'Remaining']}
        rows={props.days.map((d) => [d.date, d.remaining ?? '–'])}
      />
    </figure>
  );
}

export interface HBarRow {
  label: string;
  parts: { label: string; value: number; className?: string; color?: string }[];
  href?: string;
}

/** Horizontal bars, stacked by part; each row scaled to the largest row. */
export function HBars(props: {
  title: string;
  rows: HBarRow[];
  legend?: { label: string; className?: string; color?: string }[];
  go?: (p: string) => void;
}): ReactNode {
  const max = Math.max(1, ...props.rows.map((r) => r.parts.reduce((n, p) => n + p.value, 0)));
  return (
    <figure className="pe-chart">
      {props.legend ? <Legend items={props.legend} /> : null}
      <ul className="pe-hbars" aria-label={props.title}>
        {props.rows.map((r) => {
          const total = r.parts.reduce((n, p) => n + p.value, 0);
          let at = 0;
          return (
            <li key={r.label} className="pe-hbar">
              <span className="pe-hbar-label">
                {r.href && props.go ? (
                  <a
                    href={r.href}
                    onClick={(e) => {
                      e.preventDefault();
                      props.go?.(r.href ?? '/');
                    }}
                  >
                    {r.label}
                  </a>
                ) : (
                  r.label
                )}
              </span>
              <svg
                className="pe-hbar-track"
                viewBox="0 0 100 10"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                <rect width="100" height="10" rx="2" className="pe-chart-track-fill" />
                {r.parts.map((p) => {
                  const w = (p.value / max) * 100;
                  const x = at;
                  at += w;
                  return p.value > 0 ? (
                    <rect
                      key={p.label}
                      x={x}
                      width={w}
                      height="10"
                      className={p.className}
                      fill={p.color}
                    >
                      <title>{p.label + ': ' + String(p.value)}</title>
                    </rect>
                  ) : null;
                })}
              </svg>
              <span className="pe-hbar-value">{total}</span>
            </li>
          );
        })}
      </ul>
      <DataTable
        caption={props.title}
        head={['', ...(props.rows[0]?.parts.map((p) => p.label) ?? [])]}
        rows={props.rows.map((r) => [r.label, ...r.parts.map((p) => p.value)])}
      />
    </figure>
  );
}

// ── [PCODE-116 | S15 | v0.1.0] KPI tile: a big coloured number, the change, and a mini bar chart ──
export function Kpi(props: {
  label: string;
  value: number | string;
  hint: string;
  /** change against the period before; positive shows ↗, negative ↘ */
  delta?: number;
  tone: 'coral' | 'indigo' | 'teal';
  bars: number[];
  /** the bar to highlight; the last one when left out */
  highlight?: number;
}): ReactNode {
  const max = Math.max(1, ...props.bars);
  const n = props.bars.length;
  const hi = props.highlight ?? n - 1;
  const w = 14;
  const gap = 9;
  const width = n * w + (n - 1) * gap;
  return (
    <div className={'pe-kpi pe-kpi--' + props.tone}>
      <div className="pe-kpi-text">
        <div className="pe-kpi-label">{props.label}</div>
        <div className="pe-kpi-row">
          <span className="pe-kpi-value">{props.value}</span>
          {props.delta !== undefined ? (
            <span className="pe-kpi-delta">
              {(props.delta >= 0 ? '+' : '') + String(props.delta)} {props.delta >= 0 ? '↗' : '↘'}
            </span>
          ) : null}
        </div>
        <div className="pe-kpi-hint">{props.hint}</div>
      </div>
      <svg
        className="pe-kpi-bars"
        viewBox={'0 0 ' + String(width) + ' 64'}
        width={width}
        height="64"
        role="img"
        aria-label={props.label + ': ' + props.bars.join(', ')}
      >
        {props.bars.map((v, i) => {
          const h = 20 + (v / max) * 44; // every bar shows; the values set the rest
          return (
            <rect
              key={i}
              x={i * (w + gap)}
              y={64 - Math.min(64, h)}
              width={w}
              height={Math.min(64, h)}
              rx="3"
              className={i === hi ? 'pe-kpi-bar pe-kpi-bar--on' : 'pe-kpi-bar'}
            >
              <title>{String(v)}</title>
            </rect>
          );
        })}
      </svg>
    </div>
  );
}
