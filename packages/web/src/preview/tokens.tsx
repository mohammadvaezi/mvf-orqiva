// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-157 | S15 | v0.1.0] D5 preview: Agents, People, Tokens and costs, Activity, Insights, Settings ──
//    Why:  Tokens and costs covers both meanings the owner asked for. AI tokens: spend per day with the
//          spike that a looping agent causes, the month-end forecast, budgets at every level, price tables
//          and the provider keys (one per client if the client pays). Access tokens: personal tokens,
//          service accounts and runner tokens with their scopes, expiry and last use; policies that force
//          expiry; leaked tokens revoked automatically.
import { useState, type ReactNode } from 'react';
import { ACCESS_TOKENS, PRICES, PROVIDER_KEYS, SPEND_DAYS } from './data5.js';
import { SPEND, euro, person } from './data.js';
import { PIcon, type PIconName } from './picons.js';
import { Avatar, Bar, Button, Card, Chip, PageHead, ShareBars, Stat } from './ui.js';

function SpendChart(): ReactNode {
  const w = 760;
  const h = 200;
  const max = 140;
  const bw = (w - 40) / 31 - 4;
  const avg = 45;
  return (
    <svg
      className="pv-chart"
      viewBox={'0 0 ' + String(w) + ' ' + String(h)}
      role="img"
      aria-label="AI spend per day in October and September"
    >
      {[50, 100].map((v) => (
        <g key={v}>
          <line
            className="pv-gridline"
            x1="34"
            x2={w}
            y1={h - 20 - (v / max) * (h - 30)}
            y2={h - 20 - (v / max) * (h - 30)}
          />
          <text className="pv-axis" x="28" y={h - 16 - (v / max) * (h - 30)} textAnchor="end">
            {'€' + String(v)}
          </text>
        </g>
      ))}
      {SPEND_DAYS.map((v, i) => {
        const x = 40 + i * (bw + 4);
        const bh = (v / max) * (h - 30);
        const spike = v > avg * 2.2;
        return (
          <g key={i}>
            <rect
              className={spike ? 'pv-spend-bar pv-spend-bar--spike' : 'pv-spend-bar'}
              x={x}
              y={h - 20 - bh}
              width={bw}
              height={bh}
              rx="3"
            >
              <title>{'Day ' + String(i + 1) + ': ' + euro(v, 2)}</title>
            </rect>
            {spike ? (
              <text
                className="pv-axis pv-axis--strong"
                x={x + bw / 2}
                y={h - 26 - bh}
                textAnchor="middle"
              >
                loop
              </text>
            ) : null}
            {i % 5 === 0 ? (
              <text className="pv-axis" x={x + bw / 2} y={h - 4} textAnchor="middle">
                {String(i + 1)}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

function Spend(): ReactNode {
  return (
    <div className="pv-stack">
      <div className="pv-stats">
        <Stat
          label="This month"
          value={euro(SPEND.month)}
          sub={'of ' + euro(SPEND.monthBudget) + ' workspace budget'}
          icon="euro"
        />
        <Stat
          label="Forecast for October"
          value={euro(2210)}
          sub="from the last 14 days and the sprint plan"
          icon="insights"
        />
        <Stat label="Today" value={euro(SPEND.today, 2)} sub="4 agents, 31 runs" icon="agents" />
        <Stat
          label="Anomalies"
          value="1"
          sub="18 Sep: Coder looped on HEL-201 (€133)"
          tone="warning"
          icon="incident"
        />
      </div>
      <Card
        title="Spend per day · September"
        action={<Chip tone="warning">Alert at 3× the daily average</Chip>}
      >
        <SpendChart />
        <p className="pv-muted pv-small">
          The spike on 18 Sep came from one run that retried a failing test 41 times; the loop guard
          now stops a run after 6 identical retries.
        </p>
      </Card>
      <div className="pv-split pv-split--even">
        <Card title="By project">
          <ShareBars
            rows={SPEND.byProject.map((r) => ({
              label: <span className="pv-mono">{r.key}</span>,
              value: r.value,
              display: euro(r.value),
            }))}
          />
        </Card>
        <Card flush title="Budgets">
          <table className="pv-table">
            <tbody>
              {[
                ['Workspace', 1286, 2400, 'stops new runs at 100 %'],
                ['Project HEL', 512, 600, 'client pays · warns at 80 %'],
                ['Project NWL', 399, 700, 'warns at 80 %'],
                ['Agent Coder', 612, 900, 'per month'],
                ['Per run', 8, 8, 'Coder: stops at €8'],
              ].map(([n, u, b, s]) => (
                <tr key={String(n)}>
                  <td className="pv-cell-strong">{n}</td>
                  <td className="pv-cell-bar">
                    <Bar
                      value={Number(u)}
                      max={Number(b)}
                      tone={Number(u) / Number(b) > 0.8 ? 'warning' : 'agent'}
                    />
                    <span className="pv-small pv-muted">
                      {euro(Number(u))} of {euro(Number(b))}
                    </span>
                  </td>
                  <td className="pv-muted pv-small">{s}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  );
}

function Prices(): ReactNode {
  return (
    <div className="pv-stack">
      <Card
        flush
        title="Price tables (per million tokens, in euro)"
        action={
          <span className="pv-muted pv-small">
            From the provider in USD · converted at 0.92 (ECB, today)
          </span>
        }
      >
        <table className="pv-table">
          <thead>
            <tr>
              <th>Model</th>
              <th className="pv-num">Input</th>
              <th className="pv-num">Output</th>
              <th className="pv-num">Cache read</th>
              <th>Valid from</th>
            </tr>
          </thead>
          <tbody>
            {PRICES.map((p) => (
              <tr key={p.model}>
                <td className="pv-mono">{p.model}</td>
                <td className="pv-num">{euro(p.input, 2)}</td>
                <td className="pv-num">{euro(p.output, 2)}</td>
                <td className="pv-num">{euro(p.cacheRead, 2)}</td>
                <td className="pv-muted">{p.from}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Card
        flush
        title="Provider keys"
        action={
          <Button size="sm" icon="plus">
            Add key
          </Button>
        }
      >
        <table className="pv-table">
          <tbody>
            {PROVIDER_KEYS.map((k) => (
              <tr key={k.key}>
                <td className="pv-cell-strong">{k.provider}</td>
                <td>{k.scope}</td>
                <td className="pv-mono pv-small">{k.key}</td>
                <td>
                  <Chip tone={k.health === 'ok' ? 'success' : 'warning'}>{k.health}</Chip>
                </td>
                <td className="pv-muted pv-small">{k.limit}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function Tokens(): ReactNode {
  const [creating, setCreating] = useState(false);
  const [made, setMade] = useState(false);
  return (
    <div className="pv-stack">
      {creating ? (
        <Card title="New personal token">
          {made ? (
            <div className="pv-callout pv-callout--decision">
              <PIcon name="lock" size={16} />
              <div>
                <strong>Copy it now; it is shown only once.</strong>
                <pre className="pv-code">orq_pat_3kQ9…(shown once in the real app)</pre>
                Stored only as a hash. The prefix lets scanners find it if it leaks.
              </div>
            </div>
          ) : (
            <div className="pv-form-grid">
              <label className="pv-field">
                <span>Name</span>
                <input defaultValue="pe CLI on my laptop" />
              </label>
              <label className="pv-field">
                <span>Expires</span>
                <select className="pv-select pv-select--full" defaultValue="90">
                  <option value="30">in 30 days</option>
                  <option value="90">in 90 days (policy maximum)</option>
                </select>
              </label>
              <label className="pv-field">
                <span>Projects</span>
                <select className="pv-select pv-select--full" defaultValue="nwl">
                  <option value="nwl">NWL, AUR (where you work)</option>
                  <option value="all">All my projects</option>
                </select>
              </label>
              <fieldset className="pv-scopes">
                <legend>Scopes</legend>
                {[
                  'tasks:read',
                  'tasks:write',
                  'loop:write',
                  'agents:run',
                  'deploys:write',
                  'admin',
                ].map((s, i) => (
                  <label key={s} className="pv-switch">
                    <input type="checkbox" defaultChecked={i < 3} />
                    <span className="pv-mono">{s}</span>
                  </label>
                ))}
              </fieldset>
              <div className="pv-page-actions">
                <Button
                  kind="primary"
                  onClick={() => {
                    setMade(true);
                  }}
                >
                  Create token
                </Button>
                <span className="pv-muted pv-small">
                  Scopes like admin or deploys need an admin’s approval.
                </span>
              </div>
            </div>
          )}
        </Card>
      ) : null}
      <Card
        flush
        title="Access tokens"
        action={
          <Button
            size="sm"
            kind="primary"
            icon="plus"
            onClick={() => {
              setCreating(true);
            }}
          >
            New token
          </Button>
        }
      >
        <table className="pv-table">
          <thead>
            <tr>
              <th>Token</th>
              <th>Owner</th>
              <th>Scopes</th>
              <th>Expires</th>
              <th>Last used</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {ACCESS_TOKENS.map((t) => (
              <tr key={t.name}>
                <td>
                  <strong>{t.name}</strong>
                  <span className="pv-muted pv-block pv-small">{t.kind}</span>
                </td>
                <td>
                  <Avatar id={t.owner} size="xs" />
                </td>
                <td className="pv-mono pv-small">{t.scopes}</td>
                <td className={t.state === 'stale' ? 'pv-text-warning' : 'pv-muted'}>
                  {t.expires}
                </td>
                <td className="pv-muted pv-small">{t.last}</td>
                <td>
                  {t.state === 'leaked' ? (
                    <Chip tone="danger">leaked · auto-revoked</Chip>
                  ) : t.state === 'stale' ? (
                    <Button size="sm">Revoke</Button>
                  ) : (
                    <Button size="sm" kind="ghost">
                      Rotate
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function Policies(): ReactNode {
  return (
    <div className="pv-split pv-split--even">
      <Card title="Token policy">
        <div className="pv-kv pv-kv--wide">
          <span>Maximum lifetime</span>
          <span>90 days for personal tokens, 1 year for runners</span>
          <span>CI and runners</span>
          <span>short-lived OIDC tokens preferred (GitHub, GitLab)</span>
          <span>Broad scopes</span>
          <span>admin, deploys:write need an admin’s approval</span>
          <span>IP allow-list</span>
          <span className="pv-mono pv-small">10.0.0.0/16, 185.12.40.0/24</span>
          <span>Unused tokens</span>
          <span>warned at 60 days, revoked at 90</span>
          <span>Expiring soon</span>
          <span>e-mail and inbox 14 and 3 days before</span>
        </div>
      </Card>
      <Card title="Leaked tokens">
        <div className="pv-callout pv-callout--warn">
          <PIcon name="incident" size={16} />
          <div>
            <strong>Tim’s test token was found in commit 77ab3f1</strong> (NWD repository, 2 Oct
            14:02). It was revoked 4 seconds later; the audit log shows no use after that.{' '}
            {person('tim').name} was told and the commit is marked.
          </div>
        </div>
        <p className="pv-muted pv-small">
          Scanned: commits, task text, comments, agent traces and logs. Tokens carry the orq_ prefix
          so they are found.
        </p>
      </Card>
    </div>
  );
}

const VIEWS: { key: string; label: string; icon: PIconName }[] = [
  { key: 'spend', label: 'AI spend', icon: 'euro' },
  { key: 'prices', label: 'Prices and keys', icon: 'tokens' },
  { key: 'tokens', label: 'Access tokens', icon: 'lock' },
  { key: 'policies', label: 'Policies and leaks', icon: 'security' },
];

export function TokensPage(): ReactNode {
  const [view, setView] = useState('spend');
  return (
    <div className="pv-page">
      <PageHead
        title="Tokens and costs"
        sub="AI spend in euro, and every token that can reach this workspace"
        icon="tokens"
      />
      <nav className="pv-subtabs pv-mb" aria-label="Tokens view">
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
            {v.label}
          </button>
        ))}
      </nav>
      {view === 'spend' ? <Spend /> : null}
      {view === 'prices' ? <Prices /> : null}
      {view === 'tokens' ? <Tokens /> : null}
      {view === 'policies' ? <Policies /> : null}
    </div>
  );
}
