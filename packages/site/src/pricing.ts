// ── [PCODE-359 | S15 | v0.1.0] T35.7a Plan contents enforced ──
// ── [PCODE-219 | S15 | v0.1.0] T20.2 Pricing and self-serve purchase for self-hosted customers (offers, buy flow, licence orders, plan enforcement) ──
//    Why:  the pricing page is generated from the same offers the buy page and the server use. The buy
//          buttons go to the vendor's buy page (ORQIVA_BUY_URL at build time); without it the page says
//          that online purchase opens at launch. While the prices are a draft, the page says so.
import { CURRENCY, OFFERS, PRICING_DRAFT, priceLabel, type Offer } from '@orqiva/shared';
import { escapeHtml, type Heading } from './markdown.js';

const seatsOf = (o: Offer): string =>
  o.plan === 'free'
    ? 'Up to ' + String(o.maxSeats) + ' people'
    : o.maxSeats === null
      ? String(o.minSeats) + '+ people'
      : String(o.minSeats) + '–' + String(o.maxSeats) + ' people';

function action(o: Offer, buyUrl: string | undefined): string {
  if (o.plan === 'free') return '<a class="btn" href="getting-started.html">Install free</a>';
  if (!o.selfServe) return '<span class="btn off">Quoted: ask us</span>';
  if (!buyUrl) return '<span class="btn off">Online purchase opens at launch</span>';
  return (
    '<a class="btn primary" href="' +
    escapeHtml(buyUrl + '?plan=' + o.plan) +
    '" rel="noopener">Buy ' +
    escapeHtml(o.name) +
    '</a>'
  );
}

export function pricingPage(buyUrl: string | undefined): { body: string; headings: Heading[] } {
  const cards = OFFERS.map(
    (o) =>
      '<div class="plan' +
      (o.plan === 'business' ? ' plan-hi' : '') +
      '"><h3>' +
      escapeHtml(o.name) +
      '</h3><p class="price">' +
      escapeHtml(priceLabel(o)) +
      (o.pricePerSeatMonth !== null ? ' <small>per person/month</small>' : '') +
      '</p><p class="muted">' +
      escapeHtml(o.audience) +
      ' · ' +
      escapeHtml(seatsOf(o)) +
      '</p><ul>' +
      o.includes.map((x) => '<li>' + escapeHtml(x) + '</li>').join('') +
      '</ul>' +
      action(o, buyUrl) +
      '</div>',
  ).join('');
  const body = [
    '<h1 id="pricing">Pricing</h1>',
    PRICING_DRAFT
      ? '<blockquote><p><strong>Draft.</strong> These prices and plan contents are not final yet.</p></blockquote>'
      : '',
    '<p class="lead">Per person and month, billed yearly, in ' +
      CURRENCY +
      ' without VAT. Orqiva runs on your machines; the price is the same for every install type. AI agents use your own model key.</p>',
    '<div class="plans">' + cards + '</div>',
    '<h2 id="how-buying-works">How buying works</h2>',
    '<ol><li>Choose a plan and the number of people, and pay by card through Stripe.</li>' +
      '<li>The licence key appears as soon as the payment is confirmed. Paste it into Settings → Plan and billing on your server; it is checked offline.</li>' +
      '<li>Each year the renewal is charged and the next key appears on the same order page.</li></ol>',
    '<h2 id="questions">Questions</h2>',
    '<p><strong>Who counts as a person?</strong> Members of a workspace. Client portal users, suspended people and service accounts do not take a seat.</p>',
    '<p><strong>What happens when a licence expires?</strong> Nothing is deleted. The free plan’s limits apply until a new key is installed.</p>',
    '<p><strong>Can we try it first?</strong> Yes: install it free for up to 5 people, with no key and no time limit.</p>',
  ].join('\n');
  return {
    body,
    headings: [
      { level: 1, id: 'pricing', text: 'Pricing' },
      { level: 2, id: 'how-buying-works', text: 'How buying works' },
      { level: 2, id: 'questions', text: 'Questions' },
    ],
  };
}

export const PRICING_STYLE = `/* [PCODE-219 | S15 | v0.1.0] the pricing page */
.plans { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin: 16px 0; }
.plan { display: flex; flex-direction: column; border: 1px solid var(--line); border-radius: 6px; padding: 12px; }
.plan-hi { border-color: var(--accent); }
.plan h3 { margin: 0; font-size: 13px; }
.plan .price { margin: 4px 0 0; font-size: 18px; font-weight: 600; }
.plan .price small { font-size: 11px; font-weight: 400; color: var(--fg2); }
.plan .muted { margin: 2px 0 8px; color: var(--fg2); font-size: 12px; }
.plan ul { margin: 0 0 12px; padding-left: 16px; font-size: 12px; flex: 1; }
.btn { display: block; text-align: center; padding: 6px 8px; border: 1px solid var(--line); border-radius: 4px;
  color: var(--fg); font-weight: 600; font-size: 12px; }
.btn:hover { text-decoration: none; background: var(--bg2); }
.btn.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
.btn.off { color: var(--fg2); font-weight: 400; }
@media (max-width: 1100px) { .plans { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 480px) { .plans { grid-template-columns: minmax(0, 1fr); } }
`;
