// ── [PCODE-440 | S15 | v0.1.0] T37 Consistency: errors and loading are announced everywhere ──
// ── [PCODE-149 | S15 | v0.1.0] Bill through Stripe without its SDK: checkout, webhooks, licences ──
//    Why:  the owner's view of what the workspace pays for: the plan and seats from its licence, what is
//          limited and why, paying by card through Stripe Checkout (cloud), or pasting a licence key
//          (self-hosted), and the invoices Stripe sent.
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { FEATURE_NAMES, planOfFeature } from '@orqiva/shared'; // [PCODE-359 | S15 | v0.1.0]
import { api } from './core/api.js';
import { Card, Stat } from './shell.js';
import { localTime } from './views.js';

interface Entitlement {
  status: string;
  plan: string;
  seats: number;
  used: number;
  features: string[];
  customer: string | null;
  expires: string | null;
  problem: string;
  source: string;
}
interface Billing {
  configured: boolean;
  account: { plan: string; seats: number; status: string; currentPeriodEnd: string | null } | null;
  invoices: {
    id: string;
    at: string;
    amount: number | null;
    currency: string | null;
    url: string | null;
  }[];
}

const W = (workspaceId: string, path: string): string => '/api/workspaces/' + workspaceId + path;

/** 12000 eur → "120.00 EUR" (Stripe counts in the currency's smallest unit). */
export const money = (amount: number | null, currency: string | null): string =>
  amount === null ? '—' : (amount / 100).toFixed(2) + ' ' + (currency ?? '').toUpperCase();

export const STATUS_TEXT: Record<string, string> = {
  free: 'Free plan',
  active: 'Active',
  expired: 'Expired',
  over_seats: 'Over the seat count',
};

