// ── [PCODE-456 | S15 | v0.1.0] Planning in VS Code shows live in the portal: local AI runs, hook steps, plan documents synced ──
// ── [PCODE-242 | S15 | v0.1.0] T24.3 AI providers and file reading in the web app ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-190 | S15 | v0.1.0] Commit leftovers of B4.5–B6.1: classic pages removed, invite session with request ──
// ── [PCODE-122 | S15 | v0.1.0] Show agents in the web app: agents page, ask from a task, live run view, approvals, card badge ──
//    Why:  the T08 exit: an agent's run is watchable step by step from the board. The Agents page shows who
//          the agents are and what they cost; a task asks one to work; the run page shows every step as it
//          lands and puts the decision on a waiting action in front of a person; cards carry a badge while
//          an agent works on them. Everything follows the live stream, nothing polls.
import type { ActivityEvent } from '@orqiva/shared';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from './core/api.js';
import type { EventHub } from './core/hub.js';
import { Icon } from './core/icons.js';
import { Card, Dialog, EmptyState, PageHeader, Stat, follow } from './shell.js';
import { localTime } from './views.js';

export interface Agent {
  id: string;
  key: string;
  name: string;
  description: string;
  role: string;
  systemPrompt: string;
  model: string;
  tools: string[];
  maxTokensPerRun: number;
  monthlyTokenBudget: number;
  enabled: boolean;
  usedThisMonth: number;
}

export interface Run {
  id: string;
  agentId: string;
  agentName: string;
  projectId: string;
  itemId: string | null;
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
  /** [PCODE-456 | S15 | v0.1.0] local: on a developer's machine (client = host:folder), else on the server */
  source?: string;
  client?: string;
}

export interface Step {
  seq: number;
  kind: string;
  content: Record<string, unknown>;
  tokensIn: number;
  tokensOut: number;
  costMicros: number;
  at: string;
}

const W = (workspaceId: string, path: string): string => '/api/workspaces/' + workspaceId + path;
const ACTIVE = ['queued', 'running', 'waiting'];
const isRunEvent = (e: ActivityEvent): boolean =>
  e.type === 'orqiva.workspace.resync' || e.data.object.type === 'agent_run';

/** US dollars from millionths: small sums keep their cents' fractions. */
export const usd = (micros: number): string =>
  '$' + (micros / 1e6).toFixed(micros > 0 && micros < 10_000 ? 4 : 2);

/** 950, 12k, 1.2M */
export const tokenText = (n: number): string =>
  n >= 1e6
    ? (n / 1e6).toFixed(1) + 'M'
    : n >= 1000
      ? String(Math.round(n / 1000)) + 'k'
      : String(n);

