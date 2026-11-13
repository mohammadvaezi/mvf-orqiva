// ── [PCODE-157 | S15 | v0.1.0] D5 preview: Agents, People, Tokens and costs, Activity, Insights, Settings ──
//    Why:  Activity that stays usable at any volume. 20 000 events of the last 24 hours sit in a virtual list
//          that renders only the rows in view; a histogram shows the shape of the day and zooms on click;
//          facets with live counts and a query language narrow it down; repeats collapse ("Coder finished
//          42 steps"); live tail adds new events without moving what you read; an event opens with its
//          before and after values and the full story of its object.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { events, type Ev } from './data5.js';
import { person } from './data.js';
import { PIcon } from './picons.js';
import { Avatar, Button, Chip, Kbd, PageHead } from './ui.js';

const ALL = events(20000);
const ROW = 36;
const VIEW = 560;
const BINS = 48;

type Facet = 'kind' | 'actor' | 'project';

const actorOf = (e: Ev): string => person(e.who).kind;

function counts(list: Ev[], f: Facet): [string, number][] {
  const m = new Map<string, number>();
  for (const e of list) {
    const k = f === 'kind' ? e.kind : f === 'actor' ? actorOf(e) : e.project;
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

export function parseQuery(q: string): { field: string; value: string; not: boolean }[] {
  return q
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => {
      const not = t.startsWith('-');
      const [field = '', value = ''] = (not ? t.slice(1) : t).split(':');
      return value
        ? { field, value: value.toLowerCase(), not }
        : { field: 'text', value: field.toLowerCase(), not };
    });
}

function matches(e: Ev, q: { field: string; value: string; not: boolean }[]): boolean {
  return q.every((c) => {
    const v =
      c.field === 'actor'
        ? actorOf(e) + ' ' + person(e.who).name.toLowerCase()
        : c.field === 'project'
          ? e.project.toLowerCase()
          : c.field === 'kind'
            ? e.kind
            : c.field === 'verb'
              ? e.verb
              : (person(e.who).name + ' ' + e.verb + ' ' + e.object).toLowerCase();
    const hit = v.includes(c.value);
    return c.not ? !hit : hit;
  });
}

export function ActivityPage(): ReactNode {
  const [mode, setMode] = useState<'firehose' | 'mine'>('firehose');
  const [query, setQuery] = useState('');
  const [facets, setFacets] = useState<Record<Facet, string | null>>({
    kind: null,
    actor: null,
    project: null,
  });
  const [zoom, setZoom] = useState<[number, number] | null>(null);
  const [collapse, setCollapse] = useState(true);
  const [live, setLive] = useState(false);
  const [extra, setExtra] = useState<Ev[]>([]);
  const [unseen, setUnseen] = useState(0);
  const [scroll, setScroll] = useState(0);
  const [sel, setSel] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);

  // live tail: a new event every 1.5 s; if the reader has scrolled, they are counted instead of shown
  useEffect(() => {
    if (!live) return undefined;
    const id = window.setInterval(() => {
      const fresh = events(1)[0];
      if (!fresh) return;
      setExtra((x) => [{ ...fresh, i: 100000 + x.length, t: 'now', minute: 0 }, ...x]);
      if ((box.current?.scrollTop ?? 0) > 0) setUnseen((n) => n + 1);
    }, 1500);
    return () => {
      window.clearInterval(id);
    };
  }, [live]);

  const q = useMemo(() => parseQuery(query), [query]);
  const base = useMemo(() => {
    const src = [...extra, ...ALL];
    return src.filter(
      (e) =>
        (mode === 'firehose' ||
          e.object === 'NWL-188' ||
          e.object === 'NWL-191' ||
          e.who === 'lea') &&
        matches(e, q) &&
        (!zoom || (e.minute >= zoom[0] && e.minute < zoom[1])),
    );
  }, [extra, mode, q, zoom]);
  const filtered = useMemo(
    () =>
      base.filter(
        (e) =>
          (!facets.kind || e.kind === facets.kind) &&
          (!facets.actor || actorOf(e) === facets.actor) &&
          (!facets.project || e.project === facets.project),
      ),
    [base, facets],
  );

  const bins = useMemo(() => {
    const b = new Array<number>(BINS).fill(0);
    for (const e of ALL) {
      const k = Math.min(BINS - 1, Math.floor(e.minute / 30));
      b[k] = (b[k] ?? 0) + 1;
    }
    return b;
  }, []);
  const peak = Math.max(...bins);

  const first = Math.max(0, Math.floor(scroll / ROW) - 5);
  const count = Math.ceil(VIEW / ROW) + 10;
  const rows = filtered.slice(first, first + count);
  const current = sel !== null ? filtered.find((e) => e.i === sel) : undefined;
  const story = current ? ALL.filter((e) => e.object === current.object).slice(0, 8) : [];

  const facetBox = (f: Facet, label: string): ReactNode => (
    <div className="pv-facet">
      <div className="pv-facet-head">{label}</div>
      {counts(base, f)
        .slice(0, 6)
        .map(([k, n]) => (
          <button
            key={k}
            type="button"
            className="pv-facet-item"
            aria-pressed={facets[f] === k}
            onClick={() => {
              setFacets((s) => ({ ...s, [f]: s[f] === k ? null : k }));
            }}
          >
            <span>
              {f === 'actor'
                ? k === 'agent'
                  ? 'Agents'
                  : k === 'client'
                    ? 'Clients'
                    : 'People'
                : k}
            </span>
            <span className="pv-num pv-muted">{n.toLocaleString('en')}</span>
          </button>
        ))}
    </div>
  );

  return (
    <div className="pv-page pv-page--wide">
      <PageHead
        title="Activity"
        sub={
          'Last 24 hours · ' +
          ALL.length.toLocaleString('en') +
          ' events · kept 90 days searchable, 7 years archived'
        }
        icon="activity"
        actions={
          <>
            <select className="pv-select" aria-label="Saved view" defaultValue="">
              <option value="">Saved views…</option>
              <option>Agent actions on HEL</option>
              <option>Everything a client did this week</option>
              <option>Deploys and rollbacks</option>
            </select>
            <Button kind="ghost" icon="external">
              Export (CSV, JSON)
            </Button>
          </>
        }
      />
      <div className="pv-toolbar pv-mb">
        <div className="pv-segmented" role="radiogroup" aria-label="Mode">
          <button
            type="button"
            role="radio"
            aria-checked={mode === 'firehose'}
            className="pv-seg"
            onClick={() => {
              setMode('firehose');
            }}
          >
            Everything
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={mode === 'mine'}
            className="pv-seg"
            onClick={() => {
              setMode('mine');
            }}
          >
            My work and what I follow
          </button>
        </div>
        <label className="pv-query">
          <PIcon name="search" size={15} />
          <input
            value={query}
            placeholder="actor:agent project:hel -kind:test  or any words"
            aria-label="Query"
            onChange={(e) => {
              setQuery(e.target.value);
            }}
          />
          <Kbd>/</Kbd>
        </label>
        <label className="pv-switch">
          <input
            type="checkbox"
            checked={collapse}
            onChange={(e) => {
              setCollapse(e.target.checked);
            }}
          />
          <span>Collapse repeats</span>
        </label>
        <label className="pv-switch">
          <input
            type="checkbox"
            checked={live}
            onChange={(e) => {
              setLive(e.target.checked);
              setUnseen(0);
            }}
          />
          <span className={live ? 'pv-live-on' : ''}>Live tail</span>
        </label>
      </div>
      <div className="pv-histo-wrap">
        <svg
          className="pv-histo"
          viewBox={'0 0 ' + String(BINS * 20) + ' 70'}
          preserveAspectRatio="none"
          role="img"
          aria-label="Events per half hour"
        >
          {bins.map((n, i) => {
            // index 0 is the newest half hour; draw oldest on the left
            const x = (BINS - 1 - i) * 20;
            const h = (n / peak) * 60;
            const inZoom = zoom && i * 30 >= zoom[0] && i * 30 < zoom[1];
            return (
              <rect
                key={i}
                className={
                  'pv-histo-bar' +
                  (inZoom ? ' pv-histo-bar--on' : '') +
                  (n === peak ? ' pv-histo-bar--peak' : '')
                }
                x={x + 2}
                y={66 - h}
                width="16"
                height={h}
                rx="2"
                onClick={() => {
                  setZoom([i * 30, i * 30 + 30]);
                }}
              >
                <title>{String(n) + ' events'}</title>
              </rect>
            );
          })}
        </svg>
        <div className="pv-histo-foot">
          <span className="pv-muted pv-small">24 h ago</span>
          {zoom ? (
            <Chip tone="primary">
              {'Zoomed to ' +
                String(Math.floor(zoom[0] / 60)) +
                ':' +
                String(zoom[0] % 60).padStart(2, '0') +
                ' h ago'}{' '}
              <button
                type="button"
                className="pv-link-btn"
                onClick={() => {
                  setZoom(null);
                }}
              >
                reset
              </button>
            </Chip>
          ) : (
            <span className="pv-muted pv-small">Click a bar to zoom · the peak is marked</span>
          )}
          <Button size="sm" kind="ghost" icon="sparkle">
            Explain the peak
          </Button>
          <span className="pv-muted pv-small">now</span>
        </div>
      </div>
      <div className={'pv-activity' + (current ? ' pv-activity--detail' : '')}>
        <aside className="pv-facets" aria-label="Facets">
          {facetBox('actor', 'Who')}
          {facetBox('kind', 'Kind')}
          {facetBox('project', 'Project')}
        </aside>
        <section className="pv-stream">
          <div className="pv-stream-head">
            <strong className="pv-num">{filtered.length.toLocaleString('en')}</strong>{' '}
            <span className="pv-muted">events match</span>
            <span className="pv-spacer" />
            {unseen ? (
              <button
                type="button"
                className="pv-new-pill"
                onClick={() => {
                  box.current?.scrollTo({ top: 0 });
                  setUnseen(0);
                }}
              >
                {String(unseen) + ' new events ↑'}
              </button>
            ) : null}
            <span className="pv-muted pv-small">rendering {rows.length} rows · scroll freely</span>
          </div>
          <div
            className="pv-virtual"
            ref={box}
            onScroll={(e) => {
              setScroll(e.currentTarget.scrollTop);
              if (e.currentTarget.scrollTop === 0) setUnseen(0);
            }}
          >
            <svg className="pv-spacer-svg" width="1" height={first * ROW} aria-hidden="true" />
            {rows.map((e) => (
              <button
                key={e.i}
                type="button"
                className="pv-ev"
                aria-current={sel === e.i ? 'true' : undefined}
                onClick={() => {
                  setSel(e.i);
                }}
              >
                <span className="pv-ev-time pv-num">{e.t}</span>
                <Avatar id={e.who} size="xs" />
                <span className="pv-ev-text">
                  <strong>{person(e.who).name}</strong> {e.verb}{' '}
                  <span className="pv-mono">{e.object}</span>
                  {collapse && e.repeat ? (
                    <Chip tone="agent">{'+' + String(e.repeat) + ' similar steps'}</Chip>
                  ) : null}
                </span>
                <span className={'pv-ev-kind pv-ev-kind--' + e.kind}>{e.kind}</span>
                <span className="pv-mono pv-muted pv-small">{e.project}</span>
              </button>
            ))}
            <svg
              className="pv-spacer-svg"
              width="1"
              height={Math.max(0, (filtered.length - first - rows.length) * ROW)}
              aria-hidden="true"
            />
          </div>
        </section>
        {current ? (
          <aside className="pv-ev-detail" aria-label="Event">
            <div className="pv-drawer-head">
              <strong>Event</strong>
              <span className="pv-spacer" />
              <button
                type="button"
                className="pv-icon-btn"
                aria-label="Close"
                onClick={() => {
                  setSel(null);
                }}
              >
                <PIcon name="x" />
              </button>
            </div>
            <div className="pv-drawer-body">
              <p>
                <strong>{person(current.who).name}</strong> {current.verb}{' '}
                <span className="pv-mono">{current.object}</span>
              </p>
              <div className="pv-kv">
                <span>When</span>
                <span>today {current.t} (Europe/Berlin)</span>
                <span>Project</span>
                <span>{current.project}</span>
                <span>Source</span>
                <span>
                  {person(current.who).kind === 'agent' ? 'agent run 1 482, step 9' : 'web app'}
                </span>
                <span>Link</span>
                <span className="pv-mono pv-small">/activity/ev_{String(current.i)}</span>
              </div>
              <div className="pv-diff pv-mt">
                <div className="pv-del">state: In Progress</div>
                <div className="pv-ins">state: Review</div>
              </div>
              <h3 className="pv-ev-story-h">The story of {current.object}</h3>
              <ol className="pv-story">
                {story.map((s) => (
                  <li key={s.i}>
                    <span className="pv-num pv-muted pv-small">{s.t}</span> {person(s.who).name}{' '}
                    {s.verb}
                  </li>
                ))}
              </ol>
            </div>
          </aside>
        ) : null}
      </div>
    </div>
  );
}
