// ── [PCODE-440 | S15 | v0.1.0] T37 Consistency: errors and loading are announced everywhere ──
// ── [PCODE-435 | S15 | v0.1.0] T37 low: Quality board bars show their percentage ──
// ── [PCODE-420 | S15 | v0.1.0] T37 medium: English screens use English number and date formats ──
// ── [PCODE-334 | S15 | v0.1.0] T33.4c MCP servers per agent: registry, our own MCP client, tools in runs under the agent's rules ──
// ── [PCODE-333 | S15 | v0.1.0] T33.4b Sandbox per run with repo tools, pull requests by a bot Git identity ──
// ── [PCODE-332 | S15 | v0.1.0] T33.4a Nested traces with latency and commits, agent rate limits, provider limits and health ──
// ── [PCODE-331 | S15 | v0.1.0] T33.3b Evals: saved cases with checks, eval runs per model or prompt version, pass rates over time ──
// ── [PCODE-330 | S15 | v0.1.0] T33.3a Run quality: annotations, judge scores, outcomes ──
// ── [PCODE-329 | S15 | v0.1.0] T33.2 Agent playground: rerun with other settings, compare runs, A/B experiments ──
// ── [PCODE-328 | S15 | v0.1.0] T33.1b Cost estimate before a run, chargeback per client and cost centre, unit costs ──
// ── [PCODE-327 | S15 | v0.1.0] T33.1a Cache and reasoning tokens priced, the daily ECB rate, spend in euro by day ──
// ── [PCODE-247 | S15 | v0.1.0] T25.2 Agent scopes enforced: files, branches, network, trace redaction ──
// ── [PCODE-246 | S15 | v0.1.0] T25.1 Agent triggers act: assignment, label, mention, CI failure, schedule, webhook ──
// ── [PCODE-242 | S15 | v0.1.0] T24.3 AI providers and file reading in the web app ──
// ── [PCODE-195 | S15 | v0.1.0] B8.3 CLI parity: inbox, approvals, comments, time, agents and ideas from the terminal, offline queue ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-180 | S15 | v0.1.0] B5.1 Agents live: settings, versioned prompts, action rules, autonomy, pause all, budgets in euro, traces, costs, quality ──
//    Why:  the Agents section of the approved design on the server's agents. The fleet shows each agent's
//          state, autonomy, money this month in euro, its success and what it does now, and one switch
//          pauses all of them; each agent's settings hold the model and fallback, versioned instructions
//          with their diff and rollback, a rule per class of action, scope, budgets, triggers and the person
//          accountable. Runs open as a trace with time, tokens and euro per step; costs are charged to
//          projects with the waste of failed runs apart; the leaderboard says what each agent delivers.
import { isEventOf, stepLabel } from '@orqiva/shared';
import { lineDiff, triggerProblem, type Trigger } from '@orqiva/shared';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api } from '../core/api.js';
import type { EventHub } from '../core/hub.js';
import { PIcon, type PIconName } from '../preview/picons.js';
import { Bar, Button, Card, Chip, PageHead, Stat } from '../preview/ui.js';
import { ago } from './inbox.js';
import { euroCents, LiveAvatar } from './shell.js';
import { CompareRuns, Playground, RerunForm } from './playground.js'; // [PCODE-329 | S15 | v0.1.0]
import { RunQuality } from './runquality.js'; // [PCODE-330 | S15 | v0.1.0]
import { Evals, SaveAsCase } from './evals.js'; // [PCODE-331 | S15 | v0.1.0]
import { SandboxFiles } from './sandbox.js'; // [PCODE-333 | S15 | v0.1.0]
import { fmtLocale } from '../core/locale.js'; // [PCODE-420 | S15 | v0.1.0]

const W = (ws: string, p: string): string => '/api/workspaces/' + ws + p;
type Tone = 'success' | 'danger' | 'warning' | 'neutral' | 'info' | 'primary' | 'agent';

export interface Agent {
  id: string;
  key: string;
  name: string;
  description: string;
  systemPrompt: string;
  model: string;
  tools: string[];
  enabled: boolean;
  fallbackModel: string;
  temperature: number;
  maxOutputTokens: number;
  autonomy: string;
  ownerId: string | null;
  ownerName: string | null;
  scope: { files?: string[]; branches?: string[]; network?: string[]; documents?: string[] };
  triggers: { kind: string; value?: string; project?: string; instruction?: string }[];
  concurrency: number;
  promptVersion: number;
  runBudgetCents: number | null;
  dayBudgetCents: number | null;
  monthBudgetCents: number | null;
  // [PCODE-242 | S15 | v0.1.0] the agent's own connection; null follows the workspace's
  connectionId: string | null;
  runsPerHour?: number | null; // [PCODE-332 | S15 | v0.1.0]
  mcpServers?: string[]; // [PCODE-334 | S15 | v0.1.0]
  // [PCODE-246 | S15 | v0.1.0] the webhook's address, and when each kind of trigger last started a run
  webhook?: { path: string; hint: string } | null;
  triggersFired?: Record<string, string>;
}
interface Fleet {
  paused: { at: string; by: string | null } | null;
  running: number;
  waiting: number;
  monthCents: number;
  agents: {
    id: string;
    monthCents: number;
    runsToday: number;
    successRate: number | null;
    perSucceededCents: number | null;
    live: { runId: string; status: string; itemRef: string | null; instruction: string }[];
  }[];
}
interface Run {
  id: string;
  agentId: string;
  agentName: string;
  projectId: string;
  itemRef: string | null;
  instruction: string;
  status: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  costMicros: number;
  error: string;
  requestedBy: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  promptVersion: number;
  summary: string;
  trigger?: { kind: string; note: string } | null; // [PCODE-246 | S15 | v0.1.0]
  playground?: boolean; // [PCODE-329 | S15 | v0.1.0]
  variant?: string;
  // [PCODE-327 | S15 | v0.1.0] the euro rate of the run's day
  usdEur?: number | null;
}
interface Step {
  seq: number;
  kind: string;
  content: Record<string, unknown>;
  tokensIn: number;
  tokensOut: number;
  costMicros: number;
  at: string;
  // [PCODE-327 | S15 | v0.1.0] the cache and the reasoning
  cacheRead?: number;
  cacheWrite?: number;
  reasoning?: number;
  // [PCODE-332 | S15 | v0.1.0] how long it took and the model turn it belongs to
  latencyMs?: number | null;
  parentSeq?: number | null;
}

export const AUTONOMY: Record<string, string> = {
  suggest: 'Suggests only',
  approve: 'Acts, asks first',
  scoped: 'Acts within scope',
  autonomous: 'Fully autonomous',
};
export const RUN_TONE: Record<string, Tone> = {
  succeeded: 'success',
  failed: 'danger',
  cancelled: 'neutral',
  waiting: 'warning',
  running: 'info',
  queued: 'neutral',
};
const MODELS = [
  'claude-opus-5-5',
  'claude-sonnet-5-5',
  'claude-haiku-4-5-20251001',
  'claude-fable-5-1',
];
const TRIGGERS: Record<string, string> = {
  assigned: 'Task assigned to the agent',
  label: 'Label on a task',
  mention: 'Mention in a comment',
  schedule: 'Schedule',
  ci_failure: 'CI fails',
  webhook: 'Webhook',
};

/** Micro-dollars in euro cents at a rate. */
const cents = (micros: number, usdEur: number): number => Math.round((micros / 10_000) * usdEur);
const secs = (ms: number): string =>
  ms < 60_000
    ? (Math.round(ms / 100) / 10).toFixed(1).replace('.', ',') + ' s'
    : String(Math.round(ms / 60_000)) + ' min';

/** Euro without cents from 100 € on. */
export const money = (c: number): string => euroCents(c, c >= 10_000 ? 0 : 2);

/** One line per step of a run: what it was, how long it took, tokens and euro. */
export function traceOf(
  run: Pick<Run, 'startedAt' | 'createdAt' | 'finishedAt'>,
  steps: readonly Step[],
): {
  label: string;
  kind: 'model' | 'tool' | 'person' | 'error';
  start: number;
  dur: number;
  tokens: number;
  costMicros: number;
  /** tokens read from the cache, written to it, and spent reasoning */
  cacheRead: number;
  cacheWrite: number;
  reasoning: number;
  /** [PCODE-332 | S15 | v0.1.0] under a model turn; its own time; each tool's time */
  nested: boolean;
  latencyMs: number | null;
  tools: { tool: string; ms: number }[];
}[] {
  const t0 = new Date(run.startedAt ?? run.createdAt).getTime();
  const end = run.finishedAt ? new Date(run.finishedAt).getTime() : Date.now();
  let prev = t0;
  return steps.map((s, i) => {
    const at = new Date(s.at).getTime();
    const start = Math.max(0, prev - t0);
    const dur = Math.max(0, (i === steps.length - 1 && at < prev ? end : at) - prev);
    prev = Math.max(prev, at);
    const label = stepLabel(s); // [PCODE-195 | S15 | v0.1.0] worded as VS Code and orq agent watch word it
    return {
      label,
      kind:
        s.kind === 'model'
          ? 'model'
          : s.kind === 'tool_result'
            ? 'tool'
            : s.kind === 'error'
              ? 'error'
              : 'person',
      start,
      dur,
      tokens: s.tokensIn + s.tokensOut,
      costMicros: s.costMicros,
      cacheRead: s.cacheRead ?? 0, // [PCODE-327 | S15 | v0.1.0]
      cacheWrite: s.cacheWrite ?? 0,
      reasoning: s.reasoning ?? 0,
      nested: s.parentSeq != null, // [PCODE-332 | S15 | v0.1.0]
      latencyMs: s.latencyMs ?? null,
      tools: ((s.content['durations'] ?? []) as { tool: string; ms: number }[]).map((d) => ({
        tool: d.tool,
        ms: d.ms,
      })),
    };
  });
}

