// ── [PCODE-160 | S15 | v0.1.0] Gate A1 answers: agent-vs-people comparisons for admins only, sign-off recorded ──
// ── [PCODE-157 | S15 | v0.1.0] D5 preview: Agents, People, Tokens and costs, Activity, Insights, Settings ──
//    Why:  Insights answers how the department works across projects: how fast work flows, how reliably
//          it ships, how good it is, how much the agents contribute and what that costs, how well the team
//          estimates, and whether people are over-booked. Every figure links back to the work behind it.
import type { ReactNode } from 'react';
import { THROUGHPUT } from './data5.js';
import { euro, type Role } from './data.js';
import { Bar, Card, Chip, PageHead, Stat } from './ui.js';

// [PCODE-160 | S15 | v0.1.0] split by people and agents for admins; one total for everyone else
function Throughput(props: { split: boolean }): ReactNode {
  const w = 560;
  const h = 200;
  const max = 60;
  return (
    <svg
      className="pv-chart"
      viewBox={'0 0 ' + String(w) + ' ' + String(h)}
      role="img"
      aria-label="Points done per week by people and agents"
    >
      {[20, 40, 60].map((v) => (
        <g key={v}>
          <line
            className="pv-gridline"
            x1="30"
            x2={w}
            y1={h - 20 - (v / max) * (h - 30)}
            y2={h - 20 - (v / max) * (h - 30)}
          />
          <text className="pv-axis" x="24" y={h - 16 - (v / max) * (h - 30)} textAnchor="end">
            {v}
          </text>
        </g>
      ))}
      {THROUGHPUT.map((t, i) => {
        const x = 46 + i * 64;
        const hh = (t.human / max) * (h - 30);
        const ha = (t.agent / max) * (h - 30);
        return (
          <g key={t.week}>
            {props.split ? (
              <>
                <rect className="pv-bar-done" x={x} y={h - 20 - hh} width="34" height={hh} rx="3">
                  <title>{t.week + ': people ' + String(t.human)}</title>
                </rect>
                <rect
                  className="pv-bar-agent"
                  x={x}
                  y={h - 20 - hh - ha}
                  width="34"
                  height={ha}
                  rx="3"
                >
                  <title>{t.week + ': agents ' + String(t.agent)}</title>
                </rect>
              </>
            ) : (
              <rect
                className="pv-bar-done"
                x={x}
                y={h - 20 - hh - ha}
                width="34"
                height={hh + ha}
                rx="3"
              >
                <title>{t.week + ': ' + String(t.human + t.agent) + ' points'}</title>
              </rect>
            )}
            <text className="pv-axis" x={x + 17} y={h - 4} textAnchor="middle">
              {t.week}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// [PCODE-160 | S15 | v0.1.0] owner's decision at gate A1: comparisons of agents with people are for admins only
export function InsightsPage(props: { role: Role }): ReactNode {
  const admin = props.role === 'admin';
  return (
    <div className="pv-page">
      <PageHead
        title="Insights"
        sub="All projects · last 8 weeks"
        icon="insights"
        actions={
          <select className="pv-select" aria-label="Range" defaultValue="8">
            <option value="8">Last 8 weeks</option>
            <option value="q">This quarter</option>
          </select>
        }
      />
      <div className="pv-stats">
        <Stat
          label="Cycle time"
          value="2.9 days"
          sub="median, stories · −0.6"
          tone="success"
          icon="time"
        />
        <Stat
          label="Throughput"
          value="57 pt / week"
          sub={admin ? '36 by agents, 21 by people' : 'all work done'}
          icon="insights"
        />
        <Stat
          label="Escaped bugs"
          value="3"
          sub="found in production · 1.4 per release"
          tone="warning"
          icon="incident"
        />
        <Stat
          label="AI cost per point"
          value={euro(9.4, 2)}
          sub={admin ? 'people cost per point €118' : euro(1286) + ' this month'}
          icon="euro"
        />
      </div>
      <div className="pv-grid pv-grid--2-1">
        <Card
          title={admin ? 'Done per week: people and agents' : 'Done per week'}
          action={
            admin ? (
              <span className="pv-legend-inline">
                <span className="pv-swatch pv-swatch--actual" /> people{' '}
                <span className="pv-swatch pv-swatch--agent" /> agents
              </span>
            ) : null
          }
        >
          <Throughput split={admin} />
          {admin ? (
            <p className="pv-muted pv-small">
              Agents now finish more points than people; people spend more of their time on review,
              design and clients. Only admins see this comparison.
            </p>
          ) : null}
        </Card>
        {admin ? (
          <Card title="Agents vs people">
            <div className="pv-kv pv-kv--wide">
              <span>Rework</span>
              <span>agents 14 % · people 9 % of merged work changed again within 2 weeks</span>
              <span>Reverts</span>
              <span>agents 3 · people 1</span>
              <span>Review time</span>
              <span>agent PRs wait 3.1 h, people’s 5.4 h</span>
              <span>Bugs per 100 points</span>
              <span>agents 2.1 · people 1.8</span>
            </div>
          </Card>
        ) : (
          <Card title="Flow">
            <div className="pv-kv pv-kv--wide">
              <span>Work in progress</span>
              <span>14 items across 5 projects</span>
              <span>Carried over</span>
              <span>3 items from the last sprints</span>
              <span>Review time</span>
              <span>4.2 h median</span>
              <span>Blocked</span>
              <span>2 items, longest 3 days</span>
            </div>
          </Card>
        )}
      </div>
      <div className="pv-grid pv-grid--2-1">
        <Card flush title="Per project">
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
              {[
                ['NWL', '2.4 d', 31, 86, '4.2', '8 %'],
                ['HEL', '3.8 d', 24, 71, '2.0', '14 %'],
                ['NWD', '2.1 d', 13, 90, '1.5', '0 %'],
                ['AUR', '—', '—', 0, '—', '—'],
                ['PE', '1.6 d', 18, 92, '3.0', '5 %'],
              ].map(([k, c, v, e, d, f]) => (
                <tr key={String(k)}>
                  <td className="pv-mono pv-strong">{k}</td>
                  <td className="pv-num">{c}</td>
                  <td className="pv-num">{v}</td>
                  <td className="pv-cell-bar">
                    {Number(e) ? (
                      <>
                        <Bar
                          value={Number(e)}
                          max={100}
                          tone={Number(e) > 80 ? 'success' : 'warning'}
                        />
                        <span className="pv-small pv-muted">{e} % accurate</span>
                      </>
                    ) : (
                      <span className="pv-muted">—</span>
                    )}
                  </td>
                  <td className="pv-num">{d}</td>
                  <td className={'pv-num ' + (String(f) === '14 %' ? 'pv-text-danger' : '')}>
                    {f}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card title="Load per team · next 2 weeks">
          <ul className="pv-share">
            {[
              ['Delivery', 104],
              ['Mobile', 118],
              ['Quality', 92],
              ['Design', 76],
              ['Platform', 61],
            ].map(([t, v]) => (
              <li key={String(t)} className="pv-share-row pv-share-row--wide">
                <span className="pv-share-label">{t}</span>
                <Bar
                  value={Number(v)}
                  max={130}
                  tone={Number(v) > 100 ? 'danger' : 'primary'}
                  marker={100}
                />
                <span
                  className={'pv-share-value pv-num ' + (Number(v) > 100 ? 'pv-text-danger' : '')}
                >
                  {v} %
                </span>
              </li>
            ))}
          </ul>
          <Chip tone="warning">Mobile is over-booked in week 42: Tim is off two days</Chip>
        </Card>
      </div>
    </div>
  );
}
