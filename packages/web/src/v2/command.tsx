// ── [PCODE-420 | S15 | v0.1.0] T37 medium: English screens use English number and date formats ──
// ── [PCODE-211 | S15 | v0.1.0] T18.3 Scale test (20 projects, 50 live users, under 1 s event-to-screen) and orq portfolio ──
// ── [PCODE-210 | S15 | v0.1.0] T18.2 Command center screen: lanes with people and agents, heatmap, alerts, 24 h replay slider (design preview and live) ──
//    Why:  the command center of the plan: every project of the workspace on one screen. A lane per
//          project with its health and the cards in progress; on each card who is assigned, who is on it
//          right now and which agent works on it; a heatmap of the risks and the gates; the open alerts.
//          A slider goes back through the last 24 hours: the lanes then show the cards as they were (each
//          later move undone) and every lane its activity per hour. The view takes its data as props, so
//          the design preview shows it with sample data and the live page with the server's.
import {
  HEALTH_TEXT,
  HEAT_KEYS,
  HEAT_LABELS,
  type Health,
  type PresenceEntry,
} from '@orqiva/shared';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api } from '../core/api.js';
import type { EventHub } from '../core/hub.js';
import { PIcon } from '../preview/picons.js';
import { Button, Card, Chip, PageHead } from '../preview/ui.js';
import { fmtLocale } from '../core/locale.js'; // [PCODE-420 | S15 | v0.1.0]

export interface CcCard {
  id: string;
  ref: string;
  title: string;
  state: string;
  assignee: { id: string; name: string } | null;
  agents: { name: string; status: string }[];
  updatedAt: string;
}
export interface CcProject {
  id: string;
  key: string;
  name: string;
  client: string | null;
  phase: string | null;
  gates: { key: string; name: string; status: string }[];
  health: string;
  reasons: string[];
  heat: Record<string, { level: string; note: string }>;
  counts: { open: number; inProgress: number; doneThisWeek: number };
  cards: CcCard[];
}
export interface CcAlert {
  id: string;
  projectKey: string | null;
  source: string;
  severity: string;
  title: string;
  count: number;
  lastAt: string;
}
export interface CcData {
  projects: CcProject[];
  alerts: CcAlert[];
  at: string;
  startedStates: string[];
}
export interface CcEvent {
  sequence: number;
  at: string;
  projectId: string | null;
  object: string;
  objectId: string;
  label: string;
  verb: string;
  actor: string;
  actorKind: string;
  state: { from: string | null; to: string | null } | null;
}

/** "APP-12 Live map" → { ref: 'APP-12', title: 'Live map' } */
const splitLabel = (label: string): { ref: string; title: string } => {
  const m = /^([A-Z][A-Z0-9]{1,9}-\d+)\s+(.*)$/.exec(label);
  return m ? { ref: m[1] ?? '', title: m[2] ?? '' } : { ref: '', title: label };
};

/**
 * The cards of a project as they were at a moment: start from now and undo, newest first, every move
 * and creation after it. A card counts as in progress when its state then was one of the started states.
 */
export function cardsAt(
  project: CcProject,
  events: readonly CcEvent[],
  at: number,
  started: readonly string[],
): CcCard[] {
  const state = new Map<string, string>(project.cards.map((c) => [c.id, c.state]));
  const known = new Map<string, CcCard>(project.cards.map((c) => [c.id, c]));
  const gone = new Set<string>();
  const later = events
    .filter((e) => e.projectId === project.id && e.object === 'item' && Date.parse(e.at) > at)
    .sort((a, b) => b.sequence - a.sequence);
  for (const e of later) {
    if (e.verb === 'created') {
      gone.add(e.objectId);
      continue;
    }
    if (e.state?.from) {
      state.set(e.objectId, e.state.from);
      if (!known.has(e.objectId)) {
        const { ref, title } = splitLabel(e.label);
        known.set(e.objectId, {
          id: e.objectId,
          ref,
          title,
          state: e.state.from,
          assignee: null,
          agents: [],
          updatedAt: e.at,
        });
      }
    }
  }
  return [...known.values()]
    .filter((c) => !gone.has(c.id) && started.includes(state.get(c.id) ?? ''))
    .map((c) => ({ ...c, state: state.get(c.id) ?? c.state, agents: c.agents }));
}