// [PCODE-327 | S15 | v0.1.0] "· 1.000 cached · 40 written to cache · 300 reasoning", what a step's tokens leave out
export const traceExtra = (l: {
  cacheRead: number;
  cacheWrite: number;
  reasoning: number;
}): string =>
  (l.cacheRead ? ' · ' + l.cacheRead.toLocaleString(fmtLocale()) + ' cached' : '') +
  (l.cacheWrite ? ' · ' + l.cacheWrite.toLocaleString(fmtLocale()) + ' written to cache' : '') +
  (l.reasoning ? ' · ' + l.reasoning.toLocaleString(fmtLocale()) + ' reasoning' : '');

// [PCODE-334 | S15 | v0.1.0] an MCP server's kind of action, as the rules name it
const MCP_KIND: Record<string, string> = {
  read: 'only reads',
  comment: 'comments',
  write: 'writes',
  external: 'acts outside',
};

type View = 'fleet' | 'config' | 'runs' | 'playground' | 'evals' | 'costs' | 'quality';

export function AgentsHub(props: {
  workspaceId: string;
  role: string;
  hub: EventHub;
  go: (p: string) => void;
}): ReactNode {
  const { workspaceId } = props;
  const isAdmin = props.role === 'admin' || props.role === 'owner';
  const [view, setView] = useState<View>('fleet');
  const [agents, setAgents] = useState<Agent[] | null>(null);
  const [fleet, setFleet] = useState<Fleet | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [run, setRun] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const load = useCallback(async () => {
    const [a, f] = await Promise.all([
      api<Agent[]>('GET', W(workspaceId, '/agents')),
      api<Fleet>('GET', W(workspaceId, '/agent-fleet')),
    ]);
    if (a.ok) setAgents(a.data);
    else setError(a.error.message);
    if (f.ok) setFleet(f.data);
  }, [workspaceId]);
  useEffect(() => {
    void load();
    let timer: number | null = null;
    const off = props.hub.on((e) => {
      if (!e.type.includes('agent') && e.type !== 'orqiva.workspace.resync') return;
      if (timer !== null) return;
      timer = window.setTimeout(() => {
        timer = null;
        void load();
      }, 700);
    });
    return () => {
      off();
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [load, props.hub]);
  const pause = async (paused: boolean): Promise<void> => {
    const r = await api('PUT', W(workspaceId, '/agents/pause'), { paused });
    if (!r.ok) setError(r.error.message);
    void load();
  };
  const current = agents?.find((a) => a.id === sel) ?? agents?.[0];
  const views: { key: View; label: string; icon: PIconName }[] = [
    { key: 'fleet', label: 'Fleet', icon: 'agents' },
    { key: 'config', label: 'Settings' + (current ? ': ' + current.name : ''), icon: 'settings' },
    { key: 'runs', label: 'Runs and traces', icon: 'activity' },
    { key: 'playground', label: 'Playground', icon: 'sparkle' }, // [PCODE-329 | S15 | v0.1.0]
    { key: 'evals', label: 'Evals', icon: 'check' }, // [PCODE-331 | S15 | v0.1.0]
    { key: 'costs', label: 'Costs', icon: 'euro' },
    ...(isAdmin
      ? [{ key: 'quality' as View, label: 'Quality', icon: 'insights' as PIconName }]
      : []),
  ];
  return (
    <div className="pv-page">
      <PageHead
        title="Agents"
        sub={
          agents && fleet
            ? String(agents.length) +
              ' agents · ' +
              String(fleet.running) +
              ' running, ' +
              String(fleet.waiting) +
              ' waiting · ' +
              money(fleet.monthCents) +
              ' this month'
            : 'Loading…'
        }
        icon="agents"
        actions={
          <>
            {isAdmin && fleet ? (
              fleet.paused ? (
                <Button kind="primary" icon="play" onClick={() => void pause(false)}>
                  Resume all agents
                </Button>
              ) : (
                <Button kind="danger" icon="pause" onClick={() => void pause(true)}>
                  Pause all agents
                </Button>
              )
            ) : null}
            {props.role !== 'guest' && props.role !== 'auditor' && props.role !== 'billing' ? (
              <Button
                kind="primary"
                icon="play"
                onClick={() => {
                  setStarting(true);
                }}
              >
                Start a run
              </Button>
            ) : null}
          </>
        }
      />
      {error ? (
        <p className="v2-error" role="alert">
          {error}
        </p>
      ) : null}
      {fleet?.paused ? (
        <div className="pv-callout pv-callout--warn">
          <PIcon name="pause" size={16} />
          <div>
            <strong>All agents are paused.</strong> Running steps finish, nothing new starts; queued
            runs wait. Paused
            {fleet.paused.by ? ' by ' + fleet.paused.by : ''} {ago(fleet.paused.at)} ago.
          </div>
        </div>
      ) : null}
      {starting && agents ? (
        <StartRun
          workspaceId={workspaceId}
          agents={agents}
          onDone={(id) => {
            setStarting(false);
            if (id) {
              setRun(id);
              setView('runs');
            }
            void load();
          }}
        />
      ) : null}
      <nav className="pv-subtabs pv-mb" aria-label="Agents view">
        {views.map((v) => (
          <button
            key={v.key}
            type="button"
            className="pv-subtab"
            aria-pressed={view === v.key}
            onClick={() => {
              setView(v.key);
            }}
          >
            <PIcon name={v.icon} size={14} />
            {v.label}
          </button>
        ))}
      </nav>
      {!agents || !fleet ? (
        <p className="pv-muted" role="status">
          Loading agents…
        </p>
      ) : null}
      {view === 'fleet' && agents && fleet ? (
        <FleetView
          workspaceId={workspaceId}
          agents={agents}
          fleet={fleet}
          isAdmin={isAdmin}
          onOpen={(id) => {
            setSel(id);
            setView('config');
          }}
          onRun={(id) => {
            setRun(id);
            setView('runs');
          }}
          onChange={() => void load()}
        />
      ) : null}
      {view === 'config' && current ? (
        <Config
          key={current.id}
          workspaceId={workspaceId}
          agent={current}
          isAdmin={isAdmin}
          onChange={() => void load()}
        />
      ) : null}
      {view === 'runs' ? (
        <Runs
          workspaceId={workspaceId}
          canEdit={props.role !== 'guest' && props.role !== 'viewer'}
          selected={run}
          onSelect={setRun}
          hub={props.hub}
          go={props.go}
        />
      ) : null}
      {/* [PCODE-329 | S15 | v0.1.0] experiments; a run opens in Runs and traces */}
      {view === 'playground' && agents ? (
        <Playground
          workspaceId={workspaceId}
          agents={agents}
          hub={props.hub}
          onOpenRun={(id) => {
            setRun(id);
            setView('runs');
          }}
        />
      ) : null}
      {/* [PCODE-331 | S15 | v0.1.0] eval sets and their runs */}
      {view === 'evals' && agents ? (
        <Evals
          workspaceId={workspaceId}
          agents={agents}
          hub={props.hub}
          onOpenRun={(id) => {
            setRun(id);
            setView('runs');
          }}
        />
      ) : null}
      {view === 'costs' ? <Costs workspaceId={workspaceId} /> : null}
      {view === 'quality' && isAdmin ? <Quality workspaceId={workspaceId} /> : null}
    </div>
  );
}

function FleetView(props: {
  workspaceId: string;
  agents: Agent[];
  fleet: Fleet;
  isAdmin: boolean;
  onOpen: (id: string) => void;
  onRun: (id: string) => void;
  onChange: () => void;
}): ReactNode {
  const [making, setMaking] = useState(false);
  const toggle = async (a: Agent, on: boolean): Promise<void> => {
    await api('PATCH', W(props.workspaceId, '/agents/' + a.id), { enabled: on });
    props.onChange();
  };
  return (
    <div className="pv-stack">
      <div className="pv-agent-grid">
        {props.agents.map((a) => {
          const f = props.fleet.agents.find((x) => x.id === a.id);
          const active = a.enabled && !props.fleet.paused;
          const budget = a.monthBudgetCents;
          return (
            <div key={a.id} className={'pv-agent-card' + (active ? '' : ' pv-agent-card--off')}>
              <div className="pv-agent-card-head">
                <LiveAvatar id={a.id} name={a.name} size="md" agent />
                <div className="pv-row-main">
                  <strong>{a.name}</strong>
                  <span className="pv-muted pv-small">{a.description || a.key}</span>
                </div>
                <label
                  className="pv-switch"
                  title={a.enabled ? 'Switch this agent off' : 'Switch on'}
                >
                  <input
                    type="checkbox"
                    checked={a.enabled}
                    disabled={!props.isAdmin}
                    onChange={(e) => void toggle(a, e.target.checked)}
                  />
                  <span>{props.fleet.paused ? 'paused (all)' : a.enabled ? 'on' : 'off'}</span>
                </label>
              </div>
              <div className="pv-agent-meta">
                <Chip mono>{a.model}</Chip>
                <Chip tone="agent">{AUTONOMY[a.autonomy] ?? a.autonomy}</Chip>
                <Chip>prompt v{a.promptVersion}</Chip>
              </div>
              <div className="pv-agent-money">
                <div>
                  <span className="pv-muted pv-small">This month</span>
                  <strong className="pv-num">
                    {euroCents(f?.monthCents ?? 0)}{' '}
                    {budget ? <span className="pv-muted pv-small">of {money(budget)}</span> : null}
                  </strong>
                </div>
                {budget ? (
                  <Bar
                    value={f?.monthCents ?? 0}
                    max={budget}
                    tone={(f?.monthCents ?? 0) / budget > 0.8 ? 'warning' : 'agent'}
                  />
                ) : null}
              </div>
              <div className="pv-agent-stats">
                <span>
                  <strong>{f?.runsToday ?? 0}</strong> runs today
                </span>
                <span>
                  <strong>
                    {f?.successRate === null || f === undefined
                      ? '—'
                      : String(Math.round(f.successRate * 100)) + ' %'}
                  </strong>{' '}
                  succeed
                </span>
                <span>
                  <strong>
                    {f?.perSucceededCents === null || f === undefined
                      ? '—'
                      : euroCents(f.perSucceededCents)}
                  </strong>{' '}
                  per success
                </span>
              </div>
              {f?.live.length ? (
                <div className="pv-agent-live">
                  {f.live.slice(0, 3).map((l) => (
                    <button
                      key={l.runId}
                      type="button"
                      className={'pv-link-btn' + (l.status === 'waiting' ? ' pv-text-warning' : '')}
                      onClick={() => {
                        props.onRun(l.runId);
                      }}
                    >
                      {l.status === 'waiting'
                        ? 'Waiting: '
                        : l.status === 'queued'
                          ? 'Queued: '
                          : 'Now: '}
                      {l.itemRef ? l.itemRef + ' · ' : ''}
                      {l.instruction}
                    </button>
                  ))}
                </div>
              ) : null}
              <div className="pv-agent-foot">
                <span className="pv-who pv-small pv-muted">
                  {a.ownerName ? (
                    <LiveAvatar id={a.ownerId ?? a.ownerName} name={a.ownerName} size="xs" />
                  ) : null}
                  {a.ownerName ? 'accountable: ' + a.ownerName : 'nobody accountable yet'}
                </span>
                <Button
                  size="sm"
                  kind="ghost"
                  onClick={() => {
                    props.onOpen(a.id);
                  }}
                >
                  Settings
                </Button>
              </div>
            </div>
          );
        })}
        {props.isAdmin ? (
          making ? (
            <NewAgent
              workspaceId={props.workspaceId}
              agents={props.agents}
              onDone={(id) => {
                setMaking(false);
                props.onChange();
                if (id) props.onOpen(id);
              }}
            />
          ) : (
            <button
              type="button"
              className="pv-agent-card pv-agent-card--new"
              onClick={() => {
                setMaking(true);
              }}
            >
              <PIcon name="plus" size={22} />
              <strong>New agent</strong>
              <span className="pv-muted pv-small">From scratch or as a copy</span>
            </button>
          )
        ) : null}
      </div>
    </div>
  );
}

function NewAgent(props: {
  workspaceId: string;
  agents: Agent[];
  onDone: (id: string | null) => void;
}): ReactNode {
  const [name, setName] = useState('');
  const [copy, setCopy] = useState('');
  const [error, setError] = useState<string | null>(null);
  const key = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/^[^a-z]+/, '')
    .slice(0, 40);
  const make = async (): Promise<void> => {
    const r = await api<{ id: string }>('POST', W(props.workspaceId, '/agents'), {
      key,
      name: name.trim(),
      ...(copy ? { copyOf: copy } : {}),
    });
    if (!r.ok) setError(r.error.message);
    else props.onDone(r.data.id);
  };
  return (
    <form
      className="pv-agent-card pv-stack"
      onSubmit={(e) => {
        e.preventDefault();
        if (key) void make();
      }}
    >
      <strong>New agent</strong>
      {error ? (
        <p className="v2-error" role="alert">
          {error}
        </p>
      ) : null}
      <input
        className="v2-input"
        aria-label="Name"
        placeholder="Name, e.g. Scribe"
        value={name}
        onChange={(e) => {
          setName(e.target.value);
        }}
      />
      <select
        className="v2-input"
        aria-label="Start from"
        value={copy}
        onChange={(e) => {
          setCopy(e.target.value);
        }}
      >
        <option value="">From scratch</option>
        {props.agents.map((a) => (
          <option key={a.id} value={a.id}>
            Copy of {a.name}
          </option>
        ))}
      </select>
      <span className="pv-muted pv-small">
        It starts switched off; set it up, then switch it on.
      </span>
      <div className="pv-page-actions">
        <button type="submit" className="pv-btn pv-btn--primary pv-btn--sm" disabled={!key}>
          Create
        </button>
        <Button
          size="sm"
          kind="ghost"
          onClick={() => {
            props.onDone(null);
          }}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}

// [PCODE-328 | S15 | v0.1.0] the estimate before a run, in words
export interface Estimate {
  lowCents: number;
  midCents: number;
  highCents: number;
  basis: 'history' | 'rough';
  runs: number;
  model: string;
}
export const estimateText = (e: Estimate): string =>
  (e.highCents < 1
    ? 'Likely less than ' + euroCents(1) + ', '
    : 'Likely about ' +
      euroCents(e.midCents) +
      ' (' +
      euroCents(e.lowCents) +
      '–' +
      euroCents(e.highCents) +
      '), ') +
  (e.basis === 'history'
    ? 'from the last ' + String(e.runs) + ' finished runs of this agent'
    : 'a rough guess from the instruction and the price of ' + e.model);

function StartRun(props: {
  workspaceId: string;
  agents: Agent[];
  onDone: (runId: string | null) => void;
}): ReactNode {
  const [projects, setProjects] = useState<{ id: string; key: string; name: string }[]>([]);
  const [tasks, setTasks] = useState<{ id: string; ref: string; title: string }[]>([]);
  const [project, setProject] = useState('');
  const [agent, setAgent] = useState(props.agents.find((a) => a.enabled)?.id ?? '');
  const [item, setItem] = useState('');
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  // [PCODE-328 | S15 | v0.1.0] what the run will likely cost, asked again a moment after a change
  const [guess, setGuess] = useState<Estimate | null>(null);
  useEffect(() => {
    if (!project || !agent) return;
    const t = setTimeout(() => {
      void api<Estimate>(
        'POST',
        W(props.workspaceId, '/projects/' + project + '/agent-runs/estimate'),
        { agentId: agent, instruction: text, ...(item ? { itemId: item } : {}) },
      ).then((r) => {
        setGuess(r.ok ? r.data : null);
      });
    }, 400);
    return () => {
      clearTimeout(t);
    };
  }, [props.workspaceId, project, agent, item, text]);
  useEffect(() => {
    void api<{ id: string; key: string; name: string; archivedAt: string | null }[]>(
      'GET',
      W(props.workspaceId, '/projects'),
    ).then((r) => {
      if (r.ok) {
        const live = r.data.filter((p) => !p.archivedAt);
        setProjects(live);
        setProject((x) => x || (live[0]?.id ?? ''));
      }
    });
  }, [props.workspaceId]);
  useEffect(() => {
    if (!project) return;
    void api<{ id: string; ref: string; title: string }[]>(
      'GET',
      W(props.workspaceId, '/projects/' + project + '/items'),
    ).then((r) => {
      setTasks(r.ok ? r.data.slice(0, 300) : []);
    });
  }, [project, props.workspaceId]);
  const go = async (): Promise<void> => {
    const r = await api<{ id: string }>(
      'POST',
      W(props.workspaceId, '/projects/' + project + '/agent-runs'),
      { agentId: agent, instruction: text.trim(), ...(item ? { itemId: item } : {}) },
    );
    if (!r.ok) setError(r.error.message);
    else props.onDone(r.data.id);
  };
  return (
    <Card title="Start a run">
      <form
        className="pv-stack"
        onSubmit={(e) => {
          e.preventDefault();
          if (project && agent && text.trim()) void go();
        }}
      >
        {error ? (
          <p className="v2-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="v2-form">
          <select
            className="v2-input"
            aria-label="Agent"
            value={agent}
            onChange={(e) => {
              setAgent(e.target.value);
            }}
          >
            {props.agents.map((a) => (
              <option key={a.id} value={a.id} disabled={!a.enabled}>
                {a.name}
                {a.enabled ? '' : ' (off)'}
              </option>
            ))}
          </select>
          <select
            className="v2-input"
            aria-label="Project"
            value={project}
            onChange={(e) => {
              setProject(e.target.value);
              setItem('');
            }}
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.key} {p.name}
              </option>
            ))}
          </select>
          <select
            className="v2-input"
            aria-label="Task"
            value={item}
            onChange={(e) => {
              setItem(e.target.value);
            }}
          >
            <option value="">The whole project</option>
            {tasks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.ref} {t.title}
              </option>
            ))}
          </select>
        </div>
        <textarea
          className="v2-input"
          rows={3}
          aria-label="Instruction"
          placeholder="What should the agent do?"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
          }}
        />
        {guess ? <p className="pv-small pv-muted">{estimateText(guess)}</p> : null}
        <div className="pv-page-actions">
          <button
            type="submit"
            className="pv-btn pv-btn--primary pv-btn--sm"
            disabled={!project || !agent || !text.trim()}
          >
            Start
          </button>
          <Button
            size="sm"
            kind="ghost"
            onClick={() => {
              props.onDone(null);
            }}
          >
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}