export function BillingSection(props: { workspaceId: string; role: string }): ReactNode {
  const { workspaceId } = props;
  const isOwner = props.role === 'owner';
  const [ent, setEnt] = useState<Entitlement | null>(null);
  const [bill, setBill] = useState<Billing | null>(null);
  const [plan, setPlan] = useState('team');
  const [seats, setSeats] = useState('5');
  const [token, setToken] = useState('');
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});
  const load = useCallback(async () => {
    const e = await api<Entitlement>('GET', W(workspaceId, '/licence'));
    if (e.ok) setEnt(e.data);
    if (isOwner) {
      const b = await api<Billing>('GET', W(workspaceId, '/billing'));
      if (b.ok) setBill(b.data);
    }
  }, [workspaceId, isOwner]);
  useEffect(() => {
    void load();
  }, [load]);

  if (!ent)
    return (
      <p className="pe-muted" role="status">
        Loading…
      </p>
    );
  return (
    <div className="pe-stack">
      <Card
        title="Plan"
        subtitle={ent.customer ? 'Licensed to ' + ent.customer : 'No licence installed'}
      >
        <div className="pe-stats pe-stats--compact">
          <Stat
            label="Plan"
            value={
              ent.plan === 'free' ? 'Free' : ent.plan.charAt(0).toUpperCase() + ent.plan.slice(1)
            }
            hint={STATUS_TEXT[ent.status] ?? ent.status}
          />
          <Stat
            label="Seats"
            value={String(ent.used) + ' / ' + String(ent.seats)}
            hint="members / seats"
          />
          <Stat
            label="Renews or ends"
            value={ent.expires ? localTime(ent.expires).slice(0, 10) : '—'}
          />
        </div>
        {ent.problem ? (
          <div className="pe-notice" role="status">
            {ent.problem}
          </div>
        ) : null}
        {/* [PCODE-359 | S15 | v0.1.0] what the plan holds, and the plan that holds the rest */}
        <ul className="pe-plan-features" aria-label="What the plan holds">
          {Object.entries(FEATURE_NAMES).map(([key, name]) => {
            const has = ent.features.includes(key);
            return (
              <li key={key} className={has ? 'pe-plan-feature--on' : 'pe-plan-feature--off'}>
                <span aria-hidden="true">{has ? '✓' : '–'}</span> {name}
                {has ? null : <span className="pe-muted"> · {planOfFeature(key)}</span>}
              </li>
            );
          })}
        </ul>
      </Card>
      {isOwner && bill?.configured ? (
        <Card
          title="Pay by card"
          subtitle="Stripe handles the payment; the licence is installed here when it is paid."
        >
          <form
            className="pe-inline-form"
            onSubmit={(e) => {
              e.preventDefault();
              void api<{ url: string }>('POST', W(workspaceId, '/billing/checkout'), {
                plan,
                seats: Number(seats),
              }).then((r) => {
                if (r.ok) window.location.assign(r.data.url);
                else setMsg({ error: r.error.message });
              });
            }}
          >
            <select
              className="pe-select"
              aria-label="Plan"
              value={plan}
              onChange={(e) => {
                setPlan(e.target.value);
              }}
            >
              <option value="team">Team</option>
              <option value="business">Business</option>
            </select>
            <input
              className="pe-input pe-input--narrow"
              inputMode="numeric"
              aria-label="Seats"
              value={seats}
              onChange={(e) => {
                setSeats(e.target.value);
              }}
            />
            <button
              type="submit"
              className="pe-btn pe-btn--primary"
              disabled={!(Number(seats) >= 1)}
            >
              Continue to payment
            </button>
          </form>
          {bill.account ? (
            <p className="pe-small pe-muted">
              Subscription: {bill.account.plan}, {bill.account.seats} seats, {bill.account.status}
              {bill.account.currentPeriodEnd
                ? ', paid until ' + localTime(bill.account.currentPeriodEnd).slice(0, 10)
                : ''}
            </p>
          ) : null}
        </Card>
      ) : null}
      {isOwner ? (
        <Card title="Licence key" subtitle="For self-hosted installs: paste the key you received.">
          <form
            className="pe-form-grid pe-form-grid--wide"
            onSubmit={(e) => {
              e.preventDefault();
              void api<Entitlement>('PUT', W(workspaceId, '/licence'), {
                token: token.trim(),
              }).then((r) => {
                if (r.ok) {
                  setEnt(r.data);
                  setToken('');
                  setMsg({ ok: 'Licence installed.' });
                } else setMsg({ error: r.error.message });
              });
            }}
          >
            <textarea
              className="pe-input pe-textarea pe-mono"
              aria-label="Licence key"
              rows={3}
              placeholder="PE1.…"
              value={token}
              onChange={(e) => {
                setToken(e.target.value);
              }}
            />
            <div className="pe-form-actions">
              <button type="submit" className="pe-btn pe-btn--primary" disabled={!token.trim()}>
                Install licence
              </button>
              {ent.source === 'workspace' ? (
                <button
                  type="button"
                  className="pe-btn pe-btn--text"
                  onClick={() => {
                    void api<Entitlement>('DELETE', W(workspaceId, '/licence')).then((r) => {
                      if (r.ok) setEnt(r.data);
                    });
                  }}
                >
                  Remove the licence
                </button>
              ) : null}
            </div>
          </form>
          {msg.error ? (
            <div className="pe-field-error" role="alert">
              {msg.error}
            </div>
          ) : msg.ok ? (
            <div className="pe-ok" role="status">
              {msg.ok}
            </div>
          ) : null}
        </Card>
      ) : null}
      {isOwner && bill?.invoices.length ? (
        <Card title="Invoices">
          <table className="pe-grid-table" aria-label="Invoices">
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Amount</th>
                <th scope="col">Invoice</th>
              </tr>
            </thead>
            <tbody>
              {bill.invoices.map((i) => (
                <tr key={i.id}>
                  <td>{localTime(i.at).slice(0, 10)}</td>
                  <td>{money(i.amount, i.currency)}</td>
                  <td>
                    {i.url ? (
                      <a href={i.url} target="_blank" rel="noreferrer noopener">
                        Open
                      </a>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : null}
    </div>
  );
}
