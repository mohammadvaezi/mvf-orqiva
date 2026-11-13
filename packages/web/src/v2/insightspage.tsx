// ── [PCODE-440 | S15 | v0.1.0] T37 Consistency: errors and loading are announced everywhere ──
// ── [PCODE-184 | S15 | v0.1.0] B6.2 Insights live: cycle time, throughput, escaped bugs, AI cost per point, agents vs people for admins, flow, per project, team load ──
//    Why:  the Insights page of the approved design on the server's figures: how fast work flows, how
//          reliably it ships, what the agents cost per point, how well sprints are estimated and who is
//          over-booked next. Admins see the work split between agents and people (gate A1); everyone else
//          sees one total.
import { useEffect, useState, type ReactElement, type ReactNode } from 'react';
import { api } from '../core/api.js';
import { Bar, Card, Chip, PageHead, Stat } from '../preview/ui.js';
import { euroCents } from './shell.js';

const W = (ws: string, p: string): string => '/api/workspaces/' + ws + p;

export interface InsightsData {
  weeks: {
    week: string;
    done: number;
    points: number;
    agentDone: number | null;
    agentPoints: number | null;
  }[];
  cycleDays: number | null;
  cycleDaysBefore: number | null;
  pointsPerWeek: number;
  escapedBugs: number;
  releases: number;
  aiCents: number;
  aiCentsPerPoint: number | null;
  agents: {
    agentPoints: number;
    peoplePoints: number;
    agentCycleDays: number | null;
    peopleCycleDays: number | null;
    agentCentsPerPoint: number | null;
    runsSucceeded: number;
    runsFailed: number;
    declined: number;
  } | null;
  flow: {
    wip: number;
    aging: number;
    carried: number;
    reviewHours: number | null;
    projects: number;
  };
  projects: {
    id: string;
    key: string;
    cycleDays: number | null;
    velocity: number | null;
    accuracy: number | null;
    deploysPerWeek: number | null;
    changeFailure: number | null;
  }[];
  teams: { id: string; name: string; load: number; overbooked: { name: string; load: number }[] }[];
}

const one = (v: number): string => (Math.round(v * 10) / 10).toString().replace('.', ',');
const days = (v: number | null): string =>
  v === null ? '—' : one(v) + (v === 1 ? ' day' : ' days');
const pct = (v: number | null): string => (v === null ? '—' : String(Math.round(v * 100)) + ' %');

/** The bars of the throughput chart in a 560 × 200 box, people below agents when split. */
export function throughputBars(
  weeks: InsightsData['weeks'],
  split: boolean,
): { x: number; people: number; agents: number; label: string }[] {
  const max = Math.max(10, ...weeks.map((w) => w.points));
  const step = (560 - 46) / Math.max(1, weeks.length);
  return weeks.map((w, i) => {
    const agents = split ? (w.agentPoints ?? 0) : 0;
    return {
      x: 46 + i * step,
      people: ((w.points - agents) / max) * 170,
      agents: (agents / max) * 170,
      label: w.week.slice(8, 10) + '.' + w.week.slice(5, 7) + '.',
    };
  });
}

