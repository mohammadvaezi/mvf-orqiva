// ── [PCODE-440 | S15 | v0.1.0] T37 Consistency: errors and loading are announced everywhere ──
// ── [PCODE-420 | S15 | v0.1.0] T37 medium: English screens use English number and date formats ──
// ── [PCODE-355 | S15 | v0.1.0] T35.4c Activity: query autocomplete, columns, group-by, drag to zoom, heat map ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-183 | S15 | v0.1.0] B6.1 Activity at scale live: search, query language, facets, histogram, saved views, export, archive, hash chain, webhooks ──
//    Why:  the Activity page of the approved design on the server's search. A query (the same language
//          everywhere) narrows the events; facets with counts and a histogram of the same filter show the
//          shape, a click on a bar zooms and "explain" says who made a peak. Rows render only where you
//          look and the next page loads as you scroll; repeats fold into one line; the live tail adds new
//          events without moving what you read. An event opens with its changes, its link and the story of
//          its object. Admins set the retention, check the audit chain and run the webhooks.
import {
  acceptSuggestion,
  collapseRepeats,
  describe as describeEvent,
  groupEvents,
  heatLevels,
  parseActivityQuery,
  querySuggestions,
  type ActivityEvent,
  type GroupBy,
} from '@orqiva/shared';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api } from '../core/api.js';
import type { EventHub } from '../core/hub.js';
import { PIcon } from '../preview/picons.js';
import { Button, Card, Chip, Kbd, PageHead } from '../preview/ui.js';
import { ago } from './inbox.js';
import { LiveAvatar } from './shell.js';
import { dateText } from './versions.js';
import { fmtLocale } from '../core/locale.js'; // [PCODE-420 | S15 | v0.1.0]

const W = (ws: string, p: string): string => '/api/workspaces/' + ws + p;
const ROW = 36;
const PAGE = 200;

interface Hit {
  sequence: number;
  archived: boolean;
  event: ActivityEvent;
}
interface Facet {
  key: string;
  count: number;
}
interface Result {
  events: Hit[];
  next: string | null;
  total: number;
  facets: { actor: Facet[]; type: Facet[]; verb: Facet[]; project: Facet[] };
  histogram: { from: string; to: string; bins: number[] };
  // [PCODE-355 | S15 | v0.1.0] weekday (Monday first) by hour
  heat?: number[][];
  timeZone?: string;
}

/** [PCODE-355 | S15 | v0.1.0] The columns of the event list a person may show or hide. */
export const COLUMNS = [
  ['time', 'Time'],
  ['who', 'Who'],
  ['kind', 'Kind'],
  ['project', 'Project'],
] as const;
export type Column = (typeof COLUMNS)[number][0];
const COLUMNS_KEY = 'orqiva.activity.columns';

/** The grid of a row for the columns shown: the text always takes the rest. */
export function rowGrid(cols: readonly Column[]): string {
  return [
    cols.includes('time') ? '52px' : '',
    cols.includes('who') ? '22px' : '',
    'minmax(0, 1fr)',
    cols.includes('project') ? '64px' : '',
    cols.includes('kind') ? '76px' : '',
  ]
    .filter(Boolean)
    .join(' ');
}

/** The colour class of an event by what it is about. */
export const kindOf = (e: ActivityEvent): string =>
  e.data.object.type === 'agent_run' || e.data.actor.kind === 'agent'
    ? 'agent'
    : e.data.object.type === 'deploy'
      ? 'deploy'
      : e.data.object.type === 'finding'
        ? 'security'
        : e.data.object.type === 'test_run'
          ? 'test'
          : e.data.object.type === 'client'
            ? 'client'
            : '';

/** Adds a facet's term to a query, or takes it away when it is there already. */
export function toggleTerm(query: string, field: string, value: string): string {
  const term = field + ':' + (/\s/.test(value) ? '"' + value + '"' : value);
  const parts = query.split(/\s+/).filter(Boolean);
  const has = parts.findIndex((p) => p.toLowerCase() === term.toLowerCase());
  if (has >= 0) return parts.filter((_, i) => i !== has).join(' ');
  return [...parts.filter((p) => !p.toLowerCase().startsWith(field + ':')), term].join(' ');
}