/** Events per hour of a project over the 24 hours ending at `to`, oldest hour first. */
export function hourly(events: readonly CcEvent[], projectId: string, to: number): number[] {
  const out = Array.from({ length: 24 }, () => 0);
  for (const e of events) {
    if (e.projectId !== projectId) continue;
    const h = Math.floor((to - Date.parse(e.at)) / 3_600_000);
    if (h >= 0 && h < 24) out[23 - h] = (out[23 - h] ?? 0) + 1;
  }
  return out;
}

const HEALTH_TONE: Record<string, 'success' | 'warning' | 'danger'> = {
  'on-track': 'success',
  'at-risk': 'warning',
  critical: 'danger',
};
const GATE_TONE: Record<string, string> = {
  approved: 'ok',
  ready: 'warn',
  open: 'none',
  rejected: 'bad',
};
const initials = (name: string): string =>
  name
    .split(/\s+/)
    .map((p) => p[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase();
const hm = (ms: number): string =>
  new Date(ms).toLocaleTimeString(fmtLocale(), { hour: '2-digit', minute: '2-digit' });

function Face(props: { name: string; kind: 'user' | 'here' | 'agent'; title: string }): ReactNode {
  return (
    <span className={'v2-cc-face v2-cc-face--' + props.kind} title={props.title}>
      {props.kind === 'agent' ? <PIcon name="agents" size={11} /> : initials(props.name)}
    </span>
  );
}

function CardTile(props: { card: CcCard; here: PresenceEntry[]; live: boolean }): ReactNode {
  const c = props.card;
  return (
    <li className="v2-cc-card">
      <span className="v2-cc-ref">{c.ref}</span>
      <span className="v2-cc-title">{c.title}</span>
      <span className="v2-cc-faces">
        {c.assignee ? (
          <Face name={c.assignee.name} kind="user" title={'Assigned: ' + c.assignee.name} />
        ) : null}
        {props.live
          ? props.here
              .filter((p) => p.userId !== c.assignee?.id)
              .map((p) => (
                <Face
                  key={p.userId}
                  name={p.name}
                  kind="here"
                  title={p.name + (p.state === 'editing' ? ' is editing' : ' is looking')}
                />
              ))
          : null}
        {c.agents.map((g) => (
          <Face key={g.name} name={g.name} kind="agent" title={g.name + ' · ' + g.status} />
        ))}
      </span>
    </li>
  );
}

function Spark(props: { values: number[]; mark: number | null }): ReactNode {
  const max = Math.max(1, ...props.values);
  return (
    <svg className="v2-cc-spark" viewBox="0 0 96 16" preserveAspectRatio="none" aria-hidden="true">
      {props.values.map((v, i) => (
        <rect
          key={i}
          x={i * 4}
          y={16 - (v / max) * 16}
          width={3}
          height={(v / max) * 16}
          className={v ? 'v2-cc-spark-on' : ''}
        />
      ))}
      {props.mark !== null ? (
        <rect x={props.mark * 4} y={0} width={1} height={16} className="v2-cc-spark-mark" />
      ) : null}
    </svg>
  );
}

/** The command center, from data: lanes, heatmap, alerts and the replay bar. */
export function CommandView(props: {
  data: CcData;
  events: CcEvent[];
  people: PresenceEntry[];
  now: number;
  /** the moment shown; null: live */
  at: number | null;
  onAt: (at: number | null) => void;
  agentsRunning: number;
  go?: (path: string) => void;
}): ReactNode {
  const d = props.data;
  const live = props.at === null;
  const shownAt = props.at ?? props.now;
  const from = props.now - 24 * 3_600_000;
  const [playing, setPlaying] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (!playing) return;
    timer.current = setInterval(() => {
      const next = (props.at ?? from) + 15 * 60_000;
      if (next >= props.now) {
        setPlaying(false);
        props.onAt(null);
      } else props.onAt(next);
    }, 250);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [playing, props.at, props.now]);
  const count = (h: Health): number => d.projects.filter((p) => p.health === h).length;
  const online = new Set(props.people.filter((p) => p.kind === 'user').map((p) => p.userId)).size;
  const mark = live
    ? null
    : Math.min(23, Math.max(0, 23 - Math.floor((props.now - shownAt) / 3_600_000)));
  return (
    <div className="pv-page v2-cc">
      <PageHead
        title="Command center"
        sub={
          live
            ? 'Every project, live'
            : 'As it was at ' +
              hm(shownAt) +
              ', ' +
              new Date(shownAt).toLocaleDateString(fmtLocale())
        }
        icon="live"
        actions={
          <div className="v2-inline">
            <Chip>{String(d.projects.length) + ' projects'}</Chip>
            {count('critical') ? (
              <Chip tone="danger">{String(count('critical')) + ' critical'}</Chip>
            ) : null}
            {count('at-risk') ? (
              <Chip tone="warning">{String(count('at-risk')) + ' at risk'}</Chip>
            ) : null}
            <Chip tone="info" icon="user">
              {String(online) + ' online'}
            </Chip>
            <Chip tone="agent" icon="agents">
              {String(props.agentsRunning) + ' agents at work'}
            </Chip>
          </div>
        }
      />
      <div className="v2-cc-replay" role="group" aria-label="Replay of the last 24 hours">
        <Button
          size="sm"
          kind={playing ? 'secondary' : 'ghost'}
          icon={playing ? 'pause' : 'play'}
          onClick={() => {
            if (!playing && live) props.onAt(from);
            setPlaying(!playing);
          }}
        >
          {playing ? 'Pause' : 'Replay'}
        </Button>
        <span className="pv-muted pv-small pv-num">{hm(from)}</span>
        <input
          type="range"
          className="v2-cc-slider"
          aria-label="Moment shown"
          min={0}
          max={24 * 60}
          step={5}
          value={Math.round((shownAt - from) / 60_000)}
          onChange={(e) => {
            const v = from + Number(e.target.value) * 60_000;
            setPlaying(false);
            props.onAt(v >= props.now - 60_000 ? null : v);
          }}
        />
        <span className="pv-muted pv-small pv-num">now</span>
        {live ? (
          <Chip tone="success" icon="live">
            live
          </Chip>
        ) : (
          <Button
            size="sm"
            onClick={() => {
              setPlaying(false);
              props.onAt(null);
            }}
          >
            {'Back to live (shown: ' + hm(shownAt) + ')'}
          </Button>
        )}
      </div>
      <div className="v2-cc-grid">
        <Card title="Projects" flush>
          <ul className="v2-cc-lanes">
            {d.projects.map((p) => {
              const cards = live ? p.cards : cardsAt(p, props.events, shownAt, d.startedStates);
              return (
                <li key={p.id} className={'v2-cc-lane v2-cc-lane--' + p.health}>
                  <div className="v2-cc-lane-head">
                    <button
                      type="button"
                      className="pv-link-btn v2-left"
                      onClick={() => props.go?.('/projects/' + p.id)}
                    >
                      <span className="pv-mono">{p.key}</span> {p.name}
                    </button>
                    <span className="pv-row-sub">
                      {[p.client, p.phase].filter(Boolean).join(' · ') || 'no lifecycle'}
                    </span>
                    <span className="v2-inline">
                      <Chip tone={HEALTH_TONE[p.health] ?? 'neutral'}>
                        {(HEALTH_TEXT as Record<string, string | undefined>)[p.health] ?? p.health}
                      </Chip>
                      <Spark values={hourly(props.events, p.id, props.now)} mark={mark} />
                    </span>
                    {p.reasons.length ? (
                      <span className="pv-row-sub v2-cc-why">{p.reasons.join(' · ')}</span>
                    ) : null}
                  </div>
                  <ul className="v2-cc-cards" aria-label={p.key + ' cards in progress'}>
                    {cards.map((c) => (
                      <CardTile
                        key={c.id}
                        card={c}
                        live={live}
                        here={props.people.filter((x) => x.itemId === c.id)}
                      />
                    ))}
                    {!cards.length ? (
                      <li className="pv-muted pv-small v2-cc-none">nothing in progress</li>
                    ) : null}
                  </ul>
                </li>
              );
            })}
            {!d.projects.length ? <li className="pv-row pv-muted">No projects yet.</li> : null}
          </ul>
        </Card>
        <div className="pv-stack">
          <Card title={'Alerts · ' + String(d.alerts.length)} flush>
            <ul className="pv-rows">
              {d.alerts.slice(0, 12).map((a) => (
                <li key={a.id} className="pv-row pv-row--static">
                  <span className="pv-row-main">
                    <span className="pv-row-title">{a.title}</span>
                    <span className="pv-row-sub">
                      {[
                        a.projectKey,
                        a.source,
                        a.count > 1 ? String(a.count) + '×' : '',
                        hm(Date.parse(a.lastAt)),
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </span>
                  <Chip
                    tone={a.severity === 'sev1' || a.severity === 'sev2' ? 'danger' : 'warning'}
                  >
                    {a.severity.toUpperCase()}
                  </Chip>
                </li>
              ))}
              {!d.alerts.length ? <li className="pv-row pv-muted">No open alert.</li> : null}
            </ul>
          </Card>
          <Card title="Latest" flush>
            <ul className="pv-rows">
              {props.events
                .filter((e) => Date.parse(e.at) <= shownAt)
                .slice(-8)
                .reverse()
                .map((e) => (
                  <li key={e.sequence} className="pv-row pv-row--static">
                    <span className="pv-row-main">
                      <span className="pv-row-title v2-break">
                        {e.actor + ' ' + e.verb + ' ' + e.label}
                      </span>
                      <span className="pv-row-sub">
                        {hm(Date.parse(e.at)) + (e.state?.to ? ' · to ' + e.state.to : '')}
                      </span>
                    </span>
                  </li>
                ))}
            </ul>
          </Card>
        </div>
      </div>
      <Card title="Risk heatmap" flush>
        <div className="v2-table-wrap">
          <table className="pv-table v2-cc-heat">
            <thead>
              <tr>
                <th>Project</th>
                <th>Gates</th>
                {HEAT_KEYS.map((k) => (
                  <th key={k}>{HEAT_LABELS[k]}</th>
                ))}
                <th className="pv-num">Open</th>
                <th className="pv-num">Done (7 d)</th>
              </tr>
            </thead>
            <tbody>
              {d.projects.map((p) => (
                <tr key={p.id}>
                  <td className="pv-mono">{p.key}</td>
                  <td>
                    <span className="v2-inline">
                      {p.gates.length
                        ? p.gates.map((g) => (
                            <span
                              key={g.key}
                              className={
                                'v2-cc-gate v2-cc-cell--' + (GATE_TONE[g.status] ?? 'none')
                              }
                              title={g.name + ': ' + g.status}
                            >
                              {g.key.toUpperCase()}
                            </span>
                          ))
                        : '—'}
                    </span>
                  </td>
                  {HEAT_KEYS.map((k) => {
                    const cell = p.heat[k] ?? { level: 'none', note: '' };
                    return (
                      <td key={k} title={cell.note}>
                        <span className={'v2-cc-cell v2-cc-cell--' + cell.level}>
                          {cell.level === 'none' ? '—' : cell.note}
                        </span>
                      </td>
                    );
                  })}
                  <td className="pv-num">{p.counts.open}</td>
                  <td className="pv-num">{p.counts.doneThisWeek}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

// ── the live page ──
export function CommandPage(props: {
  workspaceId: string;
  hub: EventHub;
  people: PresenceEntry[];
  go: (p: string) => void;
}): ReactNode {
  const W = '/api/workspaces/' + props.workspaceId;
  const [data, setData] = useState<CcData | null>(null);
  const [events, setEvents] = useState<CcEvent[]>([]);
  const [agents, setAgents] = useState(0);
  const [at, setAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState('');
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const load = useCallback(async () => {
    const [p, r, f] = await Promise.all([
      api<CcData>('GET', W + '/command-center'),
      api<{ events: CcEvent[] }>('GET', W + '/command-center/replay'),
      api<{ running: number }>('GET', W + '/agent-fleet'),
    ]);
    if (p.ok) setData(p.data);
    else setError(p.error.message);
    if (r.ok) setEvents(r.data.events);
    if (f.ok) setAgents(f.data.running);
    setNow(Date.now());
  }, [W]);
  useEffect(() => {
    void load();
    // [PCODE-211 | S15 | v0.1.0] events in a burst are bundled for 150 ms, then one read; the scale test
    // (server/test/db/scale.test.ts) keeps event + pause + read under a second at p95
    return props.hub.on(() => {
      if (pending.current) return;
      pending.current = setTimeout(() => {
        pending.current = null;
        void load();
      }, 150);
    });
  }, [load, props.hub]);
  const view = useMemo(() => data, [data]);
  if (!view) return <p className="pv-muted pv-pad">{error || 'Loading the command center…'}</p>;
  return (
    <CommandView
      data={view}
      events={events}
      people={props.people}
      now={now}
      at={at}
      onAt={setAt}
      agentsRunning={agents}
      go={props.go}
    />
  );
}