export function InsightsHub(props: {
  workspaceId: string;
  role: string;
  go: (p: string) => void;
}): ReactNode {
  const [weeks, setWeeks] = useState(8);
  const [d, setD] = useState<InsightsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void api<InsightsData>('GET', W(props.workspaceId, '/insights?weeks=' + String(weeks))).then(
      (r) => {
        if (r.ok) setD(r.data);
        else setError(r.error.message);
      },
    );
  }, [props.workspaceId, weeks]);
  const split = Boolean(d?.agents);
  const bars = d ? throughputBars(d.weeks, split) : [];
  const step = d ? (560 - 46) / Math.max(1, d.weeks.length) : 0;
  const max = d ? Math.max(10, ...d.weeks.map((w) => w.points)) : 10;
  const delta =
    d && d.cycleDays !== null && d.cycleDaysBefore !== null
      ? d.cycleDays - d.cycleDaysBefore
      : null;
  return (
    <div className="pv-page">
      <PageHead
        title="Insights"
        sub={'All projects · last ' + String(weeks) + ' weeks'}
        icon="insights"
        actions={
          <select
            className="pv-select"
            aria-label="Range"
            value={String(weeks)}
            onChange={(e) => {
              setWeeks(Number(e.target.value));
            }}
          >
            <option value="4">Last 4 weeks</option>
            <option value="8">Last 8 weeks</option>
            <option value="13">Last quarter</option>
            <option value="26">Last half year</option>
          </select>
        }
      />
      {error ? (
        <p className="v2-error" role="alert">
          {error}
        </p>
      ) : null}
      {!d ? (
        <p className="pv-muted">{error ? '' : 'Loading…'}</p>
      ) : (
        <>
          <div className="pv-stats">
            <Stat
              label="Cycle time"
              value={days(d.cycleDays)}
              sub={
                'median, started to done' +
                (delta !== null ? ' · ' + (delta > 0 ? '+' : '−') + one(Math.abs(delta)) : '')
              }
              tone={delta === null ? undefined : delta <= 0 ? 'success' : 'warning'}
              icon="time"
            />
            <Stat
              label="Throughput"
              value={one(d.pointsPerWeek) + ' pt / week'}
              sub={
                d.agents
                  ? String(d.agents.agentPoints) +
                    ' with agents, ' +
                    String(d.agents.peoplePoints) +
                    ' by people alone'
                  : 'all work done'
              }
              icon="insights"
            />
            <Stat
              label="Escaped bugs"
              value={String(d.escapedBugs)}
              sub={
                'reported after a release' +
                (d.releases ? ' · ' + one(d.escapedBugs / d.releases) + ' per release' : '')
              }
              tone={d.escapedBugs ? 'warning' : 'success'}
              icon="incident"
            />
            <Stat
              label="AI cost per point"
              value={d.aiCentsPerPoint === null ? '—' : euroCents(d.aiCentsPerPoint)}
              sub={euroCents(d.aiCents, d.aiCents >= 10_000 ? 0 : 2) + ' in the range'}
              icon="euro"
            />
          </div>
          <div className="pv-grid pv-grid--2-1">
            <Card
              title={split ? 'Done per week: people and agents' : 'Done per week'}
              action={
                split ? (
                  <span className="pv-legend-inline">
                    <span className="pv-swatch pv-swatch--actual" /> people{' '}
                    <span className="pv-swatch pv-swatch--agent" /> with agents
                  </span>
                ) : null
              }
            >
              <svg
                className="pv-chart"
                viewBox="0 0 560 200"
                role="img"
                aria-label="Points done per week"
              >
                {[0.5, 1].map((f) => (
                  <g key={f}>
                    <line
                      className="pv-gridline"
                      x1="30"
                      x2="560"
                      y1={180 - f * 170}
                      y2={180 - f * 170}
                    />
                    <text className="pv-axis" x="24" y={184 - f * 170} textAnchor="end">
                      {Math.round(max * f)}
                    </text>
                  </g>
                ))}
                {bars.map((b, i) => (
                  <g key={d.weeks[i]?.week ?? i}>
                    <rect
                      className="pv-bar-done"
                      x={b.x}
                      y={180 - b.people}
                      width={Math.min(34, step - 8)}
                      height={Math.max(0, b.people)}
                      rx="3"
                    >
                      <title>
                        {(d.weeks[i]?.week ?? '') +
                          ': ' +
                          String(d.weeks[i]?.points ?? 0) +
                          ' points, ' +
                          String(d.weeks[i]?.done ?? 0) +
                          ' tasks'}
                      </title>
                    </rect>
                    {split ? (
                      <rect
                        className="pv-bar-agent"
                        x={b.x}
                        y={180 - b.people - b.agents}
                        width={Math.min(34, step - 8)}
                        height={Math.max(0, b.agents)}
                        rx="3"
                      />
                    ) : null}
                    <text
                      className="pv-axis"
                      x={b.x + Math.min(34, step - 8) / 2}
                      y="196"
                      textAnchor="middle"
                    >
                      {b.label}
                    </text>
                  </g>
                ))}
              </svg>
              {split ? (
                <p className="pv-muted pv-small">
                  “With agents” counts tasks where an agent run succeeded. Only admins see this
                  split.
                </p>
              ) : null}
            </Card>
            {d.agents ? (
              <Card title="Agents vs people">
                <div className="pv-kv pv-kv--wide">
                  <span>Cycle time</span>
                  <span>
                    with agents {days(d.agents.agentCycleDays)} · people alone{' '}
                    {days(d.agents.peopleCycleDays)}
                  </span>
                  <span>AI cost per point</span>
                  <span>
                    {d.agents.agentCentsPerPoint === null
                      ? '—'
                      : euroCents(d.agents.agentCentsPerPoint) + ' on work with agents'}
                  </span>
                  <span>Runs</span>
                  <span>
                    {d.agents.runsSucceeded} succeeded · {d.agents.runsFailed} failed
                  </span>
                  <span>Declined by people</span>
                  <span>
                    {d.agents.declined} {d.agents.declined === 1 ? 'action' : 'actions'}
                  </span>
                </div>
              </Card>
            ) : (
              <FlowCard flow={d.flow} />
            )}
          </div>
          <div className="pv-grid pv-grid--2-1">
            <Card flush title="Per project">
              <div className="pv-grid-scroll">
                <table className="pv-table">
                  <thead>
                    <tr>
                      <th>Project</th>
                      <th className="pv-num">Cycle time</th>
                      <th className="pv-num">Velocity</th>
                      <th>Estimates</th>
                      <th className="pv-num">Deploys / week</th>
                      <th className="pv-num">Change failure</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.projects.map((p) => (
                      <tr key={p.id}>
                        <td>
                          <button
                            type="button"
                            className="pv-link-btn pv-mono pv-strong"
                            onClick={() => {
                              props.go('/projects/' + p.id);
                            }}
                          >
                            {p.key}
                          </button>
                        </td>
                        <td className="pv-num">{days(p.cycleDays)}</td>
                        <td className="pv-num">
                          {p.velocity === null ? '—' : String(p.velocity) + ' pt'}
                        </td>
                        <td className="pv-cell-bar">
                          {p.accuracy === null ? (
                            <span className="pv-muted">—</span>
                          ) : (
                            <>
                              <Bar
                                value={p.accuracy * 100}
                                max={100}
                                tone={p.accuracy >= 0.8 ? 'success' : 'warning'}
                              />
                              <span className="pv-small pv-muted">
                                {pct(p.accuracy)} done of planned
                              </span>
                            </>
                          )}
                        </td>
                        <td className="pv-num">
                          {p.deploysPerWeek === null ? '—' : one(p.deploysPerWeek)}
                        </td>
                        <td
                          className={
                            'pv-num ' +
                            (p.changeFailure !== null && p.changeFailure > 0.15
                              ? 'pv-text-danger'
                              : '')
                          }
                        >
                          {pct(p.changeFailure)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
            <div className="pv-stack">
              <Card title="Load per team · next 2 weeks">
                {d.teams.length ? (
                  <>
                    <ul className="pv-share">
                      {d.teams.map((t) => (
                        <li key={t.id} className="pv-share-row pv-share-row--wide">
                          <span className="pv-share-label">{t.name}</span>
                          <Bar
                            value={Math.min(t.load, 130)}
                            max={130}
                            tone={t.load > 100 ? 'danger' : 'primary'}
                            marker={100}
                          />
                          <span
                            className={
                              'pv-share-value pv-num ' + (t.load > 100 ? 'pv-text-danger' : '')
                            }
                          >
                            {t.load} %
                          </span>
                        </li>
                      ))}
                    </ul>
                    {d.teams
                      .flatMap((t) => t.overbooked.map((p) => ({ team: t.name, ...p })))
                      .slice(0, 3)
                      .map((p) => (
                        <Chip key={p.team + p.name} tone="warning">
                          {p.name} ({p.team}) is booked {p.load} %
                        </Chip>
                      ))}
                    <p className="pv-muted pv-small">
                      From planned tasks with dates against each person’s weekly hours.
                    </p>
                  </>
                ) : (
                  <p className="pv-muted pv-small">No teams yet: make them under People.</p>
                )}
              </Card>
              {d.agents ? <FlowCard flow={d.flow} /> : null}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── [PCODE-184 | S15 | v0.1.0] B6.2 Insights live: cycle time, throughput, escaped bugs, AI cost per point, agents vs people for admins, flow, per project, team load ──
/** How work moves right now; everyone sees it, admins below the agents split. */
function FlowCard(props: { flow: InsightsData['flow'] }): ReactElement {
  return (
    <Card title="Flow">
      <div className="pv-kv pv-kv--wide">
        <span>Work in progress</span>
        <span>
          {props.flow.wip} tasks across {props.flow.projects} projects
        </span>
        <span>Aging</span>
        <span>{props.flow.aging} started more than a week ago</span>
        <span>Carried over</span>
        <span>{props.flow.carried} times into the active sprints</span>
        <span>Review time</span>
        <span>
          {props.flow.reviewHours === null ? '—' : one(props.flow.reviewHours) + ' h median'}
        </span>
      </div>
    </Card>
  );
}
