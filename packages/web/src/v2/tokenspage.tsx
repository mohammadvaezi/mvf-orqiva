// ── [PCODE-440 | S15 | v0.1.0] T37 Consistency: errors and loading are announced everywhere ──
// ── [PCODE-243 | S15 | v0.1.0] T24.4 AI providers exit check, docs and sprint close ──
// ── [PCODE-242 | S15 | v0.1.0] T24.3 AI providers and file reading in the web app ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-181 | S15 | v0.1.0] B5.2 Tokens and costs live: AI spend, budgets, prices, provider keys per project, access tokens with scopes, policy, leak revocation ──
//    Why:  Tokens and costs of the approved design on the server. AI spend per day in euro with the days
//          that stand out, this month, today and the forecast, by project, model and agent; budgets with
//          their use; price tables per model and provider keys per project. Access tokens with their
//          scopes, expiry and last use, shown once when made; service accounts and runners; the token
//          policy and the leaks that revoked a token.
import { TOKEN_SCOPES } from '@orqiva/shared';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api } from '../core/api.js';
import { PIcon, type PIconName } from '../preview/picons.js';
import { Bar, Button, Card, Chip, PageHead, ShareBars, Stat } from '../preview/ui.js';
import { ago } from './inbox.js';
import { euroCents } from './shell.js';
import { dateText } from './versions.js';

const W = (ws: string, p: string): string => '/api/workspaces/' + ws + p;
/** Euro without cents from 100 € on. */
export const money = (c: number): string => euroCents(c, c >= 10_000 ? 0 : 2);

interface Spend {
  rate: { usdEur: number; day: string | null; source: string };
  days: { day: string; cents: number; runs: number }[];
  anomalies: { day: string; cents: number; agent: string | null; runs: number }[];
  todayCents: number;
  todayRuns: number;
  todayAgents: number;
  monthCents: number;
  forecastCents: number;
  budgetCents: number | null;
  byProject: { id: string; key: string; cents: number }[];
  byModel: { model: string; cents: number; tokens: number }[];
  byProvider?: { provider: string; cents: number; tokens: number }[]; // [PCODE-243 | S15 | v0.1.0]
  byAgent: { id: string; name: string; cents: number }[];
}
interface Budget {
  id: string;
  scopeType: string;
  scopeId: string | null;
  scopeLabel: string;
  measure: string;
  period: string;
  amountCents: number;
  warnPct: number;
  hardStop: boolean;
  usedCents: number;
}
export interface AccessToken {
  id: string;
  name: string;
  kind: string;
  ownerId: string;
  ownerName: string;
  isService: boolean;
  boundToWorkspace: boolean;
  scopes: string[];
  state: string;
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  lastUsedIp: string | null;
  useCount: number;
  revokedAt: string | null;
  stale: boolean;
  mine: boolean;
}

/** The bars of the spend chart: x, height and whether the day stands out, in a 760 × 200 box. */
export function spendBars(
  days: readonly { cents: number }[],
  spikes: readonly number[],
): { x: number; w: number; h: number; spike: boolean }[] {
  const max = Math.max(100, ...days.map((d) => d.cents));
  const bw = Math.max(4, (760 - 40) / Math.max(1, days.length) - 4);
  return days.map((d, i) => ({
    x: 40 + i * (bw + 4),
    w: bw,
    h: (d.cents / max) * 170,
    spike: spikes.includes(i),
  }));
}

const PERIOD: Record<string, string> = {
  run: 'per run',
  day: 'per day',
  month: 'per month',
  sprint: 'per sprint',
  total: 'in total',
};
const KIND: Record<string, string> = {
  personal: 'Personal token',
  service: 'Service account',
  runner: 'Runner',
};

type View = 'spend' | 'prices' | 'tokens' | 'policies';

export function TokensHub(props: { workspaceId: string; role: string }): ReactNode {
  const isAdmin = props.role === 'admin' || props.role === 'owner';
  const [view, setView] = useState<View>('spend');
  const views: { key: View; label: string; icon: PIconName }[] = [
    { key: 'spend', label: 'AI spend', icon: 'euro' },
    { key: 'prices', label: 'Prices and keys', icon: 'tokens' },
    { key: 'tokens', label: 'Access tokens', icon: 'lock' },
    { key: 'policies', label: 'Policies and leaks', icon: 'security' },
  ];
  const base = { workspaceId: props.workspaceId, isAdmin };
  return (
    <div className="pv-page">
      <PageHead
        title="Tokens and costs"
        sub="AI spend in euro, and every token that can reach this workspace"
        icon="tokens"
      />
      <nav className="pv-subtabs pv-mb" aria-label="Tokens view">
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
      {view === 'spend' ? <SpendView {...base} /> : null}
      {view === 'prices' ? <Prices {...base} /> : null}
      {view === 'tokens' ? <Tokens {...base} /> : null}
      {view === 'policies' ? <Policies {...base} /> : null}
    </div>
  );
}

// ── AI spend ──

