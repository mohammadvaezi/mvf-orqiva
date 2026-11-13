// ── [PCODE-440 | S15 | v0.1.0] T37 Consistency: errors and loading are announced everywhere ──
// ── [PCODE-219 | S15 | v0.1.0] T20.2 Pricing and self-serve purchase for self-hosted customers (offers, buy flow, licence orders, plan enforcement) ──
//    Why:  buying without an account and without talking to us. /buy shows the plans and takes the plan,
//          the seats, the company and an email, then hands over to Stripe Checkout; Stripe brings the buyer
//          back to /buy/done with the session, where the licence key appears once the payment is confirmed
//          (the page asks again every two seconds for a minute). The key is pasted into Settings → Licence
//          of the buyer's own server, which also works offline.
import { useEffect, useState, type ReactNode } from 'react';
import { offerOf, priceLabel, purchaseProblem, yearlyPrice, type Offer } from '@orqiva/shared';
import { CopyField } from './account.js';
import { api } from './core/api.js';
import { Logo } from './core/icons.js';
import './buy.css';

interface OffersOut {
  sells: boolean;
  draft: boolean;
  currency: string;
  offers: (Offer & { available: boolean })[];
}

interface OrderOut {
  status: string;
  plan: string;
  seats: number;
  company: string;
  email: string;
  licence: string | null;
  paidUntil: string | null;
}

const euros = (n: number): string => '€' + n.toLocaleString('en-GB');

export function BuyScreen(props: { path: string; search: string }): ReactNode {
  const done = props.path.startsWith('/buy/done');
  return (
    <main className="pe-auth pe-buy-page">
      <div className="pe-card pe-buy">
        <div className="pe-brand pe-brand--logo">
          <Logo /> Orqiva
        </div>
        {done ? (
          <OrderStatus session={new URLSearchParams(props.search).get('session') ?? ''} />
        ) : (
          <BuyForm plan={new URLSearchParams(props.search).get('plan') ?? 'team'} />
        )}
      </div>
    </main>
  );
}

function BuyForm(props: { plan: string }): ReactNode {
  const [data, setData] = useState<OffersOut | null>(null);
  const [problem, setProblem] = useState('');
  const [plan, setPlan] = useState(props.plan === 'business' ? 'business' : 'team');
  const [seats, setSeats] = useState(String(offerOf(props.plan)?.minSeats ?? 3));
  const [company, setCompany] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void api<OffersOut>('GET', '/buy/offers').then((r) => {
      if (r.ok) setData(r.data);
      else setProblem(r.error.message);
    });
  }, []);
  if (problem) return <p className="pe-muted">{problem}</p>;
  if (!data)
    return (
      <p className="pe-muted" role="status">
        Loading…
      </p>
    );
  if (!data.sells)
    return (
      <>
        <h1>Buy Orqiva</h1>
        <p className="pe-muted">
          This server does not sell licences. Licences are bought from Orqiva’s own site; the key
          you receive is then installed here under Settings → Licence.
        </p>
      </>
    );
  const offer = data.offers.find((o) => o.plan === plan);
  const n = Number(seats);
  const total = offer ? yearlyPrice(offer, Number.isInteger(n) ? n : 0) : null;
  return (
    <>
      <h1>Buy a licence</h1>
      <p className="pe-muted">
        For your own Orqiva server. Prices per person and month, billed yearly, without VAT.
        {data.draft ? ' Prices are not final yet.' : ''}
      </p>
      <div className="pe-buy-plans" role="radiogroup" aria-label="Plan">
        {data.offers.map((o) => (
          <button
            key={o.plan}
            type="button"
            role="radio"
            aria-checked={o.plan === plan}
            disabled={!o.available}
            className={'pe-buy-plan' + (o.plan === plan ? ' is-on' : '')}
            onClick={() => {
              setPlan(o.plan);
              if (Number(seats) < o.minSeats) setSeats(String(o.minSeats));
            }}
          >
            <span className="pe-buy-plan-name">{o.name}</span>
            <span className="pe-buy-plan-price">
              {priceLabel(o)}
              {o.pricePerSeatMonth !== null ? <small> /person/month</small> : null}
            </span>
            <span className="pe-small pe-muted">
              {o.plan === 'free'
                ? 'No purchase needed'
                : o.selfServe
                  ? String(o.minSeats) + '–' + String(o.maxSeats ?? '') + ' people'
                  : 'Quoted; contact us'}
            </span>
          </button>
        ))}
      </div>
      {offer ? (
        <ul className="pe-buy-includes pe-small">
          {offer.includes.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      ) : null}
      <form
        className="pe-buy-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          const why =
            purchaseProblem(plan, n) ||
            (!company.trim() ? 'Name the company the licence is for.' : '') ||
            (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ? 'Enter an email address.' : '');
          if (why) {
            setError(why);
            return;
          }
          setBusy(true);
          setError('');
          void api<{ url: string }>('POST', '/buy/checkout', {
            plan,
            seats: n,
            company: company.trim(),
            email: email.trim(),
          }).then((r) => {
            if (r.ok) window.location.assign(r.data.url);
            else {
              setBusy(false);
              setError(r.error.message);
            }
          });
        }}
      >
        <div className="pe-field">
          <label htmlFor="buy-seats">People</label>
          <input
            id="buy-seats"
            className="pe-input"
            type="number"
            inputMode="numeric"
            min={offer?.minSeats}
            max={offer?.maxSeats ?? undefined}
            value={seats}
            onChange={(e) => {
              setSeats(e.target.value);
            }}
          />
        </div>
        <div className="pe-field">
          <label htmlFor="buy-company">Company</label>
          <input
            id="buy-company"
            className="pe-input"
            autoComplete="organization"
            value={company}
            onChange={(e) => {
              setCompany(e.target.value);
            }}
          />
        </div>
        <div className="pe-field pe-buy-wide">
          <label htmlFor="buy-email">Email for the licence and invoices</label>
          <input
            id="buy-email"
            className="pe-input"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
            }}
          />
        </div>
        <div className="pe-buy-total pe-buy-wide">
          <span className="pe-muted">Per year</span>
          <strong>{total === null ? '—' : euros(total)}</strong>
        </div>
        {error ? (
          <p className="pe-field-error pe-buy-wide" role="alert">
            {error}
          </p>
        ) : null}
        <button
          type="submit"
          className="pe-btn pe-btn--primary pe-btn--block pe-buy-wide"
          disabled={busy || !offer?.available}
        >
          {busy ? 'Opening the payment…' : 'Continue to payment'}
        </button>
        <p className="pe-small pe-muted pe-buy-wide">
          Payment is handled by Stripe. Your licence key appears on the next page as soon as the
          payment is confirmed; you can open that page again later.
        </p>
      </form>
    </>
  );
}

