// ── [PCODE-256 | S15 | v0.1.0] T26.5 Planning charts: burndown and burnup in points, cumulative flow, control chart, lead time ──
//    Why:  the charts of Reports, drawn as plain SVG that scales with its card: a sprint's burnup and
//          burndown in points or tasks, the cumulative flow of the last weeks, the control chart of finished
//          tasks and how long tasks took from idea to done.
import { useEffect, useState, type ReactNode } from 'react';
import { api } from '../core/api.js';
import { Card } from '../preview/ui.js';

const W = (ws: string, p: string): string => '/api/workspaces/' + ws + p;
const WIDTH = 600;
const HEIGHT = 200;
const PAD = { l: 34, r: 10, t: 10, b: 24 };

const x = (i: number, n: number, w = WIDTH): number =>
  PAD.l + (n <= 1 ? 0 : (i / (n - 1)) * (w - PAD.l - PAD.r));
const y = (v: number, max: number): number =>
  HEIGHT - PAD.b - (max ? (v / max) * (HEIGHT - PAD.t - PAD.b) : 0);

function Axes(props: { max: number; labels: string[]; width?: number }): ReactNode {
  const n = props.labels.length;
  const w = props.width ?? WIDTH;
  const every = Math.max(1, Math.ceil(n / (w > WIDTH ? 10 : 6)));
  // whole numbers only, each once
  const marks = [...new Set([0, Math.round(props.max / 2), Math.round(props.max)])];
  return (
    <g className="fc-axes">
      <line x1={PAD.l} y1={HEIGHT - PAD.b} x2={w - PAD.r} y2={HEIGHT - PAD.b} />
      {marks.map((v) => (
        <g key={v}>
          <line
            className="fc-grid"
            x1={PAD.l}
            x2={w - PAD.r}
            y1={y(v, props.max)}
            y2={y(v, props.max)}
          />
          <text x={PAD.l - 4} y={y(v, props.max) + 3} textAnchor="end">
            {v}
          </text>
        </g>
      ))}
      {props.labels.map((l, i) =>
        i % every === 0 || i === n - 1 ? (
          <text key={l + String(i)} x={x(i, n, w)} y={HEIGHT - 6} textAnchor="middle">
            {l}
          </text>
        ) : null,
      )}
    </g>
  );
}

