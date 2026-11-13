// ── [PCODE-440 | S15 | v0.1.0] T37 Consistency: errors and loading are announced everywhere ──
// ── [PCODE-281 | S15 | v0.1.0] T29.3 Document embeds: live task lists, designs, Gantt, repo code; README import ──
//    Why:  the live parts of a page: a task list that follows the project as tasks change, the latest
//          version of a design, the plan as a timeline, and repository lines as the last scan sent them.
//          Each reads its own small answer from the server; outside a project it says where it works.
import { readEmbed, type ActivityEvent, type Embed } from '@orqiva/shared';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api } from '../core/api.js';
import type { EventHub } from '../core/hub.js';
import { Chip } from '../preview/ui.js';

export interface EmbedCtx {
  workspaceId: string;
  projectId: string;
  hub: EventHub | null;
  open: (path: string) => void;
}

const W = (ctx: EmbedCtx, p: string): string =>
  '/api/workspaces/' + ctx.workspaceId + '/projects/' + ctx.projectId + p;

// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- T names the shape of the answer
function useAnswer<T>(
  path: string | null,
  ctx: EmbedCtx,
  live: (e: ActivityEvent) => boolean,
): { data: T | null; error: string } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    if (!path) return;
    const r = await api<T>('GET', path);
    if (r.ok) {
      setData(r.data);
      setError('');
    } else setError(r.error.message);
  }, [path]);
  useEffect(() => {
    void load();
    if (!ctx.hub) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const off = ctx.hub.on((e) => {
      if (!live(e)) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void load(), 400);
    });
    return () => {
      off();
      if (timer) clearTimeout(timer);
    };
    // live is a fresh function each render; what it reads is in the path
  }, [load, ctx.hub]);
  return { data, error };
}

const Frame = (props: { title: ReactNode; sub?: ReactNode; children: ReactNode }): ReactNode => (
  <figure className="v2-embed">
    <figcaption>
      <strong>{props.title}</strong>
      {props.sub ? <span className="pv-muted pv-small"> {props.sub}</span> : null}
    </figcaption>
    {props.children}
  </figure>
);

interface TaskAnswer {
  total: number;
  tasks: {
    id: string;
    ref: string;
    title: string;
    state: string;
    stateGroup: string;
    kind: string;
    assignee: string | null;
  }[];
}

function TasksEmbed(props: {
  e: Extract<Embed, { kind: 'tasks' }>;
  src: string;
  ctx: EmbedCtx;
}): ReactNode {
  const query = props.src.replace(/^tasks\s*:?\s*/i, '');
  const { data, error } = useAnswer<TaskAnswer>(
    W(props.ctx, '/embed/tasks?query=' + encodeURIComponent(query)),
    props.ctx,
    (e) => e.data.object.type === 'item' && e.projectid === props.ctx.projectId,
  );
  const tone = (g: string): 'success' | 'primary' | 'neutral' =>
    g === 'completed' ? 'success' : g === 'started' ? 'primary' : 'neutral';
  return (
    <Frame title="Tasks" sub={(query || 'all') + (data ? ' · ' + String(data.total) : '')}>
      {error ? (
        <p className="v2-error" role="alert">
          {error}
        </p>
      ) : null}
      <ul className="v2-embed-tasks">
        {data?.tasks.map((t) => (
          <li key={t.id}>
            <input
              type="checkbox"
              readOnly
              checked={t.stateGroup === 'completed'}
              aria-label={t.stateGroup === 'completed' ? 'done' : 'open'}
            />
            <a
              href={'/items/' + t.id}
              onClick={(ev) => {
                ev.preventDefault();
                props.ctx.open('/items/' + t.id);
              }}
            >
              <span className="pv-mono pv-muted">{t.ref}</span> {t.title}
            </a>
            {t.kind !== 'task' ? <Chip>{t.kind}</Chip> : null}
            <Chip tone={tone(t.stateGroup)}>{t.state}</Chip>
            <span className="pv-muted pv-small">{t.assignee ?? 'nobody'}</span>
          </li>
        ))}
        {data && !data.tasks.length ? <li className="pv-muted">No task matches.</li> : null}
      </ul>
      {data && data.total > data.tasks.length ? (
        <p className="pv-small pv-muted">
          {data.total - data.tasks.length} more; raise limit: to see them
        </p>
      ) : null}
    </Frame>
  );
}

