// ── [PCODE-420 | S15 | v0.1.0] T37 medium: English screens use English number and date formats ──
// ── [PCODE-343 | S15 | v0.1.0] T34.3a Hour budgets with alerts, time reports by person, sprint and task, DATEV export ──
//    Why:  Time, Breakdown: the hours of any range of days by person, sprint, task, project or client, as a
//          table and CSV, and the DATEV file for the tax adviser; Time, Hour budgets: the hours sold per
//          project or client against what is booked.
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api } from '../core/api.js';
import { Bar, Button, Card, Chip } from '../preview/ui.js';
import { fmtLocale } from '../core/locale.js'; // [PCODE-420 | S15 | v0.1.0]

const W = (ws: string, p: string): string => '/api/workspaces/' + ws + p;
const hours = (m: number): string =>
  String(Math.round((m / 60) * 10) / 10).replace('.', ',') + ' h';
const euro = (c: number): string =>
  (c / 100).toLocaleString(fmtLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 }) +
  ' €';

type By = 'person' | 'sprint' | 'task' | 'project' | 'client';
const BY: { key: By; label: string }[] = [
  { key: 'person', label: 'Person' },
  { key: 'sprint', label: 'Sprint' },
  { key: 'task', label: 'Task' },
  { key: 'project', label: 'Project' },
  { key: 'client', label: 'Client' },
];

/** The first and last day of a named range around a day. */
export function rangeOf(
  preset: 'this-month' | 'last-month' | 'this-week' | 'last-week',
  today: string,
): { from: string; to: string } {
  const d = new Date(today + 'T00:00:00Z');
  const iso = (x: Date): string => x.toISOString().slice(0, 10);
  if (preset === 'this-month' || preset === 'last-month') {
    const first = new Date(
      Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - (preset === 'last-month' ? 1 : 0), 1),
    );
    const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0));
    return { from: iso(first), to: iso(last) };
  }
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) - (preset === 'last-week' ? 7 : 0));
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  return { from: iso(monday), to: iso(sunday) };
}

interface Breakdown {
  minutes: number;
  billableMinutes: number;
  cents: number;
  rows: { key: string; label: string; minutes: number; billableMinutes: number; cents: number }[];
}