/** Lines over days. */
export function LineChart(props: {
  labels: string[];
  series: { name: string; values: number[]; className: string; dashed?: boolean }[];
  title: string;
}): ReactNode {
  const max = Math.max(1, ...props.series.flatMap((s) => s.values));
  const n = props.labels.length;
  return (
    <figure className="fc-figure">
      <svg
        viewBox={'0 0 ' + String(WIDTH) + ' ' + String(HEIGHT)}
        role="img"
        aria-label={props.title}
      >
        <Axes max={max} labels={props.labels} />
        {props.series.map((s) => (
          <polyline
            key={s.name}
            className={'fc-line ' + s.className}
            strokeDasharray={s.dashed ? '4 4' : undefined}
            points={s.values.map((v, i) => String(x(i, n)) + ',' + String(y(v, max))).join(' ')}
          />
        ))}
      </svg>
      <figcaption className="fc-legend">
        {props.series.map((s) => (
          <span key={s.name}>
            <i className={'fc-key ' + s.className} /> {s.name}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}

/** Bands stacked over days: the cumulative flow. */
export function StackedArea(props: {
  labels: string[];
  layers: { name: string; values: number[]; className: string }[];
  title: string;
}): ReactNode {
  const n = props.labels.length;
  // a full-width chart draws on a wider canvas, so it is not taller than the others
  const w = WIDTH * 2;
  const totals = props.labels.map((_, i) =>
    props.layers.reduce((a, l) => a + (l.values[i] ?? 0), 0),
  );
  const max = Math.max(1, ...totals);
  let below = props.labels.map(() => 0);
  const bands = props.layers.map((l) => {
    const top = below.map((b, i) => b + (l.values[i] ?? 0));
    const pts = [
      ...top.map((v, i) => String(x(i, n, w)) + ',' + String(y(v, max))),
      ...below.map((v, i) => String(x(i, n, w)) + ',' + String(y(v, max))).reverse(),
    ].join(' ');
    below = top;
    return { name: l.name, className: l.className, pts };
  });
  return (
    <figure className="fc-figure">
      <svg viewBox={'0 0 ' + String(w) + ' ' + String(HEIGHT)} role="img" aria-label={props.title}>
        <Axes max={max} labels={props.labels} width={w} />
        {bands.map((b) => (
          <polygon key={b.name} className={'fc-band ' + b.className} points={b.pts} />
        ))}
      </svg>
      <figcaption className="fc-legend">
        {[...props.layers].reverse().map((l) => (
          <span key={l.name}>
            <i className={'fc-key ' + l.className} /> {l.name}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}

interface Burn {
  sprint: { name: string };
  days: {
    day: string;
    scopePoints: number;
    donePoints: number;
    scopeTasks: number;
    doneTasks: number;
  }[];
}
interface Flow {
  days: { day: string; backlog: number; unstarted: number; started: number; completed: number }[];
}
interface Cycle {
  tasks: {
    itemId: string;
    ref: string;
    title: string;
    completedAt: string;
    cycleDays: number | null;
    leadDays: number;
  }[];
  cycle: {
    count: number;
    mean: number | null;
    sd: number | null;
    p50: number | null;
    p85: number | null;
  };
  lead: { count: number; mean: number | null; p50: number | null; p85: number | null };
  leadHistogram: { from: number; count: number }[];
}

const short = (d: string): string => d.slice(8, 10) + '.' + d.slice(5, 7) + '.';

/** Reports: burnup and burndown of the sprint, any sprint, in points or tasks. */
export function BurnCharts(props: { workspaceId: string; sprintId: string }): ReactNode {
  const [d, setD] = useState<Burn | null>(null);
  const [tasks, setTasks] = useState(false);
  useEffect(() => {
    void api<Burn>('GET', W(props.workspaceId, '/sprints/' + props.sprintId + '/charts/burn')).then(
      (r) => {
        if (r.ok) setD(r.data);
      },
    );
  }, [props.workspaceId, props.sprintId]);
  if (!d) return null;
  const labels = d.days.map((x) => short(x.day));
  const scope = d.days.map((x) => (tasks ? x.scopeTasks : x.scopePoints));
  const done = d.days.map((x) => (tasks ? x.doneTasks : x.donePoints));
  const toggle = (
    <span className="pv-segmented" role="radiogroup" aria-label="Count">
      {[false, true].map((v) => (
        <button
          key={String(v)}
          type="button"
          role="radio"
          aria-checked={tasks === v}
          className="pv-seg"
          onClick={() => {
            setTasks(v);
          }}
        >
          {v ? 'Tasks' : 'Points'}
        </button>
      ))}
    </span>
  );
  return (
    <div className="pv-split pv-split--even">
      <Card title={'Burnup · ' + d.sprint.name} action={toggle}>
        {d.days.length ? (
          <LineChart
            title="Burnup"
            labels={labels}
            series={[
              { name: 'Scope', values: scope, className: 'fc-scope', dashed: true },
              { name: 'Done', values: done, className: 'fc-done' },
            ]}
          />
        ) : (
          <p className="pv-muted">The sprint has not started yet.</p>
        )}
      </Card>
      <Card title={'Burndown · ' + d.sprint.name}>
        {d.days.length ? (
          <LineChart
            title="Burndown"
            labels={labels}
            series={[
              {
                name: 'Ideal',
                values: scope.map((s0, i) =>
                  Math.round(
                    ((scope[0] ?? s0) * (scope.length - 1 - i)) / Math.max(1, scope.length - 1),
                  ),
                ),
                className: 'fc-ideal',
                dashed: true,
              },
              {
                name: 'Remaining',
                values: scope.map((s0, i) => s0 - (done[i] ?? 0)),
                className: 'fc-remaining',
              },
            ]}
          />
        ) : (
          <p className="pv-muted">The sprint has not started yet.</p>
        )}
      </Card>
    </div>
  );
}

/** Reports: cumulative flow, the control chart and lead times. */
export function FlowCharts(props: { workspaceId: string; projectId: string }): ReactNode {
  const [flow, setFlow] = useState<Flow | null>(null);
  const [cycle, setCycle] = useState<Cycle | null>(null);
  useEffect(() => {
    const P = W(props.workspaceId, '/projects/' + props.projectId + '/charts');
    void api<Flow>('GET', P + '/flow?days=30').then((r) => {
      if (r.ok) setFlow(r.data);
    });
    void api<Cycle>('GET', P + '/cycle?days=90').then((r) => {
      if (r.ok) setCycle(r.data);
    });
  }, [props.workspaceId, props.projectId]);
  const timed = cycle?.tasks.filter((t) => t.cycleDays !== null) ?? [];
  const maxY = Math.max(1, ...timed.map((t) => t.cycleDays ?? 0), cycle?.cycle.p85 ?? 0);
  const first = timed[0] ? Date.parse(timed[0].completedAt) : 0;
  const last = timed.at(-1) ? Date.parse(timed.at(-1)?.completedAt ?? '') : 1;
  const px = (at: string): number =>
    PAD.l + ((Date.parse(at) - first) / Math.max(1, last - first)) * (WIDTH - PAD.l - PAD.r);
  return (
    <>
      <Card title="Cumulative flow · 30 days">
        {flow ? (
          <StackedArea
            title="Cumulative flow"
            labels={flow.days.map((d) => short(d.day))}
            layers={[
              {
                name: 'Done',
                values: flow.days.map((d) => d.completed),
                className: 'fc-g-completed',
              },
              {
                name: 'In progress',
                values: flow.days.map((d) => d.started),
                className: 'fc-g-started',
              },
              {
                name: 'To do',
                values: flow.days.map((d) => d.unstarted),
                className: 'fc-g-unstarted',
              },
              {
                name: 'Backlog',
                values: flow.days.map((d) => d.backlog),
                className: 'fc-g-backlog',
              },
            ]}
          />
        ) : null}
      </Card>
      <div className="pv-split pv-split--even">
        <Card
          title="Control chart · 90 days"
          action={
            cycle?.cycle.count ? (
              <span className="pv-muted pv-small">
                average {String(cycle.cycle.mean)} d · 85 % within {String(cycle.cycle.p85)} d
              </span>
            ) : null
          }
        >
          {timed.length ? (
            <figure className="fc-figure">
              <svg
                viewBox={'0 0 ' + String(WIDTH) + ' ' + String(HEIGHT)}
                role="img"
                aria-label="Control chart"
              >
                <Axes
                  max={maxY}
                  labels={[
                    short(timed[0]?.completedAt ?? ''),
                    short(timed.at(-1)?.completedAt ?? ''),
                  ]}
                />
                {cycle?.cycle.mean !== null && cycle?.cycle.mean !== undefined ? (
                  <line
                    className="fc-mean"
                    x1={PAD.l}
                    x2={WIDTH - PAD.r}
                    y1={y(cycle.cycle.mean, maxY)}
                    y2={y(cycle.cycle.mean, maxY)}
                  />
                ) : null}
                {cycle?.cycle.p85 !== null && cycle?.cycle.p85 !== undefined ? (
                  <line
                    className="fc-p85"
                    x1={PAD.l}
                    x2={WIDTH - PAD.r}
                    y1={y(cycle.cycle.p85, maxY)}
                    y2={y(cycle.cycle.p85, maxY)}
                  />
                ) : null}
                {timed.map((t) => (
                  <circle
                    key={t.itemId}
                    className="fc-dot"
                    cx={px(t.completedAt)}
                    cy={y(t.cycleDays ?? 0, maxY)}
                    r={4}
                  >
                    <title>{t.ref + ' ' + t.title + ': ' + String(t.cycleDays) + ' days'}</title>
                  </circle>
                ))}
              </svg>
              <figcaption className="fc-legend">
                <span>
                  <i className="fc-key fc-dot" /> a finished task (days from start to done)
                </span>
                <span>
                  <i className="fc-key fc-mean" /> average
                </span>
                <span>
                  <i className="fc-key fc-p85" /> 85th percentile
                </span>
              </figcaption>
            </figure>
          ) : (
            <p className="pv-muted">No task finished in the last 90 days.</p>
          )}
        </Card>
        <Card
          title="Lead time"
          action={
            cycle?.lead.count ? (
              <span className="pv-muted pv-small">
                half within {String(cycle.lead.p50)} d · 85 % within {String(cycle.lead.p85)} d
              </span>
            ) : null
          }
        >
          {cycle?.leadHistogram.length ? (
            <figure className="fc-figure">
              <svg
                viewBox={'0 0 ' + String(WIDTH) + ' ' + String(HEIGHT)}
                role="img"
                aria-label="Lead time"
              >
                <Axes
                  max={Math.max(1, ...cycle.leadHistogram.map((b) => b.count))}
                  labels={cycle.leadHistogram.map((b) => String(b.from) + ' d')}
                />
                {cycle.leadHistogram.map((b, i) => {
                  const n = cycle.leadHistogram.length;
                  const w = (WIDTH - PAD.l - PAD.r) / Math.max(1, n) - 4;
                  const max = Math.max(1, ...cycle.leadHistogram.map((z) => z.count));
                  return (
                    <rect
                      key={b.from}
                      className="fc-bar"
                      x={PAD.l + i * ((WIDTH - PAD.l - PAD.r) / Math.max(1, n)) + 2}
                      y={y(b.count, max)}
                      width={Math.max(2, w)}
                      height={HEIGHT - PAD.b - y(b.count, max)}
                    >
                      <title>
                        {String(b.count) +
                          ' tasks took ' +
                          String(b.from) +
                          ' days or a little more'}
                      </title>
                    </rect>
                  );
                })}
              </svg>
              <figcaption className="fc-legend">
                <span>tasks by days from being filed to done</span>
              </figcaption>
            </figure>
          ) : (
            <p className="pv-muted">No task finished in the last 90 days.</p>
          )}
        </Card>
      </div>
    </>
  );
}