interface Mockup {
  id: string;
  title: string;
  status: string;
  version: number;
  imageUrl: string | null;
}

function DesignEmbed(props: { e: Extract<Embed, { kind: 'design' }>; ctx: EmbedCtx }): ReactNode {
  const { data, error } = useAnswer<Mockup[]>(
    W(props.ctx, '/mockups'),
    props.ctx,
    // a new design version is read when the page opens again
    () => false,
  );
  const want = props.e.ref.toLowerCase();
  const m = data?.find((x) => x.id === props.e.ref || x.title.toLowerCase() === want);
  return (
    <Frame
      title={m ? m.title : props.e.ref}
      sub={
        m ? 'design · version ' + String(m.version) + ' · ' + m.status.replace('_', ' ') : 'design'
      }
    >
      {error ? (
        <p className="v2-error" role="alert">
          {error}
        </p>
      ) : null}
      {data && !m ? (
        <p className="pv-muted">No design called {props.e.ref} in the UI kit.</p>
      ) : null}
      {m?.imageUrl ? <img className="v2-md-img" src={m.imageUrl} alt={m.title} /> : null}
      {m && !m.imageUrl ? <p className="pv-muted">This design has no image yet.</p> : null}
    </Frame>
  );
}

interface PlanAnswer {
  start: string | null;
  finish: string | null;
  today: string;
  bars: {
    id: string;
    ref: string;
    title: string;
    start: string;
    finish: string;
    level: number;
    summary: boolean;
    milestone: boolean;
    critical: boolean;
    percentDone: number;
  }[];
}

const dayOf = (iso: string): number =>
  Math.round(Date.parse(iso.slice(0, 10) + 'T00:00:00Z') / 86_400_000);

/** Where a bar sits on a timeline of the given width, in pixels. */
export function barGeometry(
  bar: { start: string; finish: string },
  from: string,
  to: string,
  width: number,
): { x: number; w: number } {
  const span = Math.max(1, dayOf(to) - dayOf(from) + 1);
  const x = ((dayOf(bar.start) - dayOf(from)) / span) * width;
  const w = Math.max(3, ((dayOf(bar.finish) - dayOf(bar.start) + 1) / span) * width);
  return { x: Math.round(x * 10) / 10, w: Math.round(w * 10) / 10 };
}

function GanttEmbed(props: { e: Extract<Embed, { kind: 'gantt' }>; ctx: EmbedCtx }): ReactNode {
  const { data, error } = useAnswer<PlanAnswer>(
    W(
      props.ctx,
      '/embed/plan' + (props.e.sprint ? '?sprint=' + encodeURIComponent(props.e.sprint) : ''),
    ),
    props.ctx,
    (e) => e.projectid === props.ctx.projectId && e.data.object.type === 'item',
  );
  const LABEL = 170;
  const TL = 320;
  const ROW = 22;
  return (
    <Frame
      title="Plan"
      sub={
        (props.e.sprint ? 'sprint ' + props.e.sprint : 'all tasks') +
        (data?.start ? ' · ' + data.start + ' to ' + String(data.finish) : '')
      }
    >
      {error ? (
        <p className="v2-error" role="alert">
          {error}
        </p>
      ) : null}
      {data && !data.bars.length ? <p className="pv-muted">No tasks are planned.</p> : null}
      {data?.start && data.finish && data.bars.length ? (
        <div className="v2-scroll">
          <svg
            className="v2-embed-gantt"
            width={LABEL + TL}
            height={data.bars.length * ROW + 8}
            role="img"
            aria-label="The plan as bars"
          >
            {data.today >= data.start && data.today <= data.finish ? (
              <line
                className="v2-embed-today"
                x1={
                  LABEL +
                  barGeometry(
                    { start: data.today, finish: data.today },
                    data.start,
                    data.finish,
                    TL,
                  ).x
                }
                x2={
                  LABEL +
                  barGeometry(
                    { start: data.today, finish: data.today },
                    data.start,
                    data.finish,
                    TL,
                  ).x
                }
                y1={0}
                y2={data.bars.length * ROW + 8}
              />
            ) : null}
            {data.bars.map((b, i) => {
              const g = barGeometry(b, data.start ?? b.start, data.finish ?? b.finish, TL);
              const y = i * ROW + 4;
              return (
                <g key={b.id}>
                  <text
                    x={4 + b.level * 10}
                    y={y + 14}
                    className={b.summary ? 'v2-embed-sum' : undefined}
                  >
                    {(b.ref + ' ' + b.title).slice(0, 24)}
                  </text>
                  {b.milestone ? (
                    <polygon
                      className="v2-embed-ms"
                      points={[
                        [LABEL + g.x, y + 3],
                        [LABEL + g.x + 7, y + 10],
                        [LABEL + g.x, y + 17],
                        [LABEL + g.x - 7, y + 10],
                      ]
                        .map((p) => p.join(','))
                        .join(' ')}
                    />
                  ) : (
                    <>
                      <rect
                        x={LABEL + g.x}
                        y={y + (b.summary ? 7 : 4)}
                        width={g.w}
                        height={b.summary ? 6 : 13}
                        rx={2}
                        className={
                          'v2-embed-bar' +
                          (b.critical ? ' v2-embed-bar--crit' : '') +
                          (b.summary ? ' v2-embed-bar--sum' : '')
                        }
                      />
                      {b.percentDone > 0 && !b.summary ? (
                        <rect
                          x={LABEL + g.x}
                          y={y + 4}
                          width={(g.w * Math.min(100, b.percentDone)) / 100}
                          height={13}
                          rx={2}
                          className="v2-embed-done"
                        />
                      ) : null}
                    </>
                  )}
                  <title>{b.ref + ' ' + b.title + ': ' + b.start + ' to ' + b.finish}</title>
                </g>
              );
            })}
          </svg>
        </div>
      ) : null}
    </Frame>
  );
}