// ── settings ──

interface Version {
  version: number;
  prompt: string;
  note: string;
  createdBy: string | null;
  createdAt: string;
  live: boolean;
  runs: number;
  succeeded: number;
}
interface Rule {
  actionClass: string;
  label: string;
  rule: string;
  isDefault: boolean;
}
const list = (v: string[] | undefined): string => (v ?? []).join(', ');
const split = (s: string): string[] =>
  s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
const toCents = (s: string): number | null => {
  const n = Number(s.replace(',', '.'));
  return s.trim() && n > 0 ? Math.round(n * 100) : null;
};
const scopeOf = (
  f: Record<'files' | 'branches' | 'network' | 'documents', string>,
): Record<string, string[]> => {
  const out: Record<string, string[]> = {};
  for (const k of ['files', 'branches', 'network', 'documents'] as const) {
    const v = split(f[k]);
    if (v.length) out[k] = v;
  }
  return out;
};
const fromCents = (c: number | null): string =>
  c === null ? '' : String(c / 100).replace('.', ',');

function Config(props: {
  workspaceId: string;
  agent: Agent;
  isAdmin: boolean;
  onChange: () => void;
}): ReactNode {
  const a = props.agent;
  const A = W(props.workspaceId, '/agents/' + a.id);
  const ro = !props.isAdmin;
  // [PCODE-242 | S15 | v0.1.0] the connections an admin can pick from, with their suggested models
  const [connections, setConnections] = useState<
    { id: string; label: string; provider: string; models: { agent: string } }[]
  >([]);
  const [connectionId, setConnectionId] = useState(a.connectionId ?? '');
  const [form, setForm] = useState({
    model: a.model,
    fallbackModel: a.fallbackModel,
    temperature: String(a.temperature).replace('.', ','),
    maxOutputTokens: String(a.maxOutputTokens),
    concurrency: String(a.concurrency),
    perHour: a.runsPerHour ? String(a.runsPerHour) : '', // [PCODE-332 | S15 | v0.1.0]
    files: list(a.scope.files),
    branches: list(a.scope.branches),
    network: list(a.scope.network),
    documents: list(a.scope.documents),
    run: fromCents(a.runBudgetCents),
    day: fromCents(a.dayBudgetCents),
    month: fromCents(a.monthBudgetCents),
  });
  const [prompt, setPrompt] = useState(a.systemPrompt);
  const [note, setNote] = useState('');
  const [versions, setVersions] = useState<Version[]>([]);
  const [compare, setCompare] = useState<number | null>(null);
  const [rules, setRules] = useState<Rule[]>([]);
  const [members, setMembers] = useState<{ userId: string; name: string; role: string }[]>([]);
  const [triggers, setTriggers] = useState(a.triggers);
  // [PCODE-247 | S15 | v0.1.0] reading web pages is a tool the network scope opens host by host
  const [web, setWeb] = useState(a.tools.includes('fetch_url'));
  // [PCODE-334 | S15 | v0.1.0] the MCP servers it may use
  const [servers, setServers] = useState<{ id: string; label: string; actionClass: string }[]>([]);
  const [mcp, setMcp] = useState<string[]>(a.mcpServers ?? []);
  useEffect(() => {
    void api<{ id: string; label: string; actionClass: string }[]>(
      'GET',
      W(props.workspaceId, '/mcp-servers'),
    ).then((r) => {
      if (r.ok) setServers(r.data);
    });
  }, [props.workspaceId]);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    const [v, r] = await Promise.all([
      api<Version[]>('GET', A + '/prompts'),
      api<Rule[]>('GET', A + '/rules'),
    ]);
    if (v.ok) {
      setVersions(v.data);
      setCompare((c) => c ?? v.data.find((x) => !x.live)?.version ?? null);
    }
    if (r.ok) setRules(r.data);
  }, [A]);
  useEffect(() => {
    void load();
    // [PCODE-242 | S15 | v0.1.0]
    if (props.isAdmin)
      void api<{ connections: typeof connections }>(
        'GET',
        W(props.workspaceId, '/ai/connections'),
      ).then((r) => {
        if (r.ok) setConnections(r.data.connections);
      });
    if (props.isAdmin)
      void api<{ userId: string; name: string; role: string }[]>(
        'GET',
        W(props.workspaceId, '/members'),
      ).then((r) => {
        if (r.ok)
          setMembers(r.data.filter((m) => !['guest', 'billing', 'auditor'].includes(m.role)));
      });
  }, [load, props.isAdmin, props.workspaceId]);
  const patch = async (body: object, what: string): Promise<void> => {
    setError(null);
    const r = await api('PATCH', A, body);
    if (!r.ok) setError(r.error.message);
    else {
      setSaved(what + ' saved');
      props.onChange();
      void load();
    }
  };
  const saveSettings = (): void => {
    void patch(
      {
        model: form.model.trim(),
        connectionId: connectionId || null, // [PCODE-242 | S15 | v0.1.0]
        fallbackModel: form.fallbackModel.trim(),
        temperature: Math.max(0, Math.min(1, Number(form.temperature.replace(',', '.')) || 0)),
        maxOutputTokens: Math.max(256, Math.min(64_000, Number(form.maxOutputTokens) || 8000)),
        concurrency: Math.max(1, Math.min(50, Number(form.concurrency) || 1)),
        // [PCODE-332 | S15 | v0.1.0] empty: no limit
        runsPerHour:
          Number(form.perHour) > 0 ? Math.min(1000, Math.round(Number(form.perHour))) : null,
        scope: scopeOf(form),
        tools: web
          ? [...new Set([...a.tools, 'fetch_url'])]
          : a.tools.filter((x) => x !== 'fetch_url'),
        triggers,
        runBudgetCents: toCents(form.run),
        dayBudgetCents: toCents(form.day),
        monthBudgetCents: toCents(form.month),
        mcpServers: mcp, // [PCODE-334 | S15 | v0.1.0]
      },
      'Settings',
    );
  };
  const setRule = async (cls: string, rule: string): Promise<void> => {
    const r = await api<Rule[]>('PUT', A + '/rules', { rules: { [cls]: rule } });
    if (r.ok) setRules(r.data);
    else setError(r.error.message);
  };
  const rollback = async (v: number): Promise<void> => {
    const r = await api('POST', A + '/prompts/' + String(v) + '/rollback');
    if (!r.ok) setError(r.error.message);
    else {
      setSaved('Back to version ' + String(v));
      props.onChange();
      void load();
    }
  };
  const live = versions.find((v) => v.live);
  const other = versions.find((v) => v.version === compare);
  const diff = other && live ? lineDiff(other.prompt, live.prompt) : [];
  const field = (
    label: string,
    k: keyof typeof form,
    extra: { mono?: boolean; list?: string; placeholder?: string } = {},
  ): ReactNode => (
    <label className="pv-field">
      <span>{label}</span>
      <input
        className={'v2-input' + (extra.mono ? ' v2-mono' : '')}
        list={extra.list}
        placeholder={extra.placeholder}
        value={form[k]}
        disabled={ro}
        onChange={(e) => {
          setForm({ ...form, [k]: e.target.value });
          setSaved(null);
        }}
      />
    </label>
  );
  return (
    <div className="pv-config">
      <div className="pv-stack">
        {error ? (
          <p className="v2-error" role="alert">
            {error}
          </p>
        ) : null}
        {saved ? (
          <Chip tone="success" icon="check">
            {saved}
          </Chip>
        ) : null}
        <Card title="Model">
          <datalist id="pe-models">
            {MODELS.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
          <div className="pv-form-grid">
            {/* [PCODE-242 | S15 | v0.1.0] the workspace's connection, or the agent's own */}
            <label className="pv-field">
              <span>Connection</span>
              <select
                className="v2-input"
                value={connectionId}
                disabled={ro}
                onChange={(e) => {
                  setConnectionId(e.target.value);
                  const c = connections.find((x) => x.id === e.target.value);
                  if (c?.models.agent) setForm({ ...form, model: c.models.agent });
                  setSaved(null);
                }}
              >
                <option value="">The workspace’s connection for agents</option>
                {connections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
            {field(
              connectionId ? 'Model' : 'Model (used when the connection names none)',
              'model',
              {
                mono: true,
                list: 'pe-models',
              },
            )}
            {field('Fallback when the model fails', 'fallbackModel', {
              mono: true,
              list: 'pe-models',
              placeholder: 'none',
            })}
            {field('Temperature (0–1)', 'temperature')}
            {field('Max output tokens per step', 'maxOutputTokens')}
          </div>
        </Card>
        <Card
          title={'Instructions · v' + String(a.promptVersion)}
          action={
            versions.length > 1 ? (
              <span className="pv-page-actions">
                <select
                  className="v2-input v2-input--sm"
                  aria-label="Compare with"
                  value={compare ?? ''}
                  onChange={(e) => {
                    setCompare(Number(e.target.value));
                  }}
                >
                  {versions
                    .filter((v) => !v.live)
                    .map((v) => (
                      <option key={v.version} value={v.version}>
                        Changes since v{v.version}
                      </option>
                    ))}
                </select>
                {props.isAdmin && compare ? (
                  <Button size="sm" kind="ghost" onClick={() => void rollback(compare)}>
                    Roll back to v{compare}
                  </Button>
                ) : null}
              </span>
            ) : null
          }
        >
          {diff.length && diff.some((l) => l.op !== 'same') ? (
            <div className="pv-prompt">
              {diff.map((l, i) => (
                <div key={i} className={l.op === 'add' ? 'pv-ins' : l.op === 'del' ? 'pv-del' : ''}>
                  {l.text || ' '}
                </div>
              ))}
            </div>
          ) : null}
          <textarea
            className="v2-input v2-mono v2-block"
            rows={8}
            aria-label="Instructions"
            value={prompt}
            disabled={ro}
            onChange={(e) => {
              setPrompt(e.target.value);
            }}
          />
          {props.isAdmin && prompt !== a.systemPrompt ? (
            <div className="v2-inline">
              <input
                className="v2-input v2-input--sm v2-grow"
                aria-label="What changed"
                placeholder="What changed and why"
                value={note}
                onChange={(e) => {
                  setNote(e.target.value);
                }}
              />
              <Button
                size="sm"
                kind="primary"
                onClick={() =>
                  void patch(
                    { systemPrompt: prompt, promptNote: note.trim() },
                    'Version ' + String(a.promptVersion + 1),
                  )
                }
              >
                Save as v{(versions[0]?.version ?? a.promptVersion) + 1}
              </Button>
            </div>
          ) : null}
          <p className="pv-muted pv-small">
            {versions
              .slice(0, 3)
              .map(
                (v) =>
                  'v' +
                  String(v.version) +
                  (v.live ? ' (live)' : '') +
                  ': ' +
                  String(v.runs) +
                  ' runs' +
                  (v.runs
                    ? ', ' + String(Math.round((v.succeeded / v.runs) * 100)) + ' % succeeded'
                    : ''),
              )
              .join(' · ')}
          </p>
        </Card>
        <Card flush title="What it may do without asking">
          <table className="pv-table">
            <tbody>
              {rules.map((r) => (
                <tr key={r.actionClass}>
                  <td className="pv-cell-grow">
                    {r.label}
                    {r.isDefault ? <span className="pv-muted pv-small"> · default</span> : null}
                  </td>
                  <td>
                    <div className="pv-segmented" role="radiogroup" aria-label={r.label}>
                      {(['never', 'ask', 'allowed'] as const).map((v) => (
                        <button
                          key={v}
                          type="button"
                          role="radio"
                          aria-checked={r.rule === v}
                          className={'pv-seg pv-seg--' + (v === 'ask' ? 'approve' : v)}
                          disabled={ro}
                          onClick={() => void setRule(r.actionClass, v)}
                        >
                          {v === 'never' ? 'Never' : v === 'ask' ? 'Ask' : 'Allowed'}
                        </button>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
      <div className="pv-stack">
        <Card title="Autonomy">
          <div className="pv-autonomy">
            {Object.entries(AUTONOMY).map(([k, label], i) => (
              <button
                key={k}
                type="button"
                className="pv-autonomy-step"
                aria-pressed={a.autonomy === k}
                disabled={ro}
                onClick={() => void patch({ autonomy: k }, 'Autonomy')}
              >
                <span className="pv-autonomy-n">{i + 1}</span>
                {label}
              </button>
            ))}
          </div>
          <p className="pv-muted pv-small">
            Suggests only never acts; asks first waits for a person on every action; the other two
            follow the rules.
          </p>
        </Card>
        <Card title="Accountable person">
          {props.isAdmin ? (
            <select
              className="v2-input"
              aria-label="Accountable person"
              value={a.ownerId ?? ''}
              onChange={(e) =>
                void patch({ ownerId: e.target.value || null }, 'Accountable person')
              }
            >
              <option value="">Nobody</option>
              {members.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.name}
                </option>
              ))}
            </select>
          ) : (
            <p>{a.ownerName ?? 'Nobody'}</p>
          )}
        </Card>
        <Card title="Scope, budget and triggers">
          <div className="pv-form-grid">
            {field('Files (comma separated)', 'files', {
              mono: true,
              placeholder: 'src/**, test/**',
            })}
            {field('Branches', 'branches', { mono: true, placeholder: 'agent/*' })}
            {field('Network', 'network', { mono: true, placeholder: 'api.github.com' })}
            {field('Documents', 'documents', { placeholder: 'Architecture, API reference' })}
            {field('Budget per run (€)', 'run', { placeholder: 'no limit' })}
            {field('Budget per day (€)', 'day', { placeholder: 'no limit' })}
            {field('Budget per month (€)', 'month', { placeholder: 'no limit' })}
            {field('Runs at a time', 'concurrency')}
            {field('Runs an hour at most', 'perHour', { placeholder: 'no limit' })}
          </div>
          <label className="v2-check ag-web">
            <input
              type="checkbox"
              checked={web}
              disabled={ro}
              onChange={(e) => {
                setWeb(e.target.checked);
              }}
            />
            May read web pages on the hosts under Network (https only)
          </label>
          {/* [PCODE-334 | S15 | v0.1.0] outside tools; their kind of action meets this agent's rules */}
          {servers.length ? (
            <fieldset className="ag-mcp">
              <legend className="pv-small">MCP servers it may use</legend>
              {servers.map((m) => (
                <label key={m.id} className="v2-check">
                  <input
                    type="checkbox"
                    checked={mcp.includes(m.id)}
                    disabled={ro}
                    onChange={(e) => {
                      setMcp(e.target.checked ? [...mcp, m.id] : mcp.filter((x) => x !== m.id));
                    }}
                  />
                  {m.label}
                  <span className="pv-muted pv-small">
                    {' '}
                    · {MCP_KIND[m.actionClass] ?? m.actionClass}
                  </span>
                </label>
              ))}
            </fieldset>
          ) : null}
          <p className="pv-muted pv-small">
            Files and branches without a list are not limited; with one, Claude Code refuses edits
            and commits outside it on tasks assigned to this agent. Without a host under Network the
            agent reaches nothing outside. Keys and passwords never stay in a trace.
          </p>
          <h3 className="v2-h3">Triggers</h3>
          <ul className="pv-rows">
            {triggers.map((t, i) => (
              <li key={String(i) + t.kind} className="pv-row pv-row--static">
                <span className="pv-row-main">
                  <span className="pv-row-title">{TRIGGERS[t.kind] ?? t.kind}</span>
                  {/* [PCODE-246 | S15 | v0.1.0] what it acts on, and when it last started a run */}
                  <span className="pv-row-sub">
                    {[
                      t.value ? t.value : '',
                      t.project ? 'in ' + t.project : '',
                      t.instruction ? '“' + t.instruction.slice(0, 80) + '”' : '',
                      a.triggersFired?.[t.kind]
                        ? 'last started ' + ago(a.triggersFired[t.kind] ?? '') + ' ago'
                        : 'not started yet',
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
                {!ro ? (
                  <button
                    type="button"
                    className="pv-mini-btn"
                    aria-label="Remove trigger"
                    onClick={() => {
                      setTriggers(triggers.filter((_, j) => j !== i));
                    }}
                  >
                    <PIcon name="x" size={12} />
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
          {!ro ? (
            <AddTrigger
              onAdd={(t) => {
                setTriggers([...triggers, t]);
              }}
            />
          ) : null}
          {!ro ? (
            <div className="pv-page-actions pv-mt">
              <Button kind="primary" onClick={saveSettings}>
                Save settings
              </Button>
            </div>
          ) : null}
          {triggers.some((t) => t.kind === 'webhook') && !ro ? (
            <WebhookPanel
              workspaceId={props.workspaceId}
              agentId={a.id}
              webhook={a.webhook ?? null}
              onChange={props.onChange}
            />
          ) : null}
          <p className="pv-muted pv-small">
            Budgets stop the run when they are reached. Triggers start runs by themselves: each
            cause once, never the agent itself, at most 30 an hour.
          </p>
        </Card>
      </div>
    </div>
  );
}

function AddTrigger(props: { onAdd: (t: Trigger) => void }): ReactNode {
  const [kind, setKind] = useState<Trigger['kind']>('assigned');
  const [value, setValue] = useState('');
  // [PCODE-246 | S15 | v0.1.0] a schedule and a webhook work in a project, with their own ask
  const [project, setProject] = useState('');
  const [instruction, setInstruction] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const withProject = kind === 'schedule' || kind === 'webhook';
  return (
    <div className="v2-inline">
      <select
        className="v2-input v2-input--sm"
        aria-label="Trigger"
        value={kind}
        onChange={(e) => {
          setKind(e.target.value as Trigger['kind']);
          setProblem(null);
        }}
      >
        {Object.entries(TRIGGERS).map(([k, l]) => (
          <option key={k} value={k}>
            {l}
          </option>
        ))}
      </select>
      {kind !== 'assigned' && kind !== 'ci_failure' && kind !== 'webhook' ? (
        <input
          className="v2-input v2-input--sm v2-mono"
          aria-label="Trigger value"
          placeholder={
            kind === 'schedule' ? '0 7 * * 1-5' : kind === 'mention' ? '/coder' : 'agent'
          }
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
          }}
        />
      ) : null}
      {withProject ? (
        <>
          <input
            className="v2-input v2-input--sm v2-mono"
            aria-label="Project key"
            placeholder="APP"
            size={6}
            value={project}
            onChange={(e) => {
              setProject(e.target.value);
            }}
          />
          <input
            className="v2-input v2-input--sm"
            aria-label="What the agent is asked"
            placeholder="What the agent is asked (optional)"
            value={instruction}
            onChange={(e) => {
              setInstruction(e.target.value);
            }}
          />
        </>
      ) : null}
      <Button
        size="sm"
        kind="ghost"
        icon="plus"
        onClick={() => {
          const t: Trigger = {
            kind,
            value: kind === 'webhook' ? '' : value.trim(),
            ...(withProject && project.trim() ? { project: project.trim().toUpperCase() } : {}),
            ...(withProject && instruction.trim() ? { instruction: instruction.trim() } : {}),
          };
          const p = triggerProblem(t);
          setProblem(p);
          if (p) return;
          props.onAdd(t);
          setValue('');
          setProject('');
          setInstruction('');
        }}
      >
        Add trigger
      </Button>
      {problem ? (
        <span className="v2-error" role="alert">
          {problem}
        </span>
      ) : null}
    </div>
  );
}

/** [PCODE-246 | S15 | v0.1.0] The agent's webhook: its address, a new secret shown once, or none. */
function WebhookPanel(props: {
  workspaceId: string;
  agentId: string;
  webhook: { path: string; hint: string } | null;
  onChange: () => void;
}): ReactNode {
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const H = W(props.workspaceId, '/agents/' + props.agentId + '/webhook');
  const renew = async (): Promise<void> => {
    const r = await api<{ path: string; secret: string }>('POST', H);
    if (!r.ok) setError(r.error.message);
    else {
      setSecret(r.data.secret);
      props.onChange();
    }
  };
  const remove = async (): Promise<void> => {
    const r = await api('DELETE', H);
    if (!r.ok) setError(r.error.message);
    else {
      setSecret(null);
      props.onChange();
    }
  };
  return (
    <div className="ag-webhook">
      <h3 className="v2-h3">Webhook</h3>
      {props.webhook ? (
        <>
          <p className="pv-small">
            POST to <code className="v2-mono">{window.location.origin + props.webhook.path}</code>{' '}
            with the header <code className="v2-mono">X-Orqiva-Signature: sha256=…</code> (HMAC of
            the body) or <code className="v2-mono">Authorization: Bearer</code> and the secret. A{' '}
            <code className="v2-mono">project</code> key in the JSON names the project.
          </p>
          {secret ? (
            <p className="pv-small" role="status">
              The secret, shown only now: <code className="v2-mono">{secret}</code>
            </p>
          ) : (
            <p className="pv-muted pv-small">Secret ending in …{props.webhook.hint}</p>
          )}
          <div className="v2-inline">
            <Button size="sm" onClick={() => void renew()}>
              New secret
            </Button>
            <Button size="sm" kind="ghost" onClick={() => void remove()}>
              Remove the address
            </Button>
          </div>
        </>
      ) : (
        <Button size="sm" onClick={() => void renew()}>
          Make the webhook address
        </Button>
      )}
      {error ? (
        <p className="v2-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

// ── runs and traces ──

function Runs(props: {
  workspaceId: string;
  canEdit?: boolean; // [PCODE-330 | S15 | v0.1.0]
  selected: string | null;
  onSelect: (id: string) => void;
  hub: EventHub;
  go: (p: string) => void;
}): ReactNode {
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [rate, setRate] = useState(0.92);
  // [PCODE-329 | S15 | v0.1.0] up to three runs picked to compare
  const [picked, setPicked] = useState<string[]>([]);
  const [comparing, setComparing] = useState(false);
  const load = useCallback(async () => {
    const r = await api<Run[]>('GET', W(props.workspaceId, '/agent-runs'));
    if (r.ok) setRuns(r.data);
  }, [props.workspaceId]);
  useEffect(() => {
    void load();
    void api<{ rate: { usdEur: number } }>('GET', W(props.workspaceId, '/agent-costs')).then(
      (r) => {
        if (r.ok) setRate(r.data.rate.usdEur);
      },
    );
    return props.hub.on((e) => {
      if (isEventOf(e.type, 'agent_run')) void load();
    });
  }, [load, props.hub, props.workspaceId]);
  if (!runs)
    return (
      <p className="pv-muted" role="status">
        Loading runs…
      </p>
    );
  const sel = props.selected ?? runs[0]?.id ?? null;
  return (
    <div className="pv-stack">
      {comparing && picked.length >= 2 ? (
        <CompareRuns
          workspaceId={props.workspaceId}
          ids={picked}
          onClose={() => {
            setComparing(false);
          }}
        />
      ) : null}
      {sel ? (
        <Trace
          key={sel}
          workspaceId={props.workspaceId}
          runId={sel}
          rate={rate}
          hub={props.hub}
          go={props.go}
          onOpen={props.onSelect}
          canEdit={props.canEdit ?? false}
        />
      ) : null}
      <Card
        flush
        title="Recent runs"
        action={
          picked.length ? (
            <span className="pv-page-actions">
              <span className="pv-small pv-muted">{picked.length} picked</span>
              <Button
                size="sm"
                disabled={picked.length < 2}
                onClick={() => {
                  setComparing(true);
                }}
              >
                Compare
              </Button>
              <Button
                size="sm"
                kind="ghost"
                onClick={() => {
                  setPicked([]);
                  setComparing(false);
                }}
              >
                Clear
              </Button>
            </span>
          ) : null
        }
      >
        {runs.length ? (
          <div className="pv-grid-scroll">
            <table className="pv-table">
              <tbody>
                {runs.slice(0, 50).map((r) => (
                  <tr
                    key={r.id}
                    className={'pv-click-row' + (r.id === sel ? ' pv-row-sel' : '')}
                    onClick={() => {
                      props.onSelect(r.id);
                    }}
                  >
                    <td
                      onClick={(e) => {
                        e.stopPropagation();
                      }}
                    >
                      <input
                        type="checkbox"
                        aria-label="Pick to compare"
                        checked={picked.includes(r.id)}
                        disabled={!picked.includes(r.id) && picked.length >= 3}
                        onChange={(e) => {
                          setPicked(
                            e.target.checked ? [...picked, r.id] : picked.filter((x) => x !== r.id),
                          );
                        }}
                      />
                    </td>
                    <td>
                      <span className="pv-who">
                        <LiveAvatar id={r.agentId} name={r.agentName} size="xs" agent />
                        {r.agentName}
                      </span>
                    </td>
                    <td className="pv-mono">{r.itemRef ?? '—'}</td>
                    <td className="pv-cell-grow">
                      <button
                        type="button"
                        className="pv-link-btn"
                        onClick={() => {
                          props.onSelect(r.id);
                        }}
                      >
                        {r.summary || r.instruction.slice(0, 100)}
                      </button>
                      {/* [PCODE-246 | S15 | v0.1.0] a run a trigger started says so */}
                      {r.trigger ? (
                        <span className="pv-muted pv-small"> · started by {r.trigger.note}</span>
                      ) : null}
                      {r.playground ? (
                        <span className="pv-muted pv-small">
                          {' '}
                          · playground{r.variant ? ' ' + r.variant : ''}
                        </span>
                      ) : null}
                    </td>
                    <td>
                      <Chip tone={RUN_TONE[r.status] ?? 'neutral'}>{r.status}</Chip>
                    </td>
                    <td className="pv-muted v2-nowrap">
                      {r.startedAt && r.finishedAt
                        ? secs(new Date(r.finishedAt).getTime() - new Date(r.startedAt).getTime())
                        : ago(r.createdAt) + ' ago'}
                    </td>
                    <td className="pv-num">{euroCents(cents(r.costMicros, rate))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="pv-empty">No runs yet. Start one above or from a task.</p>
        )}
      </Card>
    </div>
  );
}

// [PCODE-332 | S15 | v0.1.0] a commit made for the run's task after it started
interface Commit {
  sha: string;
  message: string;
  url: string;
  committedAt: string;
  reverted: boolean;
}

function Trace(props: {
  workspaceId: string;
  runId: string;
  rate: number;
  hub: EventHub;
  go: (p: string) => void;
  onOpen?: (id: string) => void; // [PCODE-329 | S15 | v0.1.0]
  canEdit?: boolean; // [PCODE-330 | S15 | v0.1.0]
}): ReactNode {
  const [rerun, setRerun] = useState(false);
  const [data, setData] = useState<{ run: Run; steps: Step[]; commits?: Commit[] } | null>(null);
  const load = useCallback(async () => {
    const r = await api<{ run: Run; steps: Step[]; commits?: Commit[] }>(
      'GET',
      W(props.workspaceId, '/agent-runs/' + props.runId),
    );
    if (r.ok) setData(r.data);
  }, [props.workspaceId, props.runId]);
  useEffect(() => {
    void load();
    return props.hub.on((e) => {
      if (e.subject === props.runId) void load();
    });
  }, [load, props.hub, props.runId]);
  if (!data)
    return (
      <p className="pv-muted" role="status">
        Loading the run…
      </p>
    );
  const { run, steps } = data;
  const lines = traceOf(run, steps);
  const total = Math.max(1, ...lines.map((l) => l.start + l.dur));
  const dur = run.startedAt
    ? (run.finishedAt ? new Date(run.finishedAt).getTime() : Date.now()) -
      new Date(run.startedAt).getTime()
    : 0;
  return (
    <Card
      title={
        <span className="pv-who">
          <LiveAvatar id={run.agentId} name={run.agentName} size="xs" agent /> {run.agentName}
          {run.itemRef ? ' · ' + run.itemRef : ''} · prompt v{run.promptVersion}
        </span>
      }
      action={
        <span className="pv-page-actions">
          <Chip tone={RUN_TONE[run.status] ?? 'neutral'}>{run.status}</Chip>
          {dur ? <Chip>{secs(dur)}</Chip> : null}
          {/* [PCODE-327 | S15 | v0.1.0] at the rate of the run's day */}
          <Chip tone="agent">{euroCents(cents(run.costMicros, run.usdEur ?? props.rate))}</Chip>
          {run.playground ? <Chip tone="info">playground</Chip> : null}
          {/* [PCODE-329 | S15 | v0.1.0] try it again, safely */}
          {props.onOpen ? (
            <Button
              size="sm"
              kind="ghost"
              onClick={() => {
                setRerun(!rerun);
              }}
            >
              Rerun
            </Button>
          ) : null}
          <Button
            size="sm"
            kind="ghost"
            onClick={() => {
              props.go('/runs/' + run.id);
            }}
          >
            Open
          </Button>
        </span>
      }
    >
      {rerun ? (
        <RerunForm
          workspaceId={props.workspaceId}
          runId={run.id}
          model={run.model}
          onDone={(id) => {
            setRerun(false);
            if (id) props.onOpen?.(id);
          }}
        />
      ) : null}
      <p className="pv-muted pv-small">
        {run.summary ? 'In one sentence: ' + run.summary : run.instruction.slice(0, 300)}
        {run.error && run.error !== run.summary ? ' · ' + run.error : ''}
      </p>
      {lines.length ? (
        <div className="pv-trace">
          {lines.map((l, i) => (
            <div key={i} className={'pv-trace-row' + (l.nested ? ' pv-trace-row--nested' : '')}>
              <span className="pv-trace-name">
                <PIcon
                  name={
                    l.kind === 'model'
                      ? 'sparkle'
                      : l.kind === 'tool'
                        ? 'ide'
                        : l.kind === 'error'
                          ? 'x'
                          : 'user'
                  }
                  size={13}
                />
                {l.label}
              </span>
              <svg
                className="pv-trace-bar"
                viewBox="0 0 100 10"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                <rect
                  className={
                    'pv-trace-span pv-trace-span--' + (l.kind === 'model' ? 'model' : 'tool')
                  }
                  x={(l.start / total) * 100}
                  y="1"
                  width={Math.max(0.6, (l.dur / total) * 100)}
                  height="8"
                  rx="2"
                />
              </svg>
              <span className="pv-trace-meta pv-small pv-muted">
                {/* [PCODE-332 | S15 | v0.1.0] the step's own time where it was measured, and each tool's */}
                {secs(l.latencyMs ?? l.dur)}
                {l.tools.length > 1
                  ? ' (' + l.tools.map((x) => x.tool + ' ' + secs(x.ms)).join(', ') + ')'
                  : ''}
                {l.tokens ? ' · ' + l.tokens.toLocaleString(fmtLocale()) + ' tokens' : ''}
                {/* [PCODE-327 | S15 | v0.1.0] the cache and the reasoning beside the tokens */}
                {traceExtra(l)}
              </span>
              <span className="pv-num pv-small">
                {l.costMicros ? euroCents(cents(l.costMicros, run.usdEur ?? props.rate)) : ''}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="pv-muted pv-small">No steps yet.</p>
      )}
      {/* [PCODE-333 | S15 | v0.1.0] what the run wrote into its sandbox */}
      <SandboxFiles key={run.id + run.status} workspaceId={props.workspaceId} runId={run.id} />
      {/* [PCODE-332 | S15 | v0.1.0] commits for the task after the run began */}
      {data.commits?.length ? (
        <ul className="pv-trace-commits">
          {data.commits.map((g) => (
            <li key={g.sha} className="pv-small">
              <a className="pv-mono" href={g.url || undefined} target="_blank" rel="noreferrer">
                {g.sha.slice(0, 7)}
              </a>{' '}
              {g.message}
              {g.reverted ? <Chip tone="danger">reverted</Chip> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {/* [PCODE-330 | S15 | v0.1.0] outcome, judge and what people said */}
      <RunQuality
        key={run.id + run.status}
        workspaceId={props.workspaceId}
        runId={run.id}
        finished={run.status === 'succeeded' || run.status === 'failed'}
        canEdit={props.canEdit ?? false}
      />
      {/* [PCODE-331 | S15 | v0.1.0] keep this run's instruction as an eval case */}
      {props.canEdit ? (
        <SaveAsCase workspaceId={props.workspaceId} runId={run.id} agentId={run.agentId} />
      ) : null}
    </Card>
  );
}

// ── costs ──

interface CostData {
  month: string;
  rate: { usdEur: number; day: string | null; source: string };
  totalCents: number;
  wasteCents: number;
  forecastCents: number;
  budgetCents: number | null;
  cacheShare: number | null;
  projects: { id: string; key: string }[];
  agents: {
    agentId: string;
    name: string;
    byProject: Record<string, number>;
    wasteCents: number;
    totalCents: number;
  }[];
  // [PCODE-328 | S15 | v0.1.0] chargeback and what a result cost
  byClient?: Charge[];
  byCostCentre?: Charge[];
  units?: Units;
  projectUnits?: (Units & { id: string; key: string })[];
}
interface Charge {
  group: string;
  projects: string[];
  runs: number;
  cents: number;
}
interface Units {
  tasksDone: number;
  perTaskCents: number | null;
  prsMerged: number;
  perPrCents: number | null;
}

export const heat = (c: number): string =>
  c > 20_000 ? 'over' : c > 5_000 ? 'full' : c > 1_000 ? 'mid' : 'low';

function Costs(props: { workspaceId: string }): ReactNode {
  const now = new Date();
  const [month, setMonth] = useState(
    String(now.getFullYear()) + '-' + String(now.getMonth() + 1).padStart(2, '0'),
  );
  const [d, setD] = useState<CostData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [charge, setCharge] = useState<'client' | 'cost-centre'>('client'); // [PCODE-328 | S15 | v0.1.0]
  useEffect(() => {
    void api<CostData>('GET', W(props.workspaceId, '/agent-costs?month=' + month)).then((r) => {
      if (r.ok) setD(r.data);
      else setError(r.error.message);
    });
  }, [props.workspaceId, month]);
  if (!d) return <p className="pv-muted">{error ?? 'Loading costs…'}</p>;
  const col = (p: string): number => d.agents.reduce((n, a) => n + (a.byProject[p] ?? 0), 0);
  return (
    <div className="pv-stack">
      <div className="pv-page-actions">
        <input
          className="v2-input v2-input--sm"
          type="month"
          aria-label="Month"
          value={month}
          onChange={(e) => {
            if (e.target.value) setMonth(e.target.value);
          }}
        />
      </div>
      <div className="pv-stats">
        <Stat
          label={d.month === month ? 'This month so far' : 'Month'}
          value={money(d.totalCents)}
          sub={
            'forecast ' +
            money(d.forecastCents) +
            (d.budgetCents ? ' · budget ' + money(d.budgetCents) : '')
          }
          tone={d.budgetCents && d.forecastCents > d.budgetCents ? 'warning' : undefined}
          icon="euro"
        />
        <Stat
          label="Waste"
          value={money(d.wasteCents)}
          sub="failed and cancelled runs"
          tone={d.wasteCents ? 'warning' : undefined}
          icon="x"
        />
        <Stat
          label="Cache hits"
          value={d.cacheShare === null ? '—' : String(Math.round(d.cacheShare * 100)) + ' %'}
          sub="of input tokens"
          icon="check"
        />
        <Stat
          label="Rate"
          value={'1 USD = ' + String(d.rate.usdEur).replace('.', ',') + ' EUR'}
          sub={
            d.rate.source +
            (d.rate.day
              ? ', ' + new Date(d.rate.day + 'T12:00:00Z').toLocaleDateString(fmtLocale())
              : '')
          }
          icon="euro"
        />
        {/* [PCODE-328 | S15 | v0.1.0] what one result cost */}
        {d.units ? (
          <Stat
            label="Per task done"
            value={d.units.perTaskCents === null ? '—' : euroCents(d.units.perTaskCents)}
            sub={
              String(d.units.tasksDone) +
              (d.units.tasksDone === 1 ? ' task' : ' tasks') +
              ' with agent runs' +
              (d.units.perPrCents === null
                ? ''
                : ' · ' + euroCents(d.units.perPrCents) + ' per merged PR')
            }
            icon="check"
          />
        ) : null}
      </div>
      {d.byClient ? (
        <Card
          flush
          title="Chargeback"
          action={
            <span className="pv-page-actions">
              <select
                className="v2-input v2-input--sm"
                aria-label="Charge to"
                value={charge}
                onChange={(e) => {
                  setCharge(e.target.value === 'cost-centre' ? 'cost-centre' : 'client');
                }}
              >
                <option value="client">By client</option>
                <option value="cost-centre">By cost centre</option>
              </select>
              <a
                className="pv-btn pv-btn--ghost pv-btn--sm"
                href={W(
                  props.workspaceId,
                  '/agent-costs/chargeback?month=' + d.month + '&by=' + charge,
                )}
              >
                <PIcon name="external" size={14} />
                CSV
              </a>
            </span>
          }
        >
          <ChargeTable rows={(charge === 'client' ? d.byClient : d.byCostCentre) ?? []} />
        </Card>
      ) : null}
      <Card flush title="Cost per agent and project">
        {d.agents.length ? (
          <div className="pv-grid-scroll">
            <table className="pv-table">
              <thead>
                <tr>
                  <th>Agent</th>
                  {d.projects.map((p) => (
                    <th key={p.id} className="pv-num">
                      {p.key}
                    </th>
                  ))}
                  <th className="pv-num">Waste</th>
                  <th className="pv-num">Total</th>
                </tr>
              </thead>
              <tbody>
                {d.agents.map((a) => (
                  <tr key={a.agentId}>
                    <td>
                      <span className="pv-who">
                        <LiveAvatar id={a.agentId} name={a.name} size="xs" agent />
                        {a.name}
                      </span>
                    </td>
                    {d.projects.map((p) => (
                      <td key={p.id} className={'pv-num pv-heat-' + heat(a.byProject[p.id] ?? 0)}>
                        {a.byProject[p.id] ? euroCents(a.byProject[p.id] ?? 0) : '—'}
                      </td>
                    ))}
                    <td className="pv-num pv-text-warning">{euroCents(a.wasteCents)}</td>
                    <td className="pv-num pv-strong">{euroCents(a.totalCents)}</td>
                  </tr>
                ))}
                <tr className="pv-sheet-summary">
                  <td>All agents</td>
                  {d.projects.map((p) => (
                    <td key={p.id} className="pv-num">
                      {euroCents(col(p.id))}
                    </td>
                  ))}
                  <td className="pv-num">{euroCents(d.wasteCents)}</td>
                  <td className="pv-num">{euroCents(d.totalCents)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        ) : (
          <p className="pv-empty">No agent costs in this month.</p>
        )}
      </Card>
    </div>
  );
}

// [PCODE-328 | S15 | v0.1.0] the month's AI cost per client or cost centre
function ChargeTable(props: { rows: Charge[] }): ReactNode {
  if (!props.rows.length) return <p className="pv-empty">No agent costs in this month.</p>;
  return (
    <table className="pv-table">
      <thead>
        <tr>
          <th>Charged to</th>
          <th>Projects</th>
          <th className="pv-num">Runs</th>
          <th className="pv-num">AI cost</th>
        </tr>
      </thead>
      <tbody>
        {props.rows.map((r) => (
          <tr key={r.group}>
            <td className="pv-strong">{r.group}</td>
            <td className="pv-muted">{r.projects.join(', ')}</td>
            <td className="pv-num">{r.runs}</td>
            <td className="pv-num">{euroCents(r.cents)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ── quality ──

interface QualityRow {
  agentId: string;
  name: string;
  runs: number;
  succeeded: number;
  failed: number;
  cancelled: number;
  successRate: number | null;
  declined: number;
  tasksDone: number;
  costCents: number;
  perSucceededCents: number | null;
  // [PCODE-330 | S15 | v0.1.0]
  good?: number;
  bad?: number;
  judged?: number;
  judgeAvg?: number | null;
  outcomes?: { done: number; merged: number; reverted: number; open: number };
}

// [PCODE-330 | S15 | v0.1.0] "4 merged · 1 done · 1 reverted"
export const outcomeLine = (o?: {
  done: number;
  merged: number;
  reverted: number;
  open: number;
}): string => {
  if (!o) return '—';
  const parts = [
    ...(o.merged ? [String(o.merged) + ' merged'] : []),
    ...(o.done ? [String(o.done) + ' done'] : []),
    ...(o.reverted ? [String(o.reverted) + ' reverted'] : []),
    ...(o.open ? [String(o.open) + ' open'] : []),
  ];
  return parts.length ? parts.join(' · ') : '—';
};

function Quality(props: { workspaceId: string }): ReactNode {
  const [days, setDays] = useState(30);
  const [rows, setRows] = useState<QualityRow[] | null>(null);
  useEffect(() => {
    void api<QualityRow[]>('GET', W(props.workspaceId, '/agent-quality?days=' + String(days))).then(
      (r) => {
        if (r.ok) setRows(r.data);
      },
    );
  }, [props.workspaceId, days]);
  if (!rows)
    return (
      <p className="pv-muted" role="status">
        Loading…
      </p>
    );
  return (
    <Card
      flush
      title={'Leaderboard · last ' + String(days) + ' days'}
      action={
        <select
          className="v2-input v2-input--sm"
          aria-label="Period"
          value={String(days)}
          onChange={(e) => {
            setDays(Number(e.target.value));
          }}
        >
          {[7, 30, 90].map((n) => (
            <option key={n} value={String(n)}>
              {n} days
            </option>
          ))}
        </select>
      }
    >
      <div className="pv-grid-scroll">
        <table className="pv-table">
          <thead>
            <tr>
              <th>Agent</th>
              <th>Succeeds</th>
              <th className="pv-num">Runs</th>
              <th className="pv-num">Failed</th>
              <th className="pv-num">Declined actions</th>
              <th className="pv-num">Tasks finished</th>
              <th className="pv-num">Cost</th>
              <th className="pv-num">Per success</th>
              <th className="pv-num">Good / bad</th>
              <th className="pv-num">Judge</th>
              <th>Outcomes</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.agentId}>
                <td>
                  <span className="pv-who">
                    <LiveAvatar id={r.agentId} name={r.name} size="xs" agent />
                    {r.name}
                  </span>
                </td>
                <td className="pv-cell-bar">
                  {r.successRate === null ? (
                    <span className="pv-muted">—</span>
                  ) : (
                    // [PCODE-435 | S15 | v0.1.0] the percentage beside the bar, for everyone
                    <span className="pv-bar-with-value">
                      <Bar
                        value={r.successRate * 100}
                        max={100}
                        tone="success"
                        label={String(Math.round(r.successRate * 100)) + ' %'}
                      />
                      <span className="pv-num pv-small" aria-hidden="true">
                        {String(Math.round(r.successRate * 100))} %
                      </span>
                    </span>
                  )}
                </td>
                <td className="pv-num">{r.runs}</td>
                <td className="pv-num">{r.failed}</td>
                <td className="pv-num">{r.declined}</td>
                <td className="pv-num">{r.tasksDone}</td>
                <td className="pv-num">{euroCents(r.costCents)}</td>
                <td className="pv-num">
                  {r.perSucceededCents === null ? '—' : euroCents(r.perSucceededCents)}
                </td>
                {/* [PCODE-330 | S15 | v0.1.0] people, the judge and what came of the runs */}
                <td className="pv-num">
                  {r.good || r.bad ? String(r.good ?? 0) + ' / ' + String(r.bad ?? 0) : '—'}
                </td>
                <td className="pv-num">
                  {r.judgeAvg == null
                    ? '—'
                    : String(r.judgeAvg).replace('.', ',') + ' (' + String(r.judged ?? 0) + ')'}
                </td>
                <td className="pv-small">{outcomeLine(r.outcomes)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="pv-muted pv-small v2-pad">
        Admins only. Playground runs are left out. Outcomes count finished runs on tasks: the task
        done, its pull request merged, or a commit for it reverted.
      </p>
    </Card>
  );
}