export function TimeBreakdown(props: {
  workspaceId: string;
  mayExport: boolean;
  admin: boolean;
}): ReactNode {
  const today = new Date().toISOString().slice(0, 10);
  const [range, setRange] = useState(() => rangeOf('this-month', today));
  const [by, setBy] = useState<By>('person');
  const [d, setD] = useState<Breakdown | null>(null);
  const [error, setError] = useState('');
  const qs = 'from=' + range.from + '&to=' + range.to;
  const load = useCallback(async () => {
    const r = await api<Breakdown>(
      'GET',
      W(props.workspaceId, '/time/breakdown?' + qs + '&by=' + by),
    );
    if (r.ok) {
      setD(r.data);
      setError('');
    } else setError(r.error.message);
  }, [props.workspaceId, qs, by]);
  useEffect(() => {
    void load();
  }, [load]);
  const top = Math.max(1, ...(d?.rows.map((r) => r.minutes) ?? [1]));
  return (
    <div className="pv-stack">
      <div className="v2-inline">
        <input
          type="date"
          className="v2-input v2-input--sm"
          aria-label="From"
          value={range.from}
          onChange={(e) => {
            setRange({ ...range, from: e.target.value });
          }}
        />
        <span className="pv-muted">to</span>
        <input
          type="date"
          className="v2-input v2-input--sm"
          aria-label="To"
          value={range.to}
          onChange={(e) => {
            setRange({ ...range, to: e.target.value });
          }}
        />
        {(
          [
            ['this-week', 'This week'],
            ['last-week', 'Last week'],
            ['this-month', 'This month'],
            ['last-month', 'Last month'],
          ] as const
        ).map(([k, label]) => (
          <Button
            key={k}
            size="sm"
            kind="ghost"
            onClick={() => {
              setRange(rangeOf(k, today));
            }}
          >
            {label}
          </Button>
        ))}
      </div>
      <nav className="pv-subtabs" aria-label="Sum by">
        {BY.map((b) => (
          <button
            key={b.key}
            type="button"
            className="pv-subtab"
            aria-pressed={by === b.key}
            onClick={() => {
              setBy(b.key);
            }}
          >
            {b.label}
          </button>
        ))}
      </nav>
      {error ? (
        <p className="v2-error" role="alert">
          {error}
        </p>
      ) : null}
      {d ? (
        <Card
          title={
            'By ' +
            by +
            ' · ' +
            hours(d.minutes) +
            ', ' +
            hours(d.billableMinutes) +
            ' billable, ' +
            euro(d.cents)
          }
          action={
            <a
              className="pv-small"
              href={W(props.workspaceId, '/time/breakdown.csv?' + qs + '&by=' + by)}
            >
              CSV
            </a>
          }
        >
          {d.rows.length ? (
            <table className="pv-table pv-tbreak">
              <thead>
                <tr>
                  <th>{BY.find((b) => b.key === by)?.label}</th>
                  <th />
                  <th className="pv-num">Hours</th>
                  <th className="pv-num">Billable</th>
                  <th className="pv-num">Amount</th>
                </tr>
              </thead>
              <tbody>
                {d.rows.map((r) => (
                  <tr key={r.key}>
                    <td>{r.label}</td>
                    <td className="pv-tbreak-bar">
                      <Bar value={r.minutes} max={top} />
                    </td>
                    <td className="pv-num">{hours(r.minutes)}</td>
                    <td className="pv-num">{hours(r.billableMinutes)}</td>
                    <td className="pv-num">{euro(r.cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="pv-muted pv-small">No time booked in this range.</p>
          )}
        </Card>
      ) : null}
      {props.mayExport ? (
        <DatevExport workspaceId={props.workspaceId} range={range} admin={props.admin} />
      ) : null}
    </div>
  );
}

const DATEV_KEY = 'orqiva.datev';

function DatevExport(props: {
  workspaceId: string;
  range: { from: string; to: string };
  admin: boolean;
}): ReactNode {
  const [f, setF] = useState(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(DATEV_KEY) ?? '{}') as Record<
        string,
        string
      >;
      return {
        consultant: saved['consultant'] ?? '',
        client: saved['client'] ?? '',
        revenue: saved['revenue'] ?? '8400',
      };
    } catch {
      return { consultant: '', client: '', revenue: '8400' };
    }
  });
  const [clients, setClients] = useState<
    { id: string; name: string; datevAccount?: string | null }[]
  >([]);
  const [error, setError] = useState('');
  useEffect(() => {
    void api<{ id: string; name: string; datevAccount?: string | null }[]>(
      'GET',
      W(props.workspaceId, '/clients'),
    ).then((r) => {
      if (r.ok) setClients(r.data);
    });
  }, [props.workspaceId]);
  const ok =
    /^[0-9]{4,7}$/.test(f.consultant) &&
    /^[0-9]{1,5}$/.test(f.client) &&
    /^[0-9]{4,8}$/.test(f.revenue);
  const set = (k: 'consultant' | 'client' | 'revenue', v: string): void => {
    const next = { ...f, [k]: v.replace(/\D/g, '') };
    setF(next);
    try {
      window.localStorage.setItem(DATEV_KEY, JSON.stringify(next));
    } catch {
      // the numbers are only remembered where storage works
    }
  };
  const saveAccount = async (id: string, account: string): Promise<void> => {
    const r = await api('PUT', W(props.workspaceId, '/clients/' + id + '/datev-account'), {
      account: account || null,
    });
    if (!r.ok) setError(r.error.message);
    else setError('');
  };
  return (
    <Card title="DATEV export">
      <p className="pv-small pv-muted">
        The billable amounts of the range, one booking per client and project, as a Buchungsstapel
        for DATEV Rechnungswesen. Clients without their own debtor account are booked to 10000.
      </p>
      <div className="v2-inline pv-mt">
        <input
          className="v2-input v2-input--sm"
          aria-label="Consultant number"
          placeholder="Beraternummer"
          value={f.consultant}
          onChange={(e) => {
            set('consultant', e.target.value);
          }}
        />
        <input
          className="v2-input v2-input--sm"
          aria-label="Client number"
          placeholder="Mandantennummer"
          value={f.client}
          onChange={(e) => {
            set('client', e.target.value);
          }}
        />
        <input
          className="v2-input v2-input--sm"
          aria-label="Revenue account"
          placeholder="Erlöskonto"
          value={f.revenue}
          onChange={(e) => {
            set('revenue', e.target.value);
          }}
        />
        {ok ? (
          <a
            className="pv-btn pv-btn--primary pv-btn--sm"
            href={W(
              props.workspaceId,
              '/time/datev.csv?from=' +
                props.range.from +
                '&to=' +
                props.range.to +
                '&revenueAccount=' +
                f.revenue +
                '&consultant=' +
                f.consultant +
                '&client=' +
                f.client,
            )}
          >
            Download the DATEV file
          </a>
        ) : (
          <Chip>Enter the consultant, client and revenue account numbers</Chip>
        )}
      </div>
      {props.admin && clients.length ? (
        <details className="pv-mt">
          <summary className="pv-small">Debtor accounts of the clients</summary>
          {error ? (
            <p className="v2-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="pv-datev-accounts">
            {clients.map((c) => (
              <label key={c.id} className="v2-inline">
                <span>{c.name}</span>
                <input
                  className="v2-input v2-input--sm"
                  aria-label={'Debtor account of ' + c.name}
                  placeholder="10000"
                  defaultValue={c.datevAccount ?? ''}
                  onBlur={(e) => void saveAccount(c.id, e.target.value.replace(/\D/g, ''))}
                />
              </label>
            ))}
          </div>
        </details>
      ) : null}
    </Card>
  );
}

interface HourBudget {
  id: string;
  scopeType: 'project' | 'client';
  scopeId: string;
  label: string;
  period: 'month' | 'total';
  hours: number;
  warnPct: number;
  usedHours: number;
  pct: number;
}

export function HourBudgets(props: { workspaceId: string; admin: boolean }): ReactNode {
  const [list, setList] = useState<HourBudget[]>([]);
  const [scopes, setScopes] = useState<{ value: string; label: string }[]>([]);
  const [form, setForm] = useState({ scope: '', period: 'month', hours: '', warnPct: '80' });
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    const [b, p, c] = await Promise.all([
      api<{ budgets: HourBudget[] }>('GET', W(props.workspaceId, '/time/hour-budgets')),
      api<{ id: string; key: string; name: string; archivedAt: string | null }[]>(
        'GET',
        W(props.workspaceId, '/projects'),
      ),
      api<{ id: string; name: string }[]>('GET', W(props.workspaceId, '/clients')),
    ]);
    if (b.ok) setList(b.data.budgets);
    else setError(b.error.message);
    setScopes([
      ...(p.ok
        ? p.data
            .filter((x) => !x.archivedAt)
            .map((x) => ({ value: 'project:' + x.id, label: x.key + ' ' + x.name }))
        : []),
      ...(c.ok ? c.data.map((x) => ({ value: 'client:' + x.id, label: 'Client ' + x.name })) : []),
    ]);
  }, [props.workspaceId]);
  useEffect(() => {
    void load();
  }, [load]);
  const save = async (): Promise<void> => {
    const [scopeType, scopeId] = form.scope.split(':');
    const r = await api('PUT', W(props.workspaceId, '/time/hour-budgets'), {
      scopeType,
      scopeId,
      period: form.period,
      hours: Number(form.hours.replace(',', '.')),
      warnPct: Number(form.warnPct),
    });
    if (!r.ok) {
      setError(r.error.message);
      return;
    }
    setError('');
    setForm({ ...form, hours: '' });
    await load();
  };
  const remove = async (id: string): Promise<void> => {
    await api('DELETE', W(props.workspaceId, '/time/hour-budgets/' + id));
    await load();
  };
  const hoursOk = Number(form.hours.replace(',', '.')) >= 0.5;
  return (
    <div className="pv-stack">
      <p className="pv-muted pv-small">
        The hours sold to a project or client, per month or in total. Admins get an inbox alert when
        the booked time crosses the warning level and again when the hours are used up.
      </p>
      {error ? (
        <p className="v2-error" role="alert">
          {error}
        </p>
      ) : null}
      <Card title={'Hour budgets · ' + String(list.length)}>
        {list.length ? (
          <table className="pv-table">
            <thead>
              <tr>
                <th>For</th>
                <th>Period</th>
                <th className="pv-num">Booked</th>
                <th />
                <th className="pv-num">Warn at</th>
                {props.admin ? <th /> : null}
              </tr>
            </thead>
            <tbody>
              {list.map((b) => (
                <tr key={b.id}>
                  <td>{b.label}</td>
                  <td>{b.period === 'month' ? 'per month' : 'in total'}</td>
                  <td className="pv-num">
                    {String(b.usedHours).replace('.', ',')} of {String(b.hours).replace('.', ',')} h
                  </td>
                  <td className="pv-tbreak-bar">
                    <Bar
                      value={Math.min(b.usedHours, b.hours)}
                      max={b.hours}
                      tone={b.pct >= 100 ? 'danger' : b.pct >= b.warnPct ? 'warning' : 'primary'}
                      label={String(b.pct) + ' %'}
                    />{' '}
                    <span className="pv-small pv-muted">{b.pct} %</span>
                  </td>
                  <td className="pv-num">{b.warnPct} %</td>
                  {props.admin ? (
                    <td>
                      <Button size="sm" kind="ghost" onClick={() => void remove(b.id)}>
                        Remove
                      </Button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="pv-muted pv-small">No hour budgets yet.</p>
        )}
      </Card>
      {props.admin ? (
        <Card title="Set an hour budget">
          <div className="v2-inline">
            <select
              className="v2-input"
              aria-label="For"
              value={form.scope}
              onChange={(e) => {
                setForm({ ...form, scope: e.target.value });
              }}
            >
              <option value="">Project or client…</option>
              {scopes.map((x) => (
                <option key={x.value} value={x.value}>
                  {x.label}
                </option>
              ))}
            </select>
            <select
              className="v2-input"
              aria-label="Period"
              value={form.period}
              onChange={(e) => {
                setForm({ ...form, period: e.target.value });
              }}
            >
              <option value="month">per month</option>
              <option value="total">in total</option>
            </select>
            <input
              className="v2-input v2-input--sm"
              aria-label="Hours"
              placeholder="Hours"
              value={form.hours}
              onChange={(e) => {
                setForm({ ...form, hours: e.target.value });
              }}
            />
            <input
              className="v2-input v2-input--sm"
              aria-label="Warn at percent"
              value={form.warnPct}
              onChange={(e) => {
                setForm({ ...form, warnPct: e.target.value.replace(/\D/g, '') });
              }}
            />
            <span className="pv-muted pv-small">% warns</span>
            <Button kind="primary" disabled={!form.scope || !hoursOk} onClick={() => void save()}>
              Save
            </Button>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