const STATUS_TEXT: Record<string, string> = {
  queued: 'Queued',
  running: 'Working',
  waiting: 'Waiting for approval',
  succeeded: 'Finished',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

export function RunStatus(props: { status: string }): ReactNode {
  return (
    <span className={'pe-run-status pe-run-status--' + props.status}>
      {STATUS_TEXT[props.status] ?? props.status}
    </span>
  );
}

// ── the badge on cards: which items an agent is working on now ──

/** Item id → the name of the agent working on it. */
export const AgentWork = createContext<ReadonlyMap<string, string>>(new Map());

export function useActiveRuns(
  workspaceId: string,
  projectId: string | null,
  hub: EventHub,
): ReadonlyMap<string, string> {
  const [work, setWork] = useState<ReadonlyMap<string, string>>(new Map());
  useEffect(() => {
    if (!projectId) return;
    const load = async (): Promise<void> => {
      const r = await api<Run[]>(
        'GET',
        W(workspaceId, '/agent-runs?active=1&projectId=' + projectId),
      );
      if (r.ok)
        setWork(
          new Map(r.data.flatMap((run) => (run.itemId ? [[run.itemId, run.agentName]] : []))),
        );
    };
    void load();
    return hub.on((e) => {
      // a step changes nothing about who works where
      if (isRunEvent(e) && e.data.verb !== 'progressed') void load();
    });
  }, [workspaceId, projectId, hub]);
  return work;
}

/** Gives the cards inside it the project's agents at work. */
export function AgentWorkScope(props: {
  workspaceId: string;
  projectId: string;
  hub: EventHub;
  children: ReactNode;
}): ReactNode {
  const work = useActiveRuns(props.workspaceId, props.projectId, props.hub);
  return <AgentWork.Provider value={work}>{props.children}</AgentWork.Provider>;
}

export function AgentBadge(props: { itemId: string }): ReactNode {
  const name = useContext(AgentWork).get(props.itemId);
  if (!name) return null;
  return (
    <span className="pe-agent-badge" title={name + ' is working on this'}>
      <Icon name="agent" size={14} />
      <span className="pe-agent-badge-text">{name.replace(/ agent$/, '')}</span>
    </span>
  );
}

// ── the Agents page ──

// [PCODE-242 | S15 | v0.1.0] the model provider moved to Settings, AI providers (aiproviders.tsx)

// ── a task: its runs, and asking an agent ──

export function ItemAgents(props: {
  workspaceId: string;
  projectId: string;
  itemId: string;
  canEdit: boolean;
  hub: EventHub;
  go: (p: string) => void;
}): ReactNode {
  const { workspaceId, itemId } = props;
  const [runs, setRuns] = useState<Run[]>([]);
  const [asking, setAsking] = useState(false);
  const load = useCallback(async () => {
    const r = await api<Run[]>('GET', W(workspaceId, '/agent-runs?itemId=' + itemId));
    if (r.ok) setRuns(r.data);
  }, [workspaceId, itemId]);
  useEffect(() => {
    void load();
    return props.hub.on((e) => {
      if (isRunEvent(e) && e.data.verb !== 'progressed') void load();
    });
  }, [load, props.hub]);
  return (
    <section aria-label="Agents" className="pe-panel">
      <div className="pe-panel-head">
        <h2 className="pe-panel-title">Agents</h2>
        {props.canEdit ? (
          <button
            type="button"
            className="pe-btn pe-btn--secondary"
            onClick={() => {
              setAsking(true);
            }}
          >
            <Icon name="agent" size={18} /> Ask an agent
          </button>
        ) : null}
      </div>
      {runs.length === 0 ? (
        <p className="pe-muted">No agent has worked on this task yet.</p>
      ) : (
        <ul className="pe-run-list">
          {runs.map((r) => (
            <li key={r.id}>
              <a href={'/runs/' + r.id} onClick={follow('/runs/' + r.id, props.go)}>
                {r.agentName}
              </a>{' '}
              <RunStatus status={r.status} />
              <div className="pe-small pe-muted pe-run-list-text">{r.instruction}</div>
            </li>
          ))}
        </ul>
      )}
      {asking ? (
        <AskAgentDialog
          workspaceId={workspaceId}
          projectId={props.projectId}
          itemId={itemId}
          onClose={() => {
            setAsking(false);
          }}
          onStarted={(id) => {
            setAsking(false);
            props.go('/runs/' + id);
          }}
        />
      ) : null}
    </section>
  );
}

function AskAgentDialog(props: {
  workspaceId: string;
  projectId: string;
  itemId: string;
  onClose: () => void;
  onStarted: (runId: string) => void;
}): ReactNode {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [agentId, setAgentId] = useState('');
  const [instruction, setInstruction] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    void api<Agent[]>('GET', W(props.workspaceId, '/agents')).then((r) => {
      if (!r.ok) return;
      const on = r.data.filter((a) => a.enabled);
      setAgents(on);
      setAgentId((id) => id || (on[0]?.id ?? ''));
    });
  }, [props.workspaceId]);
  const chosen = agents.find((a) => a.id === agentId);
  const start = async (): Promise<void> => {
    const r = await api<Run>(
      'POST',
      W(props.workspaceId, '/projects/' + props.projectId + '/agent-runs'),
      { agentId, instruction: instruction.trim(), itemId: props.itemId },
    );
    if (!r.ok) {
      setError(r.error.message);
      return;
    }
    props.onStarted(r.data.id);
  };
  return (
    <Dialog
      title="Ask an agent"
      onClose={props.onClose}
      footer={
        <>
          <button type="button" className="pe-btn pe-btn--secondary" onClick={props.onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="pe-btn pe-btn--primary"
            disabled={!agentId || !instruction.trim()}
            onClick={() => {
              void start();
            }}
          >
            Start
          </button>
        </>
      }
    >
      <div className="pe-form-grid">
        <div className="pe-field">
          <label htmlFor="ask-agent">Agent</label>
          <select
            id="ask-agent"
            className="pe-select"
            value={agentId}
            onChange={(e) => {
              setAgentId(e.target.value);
            }}
          >
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          {chosen ? <div className="pe-small pe-muted">{chosen.description}</div> : null}
        </div>
        <div className="pe-field">
          <label htmlFor="ask-text">What should it do?</label>
          <textarea
            id="ask-text"
            className="pe-input pe-textarea"
            rows={4}
            placeholder="e.g. Read this task, write acceptance criteria as a comment and start it"
            value={instruction}
            onChange={(e) => {
              setInstruction(e.target.value);
            }}
          />
        </div>
        {error ? (
          <div className="pe-field-error" role="alert">
            {error}
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}

// ── one run, live ──

interface Block {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
}
interface ResultBlock {
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
}

const text = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);

const short = (v: unknown, max = 600): string => {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s.length > max ? s.slice(0, max) + '…' : s;
};

/** What a tool call would do, in words. */
export function actionText(tool: string, input: Record<string, unknown>): string {
  const ref = typeof input['ref'] === 'string' ? input['ref'] : 'a task';
  switch (tool) {
    case 'move_item':
      return 'move ' + ref + ' to ' + short(input['state'], 60).replace(/^"|"$/g, '');
    case 'add_comment':
      return 'comment on ' + ref;
    case 'create_item':
      return 'create a task';
    case 'update_item':
      return 'change ' + ref;
    default:
      return 'use ' + tool;
  }
}

/** The approvals of a run that no decision has answered yet. */
export function openApprovals(steps: Step[]): Step[] {
  const decided = new Set(
    steps.filter((s) => s.kind === 'decision').map((s) => text(s.content['toolUseId'], '')),
  );
  return steps.filter(
    (s) => s.kind === 'approval' && !decided.has(text(s.content['toolUseId'], '')),
  );
}

export function RunPage(props: {
  workspaceId: string;
  runId: string;
  role: string;
  hub: EventHub;
  go: (p: string) => void;
}): ReactNode {
  const { workspaceId, runId } = props;
  const [data, setData] = useState<{ run: Run; steps: Step[] } | null | 'missing'>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    const r = await api<{ run: Run; steps: Step[] }>('GET', W(workspaceId, '/agent-runs/' + runId));
    setData(r.ok ? r.data : 'missing');
  }, [workspaceId, runId]);
  useEffect(() => {
    void load();
    return props.hub.on((e) => {
      if (e.type === 'orqiva.workspace.resync' || e.data.object.id === runId) void load();
    });
  }, [load, props.hub, runId]);

  if (data === 'missing')
    return (
      <div className="pe-page">
        <EmptyState icon="agent" title="This run does not exist or you cannot see it" />
      </div>
    );
  if (!data) return <div className="pe-page pe-muted">Loading…</div>;
  const { run, steps } = data;
  const active = ACTIVE.includes(run.status);
  const open = run.status === 'waiting' ? openApprovals(steps) : [];
  const toolNames = new Map<string, string>();
  for (const s of steps)
    if (s.kind === 'model')
      for (const b of (s.content['blocks'] ?? []) as Block[])
        if (b.type === 'tool_use' && b.id) toolNames.set(b.id, b.name ?? '');

  const decide = async (approve: boolean): Promise<void> => {
    const r = await api('POST', W(workspaceId, '/agent-runs/' + runId + '/decision'), {
      approve,
      note: note.trim(),
    });
    if (!r.ok) {
      setError(r.error.message);
      return;
    }
    setError('');
    setNote('');
    await load();
  };
  return (
    <div className="pe-page">
      <PageHeader
        eyebrow={
          <a href="/agents" onClick={follow('/agents', props.go)}>
            Agents
          </a>
        }
        title={
          <>
            {run.agentName}
            {run.itemRef ? (
              <>
                {' on '}
                <a
                  className="pe-mono"
                  href={'/items/' + (run.itemId ?? '')}
                  onClick={follow('/items/' + (run.itemId ?? ''), props.go)}
                >
                  {run.itemRef}
                </a>
              </>
            ) : null}
          </>
        }
        subtitle={run.instruction}
        actions={
          // [PCODE-456 | S15 | v0.1.0] a run on a developer's machine is stopped there, not here
          active && props.role !== 'guest' && run.source !== 'local' ? (
            <button
              type="button"
              className="pe-btn pe-btn--secondary"
              onClick={() => {
                void api('POST', W(workspaceId, '/agent-runs/' + runId + '/cancel')).then((r) => {
                  if (!r.ok) setError(r.error.message);
                  void load();
                });
              }}
            >
              Stop the run
            </button>
          ) : null
        }
      />
      <div className="pe-stack">
        {run.source === 'local' ? (
          <div className="pe-notice" role="status">
            {'Runs in VS Code on ' +
              (run.client ?? '').split(':')[0] +
              '. It ends when the planning terminal there is closed.'}
          </div>
        ) : null}
        <div className="pe-stats">
          <Stat icon="agent" label="Status" value={<RunStatus status={run.status} />} />
          <Stat
            icon="chart"
            label="Tokens"
            value={tokenText(run.tokensIn + run.tokensOut)}
            hint={tokenText(run.tokensIn) + ' in · ' + tokenText(run.tokensOut) + ' out'}
          />
          <Stat icon="pulse" label="Cost" value={usd(run.costMicros)} />
          <Stat
            icon="bolt"
            label="Model"
            value={<span className="pe-run-model">{run.model}</span>}
          />
        </div>
        {error ? (
          <div className="pe-field-error" role="alert">
            {error}
          </div>
        ) : null}
        {run.status === 'failed' && run.error ? (
          <div className="pe-notice" role="alert">
            {run.error}
          </div>
        ) : null}

        {open.map((s) => {
          const tool = text(s.content['tool'], '');
          const input = (s.content['input'] ?? {}) as Record<string, unknown>;
          return (
            <section key={s.seq} className="pe-panel pe-approval" aria-label="Waiting for approval">
              <div className="pe-panel-head">
                <div>
                  <h2 className="pe-panel-title">
                    {run.agentName} wants to {actionText(tool, input)}
                  </h2>
                  <p className="pe-panel-subtitle">
                    Nothing happens until a person decides. A decline goes back to the agent with
                    your note.
                  </p>
                </div>
              </div>
              <pre className="pe-run-pre">{short(input, 2000)}</pre>
              {props.role === 'guest' ? (
                <p className="pe-muted">A member decides this.</p>
              ) : (
                <div className="pe-inline-form">
                  <input
                    className="pe-input"
                    aria-label="Note for the agent"
                    placeholder="Note for the agent (optional)"
                    value={note}
                    onChange={(e) => {
                      setNote(e.target.value);
                    }}
                  />
                  <button
                    type="button"
                    className="pe-btn pe-btn--primary"
                    onClick={() => {
                      void decide(true);
                    }}
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    className="pe-btn pe-btn--secondary"
                    onClick={() => {
                      void decide(false);
                    }}
                  >
                    Decline
                  </button>
                </div>
              )}
            </section>
          );
        })}

        <Card
          title="Steps"
          subtitle={
            active ? 'Live: steps appear as the agent takes them.' : 'Everything the agent did.'
          }
        >
          {steps.length === 0 ? (
            <p className="pe-muted">
              {run.status === 'queued' ? 'Waiting to start…' : 'No steps.'}
            </p>
          ) : (
            <ol className="pe-run-steps" aria-label="Steps">
              {steps.map((s) => (
                <StepRow key={s.seq} step={s} agent={run.agentName} toolNames={toolNames} />
              ))}
              {run.status === 'running' || run.status === 'queued' ? (
                <li className="pe-run-step pe-run-step--live">
                  <span className="pe-run-step-icon" aria-hidden="true">
                    <Icon name="dot" size={16} />
                  </span>
                  <div className="pe-muted">Working…</div>
                </li>
              ) : null}
            </ol>
          )}
        </Card>
      </div>
    </div>
  );
}