const ACTOR_TEXT: Record<string, string> = {
  user: 'People',
  agent: 'Agents',
  system: 'Orqiva',
  integration: 'Integrations',
};
/** Today's events by their time, older ones by their date: the column is narrow. */
export const shortWhen = (iso: string, now = new Date()): string => {
  const d = new Date(iso);
  return d.toDateString() === now.toDateString()
    ? d.toLocaleTimeString(fmtLocale(), { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString(fmtLocale(), { day: '2-digit', month: '2-digit' });
};
const whenOf = (iso: string): string =>
  new Date(iso).toLocaleString(fmtLocale(), {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

export function ActivityHub(props: {
  workspaceId: string;
  role: string;
  hub: EventHub;
  go: (p: string) => void;
}): ReactNode {
  const { workspaceId } = props;
  const isAdmin = props.role === 'admin' || props.role === 'owner';
  const [mode, setMode] = useState<'all' | 'mine'>('all');
  const [query, setQuery] = useState('since:7d');
  const [applied, setApplied] = useState('since:7d');
  const [zoom, setZoom] = useState<[string, string] | null>(null);
  const [res, setRes] = useState<Result | null>(null);
  const [hits, setHits] = useState<Hit[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [collapse, setCollapse] = useState(true);
  const [live, setLive] = useState(true);
  const [unseen, setUnseen] = useState(0);
  const [scroll, setScroll] = useState(0);
  const [sel, setSel] = useState<Hit | null>(null);
  const [explain, setExplain] = useState<string | null>(null);
  const [views, setViews] = useState<
    { id: string; name: string; query: string; mode: string; shared: boolean; mine: boolean }[]
  >([]);
  const [admin, setAdmin] = useState(false);
  // [PCODE-355 | S15 | v0.1.0] autocomplete, columns, groups, the dragged span, project keys
  const [caret, setCaret] = useState(0);
  const [pick, setPick] = useState(0);
  const [suggesting, setSuggesting] = useState(false);
  const [cols, setCols] = useState<Column[]>(() => {
    try {
      const v = JSON.parse(window.localStorage.getItem(COLUMNS_KEY) ?? 'null') as unknown;
      if (Array.isArray(v)) return v.filter((x): x is Column => COLUMNS.some(([k]) => k === x));
    } catch {
      // the default columns
    }
    return ['time', 'who', 'kind'];
  });
  const [groupBy, setGroupBy] = useState<GroupBy | ''>('');
  const [drag, setDrag] = useState<[number, number] | null>(null);
  const [projectKeys, setProjectKeys] = useState<Record<string, string>>({});
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const loading = useRef(false);
  const parsed = useMemo(() => parseActivityQuery(query), [query]);
  const params = useCallback(
    (extra = ''): string =>
      '?q=' +
      encodeURIComponent(applied) +
      '&mode=' +
      mode +
      (zoom ? '&from=' + encodeURIComponent(zoom[0]) + '&to=' + encodeURIComponent(zoom[1]) : '') +
      extra,
    [applied, mode, zoom],
  );
  const load = useCallback(async () => {
    const r = await api<Result>(
      'GET',
      W(workspaceId, '/activity/search' + params('&limit=' + String(PAGE))),
    );
    if (!r.ok) {
      setError(r.error.message);
      return;
    }
    setError(null);
    setRes(r.data);
    setHits(r.data.events);
    setNext(r.data.next);
    setUnseen(0);
  }, [workspaceId, params]);
  const more = useCallback(async () => {
    if (!next || loading.current) return;
    loading.current = true;
    const r = await api<Result>(
      'GET',
      W(
        workspaceId,
        '/activity/search' +
          params('&limit=' + String(PAGE) + '&cursor=' + encodeURIComponent(next)),
      ),
    );
    loading.current = false;
    if (r.ok) {
      setHits((h) => [...h, ...r.data.events]);
      setNext(r.data.next);
    }
  }, [workspaceId, params, next]);
  useEffect(() => {
    void load();
  }, [load]);
  const loadViews = useCallback(async () => {
    const r = await api<typeof views>('GET', W(workspaceId, '/activity/views'));
    if (r.ok) setViews(r.data);
  }, [workspaceId]);
  useEffect(() => {
    void loadViews();
  }, [loadViews]);
  // the live tail: new events come in at the top; a reader who scrolled down is told, not moved
  useEffect(() => {
    if (!live) return undefined;
    let timer: number | null = null;
    const off = props.hub.on(() => {
      if ((box.current?.scrollTop ?? 0) > 0) {
        setUnseen((n) => n + 1);
        return;
      }
      if (timer !== null) return;
      timer = window.setTimeout(() => {
        timer = null;
        void load();
      }, 800);
    });
    return () => {
      off();
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [live, props.hub, load]);
  useEffect(() => {
    const key = (e: KeyboardEvent): void => {
      if (
        e.key === '/' &&
        document.activeElement?.tagName !== 'INPUT' &&
        document.activeElement?.tagName !== 'TEXTAREA'
      ) {
        e.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('keydown', key);
    };
  }, []);

  const folds = useMemo(
    () =>
      collapse
        ? collapseRepeats(
            hits.map((h) => ({
              actorId: h.event.data.actor.id,
              verb: h.event.data.verb,
              objectType: h.event.data.object.type,
              time: h.event.time,
            })),
          )
        : hits.map(() => 0),
    [hits, collapse],
  );
  const rows = useMemo(
    () => hits.map((h, i) => ({ h, repeat: folds[i] ?? 0 })).filter((r) => r.repeat >= 0),
    [hits, folds],
  );
  const view = 560;
  const first = Math.max(0, Math.floor(scroll / ROW) - 5);
  const shown = rows.slice(first, first + Math.ceil(view / ROW) + 10);
  useEffect(() => {
    void api<{ id: string; key: string }[]>('GET', W(workspaceId, '/projects')).then((r) => {
      if (r.ok) setProjectKeys(Object.fromEntries(r.data.map((p) => [p.id, p.key])));
    });
  }, [workspaceId]);
  const toggleCol = (c: Column): void => {
    const next = cols.includes(c) ? cols.filter((x) => x !== c) : [...cols, c];
    setCols(next);
    try {
      window.localStorage.setItem(COLUMNS_KEY, JSON.stringify(next));
    } catch {
      // kept for this page only
    }
  };
  const suggestions = suggesting
    ? querySuggestions(query, caret, {
        actor: [...new Set(hits.map((h) => h.event.data.actor.name ?? '').filter(Boolean))],
        project: [...new Set(Object.values(projectKeys))],
        type: (res?.facets.type ?? []).map((f) => f.key),
        verb: (res?.facets.verb ?? []).map((f) => f.key),
      })
    : [];
  const takeSuggestion = (sug: string): void => {
    const next = acceptSuggestion(query, caret, sug);
    setQuery(next.query);
    setCaret(next.caret);
    setPick(0);
    requestAnimationFrame(() => {
      input.current?.setSelectionRange(next.caret, next.caret);
    });
  };
  const apply = (q: string): void => {
    setQuery(q);
    if (!parseActivityQuery(q).errors.length) {
      setApplied(q);
      setZoom(null);
      setExplain(null);
    }
  };
  const bins = res?.histogram.bins ?? [];
  const peak = Math.max(1, ...bins);
  const binTime = (i: number): [string, string] => {
    const from = new Date(res?.histogram.from ?? Date.now()).getTime();
    const to = new Date(res?.histogram.to ?? Date.now()).getTime();
    const w = (to - from) / bins.length;
    return [new Date(from + i * w).toISOString(), new Date(from + (i + 1) * w).toISOString()];
  };
  const explainPeak = async (): Promise<void> => {
    const i = bins.indexOf(Math.max(...bins));
    const span = zoom ?? binTime(Math.max(0, i));
    const r = await api<{ sentence: string }>(
      'GET',
      W(
        workspaceId,
        '/activity/explain?q=' +
          encodeURIComponent(applied) +
          '&mode=' +
          mode +
          '&from=' +
          encodeURIComponent(span[0]) +
          '&to=' +
          encodeURIComponent(span[1]),
      ),
    );
    if (r.ok) setExplain(whenOf(span[0]) + '–' + whenOf(span[1]) + ': ' + r.data.sentence);
  };
  const saveView = async (): Promise<void> => {
    const name = applied.trim() ? applied.trim().slice(0, 60) : 'Everything';
    const r = await api('POST', W(workspaceId, '/activity/views'), {
      name,
      query: applied,
      mode,
      shared: false,
    });
    if (!r.ok) setError(r.error.message);
    void loadViews();
  };
  const facetBox = (f: keyof Result['facets'], label: string, field: string): ReactNode => (
    <div className="pv-facet">
      <div className="pv-facet-head">{label}</div>
      {(res?.facets[f] ?? []).map((x) => {
        const value = f === 'actor' ? x.key : x.key.toLowerCase();
        const on = parsed.terms.some(
          (t) =>
            t.field === (field === 'type' ? 'type' : field) &&
            t.value === value.toLowerCase() &&
            !t.not,
        );
        return (
          <button
            key={x.key}
            type="button"
            className="pv-facet-item"
            aria-pressed={on}
            onClick={() => {
              apply(toggleTerm(query, field, value));
            }}
          >
            <span>{f === 'actor' ? (ACTOR_TEXT[x.key] ?? x.key) : x.key.replace(/_/g, ' ')}</span>
            <span className="pv-num pv-muted">{x.count.toLocaleString(fmtLocale())}</span>
          </button>
        );
      })}
    </div>
  );
  return (
    <div className="pv-page pv-page--wide">
      <PageHead
        title="Activity"
        sub={
          res
            ? res.total.toLocaleString(fmtLocale()) +
              ' events match' +
              (zoom ? ' in the zoomed span' : '')
            : 'Loading…'
        }
        icon="activity"
        actions={
          <>
            <select
              className="pv-select"
              aria-label="Saved view"
              value=""
              onChange={(e) => {
                const v = views.find((x) => x.id === e.target.value);
                if (v) {
                  setMode(v.mode === 'mine' ? 'mine' : 'all');
                  apply(v.query);
                }
              }}
            >
              <option value="">Saved views…</option>
              {views.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                  {v.shared ? ' (shared)' : ''}
                </option>
              ))}
            </select>
            {props.role !== 'guest' ? (
              <>
                <Button kind="ghost" icon="plus" onClick={() => void saveView()}>
                  Save view
                </Button>
                <a
                  className="pv-btn pv-btn--ghost"
                  href={W(workspaceId, '/activity/export' + params('&format=csv'))}
                >
                  <PIcon name="external" size={16} />
                  CSV
                </a>
                <a
                  className="pv-btn pv-btn--ghost"
                  href={W(workspaceId, '/activity/export' + params('&format=json'))}
                >
                  JSON
                </a>
              </>
            ) : null}
            {isAdmin ? (
              <Button
                kind="ghost"
                icon="settings"
                onClick={() => {
                  setAdmin(!admin);
                }}
              >
                Retention and webhooks
              </Button>
            ) : null}
          </>
        }
      />
      {admin && isAdmin ? <AdminPanel workspaceId={workspaceId} /> : null}
      <div className="pv-toolbar pv-mb">
        <div className="pv-segmented" role="radiogroup" aria-label="Mode">
          {(
            [
              ['all', 'Everything'],
              ['mine', 'My work and what I follow'],
            ] as const
          ).map(([k, l]) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={mode === k}
              className="pv-seg"
              onClick={() => {
                setMode(k);
              }}
            >
              {l}
            </button>
          ))}
        </div>
        <form
          className="pv-query"
          onSubmit={(e) => {
            e.preventDefault();
            apply(query);
          }}
        >
          <PIcon name="search" size={15} />
          <input
            ref={input}
            value={query}
            placeholder="actor:agent project:app -verb:progressed since:24h  or any words"
            aria-label="Query"
            onChange={(e) => {
              setQuery(e.target.value);
              setCaret(e.target.selectionStart ?? e.target.value.length);
              setSuggesting(true);
              setPick(0);
            }}
            onKeyDown={(e) => {
              // [PCODE-355 | S15 | v0.1.0] arrows choose a suggestion, Tab or Enter takes it, Escape closes
              if (!suggestions.length) return;
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                setPick(
                  (p) =>
                    (p + (e.key === 'ArrowDown' ? 1 : suggestions.length - 1)) % suggestions.length,
                );
              } else if (e.key === 'Tab' || e.key === 'Enter') {
                e.preventDefault();
                takeSuggestion(suggestions[pick] ?? suggestions[0] ?? '');
              } else if (e.key === 'Escape') setSuggesting(false);
            }}
            onBlur={() => {
              setSuggesting(false);
              apply(query);
            }}
            role="combobox"
            aria-expanded={suggestions.length > 0}
            aria-controls="pv-query-suggest"
            aria-autocomplete="list"
          />
          <Kbd>/</Kbd>
          {suggestions.length ? (
            <ul
              id="pv-query-suggest"
              className="pv-suggest"
              role="listbox"
              aria-label="Suggestions"
            >
              {suggestions.map((x, i) => (
                <li key={x} role="option" aria-selected={i === pick}>
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      takeSuggestion(x);
                    }}
                  >
                    {x}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </form>
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
      {parsed.errors.length ? (
        <p className="v2-error" role="alert">
          {parsed.errors.join('; ')}
        </p>
      ) : null}
      {error && !parsed.errors.length ? (
        <p className="v2-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="pv-histo-wrap">
        <svg
          className="pv-histo"
          viewBox={'0 0 ' + String(Math.max(1, bins.length) * 20) + ' 70'}
          preserveAspectRatio="none"
          role="img"
          aria-label="Events over the span"
        >
          {bins.map((n, i) => {
            const h = (n / peak) * 60;
            const [a] = binTime(i);
            const on = zoom !== null && zoom[0] === a;
            return (
              <rect
                key={i}
                className={
                  'pv-histo-bar' +
                  (on ? ' pv-histo-bar--on' : '') +
                  (drag && i >= Math.min(...drag) && i <= Math.max(...drag)
                    ? ' pv-histo-bar--on'
                    : '') +
                  (n === peak && n > 0 ? ' pv-histo-bar--peak' : '')
                }
                x={i * 20 + 2}
                y={66 - h}
                width="16"
                height={Math.max(0, h)}
                rx="2"
                onPointerDown={() => {
                  // [PCODE-355 | S15 | v0.1.0] press, drag across the bars, let go: that span
                  setDrag([i, i]);
                }}
                onPointerEnter={() => {
                  if (drag) setDrag([drag[0], i]);
                }}
                onPointerUp={() => {
                  const [x, y] = drag ?? [i, i];
                  setDrag(null);
                  const lo = Math.min(x, y);
                  const hi = Math.max(x, y);
                  if (lo === hi && !n) return;
                  setZoom([binTime(lo)[0], binTime(hi)[1]]);
                  setExplain(null);
                }}
              >
                <title>{whenOf(a) + ': ' + String(n) + ' events'}</title>
              </rect>
            );
          })}
        </svg>
        <div className="pv-histo-foot">
          <span className="pv-muted pv-small">{res ? whenOf(res.histogram.from) : ''}</span>
          {zoom ? (
            <Chip tone="primary">
              {'Zoomed to ' + whenOf(zoom[0]) + '–' + whenOf(zoom[1]) + ' '}
              <button
                type="button"
                className="pv-link-btn"
                onClick={() => {
                  setZoom(null);
                  setExplain(null);
                }}
              >
                reset
              </button>
            </Chip>
          ) : (
            <span className="pv-muted pv-small">
              Click a bar or drag across bars to zoom · the peak is marked
            </span>
          )}
          <Button size="sm" kind="ghost" icon="sparkle" onClick={() => void explainPeak()}>
            {zoom ? 'Explain this span' : 'Explain the peak'}
          </Button>
          <span className="pv-muted pv-small">{res ? whenOf(res.histogram.to) : ''}</span>
        </div>
        {explain ? <p className="pv-small">{explain}</p> : null}
        {/* [PCODE-355 | S15 | v0.1.0] when it happens: weekday by hour */}
        {res?.heat ? (
          <details className="pv-heat-wrap">
            <summary className="pv-small">
              When it happens, by weekday and hour ({res.timeZone ?? 'local time'})
            </summary>
            <div className="pv-heat" role="img" aria-label="Events by weekday and hour">
              {heatLevels(res.heat).map((row, d) => (
                <div key={d} className="pv-heat-row">
                  <span className="pv-small pv-muted">
                    {['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'][d]}
                  </span>
                  {row.map((lv, h) => (
                    <i
                      key={h}
                      className={'pv-heat-cell pv-heat-cell--' + String(lv)}
                      title={
                        (['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][d] ?? '') +
                        ' ' +
                        String(h).padStart(2, '0') +
                        ':00 · ' +
                        String(res.heat?.[d]?.[h] ?? 0) +
                        ' events'
                      }
                    />
                  ))}
                </div>
              ))}
              <div className="pv-heat-row pv-heat-hours">
                <span />
                {Array.from({ length: 24 }, (_, h) => (
                  <span key={h} className="pv-small pv-muted">
                    {h % 6 === 0 ? String(h) : ''}
                  </span>
                ))}
              </div>
            </div>
          </details>
        ) : null}
      </div>
      <div className={'pv-activity' + (sel ? ' pv-activity--detail' : '')}>
        <aside className="pv-facets" aria-label="Facets">
          {facetBox('actor', 'Who', 'actor')}
          {facetBox('type', 'Kind', 'type')}
          {facetBox('project', 'Project', 'project')}
          {facetBox('verb', 'What', 'verb')}
        </aside>
        <section className="pv-stream">
          <div className="pv-stream-head">
            <strong className="pv-num">{(res?.total ?? 0).toLocaleString(fmtLocale())}</strong>{' '}
            <span className="pv-muted">events match</span>
            <span className="pv-spacer" />
            {unseen ? (
              <button
                type="button"
                className="pv-new-pill"
                onClick={() => {
                  box.current?.scrollTo({ top: 0 });
                  void load();
                }}
              >
                {String(unseen) + ' new events ↑'}
              </button>
            ) : null}
            <span className="pv-muted pv-small">
              {hits.length.toLocaleString(fmtLocale())} loaded{next ? ', more as you scroll' : ''}
            </span>
            {/* [PCODE-355 | S15 | v0.1.0] group the loaded events, choose the columns */}
            <select
              className="v2-input v2-input--sm"
              aria-label="Group by"
              value={groupBy}
              onChange={(e) => {
                setGroupBy(e.target.value as GroupBy | '');
              }}
            >
              <option value="">No groups</option>
              <option value="actor">Group by who</option>
              <option value="type">Group by kind</option>
              <option value="project">Group by project</option>
              <option value="day">Group by day</option>
            </select>
            <details className="pv-columns">
              <summary className="pv-small">Columns</summary>
              <div className="pv-columns-menu">
                {COLUMNS.map(([k, label]) => (
                  <label key={k} className="v2-check">
                    <input
                      type="checkbox"
                      checked={cols.includes(k)}
                      onChange={() => {
                        toggleCol(k);
                      }}
                    />
                    {label}
                  </label>
                ))}
              </div>
            </details>
          </div>
          {groupBy ? (
            <div className="pv-groups">
              {groupEvents(
                hits,
                groupBy,
                (id) => (id ? (projectKeys[id] ?? 'Other') : 'No project'),
                (iso) => dateText(iso.slice(0, 10)),
              ).map((g) => (
                <details key={g.key} className="pv-group" open>
                  <summary>
                    <strong>{g.key}</strong>{' '}
                    <span className="pv-muted pv-small">{g.hits.length}</span>
                  </summary>
                  {g.hits.slice(0, 200).map((h) => (
                    <button
                      key={h.event.id}
                      type="button"
                      className="pv-ev"
                      style={{ gridTemplateColumns: rowGrid(cols.filter((c) => c !== 'project')) }}
                      onClick={() => {
                        setSel(h);
                      }}
                    >
                      {cols.includes('time') ? (
                        <span className="pv-ev-time pv-num">{shortWhen(h.event.time)}</span>
                      ) : null}
                      {cols.includes('who') ? (
                        <LiveAvatar
                          id={h.event.data.actor.id}
                          name={h.event.data.actor.name ?? h.event.data.actor.kind}
                          size="xs"
                          agent={h.event.data.actor.kind === 'agent'}
                        />
                      ) : null}
                      <span className="pv-ev-text">{describeEvent(h.event)}</span>
                      {cols.includes('kind') ? (
                        <span className={'pv-ev-kind pv-ev-kind--' + kindOf(h.event)}>
                          {h.event.data.object.type.replace(/_/g, ' ')}
                        </span>
                      ) : null}
                    </button>
                  ))}
                </details>
              ))}
            </div>
          ) : null}
          <div
            className="pv-virtual"
            hidden={Boolean(groupBy)}
            ref={box}
            onScroll={(e) => {
              const el = e.currentTarget;
              setScroll(el.scrollTop);
              if (el.scrollTop === 0 && unseen) void load();
              if (el.scrollTop + el.clientHeight > el.scrollHeight - ROW * 20) void more();
            }}
          >
            <svg className="pv-spacer-svg" width="1" height={first * ROW} aria-hidden="true" />
            {shown.map(({ h, repeat }) => (
              <button
                key={h.event.id}
                type="button"
                className="pv-ev"
                style={{ gridTemplateColumns: rowGrid(cols) }}
                aria-current={sel?.event.id === h.event.id ? 'true' : undefined}
                onClick={() => {
                  setSel(h);
                }}
              >
                {cols.includes('time') ? (
                  <span className="pv-ev-time pv-num" title={whenOf(h.event.time)}>
                    {shortWhen(h.event.time)}
                  </span>
                ) : null}
                {cols.includes('who') ? (
                  <LiveAvatar
                    id={h.event.data.actor.id}
                    name={h.event.data.actor.name ?? h.event.data.actor.kind}
                    size="xs"
                    agent={h.event.data.actor.kind === 'agent'}
                  />
                ) : null}
                <span className="pv-ev-text">
                  {describeEvent(h.event)}
                  {repeat > 0 ? (
                    <Chip tone="agent">{'+' + String(repeat) + ' like it'}</Chip>
                  ) : null}
                  {h.archived ? <Chip>archive</Chip> : null}
                </span>
                {cols.includes('project') ? (
                  <span className="pv-mono pv-small pv-muted">
                    {h.event.projectid ? (projectKeys[h.event.projectid] ?? '') : ''}
                  </span>
                ) : null}
                {cols.includes('kind') ? (
                  <span className={'pv-ev-kind pv-ev-kind--' + kindOf(h.event)}>
                    {h.event.data.object.type.replace(/_/g, ' ')}
                  </span>
                ) : null}
              </button>
            ))}
            <svg
              className="pv-spacer-svg"
              width="1"
              height={Math.max(0, (rows.length - first - shown.length) * ROW)}
              aria-hidden="true"
            />
            {!rows.length && res ? <p className="pv-empty">No events match.</p> : null}
          </div>
        </section>
        {sel ? (
          <Detail
            workspaceId={workspaceId}
            hit={sel}
            go={props.go}
            onClose={() => {
              setSel(null);
            }}
          />
        ) : null}
      </div>
    </div>
  );
}

function Detail(props: {
  workspaceId: string;
  hit: Hit;
  go: (p: string) => void;
  onClose: () => void;
}): ReactNode {
  const e = props.hit.event;
  const [story, setStory] = useState<Hit[]>([]);
  useEffect(() => {
    void api<Hit[]>(
      'GET',
      W(
        props.workspaceId,
        '/activity/story/' + e.data.object.type + '/' + encodeURIComponent(e.data.object.id),
      ),
    ).then((r) => {
      if (r.ok) setStory(r.data);
    });
  }, [props.workspaceId, e.data.object.type, e.data.object.id]);
  const changes = Object.entries(e.data.changes ?? {});
  const show = (v: unknown): string =>
    v === null || v === undefined ? '—' : typeof v === 'string' ? v : JSON.stringify(v);
  return (
    <aside className="pv-ev-detail" aria-label="Event">
      <div className="pv-drawer-head">
        <strong>Event</strong>
        <span className="pv-spacer" />
        <button type="button" className="pv-icon-btn" aria-label="Close" onClick={props.onClose}>
          <PIcon name="x" />
        </button>
      </div>
      <div className="pv-drawer-body">
        <p>{describeEvent(e)}</p>
        <div className="pv-kv">
          <span>When</span>
          <span>{new Date(e.time).toLocaleString(fmtLocale())} (Europe/Berlin)</span>
          <span>Who</span>
          <span>
            {e.data.actor.name ?? e.data.actor.kind} · {e.data.actor.kind}
          </span>
          <span>Object</span>
          <span className="pv-mono pv-small">
            {e.data.object.type} {e.data.object.label ?? e.data.object.id}
          </span>
          <span>Event</span>
          <span className="pv-mono pv-small">
            #{props.hit.sequence} · {e.id.slice(0, 8)}
            {props.hit.archived ? ' · archive' : ''}
          </span>
        </div>
        {changes.length ? (
          <div className="pv-diff pv-mt">
            {changes.map(([k, c]) => (
              <div key={k}>
                <div className="pv-del">
                  {k}: {show(c.from)}
                </div>
                <div className="pv-ins">
                  {k}: {show(c.to)}
                </div>
              </div>
            ))}
          </div>
        ) : null}
        {e.data.object.type === 'item' ? (
          <Button
            size="sm"
            kind="ghost"
            onClick={() => {
              props.go('/items/' + e.data.object.id);
            }}
          >
            Open the task
          </Button>
        ) : null}
        <h3 className="pv-ev-story-h">
          The story of {e.data.object.label ?? 'this ' + e.data.object.type}
        </h3>
        <ol className="pv-story">
          {story.slice(-30).map((s) => (
            <li key={s.event.id}>
              <span className="pv-num pv-muted pv-small">{whenOf(s.event.time)}</span>{' '}
              {describeEvent(s.event)}
            </li>
          ))}
        </ol>
      </div>
    </aside>
  );
}

interface Hook {
  id: string;
  name: string;
  url: string;
  eventTypes: string[];
  query: string;
  active: boolean;
  failures: number;
  lastDelivery: { status: string; at: string; error: string; events: number } | null;
}

function AdminPanel(props: { workspaceId: string }): ReactNode {
  const [settings, setSettings] = useState<{
    retentionDays: number;
    hot: number;
    archived: number;
    oldest: string | null;
  } | null>(null);
  const [days, setDays] = useState('90');
  const [chain, setChain] = useState<{
    checked: number;
    unhashed: number;
    firstBreak: number | null;
    intact: boolean;
  } | null>(null);
  const [hooks, setHooks] = useState<Hook[]>([]);
  const [form, setForm] = useState({ name: '', url: '', types: '', query: '' });
  const [secret, setSecret] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    const [s, h] = await Promise.all([
      api<NonNullable<typeof settings>>('GET', W(props.workspaceId, '/activity/settings')),
      api<Hook[]>('GET', W(props.workspaceId, '/webhooks')),
    ]);
    if (s.ok) {
      setSettings(s.data);
      setDays(String(s.data.retentionDays));
    }
    if (h.ok) setHooks(h.data);
  }, [props.workspaceId]);
  useEffect(() => {
    void load();
  }, [load]);
  const saveDays = async (): Promise<void> => {
    const r = await api('PUT', W(props.workspaceId, '/activity/settings'), {
      retentionDays: Number(days),
    });
    if (!r.ok) setError(r.error.message);
    else void load();
  };
  const archive = async (): Promise<void> => {
    const r = await api<{ moved: number }>('POST', W(props.workspaceId, '/activity/archive'));
    if (r.ok) setNote(String(r.data.moved) + ' events moved to the archive');
    void load();
  };
  const verify = async (): Promise<void> => {
    const r = await api<NonNullable<typeof chain>>('GET', W(props.workspaceId, '/activity/verify'));
    if (r.ok) setChain(r.data);
  };
  const addHook = async (): Promise<void> => {
    const r = await api<{ secret: string }>('POST', W(props.workspaceId, '/webhooks'), {
      name: form.name.trim(),
      url: form.url.trim(),
      eventTypes: form.types
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean),
      query: form.query.trim(),
    });
    if (!r.ok) setError(r.error.message);
    else {
      setSecret(r.data.secret);
      setForm({ name: '', url: '', types: '', query: '' });
      setError(null);
      void load();
    }
  };
  const toggle = async (h: Hook): Promise<void> => {
    const r = await api<Hook[]>('PATCH', W(props.workspaceId, '/webhooks/' + h.id), {
      active: !h.active,
    });
    if (r.ok) setHooks(r.data);
  };
  const remove = async (h: Hook): Promise<void> => {
    const r = await api<Hook[]>('DELETE', W(props.workspaceId, '/webhooks/' + h.id));
    if (r.ok) setHooks(r.data);
  };
  return (
    <div className="pv-split pv-split--even pv-mb">
      <Card title="Retention and audit">
        {error ? (
          <p className="v2-error" role="alert">
            {error}
          </p>
        ) : null}
        {settings ? (
          <div className="pv-stack">
            <div className="pv-kv pv-kv--wide">
              <span>Searchable</span>
              <span>{settings.hot.toLocaleString(fmtLocale())} events</span>
              <span>Archive</span>
              <span>
                {settings.archived.toLocaleString(fmtLocale())} events
                {settings.oldest ? ', since ' + dateText(settings.oldest) : ''} · search them with
                in:archive
              </span>
            </div>
            <div className="v2-inline">
              <label className="pv-field">
                <span>Keep searchable for (days)</span>
                <input
                  className="v2-input v2-input--sm"
                  type="number"
                  min={7}
                  max={3650}
                  value={days}
                  onChange={(e) => {
                    setDays(e.target.value);
                  }}
                />
              </label>
              <Button size="sm" onClick={() => void saveDays()}>
                Save
              </Button>
              <Button size="sm" kind="ghost" onClick={() => void archive()}>
                Archive now
              </Button>
            </div>
            <div className="v2-inline">
              <Button size="sm" kind="ghost" icon="lock" onClick={() => void verify()}>
                Check the audit chain
              </Button>
              {chain ? (
                <Chip
                  tone={chain.intact ? 'success' : 'danger'}
                  icon={chain.intact ? 'check' : 'x'}
                >
                  {chain.intact
                    ? (chain.checked
                        ? String(chain.checked) + ' events intact'
                        : 'the chain starts with the next event') +
                      (chain.unhashed
                        ? ' · ' + String(chain.unhashed) + ' from before the chain'
                        : '')
                    : 'changed or missing at event #' + String(chain.firstBreak ?? '?')}
                </Chip>
              ) : null}
            </div>
            {note ? <span className="pv-muted pv-small">{note}</span> : null}
          </div>
        ) : (
          <p className="pv-muted" role="status">
            Loading…
          </p>
        )}
      </Card>
      <Card flush title={'Webhooks · ' + String(hooks.length)}>
        {secret ? (
          <div className="pv-callout pv-callout--decision v2-pad">
            <PIcon name="lock" size={16} />
            <div>
              <strong>Copy the signing secret now; it is shown only once.</strong>
              <pre className="pv-code">{secret}</pre>
              <span className="pv-small">
                Every delivery carries X-Orqiva-Signature: sha256=HMAC of the body.
              </span>
            </div>
          </div>
        ) : null}
        {hooks.length ? (
          <ul className="pv-rows">
            {hooks.map((h) => (
              <li key={h.id} className="pv-row pv-row--static">
                <span className="pv-row-main">
                  <span className="pv-row-title">{h.name}</span>
                  <span className="pv-row-sub pv-mono">{h.url}</span>
                  <span className="pv-row-sub">
                    {h.eventTypes.length ? h.eventTypes.join(', ') : 'all kinds'}
                    {h.query ? ' · ' + h.query : ''}
                    {h.lastDelivery
                      ? ' · last ' +
                        h.lastDelivery.status +
                        ' ' +
                        ago(h.lastDelivery.at) +
                        ' ago' +
                        (h.lastDelivery.error ? ' (' + h.lastDelivery.error + ')' : '')
                      : ' · nothing sent yet'}
                  </span>
                </span>
                <Chip tone={h.active ? (h.failures ? 'warning' : 'success') : 'neutral'}>
                  {h.active ? (h.failures ? String(h.failures) + ' failures' : 'on') : 'off'}
                </Chip>
                <Button size="sm" kind="ghost" onClick={() => void toggle(h)}>
                  {h.active ? 'Switch off' : 'Switch on'}
                </Button>
                <button
                  type="button"
                  className="pv-mini-btn"
                  aria-label={'Remove ' + h.name}
                  onClick={() => void remove(h)}
                >
                  <PIcon name="x" size={12} />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="pv-muted pv-small v2-pad">
            No webhooks. A webhook streams events to a SIEM or another tool, signed, in order, with
            retries.
          </p>
        )}
        <form
          className="v2-form v2-pad"
          onSubmit={(e) => {
            e.preventDefault();
            if (form.name.trim() && form.url.trim()) void addHook();
          }}
        >
          <input
            className="v2-input v2-input--sm"
            aria-label="Webhook name"
            placeholder="Name, e.g. SIEM"
            value={form.name}
            onChange={(e) => {
              setForm({ ...form, name: e.target.value });
            }}
          />
          <input
            className="v2-input v2-input--sm v2-mono"
            aria-label="Address"
            placeholder="https://…"
            value={form.url}
            onChange={(e) => {
              setForm({ ...form, url: e.target.value });
            }}
          />
          <input
            className="v2-input v2-input--sm"
            aria-label="Kinds"
            placeholder="kinds: item, deploy (empty: all)"
            value={form.types}
            onChange={(e) => {
              setForm({ ...form, types: e.target.value });
            }}
          />
          <input
            className="v2-input v2-input--sm v2-mono"
            aria-label="Query"
            placeholder="query, e.g. project:app"
            value={form.query}
            onChange={(e) => {
              setForm({ ...form, query: e.target.value });
            }}
          />
          <button type="submit" className="pv-btn pv-btn--secondary pv-btn--sm">
            Add webhook
          </button>
        </form>
      </Card>
    </div>
  );
}
