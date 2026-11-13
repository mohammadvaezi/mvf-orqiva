// ── [PCODE-157 | S15 | v0.1.0] D5 preview: Agents, People, Tokens and costs, Activity, Insights, Settings ──
//    Why:  the Agents section: every agent fully under control. The fleet shows state, autonomy and money;
//          each agent's settings cover model and fallbacks, a versioned prompt with its diff, tools and MCP
//          servers, a rule per kind of action (never, ask, allowed), file and network scope, budgets,
//          triggers, sandbox and secrets, and the person accountable for it. Runs show a trace with tokens
//          and euro per step; costs are charged to projects, with the waste of failed runs apart.
import { useState, type ReactNode } from 'react';
import {
  ACTION_RULES,
  AGENTS,
  COST_MATRIX,
  PROMPT_DIFF,
  TOOLS,
  TRACE,
  type Autonomy,
} from './data5.js';
import { AGENTS_LIVE, euro, person } from './data.js';
import { PIcon, type PIconName } from './picons.js';
import { Avatar, Bar, Button, Card, Chip, PageHead, Stat } from './ui.js';

const AUTONOMY: Record<Autonomy, string> = {
  suggest: 'Suggests only',
  approve: 'Acts, asks first',
  scoped: 'Acts within scope',
  autonomous: 'Fully autonomous',
};