function SpendView(props: { workspaceId: string; isAdmin: boolean }): ReactNode {
  const [d, setD] = useState<Spend | null>(null);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    const [s, b] = await Promise.all([
      api<Spend>('GET', W(props.workspaceId, '/ai-spend?days=31')),
      api<Budget[]>('GET', W(props.workspaceId, '/budgets')),
    ]);
    if (s.ok) setD(s.data);
    else setError(s.error.message);
    if (b.ok) setBudgets(b.data);
  }, [props.workspaceId]);
  useEffect(() => {
    void load();
  }, [load]);
  if (!d) return <p className="pv-muted">{error ?? 'Loading spend…'}</p>;
  const spikes = d.anomalies.map((a) => d.days.findIndex((x) => x.day === a.day));
  const bars = spendBars(d.days, spikes);
  const max = Math.max(100, ...d.days.map((x) => x.cents));
  const top = d.anomalies[0];
  return (
    <div className="pv-stack">
      <div className="pv-stats">
        <Stat
          label="This month"
          value={money(d.monthCents)}
          sub={
            d.budgetCents
              ? 'of ' + money(d.budgetCents) + ' workspace budget'
              : 'no workspace budget'
          }
          icon="euro"
        />
        <Stat
          label="Forecast"
          value={money(d.forecastCents)}
          sub="at this month’s pace"
          tone={d.budgetCents && d.forecastCents > d.budgetCents ? 'warning' : undefined}
          icon="insights"
        />
        <Stat
          label="Today"
          value={money(d.todayCents)}
          sub={
            String(d.todayAgents) +
            (d.todayAgents === 1 ? ' agent, ' : ' agents, ') +
            String(d.todayRuns) +
            (d.todayRuns === 1 ? ' run' : ' runs')
          }
          icon="agents"
        />
        <Stat
          label="Anomalies"
          value={String(d.anomalies.length)}
          sub={
            top
              ? dateText(top.day) + ': ' + (top.agent ?? 'agents') + ' (' + money(top.cents) + ')'
              : 'no day stands out'
          }
          tone={d.anomalies.length ? 'warning' : undefined}
          icon="incident"
        />
      </div>
      <Card
        title="Spend per day · last 31 days"
        action={<Chip tone="warning">A day stands out at 3× the average</Chip>}
      >
        <svg className="pv-chart" viewBox="0 0 760 200" role="img" aria-label="AI spend per day">
          {[0.5, 1].map((f) => (
            <g key={f}>
              <line
                className="pv-gridline"
                x1="34"
                x2="760"
                y1={180 - f * 170}
                y2={180 - f * 170}
              />
              <text className="pv-axis" x="30" y={184 - f * 170} textAnchor="end">
                {money(Math.round(max * f))}
              </text>
            </g>
          ))}
          {bars.map((b, i) => (
            <g key={d.days[i]?.day ?? i}>
              <rect
                className={b.spike ? 'pv-spend-bar pv-spend-bar--spike' : 'pv-spend-bar'}
                x={b.x}
                y={180 - b.h}
                width={b.w}
                height={Math.max(0, b.h)}
                rx="3"
              >
                <title>
                  {dateText(d.days[i]?.day ?? null) +
                    ': ' +
                    money(d.days[i]?.cents ?? 0) +
                    ', ' +
                    String(d.days[i]?.runs ?? 0) +
                    ' runs'}
                </title>
              </rect>
              {b.spike ? (
                <text
                  className="pv-axis pv-axis--strong"
                  x={b.x + b.w / 2}
                  y={174 - b.h}
                  textAnchor="middle"
                >
                  spike
                </text>
              ) : null}
              {i % 5 === 0 ? (
                <text className="pv-axis" x={b.x + b.w / 2} y="196" textAnchor="middle">
                  {(d.days[i]?.day ?? '').slice(8, 10) +
                    '.' +
                    (d.days[i]?.day ?? '').slice(5, 7) +
                    '.'}
                </text>
              ) : null}
            </g>
          ))}
        </svg>
        <p className="pv-muted pv-small">
          1 USD = {String(d.rate.usdEur).replace('.', ',')} EUR · {d.rate.source}
          {d.rate.day ? ', ' + dateText(d.rate.day) : ''}
        </p>
      </Card>
      <div className="pv-split pv-split--even">
        <Card title="This month by project">
          {d.byProject.length ? (
            <ShareBars
              rows={d.byProject.map((r) => ({
                label: <span className="pv-mono">{r.key}</span>,
                value: r.cents,
                display: money(r.cents),
              }))}
            />
          ) : (
            <p className="pv-muted pv-small">No spend this month.</p>
          )}
          {/* [PCODE-243 | S15 | v0.1.0] */}
          {d.byProvider?.length ? (
            <>
              <h3 className="v2-h3">By provider</h3>
              <ShareBars
                rows={d.byProvider.map((r) => ({
                  label: PROVIDER_NAMES[r.provider] ?? r.provider,
                  value: r.cents,
                  display: money(r.cents),
                }))}
              />
            </>
          ) : null}
          {d.byModel.length ? (
            <>
              <h3 className="v2-h3">By model</h3>
              <ShareBars
                rows={d.byModel.map((r) => ({
                  label: <span className="pv-mono">{r.model}</span>,
                  value: r.cents,
                  display: money(r.cents),
                }))}
              />
            </>
          ) : null}
        </Card>
        <Budgets
          workspaceId={props.workspaceId}
          isAdmin={props.isAdmin}
          budgets={budgets}
          onChange={() => void load()}
        />
      </div>
    </div>
  );
}