export function StepRow(props: {
  step: Step;
  agent: string;
  toolNames: ReadonlyMap<string, string>;
}): ReactNode {
  const s = props.step;
  const c = s.content;
  let icon: 'agent' | 'settings' | 'help' | 'person' | 'close' = 'agent';
  let body: ReactNode;
  switch (s.kind) {
    case 'model': {
      const blocks = (c['blocks'] ?? []) as Block[];
      body = (
        <>
          <div className="pe-run-step-title">{props.agent}</div>
          {blocks.map((b, i) =>
            b.type === 'text' ? (
              <p key={i} className="pe-run-text">
                {b.text}
              </p>
            ) : b.type === 'tool_use' ? (
              <div key={i} className="pe-run-call">
                <Icon name="bolt" size={14} /> <span className="pe-mono">{b.name}</span>{' '}
                <span className="pe-small pe-muted">{short(b.input, 200)}</span>
              </div>
            ) : null,
          )}
          <div className="pe-small pe-muted">
            {tokenText(s.tokensIn)} in · {tokenText(s.tokensOut)} out · {usd(s.costMicros)}
          </div>
        </>
      );
      break;
    }
    case 'tool_result': {
      icon = 'settings';
      const results = (c['results'] ?? []) as ResultBlock[];
      body = (
        <>
          <div className="pe-run-step-title">Tool results</div>
          {results.map((r, i) => (
            <div key={i} className={'pe-run-result' + (r.is_error ? ' pe-run-result--error' : '')}>
              <span className="pe-mono">{props.toolNames.get(r.tool_use_id ?? '') ?? 'tool'}</span>
              {r.is_error ? <span className="pe-pill">refused</span> : null}
              <pre className="pe-run-pre">{short(r.content)}</pre>
            </div>
          ))}
        </>
      );
      break;
    }
    case 'approval':
      icon = 'help';
      body = (
        <div className="pe-run-step-title">
          Asked to {actionText(text(c['tool'], ''), (c['input'] ?? {}) as Record<string, unknown>)}
        </div>
      );
      break;
    case 'decision':
      icon = 'person';
      body = (
        <div className="pe-run-step-title">
          {c['approve'] === true ? 'Approved' : 'Declined'} by {text(c['by'], 'someone')}
          {typeof c['note'] === 'string' && c['note'] ? ': ' + c['note'] : ''}
        </div>
      );
      break;
    case 'error':
      icon = 'close';
      body = <div className="pe-run-step-title">Stopped: {text(c['message'], '')}</div>;
      break;
    default:
      body = <pre className="pe-run-pre">{short(c)}</pre>;
  }
  return (
    <li className={'pe-run-step pe-run-step--' + s.kind}>
      <span className="pe-run-step-icon" aria-hidden="true">
        <Icon name={icon} size={16} />
      </span>
      <div className="pe-run-step-body">
        {body}
        <time className="pe-small pe-muted" dateTime={s.at}>
          {localTime(s.at)}
        </time>
      </div>
    </li>
  );
}