function Fleet(props: { onOpen: (id: string) => void; paused: boolean }): ReactNode {
  const [on, setOn] = useState<Record<string, boolean>>(
    Object.fromEntries(AGENTS.map((a) => [a.id, a.on])),
  );
  return (
    <div className="pv-stack">
      <div className="pv-agent-grid">
        {AGENTS.map((a) => {
          const live = AGENTS_LIVE.filter((r) => r.agent === a.id);
          const active = (on[a.id] ?? false) && !props.paused;
          return (
            <div key={a.id} className={'pv-agent-card' + (active ? '' : ' pv-agent-card--off')}>
              <div className="pv-agent-card-head">
                <Avatar id={a.id} size="md" />
                <div className="pv-row-main">
                  <strong>{person(a.id).name}</strong>
                  <span className="pv-muted pv-small">{a.role}</span>
                </div>
                <label className="pv-switch" title={active ? 'Pause this agent' : 'Resume'}>
                  <input
                    type="checkbox"
                    checked={on[a.id] ?? false}
                    onChange={(e) => {
                      setOn((s) => ({ ...s, [a.id]: e.target.checked }));
                    }}
                  />
                  <span>{props.paused ? 'paused (all)' : active ? 'on' : 'paused'}</span>
                </label>
              </div>
              <div className="pv-agent-meta">
                <Chip mono>{a.model}</Chip>
                <Chip tone="agent">{AUTONOMY[a.autonomy]}</Chip>
                <Chip>prompt {a.prompt}</Chip>
              </div>
              <div className="pv-agent-money">
                <div>
                  <span className="pv-muted pv-small">This month</span>
                  <strong className="pv-num">
                    {euro(a.monthCost)}{' '}
                    <span className="pv-muted pv-small">of {euro(a.budget)}</span>
                  </strong>
                </div>
                <Bar
                  value={a.monthCost}
                  max={a.budget}
                  tone={a.monthCost / a.budget > 0.8 ? 'warning' : 'agent'}
                />
              </div>
              <div className="pv-agent-stats">
                <span>
                  <strong>{a.runsToday}</strong> runs today
                </span>
                <span>
                  <strong>{Math.round(a.success * 100)} %</strong> succeed
                </span>
                <span>
                  <strong>{a.perMergedPr !== null ? euro(a.perMergedPr, 2) : '—'}</strong> per
                  merged PR
                </span>
              </div>
              {live.length ? (
                <div className="pv-agent-live">
                  {live.map((l) => (
                    <span key={l.task} className={l.waiting ? 'pv-text-warning' : ''}>
                      {l.waiting ? 'Waiting: ' : 'Now: '}
                      {l.task} · {l.what}
                    </span>
                  ))}
                </div>
              ) : null}
              <div className="pv-agent-foot">
                <span className="pv-who pv-small pv-muted">
                  <Avatar id={a.owner} size="xs" /> accountable: {person(a.owner).name}
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
        <button type="button" className="pv-agent-card pv-agent-card--new">
          <PIcon name="plus" size={22} />
          <strong>New agent</strong>
          <span className="pv-muted pv-small">From a template or from scratch</span>
        </button>
      </div>
    </div>
  );
}

function Config(props: { id: string }): ReactNode {
  const a = AGENTS.find((x) => x.id === props.id) ?? AGENTS[0];
  const [rules, setRules] = useState(ACTION_RULES);
  const [tools, setTools] = useState(TOOLS);
  const [autonomy, setAutonomy] = useState<Autonomy>(a?.autonomy ?? 'approve');
  const [diff, setDiff] = useState(true);
  if (!a) return null;
  return (
    <div className="pv-config">
      <div className="pv-stack">
        <Card title="Model">
          <div className="pv-form-grid">
            <label className="pv-field">
              <span>Model</span>
              <select className="pv-select pv-select--full" defaultValue={a.model}>
                <option>claude-opus-5-5</option>
                <option>claude-sonnet-5-5</option>
                <option>claude-haiku-4-5</option>
              </select>
            </label>
            <label className="pv-field">
              <span>Fallback when the model fails or is slow</span>
              <select className="pv-select pv-select--full" defaultValue={a.fallback}>
                <option>claude-sonnet-5-5</option>
                <option>claude-haiku-4-5</option>
                <option>none</option>
              </select>
            </label>
            <label className="pv-field">
              <span>Temperature</span>
              <input type="number" defaultValue={0.2} step={0.1} />
            </label>
            <label className="pv-field">
              <span>Max output tokens per step</span>
              <input type="number" defaultValue={8000} step={1000} />
            </label>
          </div>
          <p className="pv-muted pv-small">
            Pinned to the model snapshot of 1 Sep 2026; the provider retires it on 1 Jun 2027.
          </p>
        </Card>
        <Card
          title={'Instructions · ' + a.prompt}
          action={
            <span className="pv-page-actions">
              <label className="pv-switch">
                <input
                  type="checkbox"
                  checked={diff}
                  onChange={(e) => {
                    setDiff(e.target.checked);
                  }}
                />
                <span>Changes since v11</span>
              </label>
              <Button size="sm" kind="ghost">
                Roll back to v11
              </Button>
            </span>
          }
        >
          <div className="pv-prompt">
            {PROMPT_DIFF.filter((l) => diff || l.kind !== 'del').map((l) => (
              <div
                key={l.text}
                className={
                  diff && l.kind !== 'same' ? 'pv-' + (l.kind === 'add' ? 'ins' : 'del') : ''
                }
              >
                {l.text}
              </div>
            ))}
          </div>
          <p className="pv-muted pv-small">
            v12 is live; v11 ran 212 times with 82 % success, v12 so far 41 times with 86 %.
          </p>
        </Card>
        <Card flush title="What it may do without asking">
          <table className="pv-table">
            <tbody>
              {rules.map((r, i) => (
                <tr key={r.action}>
                  <td className="pv-cell-grow">{r.action}</td>
                  <td>
                    <div className="pv-segmented" role="radiogroup" aria-label={r.action}>
                      {(['never', 'approve', 'allowed'] as const).map((v) => (
                        <button
                          key={v}
                          type="button"
                          role="radio"
                          aria-checked={r.rule === v}
                          className={'pv-seg pv-seg--' + v}
                          onClick={() => {
                            setRules((all) => all.map((x, j) => (j === i ? { ...x, rule: v } : x)));
                          }}
                        >
                          {v === 'never' ? 'Never' : v === 'approve' ? 'Ask' : 'Allowed'}
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
            {(Object.keys(AUTONOMY) as Autonomy[]).map((k, i) => (
              <button
                key={k}
                type="button"
                className="pv-autonomy-step"
                aria-pressed={autonomy === k}
                onClick={() => {
                  setAutonomy(k);
                }}
              >
                <span className="pv-autonomy-n">{i + 1}</span>
                {AUTONOMY[k]}
              </button>
            ))}
          </div>
        </Card>
        <Card flush title="Tools and MCP servers">
          <ul className="pv-rows pv-rows--pad">
            {tools.map((t, i) => (
              <li key={t.name} className="pv-row pv-row--static">
                <span className="pv-row-main">
                  <span className="pv-row-title">{t.name}</span>
                  <span className="pv-row-sub">{t.server}</span>
                </span>
                <label className="pv-switch">
                  <input
                    type="checkbox"
                    checked={t.on}
                    onChange={(e) => {
                      setTools((all) =>
                        all.map((x, j) => (j === i ? { ...x, on: e.target.checked } : x)),
                      );
                    }}
                  />
                  <span>{t.on ? 'on' : 'off'}</span>
                </label>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Scope, budget and triggers">
          <div className="pv-kv pv-kv--wide">
            <span>Files</span>
            <span className="pv-mono pv-small">src/**, test/** · not infra/**, .env*</span>
            <span>Branches</span>
            <span className="pv-mono pv-small">agent/* only; never main</span>
            <span>Network</span>
            <span className="pv-mono pv-small">registry.npmjs.org, api.github.com</span>
            <span>Documents</span>
            <span>Overview, Architecture, API reference</span>
            <span>Secrets</span>
            <span>MAP_KEY_STAGING (injected, never in the prompt)</span>
            <span>Budget</span>
            <span>€8 per run (stops) · €60 per day (warns at 80 %) · €900 per month</span>
            <span>Concurrency</span>
            <span>3 runs at a time, then queued</span>
            <span>Triggers</span>
            <span>Task assigned to Coder · label “agent” · PR comment “/coder”</span>
            <span>Sandbox</span>
            <span>Container per run, 2 CPU, 4 GB, 30 min, no host access</span>
            <span>Identity</span>
            <span>Bot user coder@broszio.dev; commits signed</span>
          </div>
        </Card>
      </div>
    </div>
  );
}

function Runs(): ReactNode {
  const total = TRACE.reduce((m, s) => Math.max(m, s.start + s.dur), 0);
  return (
    <div className="pv-stack">
      <Card
        title={
          <span className="pv-who">
            <Avatar id="a-coder" size="xs" /> Run 1 482 · Coder · NWL-188 timeout handling
          </span>
        }
        action={
          <span className="pv-page-actions">
            <Chip tone="success">succeeded</Chip>
            <Chip>69.7 s</Chip>
            <Chip tone="agent">{euro(0.84, 2)}</Chip>
            <Button size="sm" kind="ghost" icon="play">
              Replay
            </Button>
          </span>
        }
      >
        <p className="pv-muted pv-small">
          In one sentence: Coder added a 2 s timeout to the routing call with a fallback, fixed one
          failing test and pushed a branch.
        </p>
        <div className="pv-trace">
          {TRACE.map((s) => (
            <div key={s.name + String(s.start)} className="pv-trace-row">
              <span className="pv-trace-name">
                <PIcon name={s.kind === 'model' ? 'sparkle' : 'ide'} size={13} />
                {s.name}
              </span>
              <svg
                className="pv-trace-bar"
                viewBox="0 0 100 10"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                <rect
                  className={'pv-trace-span pv-trace-span--' + s.kind}
                  x={(s.start / total) * 100}
                  y="1"
                  width={Math.max(0.6, (s.dur / total) * 100)}
                  height="8"
                  rx="2"
                />
              </svg>
              <span className="pv-trace-meta pv-small pv-muted">
                {s.dur.toFixed(1)} s{s.tokens ? ' · ' + s.tokens : ''}
              </span>
              <span className="pv-num pv-small">{s.cost ? euro(s.cost, 2) : ''}</span>
            </div>
          ))}
        </div>
      </Card>
      <Card flush title="Recent runs">
        <table className="pv-table">
          <tbody>
            {[
              ['1 482', 'a-coder', 'NWL-188', 'succeeded', '1 min 10 s', 0.84],
              ['1 481', 'a-coder', 'HEL-212', 'waiting for approval', '—', 2.31],
              ['1 480', 'a-reviewer', '#321', 'succeeded', '42 s', 0.12],
              ['1 479', 'a-coder', 'NWL-189', 'failed: tests', '6 min', 1.87],
              ['1 478', 'a-tester', 'NWD-77', 'running', '—', 0.38],
            ].map(([n, a, t, s, d, c]) => (
              <tr key={String(n)}>
                <td className="pv-mono pv-cell-ref">{n}</td>
                <td>
                  <span className="pv-who">
                    <Avatar id={String(a)} size="xs" />
                    {person(String(a)).name}
                  </span>
                </td>
                <td className="pv-mono">{t}</td>
                <td className="pv-cell-grow">
                  <Chip
                    tone={
                      String(s).startsWith('succeeded')
                        ? 'success'
                        : String(s).startsWith('failed')
                          ? 'danger'
                          : String(s).startsWith('waiting')
                            ? 'warning'
                            : 'info'
                    }
                  >
                    {s}
                  </Chip>
                </td>
                <td className="pv-muted">{d}</td>
                <td className="pv-num">{euro(Number(c), 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function Costs(): ReactNode {
  const projects = ['NWL', 'HEL', 'NWD', 'AUR', 'PE'];
  const col = (p: string): number => COST_MATRIX.reduce((s, r) => s + (r.byProject[p] ?? 0), 0);
  const waste = COST_MATRIX.reduce((s, r) => s + r.waste, 0);
  const total = projects.reduce((s, p) => s + col(p), 0);
  return (
    <div className="pv-stack">
      <div className="pv-stats">
        <Stat
          label="October so far"
          value={euro(total)}
          sub="forecast €2 210 · budget €2 400"
          icon="euro"
        />
        <Stat
          label="Waste"
          value={euro(waste)}
          sub="failed and cancelled runs"
          tone="warning"
          icon="x"
        />
        <Stat
          label="Cache hits"
          value="58 %"
          sub="saves about €310 a month"
          tone="success"
          icon="check"
        />
        <Stat label="Rate" value="1 USD = 0.92 EUR" sub="ECB, 4 Oct 2026" icon="euro" />
      </div>
      <Card flush title="Cost per agent and project">
        <table className="pv-table">
          <thead>
            <tr>
              <th>Agent</th>
              {projects.map((p) => (
                <th key={p} className="pv-num">
                  {p}
                </th>
              ))}
              <th className="pv-num">Waste</th>
              <th className="pv-num">Total</th>
            </tr>
          </thead>
          <tbody>
            {COST_MATRIX.map((r) => (
              <tr key={r.agent}>
                <td>
                  <span className="pv-who">
                    <Avatar id={r.agent} size="xs" />
                    {person(r.agent).name}
                  </span>
                </td>
                {projects.map((p) => (
                  <td
                    key={p}
                    className={
                      'pv-num pv-heat-' +
                      ((r.byProject[p] ?? 0) > 200
                        ? 'over'
                        : (r.byProject[p] ?? 0) > 50
                          ? 'full'
                          : (r.byProject[p] ?? 0) > 10
                            ? 'mid'
                            : 'low')
                    }
                  >
                    {r.byProject[p] ? euro(r.byProject[p] ?? 0) : '—'}
                  </td>
                ))}
                <td className="pv-num pv-text-warning">{euro(r.waste)}</td>
                <td className="pv-num pv-strong">
                  {euro(Object.values(r.byProject).reduce((a, b) => a + b, 0))}
                </td>
              </tr>
            ))}
            <tr className="pv-sheet-summary">
              <td>All agents</td>
              {projects.map((p) => (
                <td key={p} className="pv-num">
                  {euro(col(p))}
                </td>
              ))}
              <td className="pv-num">{euro(waste)}</td>
              <td className="pv-num">{euro(total)}</td>
            </tr>
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function Quality(): ReactNode {
  return (
    <Card flush title="Leaderboard · last 30 days">
      <table className="pv-table">
        <thead>
          <tr>
            <th>Agent</th>
            <th>Succeeds</th>
            <th className="pv-num">Merged PRs</th>
            <th className="pv-num">Reverted</th>
            <th className="pv-num">Edited by people</th>
            <th className="pv-num">Per merged PR</th>
            <th className="pv-num">Eval score</th>
          </tr>
        </thead>
        <tbody>
          {AGENTS.filter((a) => a.perMergedPr !== null).map((a, i) => (
            <tr key={a.id}>
              <td>
                <span className="pv-who">
                  <Avatar id={a.id} size="xs" />
                  {person(a.id).name}
                </span>
              </td>
              <td className="pv-cell-bar">
                <Bar value={a.success * 100} max={100} tone="success" />
              </td>
              <td className="pv-num">{[46, 31, 9][i]}</td>
              <td className="pv-num">{[2, 0, 1][i]}</td>
              <td className="pv-num">{['24 %', '—', '31 %'][i]}</td>
              <td className="pv-num">{euro(a.perMergedPr ?? 0, 2)}</td>
              <td className="pv-num">{[8.4, 9.1, 7.2][i]}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="pv-muted pv-small pv-pad">
        Evals run on every prompt or model change against 40 saved tasks; a drop of more than 5 %
        blocks the change.
      </p>
    </Card>
  );
}

const VIEWS: { key: string; label: string; icon: PIconName }[] = [
  { key: 'fleet', label: 'Fleet', icon: 'agents' },
  { key: 'config', label: 'Settings: Coder', icon: 'settings' },
  { key: 'runs', label: 'Runs and traces', icon: 'activity' },
  { key: 'costs', label: 'Costs', icon: 'euro' },
  { key: 'quality', label: 'Quality', icon: 'insights' },
];

export function AgentsPage(): ReactNode {
  const [view, setView] = useState('fleet');
  const [agent, setAgent] = useState('a-coder');
  const [paused, setPaused] = useState(false);
  return (
    <div className="pv-page">
      <PageHead
        title="Agents"
        sub={'6 agents · 2 running, 1 waiting · ' + euro(1286) + ' this month'}
        icon="agents"
        actions={
          <>
            {paused ? (
              <Button
                kind="primary"
                icon="play"
                onClick={() => {
                  setPaused(false);
                }}
              >
                Resume all agents
              </Button>
            ) : (
              <Button
                kind="danger"
                icon="pause"
                onClick={() => {
                  setPaused(true);
                }}
              >
                Pause all agents
              </Button>
            )}
            <Button kind="primary" icon="play">
              Start a run
            </Button>
          </>
        }
      />
      {paused ? (
        <div className="pv-callout pv-callout--warn">
          <PIcon name="pause" size={16} />
          <div>
            <strong>All agents are paused.</strong> Running steps finish, nothing new starts; queued
            runs wait. Paused by you at 09:52.
          </div>
        </div>
      ) : null}
      <nav className="pv-subtabs pv-mb" aria-label="Agents view">
        {VIEWS.map((v) => (
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
            {v.key === 'config' ? 'Settings: ' + person(agent).name : v.label}
          </button>
        ))}
      </nav>
      {view === 'fleet' ? (
        <Fleet
          paused={paused}
          onOpen={(id) => {
            setAgent(id);
            setView('config');
          }}
        />
      ) : null}
      {view === 'config' ? <Config key={agent} id={agent} /> : null}
      {view === 'runs' ? <Runs /> : null}
      {view === 'costs' ? <Costs /> : null}
      {view === 'quality' ? <Quality /> : null}
    </div>
  );
}