function OrderStatus(props: { session: string }): ReactNode {
  const [order, setOrder] = useState<OrderOut | null>(null);
  const [problem, setProblem] = useState('');
  const [waited, setWaited] = useState(0);
  useEffect(() => {
    if (!props.session) {
      setProblem('This link has no order in it');
      return;
    }
    let stop = false;
    let tries = 0;
    const ask = (): void => {
      void api<OrderOut>('GET', '/buy/orders/' + encodeURIComponent(props.session)).then((r) => {
        if (stop) return;
        if (!r.ok) {
          setProblem(r.error.message);
          return;
        }
        setOrder(r.data);
        tries++;
        setWaited(tries);
        if (!r.data.licence && tries < 30) setTimeout(ask, 2000);
      });
    };
    ask();
    return () => {
      stop = true;
    };
  }, [props.session]);
  if (problem)
    return (
      <>
        <h1>Order not found</h1>
        <p className="pe-muted">{problem}. Open the link from the payment page again.</p>
      </>
    );
  if (!order)
    return (
      <p className="pe-muted" role="status">
        Loading…
      </p>
    );
  if (!order.licence)
    return (
      <>
        <h1>Waiting for the payment</h1>
        <p className="pe-muted">
          {waited >= 30
            ? 'The payment is not confirmed yet. Keep this page’s address and open it again in a few minutes.'
            : 'Stripe is confirming the payment. This usually takes a few seconds.'}
        </p>
      </>
    );
  return (
    <>
      <h1>Your licence</h1>
      <p className="pe-muted">
        {offerOf(order.plan)?.name ?? order.plan} for {String(order.seats)} people, licensed to{' '}
        <strong>{order.company}</strong>
        {order.paidUntil
          ? ', paid until ' + new Date(order.paidUntil).toLocaleDateString('en-GB')
          : ''}
        .{order.status === 'past_due' ? ' The last payment failed; Stripe will try again.' : ''}
      </p>
      <CopyField label="Licence key" value={order.licence} />
      <ol className="pe-buy-steps pe-small">
        <li>On your Orqiva server, open Settings → Licence as the workspace owner.</li>
        <li>Paste the key and choose Install licence. No internet connection is needed.</li>
        <li>Keep this page’s address: after each yearly renewal, the next key appears here.</li>
      </ol>
    </>
  );
}