function Budgets(props: {
  workspaceId: string;
  isAdmin: boolean;
  budgets: Budget[];
  onChange: () => void;
}): ReactNode {
  const [adding, setAdding] = useState(false);
  const [scopes, setScopes] = useState<{ type: string; id: string; label: string }[]>([]);
  const [form, setForm] = useState({
    scope: 'workspace:',
    period: 'month',
    amount: '',
    hardStop: false,
  });
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!adding) return;
    void Promise.all([
      api<{ id: string; key: string }[]>('GET', W(props.workspaceId, '/projects')),
      api<{ id: string; name: string }[]>('GET', W(props.workspaceId, '/agents')),
      api<{ id: string; name: string }[]>('GET', W(props.workspaceId, '/clients')),
    ]).then(([p, a, c]) => {
      setScopes([
        { type: 'workspace', id: '', label: 'Workspace' },
        ...(c.ok
          ? c.data.map((x) => ({ type: 'client', id: x.id, label: 'Client ' + x.name }))
          : []),
        ...(p.ok
          ? p.data.map((x) => ({ type: 'project', id: x.id, label: 'Project ' + x.key }))
          : []),
        ...(a.ok ? a.data.map((x) => ({ type: 'agent', id: x.id, label: 'Agent ' + x.name })) : []),
      ]);
    });
  }, [adding, props.workspaceId]);
  const add = async (): Promise<void> => {
    const [type, id] = form.scope.split(':');
    const cents = Math.round(Number(form.amount.replace(',', '.')) * 100);
    const r = await api('POST', W(props.workspaceId, '/budgets'), {
      scopeType: type,
      ...(id ? { scopeId: id } : {}),
      period: form.period,
      amountCents: cents,
      hardStop: form.hardStop,
    });
    if (!r.ok) setError(r.error.message);
    else {
      setAdding(false);
      setForm({ ...form, amount: '' });
      props.onChange();
    }
  };
  const remove = async (b: Budget): Promise<void> => {
    await api('DELETE', W(props.workspaceId, '/budgets/' + b.id));
    props.onChange();
  };
  return (
    <Card
      flush
      title="Budgets"
      action={
        props.isAdmin && !adding ? (
          <Button
            size="sm"
            icon="plus"
            onClick={() => {
              setAdding(true);
            }}
          >
            Budget
          </Button>
        ) : null
      }
    >
      {error ? (
        <p className="v2-error v2-pad" role="alert">
          {error}
        </p>
      ) : null}
      {adding ? (
        <form
          className="v2-form v2-pad"
          onSubmit={(e) => {
            e.preventDefault();
            if (Number(form.amount.replace(',', '.')) > 0) void add();
          }}
        >
          <select
            className="v2-input v2-input--sm"
            aria-label="For"
            value={form.scope}
            onChange={(e) => {
              setForm({ ...form, scope: e.target.value });
            }}
          >
            {scopes.map((x) => (
              <option key={x.type + x.id} value={x.type + ':' + x.id}>
                {x.label}
              </option>
            ))}
          </select>
          <select
            className="v2-input v2-input--sm"
            aria-label="Period"
            value={form.period}
            onChange={(e) => {
              setForm({ ...form, period: e.target.value });
            }}
          >
            {['day', 'month', 'total', 'run'].map((p) => (
              <option key={p} value={p}>
                {PERIOD[p]}
              </option>
            ))}
          </select>
          <input
            className="v2-input v2-input--sm"
            aria-label="Amount in euro"
            placeholder="Amount in €"
            value={form.amount}
            onChange={(e) => {
              setForm({ ...form, amount: e.target.value });
            }}
          />
          <label className="v2-switch">
            <input
              type="checkbox"
              checked={form.hardStop}
              onChange={(e) => {
                setForm({ ...form, hardStop: e.target.checked });
              }}
            />
            <span>Stop runs at 100 %</span>
          </label>
          <button type="submit" className="pv-btn pv-btn--primary pv-btn--sm">
            Add
          </button>
          <Button
            size="sm"
            kind="ghost"
            onClick={() => {
              setAdding(false);
            }}
          >
            Cancel
          </Button>
        </form>
      ) : null}
      {props.budgets.length ? (
        <table className="pv-table">
          <tbody>
            {props.budgets.map((b) => (
              <tr key={b.id}>
                <td className="pv-cell-strong">
                  {b.scopeLabel}
                  <span className="pv-muted pv-block pv-small">{PERIOD[b.period] ?? b.period}</span>
                </td>
                <td className="pv-cell-bar">
                  <Bar
                    value={b.usedCents}
                    max={b.amountCents}
                    tone={
                      b.usedCents / b.amountCents >= 1
                        ? 'danger'
                        : b.usedCents / b.amountCents > b.warnPct / 100
                          ? 'warning'
                          : 'agent'
                    }
                  />
                  <span className="pv-small pv-muted">
                    {money(b.usedCents)} of {money(b.amountCents)}
                  </span>
                </td>
                <td className="pv-muted pv-small">
                  {b.hardStop ? 'stops runs at 100 %' : 'warns at ' + String(b.warnPct) + ' %'}
                </td>
                <td>
                  {props.isAdmin ? (
                    <button
                      type="button"
                      className="pv-mini-btn"
                      aria-label={'Remove budget ' + b.scopeLabel}
                      onClick={() => void remove(b)}
                    >
                      <PIcon name="x" size={12} />
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="pv-empty">No budgets yet.</p>
      )}
    </Card>
  );
}

// ── prices and keys ──

interface Price {
  provider: string;
  model: string;
  source: string;
  effectiveFrom: string;
  inputUsd: number;
  outputUsd: number;
  cacheReadUsd: number;
  cacheWriteUsd: number;
  retiresOn: string | null;
  // [PCODE-242 | S15 | v0.1.0] transcripts by the minute; where a shipped price comes from
  audioMinuteUsd: number;
  note: string;
}
// [PCODE-243 | S15 | v0.1.0] provider names as people know them
const PROVIDER_NAMES: Record<string, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  azure: 'Azure OpenAI',
  gemini: 'Google Gemini',
  bedrock: 'Amazon Bedrock',
  xai: 'xAI Grok',
  demo: 'Demo model',
};
// [PCODE-242 | S15 | v0.1.0] the providers a project may bring its own key for
const KEY_PROVIDERS: [string, string, string][] = [
  ['anthropic', 'Anthropic', 'sk-ant-…'],
  ['openai', 'OpenAI', 'sk-…'],
  ['azure', 'Azure OpenAI', 'key of the resource'],
  ['gemini', 'Google Gemini', 'Gemini API key'],
  ['bedrock', 'Amazon Bedrock', 'Bedrock API key'],
  ['xai', 'xAI Grok', 'xai-…'],
];
interface Key {
  projectId: string | null;
  projectKey: string | null;
  provider: string;
  label: string;
  hint: string;
  lastUsedAt: string | null;
  lastError: string;
  createdAt: string | null;
}

function Prices(props: { workspaceId: string; isAdmin: boolean }): ReactNode {
  const [d, setD] = useState<{
    rate: { usdEur: number; day: string | null; source: string };
    prices: Price[];
    unpriced: string[];
  } | null>(null);
  const [keys, setKeys] = useState<Key[]>([]);
  const [projects, setProjects] = useState<{ id: string; key: string }[]>([]);
  const [price, setPrice] = useState({
    provider: 'anthropic',
    model: '',
    from: new Date().toISOString().slice(0, 10),
    input: '',
    output: '',
    cache: '',
    minute: '', // [PCODE-242 | S15 | v0.1.0]
  });
  const [key, setKey] = useState({ project: '', value: '', label: '', provider: 'anthropic' });
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    const r = await api<NonNullable<typeof d>>('GET', W(props.workspaceId, '/model-prices'));
    if (r.ok) setD(r.data);
    else setError(r.error.message);
    if (props.isAdmin) {
      const [k, p] = await Promise.all([
        api<Key[]>('GET', W(props.workspaceId, '/provider-keys')),
        api<{ id: string; key: string }[]>('GET', W(props.workspaceId, '/projects')),
      ]);
      if (k.ok) setKeys(k.data);
      if (p.ok) {
        setProjects(p.data);
        setKey((x) => ({ ...x, project: x.project || (p.data[0]?.id ?? '') }));
      }
    }
  }, [props.workspaceId, props.isAdmin]);
  useEffect(() => {
    void load();
  }, [load]);
  if (!d) return <p className="pv-muted">{error ?? 'Loading prices…'}</p>;
  const eur = (usd: number): string => euroCents(Math.round(usd * 100 * d.rate.usdEur));
  const num = (x: string): number => Number(x.replace(',', '.'));
  const savePrice = async (): Promise<void> => {
    const r = await api('POST', W(props.workspaceId, '/model-prices'), {
      provider: price.provider.trim(),
      model: price.model.trim(),
      effectiveFrom: price.from,
      inputUsd: num(price.input),
      outputUsd: num(price.output),
      ...(price.cache ? { cacheReadUsd: num(price.cache) } : {}),
      ...(price.minute ? { audioMinuteUsd: num(price.minute) } : {}),
    });
    if (!r.ok) setError(r.error.message);
    else {
      setPrice({ ...price, model: '', input: '', output: '', cache: '', minute: '' });
      void load();
    }
  };
  const saveKey = async (): Promise<void> => {
    const r = await api('PUT', W(props.workspaceId, '/projects/' + key.project + '/provider-key'), {
      key: key.value.trim(),
      label: key.label.trim(),
      provider: key.provider, // [PCODE-242 | S15 | v0.1.0]
    });
    if (!r.ok) setError(r.error.message);
    else {
      setKey({ ...key, value: '', label: '' });
      void load();
    }
  };
  const removeKey = async (projectId: string, provider: string): Promise<void> => {
    await api(
      'DELETE',
      W(props.workspaceId, '/projects/' + projectId + '/provider-key?provider=' + provider),
    );
    void load();
  };
  return (
    <div className="pv-stack">
      {error ? (
        <p className="v2-error" role="alert">
          {error}
        </p>
      ) : null}
      <Card
        flush
        title="Price tables (per million tokens, in euro)"
        action={
          <span className="pv-muted pv-small">
            From the provider in USD · converted at {String(d.rate.usdEur).replace('.', ',')} (
            {d.rate.source}
            {d.rate.day ? ', ' + dateText(d.rate.day) : ''})
          </span>
        }
      >
        {d.unpriced.length ? (
          <p className="pv-text-warning pv-small v2-pad">
            Used this month without a price: {d.unpriced.join(', ')}. Their runs cost the provider
            setting’s price.
          </p>
        ) : null}
        <div className="pv-grid-scroll">
          <table className="pv-table">
            <thead>
              <tr>
                <th>Model</th>
                <th className="pv-num">Input</th>
                <th className="pv-num">Output</th>
                <th className="pv-num">Cache read</th>
                <th className="pv-num">Audio / min</th>
                <th>Valid from</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {d.prices.map((p) => (
                <tr key={p.provider + p.model}>
                  <td className="pv-mono">
                    {p.model}
                    <span className="pv-muted pv-block pv-small">{p.provider}</span>
                  </td>
                  <td className="pv-num">{eur(p.inputUsd)}</td>
                  <td className="pv-num">{eur(p.outputUsd)}</td>
                  <td className="pv-num">{eur(p.cacheReadUsd)}</td>
                  <td className="pv-num">
                    {p.audioMinuteUsd ? euroCents(p.audioMinuteUsd * 100 * d.rate.usdEur, 4) : '—'}
                  </td>
                  <td className="pv-muted">
                    {dateText(p.effectiveFrom)}
                    {p.retiresOn ? ' · retires ' + dateText(p.retiresOn) : ''}
                  </td>
                  <td>
                    <Chip tone={p.source === 'workspace' ? 'primary' : 'neutral'}>
                      {p.source === 'workspace' ? 'yours' : 'shipped'}
                    </Chip>
                    {p.note ? <span className="pv-muted pv-block pv-small">{p.note}</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {props.isAdmin ? (
          <form
            className="v2-form v2-pad"
            onSubmit={(e) => {
              e.preventDefault();
              if (price.model.trim() && price.input && price.output) void savePrice();
            }}
          >
            <input
              className="v2-input v2-input--sm"
              aria-label="Provider"
              value={price.provider}
              onChange={(e) => {
                setPrice({ ...price, provider: e.target.value });
              }}
            />
            <input
              className="v2-input v2-input--sm v2-mono"
              aria-label="Model"
              placeholder="claude-sonnet-5-5"
              value={price.model}
              onChange={(e) => {
                setPrice({ ...price, model: e.target.value });
              }}
            />
            <input
              className="v2-input v2-input--sm"
              type="date"
              aria-label="Valid from"
              value={price.from}
              onChange={(e) => {
                setPrice({ ...price, from: e.target.value });
              }}
            />
            <input
              className="v2-input v2-input--sm"
              aria-label="Input USD per million"
              placeholder="Input $/M"
              value={price.input}
              onChange={(e) => {
                setPrice({ ...price, input: e.target.value });
              }}
            />
            <input
              className="v2-input v2-input--sm"
              aria-label="Output USD per million"
              placeholder="Output $/M"
              value={price.output}
              onChange={(e) => {
                setPrice({ ...price, output: e.target.value });
              }}
            />
            <input
              className="v2-input v2-input--sm"
              aria-label="Cache read USD per million"
              placeholder="Cache read $/M"
              value={price.cache}
              onChange={(e) => {
                setPrice({ ...price, cache: e.target.value });
              }}
            />
            <input
              className="v2-input v2-input--sm"
              aria-label="Audio USD per minute"
              placeholder="Audio $/min"
              value={price.minute}
              onChange={(e) => {
                setPrice({ ...price, minute: e.target.value });
              }}
            />
            <button type="submit" className="pv-btn pv-btn--secondary pv-btn--sm">
              Set price
            </button>
          </form>
        ) : null}
      </Card>
      {props.isAdmin ? (
        <Card flush title="Provider keys">
          <table className="pv-table">
            <tbody>
              {keys.map((k) => (
                <tr key={(k.projectId ?? 'workspace') + k.provider}>
                  <td className="pv-cell-strong">
                    {k.projectKey ? 'Project ' + k.projectKey : 'Workspace'}
                  </td>
                  <td>
                    {k.label || k.provider}
                    {k.hint ? <span className="pv-mono pv-muted"> …{k.hint}</span> : null}
                  </td>
                  <td>
                    <Chip tone={k.lastError ? 'warning' : k.createdAt ? 'success' : 'neutral'}>
                      {k.lastError ? 'last call failed' : k.createdAt ? 'ok' : 'none'}
                    </Chip>
                  </td>
                  <td className="pv-muted pv-small">
                    {k.lastError ||
                      (k.lastUsedAt
                        ? 'used ' + ago(k.lastUsedAt) + ' ago'
                        : k.createdAt
                          ? 'not used yet'
                          : '')}
                  </td>
                  <td>
                    {k.projectId ? (
                      <button
                        type="button"
                        className="pv-mini-btn"
                        aria-label={'Remove the key of ' + (k.projectKey ?? '')}
                        onClick={() => void removeKey(k.projectId ?? '', k.provider)}
                      >
                        <PIcon name="x" size={12} />
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <form
            className="v2-form v2-pad"
            onSubmit={(e) => {
              e.preventDefault();
              if (key.project && key.value.trim()) void saveKey();
            }}
          >
            <select
              className="v2-input v2-input--sm"
              aria-label="Project"
              value={key.project}
              onChange={(e) => {
                setKey({ ...key, project: e.target.value });
              }}
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  Project {p.key}
                </option>
              ))}
            </select>
            <select
              className="v2-input v2-input--sm"
              aria-label="Provider"
              value={key.provider}
              onChange={(e) => {
                setKey({ ...key, provider: e.target.value });
              }}
            >
              {KEY_PROVIDERS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
            <input
              className="v2-input v2-input--sm"
              type="password"
              autoComplete="off"
              aria-label="Key"
              placeholder={KEY_PROVIDERS.find(([v]) => v === key.provider)?.[2] ?? ''}
              value={key.value}
              onChange={(e) => {
                setKey({ ...key, value: e.target.value });
              }}
            />
            <input
              className="v2-input v2-input--sm"
              aria-label="Label"
              placeholder="e.g. client pays"
              value={key.label}
              onChange={(e) => {
                setKey({ ...key, label: e.target.value });
              }}
            />
            <button type="submit" className="pv-btn pv-btn--secondary pv-btn--sm">
              Add key
            </button>
          </form>
          <p className="pv-muted pv-small v2-pad">
            A project’s own key replaces the workspace’s key of the same provider for that project’s
            agent runs and file reads. Keys are sealed on the way in and never shown again.
            Connections themselves are set in Settings, AI providers.
          </p>
        </Card>
      ) : null}
    </div>
  );
}

// ── access tokens ──

function Tokens(props: { workspaceId: string; isAdmin: boolean }): ReactNode {
  const [list, setList] = useState<AccessToken[] | null>(null);
  const [mode, setMode] = useState<'' | 'token' | 'service'>('');
  const [shown, setShown] = useState<{ name: string; token: string; state: string } | null>(null);
  const [withRevoked, setWithRevoked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    const r = await api<AccessToken[]>(
      'GET',
      W(props.workspaceId, '/access-tokens' + (withRevoked ? '?revoked=1' : '')),
    );
    if (r.ok) setList(r.data);
    else setError(r.error.message);
  }, [props.workspaceId, withRevoked]);
  useEffect(() => {
    void load();
  }, [load]);
  const act = async (t: AccessToken, what: 'approve' | 'revoke' | 'rotate'): Promise<void> => {
    const r = await api<{ token?: string }>(
      'POST',
      W(props.workspaceId, '/access-tokens/' + t.id + '/' + what),
    );
    if (!r.ok) setError(r.error.message);
    else {
      if (what === 'rotate' && r.data.token)
        setShown({ name: t.name, token: r.data.token, state: 'active' });
      void load();
    }
  };
  if (!list) return <p className="pv-muted">{error ?? 'Loading tokens…'}</p>;
  return (
    <div className="pv-stack">
      {error ? (
        <p className="v2-error" role="alert">
          {error}
        </p>
      ) : null}
      {shown ? (
        <div className="pv-callout pv-callout--decision">
          <PIcon name="lock" size={16} />
          <div className="pv-stack">
            <strong>
              Copy “{shown.name}” now; it is shown only once.
              {shown.state === 'pending' ? ' It works once an admin approves its scopes.' : ''}
            </strong>
            <pre className="pv-code">{shown.token}</pre>
            <span className="pv-small">
              Stored only as a hash. The prefix lets scanners find it if it leaks.
            </span>
            <Button
              size="sm"
              kind="ghost"
              onClick={() => {
                setShown(null);
              }}
            >
              Done
            </Button>
          </div>
        </div>
      ) : null}
      {mode ? (
        <NewToken
          workspaceId={props.workspaceId}
          isAdmin={props.isAdmin}
          service={mode === 'service'}
          onDone={(made) => {
            setMode('');
            if (made) setShown(made);
            void load();
          }}
        />
      ) : null}
      <Card
        flush
        title={'Access tokens · ' + String(list.filter((t) => !t.revokedAt).length)}
        action={
          <span className="pv-page-actions">
            <label className="pv-switch">
              <input
                type="checkbox"
                checked={withRevoked}
                onChange={(e) => {
                  setWithRevoked(e.target.checked);
                }}
              />
              <span>Show revoked</span>
            </label>
            {props.isAdmin ? (
              <Button
                size="sm"
                kind="ghost"
                icon="plus"
                onClick={() => {
                  setMode('service');
                }}
              >
                Service account
              </Button>
            ) : null}
            <Button
              size="sm"
              kind="primary"
              icon="plus"
              onClick={() => {
                setMode('token');
              }}
            >
              New token
            </Button>
          </span>
        }
      >
        {list.length ? (
          <div className="pv-grid-scroll">
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
                {list.map((t) => (
                  <tr key={t.id} className={t.revokedAt ? 'v2-row-off' : undefined}>
                    <td>
                      <strong>{t.name}</strong>
                      <span className="pv-muted pv-block pv-small">
                        {KIND[t.kind] ?? t.kind}
                        {t.boundToWorkspace ? '' : ' · all of the owner’s workspaces'}
                      </span>
                    </td>
                    <td>{t.ownerName}</td>
                    <td className="pv-mono pv-small">
                      {t.scopes.length ? t.scopes.join(', ') : 'everything the owner may do'}
                    </td>
                    <td
                      className={
                        t.expiresAt &&
                        new Date(t.expiresAt).getTime() - Date.now() < 14 * 86_400_000
                          ? 'pv-text-warning'
                          : 'pv-muted'
                      }
                    >
                      {t.expiresAt ? dateText(t.expiresAt) : 'never'}
                    </td>
                    <td className={t.stale ? 'pv-text-warning pv-small' : 'pv-muted pv-small'}>
                      {t.lastUsedAt
                        ? ago(t.lastUsedAt) +
                          ' ago' +
                          (t.useCount ? ' · ' + String(t.useCount) + '×' : '') +
                          (t.lastUsedIp ? ' · ' + t.lastUsedIp : '')
                        : 'never'}
                      {t.stale ? ' · unused' : ''}
                    </td>
                    <td className="v2-nowrap">
                      {t.revokedAt ? (
                        <Chip tone="danger">revoked</Chip>
                      ) : t.state === 'pending' ? (
                        props.isAdmin && !t.mine ? (
                          <Button size="sm" kind="primary" onClick={() => void act(t, 'approve')}>
                            Approve
                          </Button>
                        ) : (
                          <Chip tone="warning">waiting for an admin</Chip>
                        )
                      ) : (
                        <span className="pv-page-actions">
                          {t.boundToWorkspace && (t.mine || props.isAdmin) ? (
                            <Button size="sm" kind="ghost" onClick={() => void act(t, 'rotate')}>
                              Rotate
                            </Button>
                          ) : null}
                          {t.mine || (props.isAdmin && t.boundToWorkspace) ? (
                            <Button
                              size="sm"
                              kind={t.stale ? 'secondary' : 'ghost'}
                              onClick={() => void act(t, 'revoke')}
                            >
                              Revoke
                            </Button>
                          ) : null}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="pv-empty">No tokens yet.</p>
        )}
      </Card>
    </div>
  );
}

function NewToken(props: {
  workspaceId: string;
  isAdmin: boolean;
  service: boolean;
  onDone: (made: { name: string; token: string; state: string } | null) => void;
}): ReactNode {
  const [name, setName] = useState(props.service ? 'CI' : 'pe CLI on my laptop');
  const [scopes, setScopes] = useState<string[]>(['read', 'write', 'loop']);
  const [days, setDays] = useState(props.service ? '365' : '90');
  const [kind, setKind] = useState('service');
  const [role, setRole] = useState('member');
  const [error, setError] = useState<string | null>(null);
  const make = async (): Promise<void> => {
    const r = props.service
      ? await api<{ token: string; state?: string }>(
          'POST',
          W(props.workspaceId, '/service-accounts'),
          {
            name: name.trim(),
            kind,
            role,
            scopes,
            expiresInDays: Number(days),
          },
        )
      : await api<{ token: string; state?: string }>(
          'POST',
          W(props.workspaceId, '/access-tokens'),
          { name: name.trim(), scopes, expiresInDays: Number(days) },
        );
    if (!r.ok) setError(r.error.message);
    else
      props.onDone({
        name: name.trim(),
        token: r.data.token,
        state: r.data.state ?? 'active',
      });
  };
  return (
    <Card
      title={
        props.service ? 'New service account or runner' : 'New personal token for this workspace'
      }
    >
      {error ? (
        <p className="v2-error" role="alert">
          {error}
        </p>
      ) : null}
      <form
        className="pv-stack"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim() && scopes.length) void make();
        }}
      >
        <div className="pv-form-grid">
          <label className="pv-field">
            <span>Name</span>
            <input
              className="v2-input"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
              }}
            />
          </label>
          <label className="pv-field">
            <span>Expires in</span>
            <select
              className="v2-input"
              value={days}
              onChange={(e) => {
                setDays(e.target.value);
              }}
            >
              {(props.service ? ['30', '90', '365'] : ['7', '30', '90']).map((d) => (
                <option key={d} value={d}>
                  {d} days
                </option>
              ))}
            </select>
          </label>
          {props.service ? (
            <>
              <label className="pv-field">
                <span>Kind</span>
                <select
                  className="v2-input"
                  value={kind}
                  onChange={(e) => {
                    setKind(e.target.value);
                  }}
                >
                  <option value="service">Service account (CI, scripts)</option>
                  <option value="runner">Runner (deploys)</option>
                </select>
              </label>
              <label className="pv-field">
                <span>Role</span>
                <select
                  className="v2-input"
                  value={role}
                  onChange={(e) => {
                    setRole(e.target.value);
                  }}
                >
                  {['member', 'tester', 'auditor', 'guest'].map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </label>
            </>
          ) : null}
        </div>
        <fieldset className="pv-scopes">
          <legend>Scopes</legend>
          {TOKEN_SCOPES.filter((x) => (x === 'admin' ? props.isAdmin && !props.service : true)).map(
            (x) => (
              <label key={x} className="pv-switch">
                <input
                  type="checkbox"
                  checked={scopes.includes(x)}
                  onChange={(e) => {
                    setScopes(e.target.checked ? [...scopes, x] : scopes.filter((y) => y !== x));
                  }}
                />
                <span className="pv-mono">{x}</span>
              </label>
            ),
          )}
        </fieldset>
        <div className="pv-page-actions">
          <button
            type="submit"
            className="pv-btn pv-btn--primary pv-btn--sm"
            disabled={!name.trim() || !scopes.length}
          >
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
          <span className="pv-muted pv-small">
            Scopes like admin or deploys need an admin’s approval.
          </span>
        </div>
      </form>
    </Card>
  );
}

// ── policies and leaks ──

interface Policy {
  maxDaysPersonal: number;
  maxDaysService: number;
  requireExpiry: boolean;
  approveBroadScopes: boolean;
  ipAllow: string[];
  revokeUnusedDays: number | null;
}
interface Leak {
  id: string;
  tokenName: string;
  ownerName: string | null;
  foundIn: string;
  location: string;
  foundAt: string;
  revokedAt: string | null;
}

function Policies(props: { workspaceId: string; isAdmin: boolean }): ReactNode {
  const [p, setP] = useState<Policy | null>(null);
  const [ips, setIps] = useState('');
  const [leaks, setLeaks] = useState<Leak[]>([]);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void api<Policy>('GET', W(props.workspaceId, '/token-policy')).then((r) => {
      if (r.ok) {
        setP(r.data);
        setIps(r.data.ipAllow.join(', '));
      } else setError(r.error.message);
    });
    if (props.isAdmin)
      void api<Leak[]>('GET', W(props.workspaceId, '/token-leaks')).then((r) => {
        if (r.ok) setLeaks(r.data);
      });
  }, [props.workspaceId, props.isAdmin]);
  if (!p) return <p className="pv-muted">{error ?? 'Loading…'}</p>;
  const save = async (): Promise<void> => {
    const r = await api<Policy>('PUT', W(props.workspaceId, '/token-policy'), {
      ...p,
      ipAllow: ips
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean),
    });
    if (!r.ok) setError(r.error.message);
    else {
      setP(r.data);
      setSaved(true);
      setError(null);
    }
  };
  const ro = !props.isAdmin;
  const n = (k: keyof Policy, v: string): void => {
    setP({ ...p, [k]: Number(v) || 1 });
    setSaved(false);
  };
  return (
    <div className="pv-split pv-split--even">
      <Card title="Token policy">
        {error ? (
          <p className="v2-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="pv-form-grid">
          <label className="pv-field">
            <span>Longest life of a personal token (days)</span>
            <input
              className="v2-input"
              type="number"
              min={1}
              max={730}
              disabled={ro}
              value={p.maxDaysPersonal}
              onChange={(e) => {
                n('maxDaysPersonal', e.target.value);
              }}
            />
          </label>
          <label className="pv-field">
            <span>Longest life of a service or runner token (days)</span>
            <input
              className="v2-input"
              type="number"
              min={1}
              max={730}
              disabled={ro}
              value={p.maxDaysService}
              onChange={(e) => {
                n('maxDaysService', e.target.value);
              }}
            />
          </label>
          <label className="pv-field">
            <span>IP allow-list (comma separated)</span>
            <input
              className="v2-input v2-mono"
              disabled={ro}
              placeholder="anywhere"
              value={ips}
              onChange={(e) => {
                setIps(e.target.value);
                setSaved(false);
              }}
            />
          </label>
          <label className="pv-field">
            <span>Revoke unused tokens after (days)</span>
            <input
              className="v2-input"
              type="number"
              min={7}
              max={730}
              disabled={ro}
              placeholder="never"
              value={p.revokeUnusedDays ?? ''}
              onChange={(e) => {
                setP({ ...p, revokeUnusedDays: e.target.value ? Number(e.target.value) : null });
                setSaved(false);
              }}
            />
          </label>
        </div>
        <div className="pv-stack">
          <label className="v2-switch">
            <input
              type="checkbox"
              disabled={ro}
              checked={p.requireExpiry}
              onChange={(e) => {
                setP({ ...p, requireExpiry: e.target.checked });
                setSaved(false);
              }}
            />
            <span>Every token expires</span>
          </label>
          <label className="v2-switch">
            <input
              type="checkbox"
              disabled={ro}
              checked={p.approveBroadScopes}
              onChange={(e) => {
                setP({ ...p, approveBroadScopes: e.target.checked });
                setSaved(false);
              }}
            />
            <span>Broad scopes (admin, deploys) need an admin’s approval</span>
          </label>
        </div>
        {!ro ? (
          <div className="pv-page-actions pv-mt">
            <Button kind="primary" onClick={() => void save()}>
              Save policy
            </Button>
            {saved ? (
              <Chip tone="success" icon="check">
                saved
              </Chip>
            ) : null}
          </div>
        ) : null}
        <p className="pv-muted pv-small">
          The allow-list applies to tokens bound to this workspace. Unused tokens are marked after
          60 days.
        </p>
      </Card>
      <Card title="Leaked tokens">
        {props.isAdmin ? (
          leaks.length ? (
            <ul className="pv-rows">
              {leaks.map((l) => (
                <li key={l.id} className="pv-row pv-row--static">
                  <span className="pv-kind pv-kind--incident">
                    <PIcon name="incident" size={15} />
                  </span>
                  <span className="pv-row-main">
                    <span className="pv-row-title">
                      {l.ownerName ? l.ownerName + '’s ' : ''}“{l.tokenName}” in a {l.foundIn}
                    </span>
                    <span className="pv-row-sub">
                      {l.location} · {ago(l.foundAt)} ago{l.revokedAt ? ' · revoked at once' : ''}
                    </span>
                  </span>
                  <Chip tone="danger">revoked</Chip>
                </li>
              ))}
            </ul>
          ) : (
            <p className="pv-muted pv-small">No leaked tokens.</p>
          )
        ) : (
          <p className="pv-muted pv-small">Admins see leaked tokens here.</p>
        )}
        <p className="pv-muted pv-small">
          Tasks and comments are scanned as they are saved; a token found there is revoked at once.
          Tokens carry the orq_ prefix (older ones pe_) so they are found.
        </p>
      </Card>
    </div>
  );
}