interface CodeAnswer {
  path: string;
  total: number;
  from: number;
  lines: string[];
  scannedAt: string;
}

function CodeEmbed(props: { e: Extract<Embed, { kind: 'code' }>; ctx: EmbedCtx }): ReactNode {
  const q = new URLSearchParams({ path: props.e.path });
  if (props.e.from !== null) q.set('from', String(props.e.from));
  if (props.e.to !== null) q.set('to', String(props.e.to));
  const { data, error } = useAnswer<CodeAnswer>(
    W(props.ctx, '/code-text?' + q.toString()),
    props.ctx,
    () => false,
  );
  return (
    <Frame
      title={props.e.path}
      sub={
        data
          ? 'lines ' +
            String(data.from) +
            '–' +
            String(data.from + data.lines.length - 1) +
            ' of ' +
            String(data.total) +
            ' · read ' +
            data.scannedAt.slice(0, 10)
          : 'code'
      }
    >
      {error ? <p className="pv-muted pv-small">{error}</p> : null}
      {data ? (
        <pre className="v2-embed-code">
          <code>
            {data.lines.map((l, i) => (
              <span key={i} className="v2-embed-line">
                <span className="v2-embed-n" aria-hidden="true">
                  {data.from + i}
                </span>
                {l + '\n'}
              </span>
            ))}
          </code>
        </pre>
      ) : null}
    </Frame>
  );
}

/** An embed block: drawn live inside a project, its line shown elsewhere. */
export function EmbedView(props: { src: string; ctx: EmbedCtx | null | undefined }): ReactNode {
  let e: Embed;
  try {
    e = readEmbed(props.src);
  } catch (err) {
    return (
      <figure className="v2-md-code">
        <figcaption>{err instanceof Error ? err.message : 'This embed cannot be read'}</figcaption>
        <pre>
          <code>{props.src}</code>
        </pre>
      </figure>
    );
  }
  if (!props.ctx)
    return (
      <figure className="v2-md-code">
        <figcaption>Embed (shown live in the project’s documents)</figcaption>
        <pre>
          <code>{props.src}</code>
        </pre>
      </figure>
    );
  switch (e.kind) {
    case 'tasks':
      return <TasksEmbed e={e} src={props.src.trim()} ctx={props.ctx} />;
    case 'design':
      return <DesignEmbed e={e} ctx={props.ctx} />;
    case 'gantt':
      return <GanttEmbed e={e} ctx={props.ctx} />;
    case 'code':
      return <CodeEmbed e={e} ctx={props.ctx} />;
  }
}
