// ── [PCODE-359 | S15 | v0.1.0] T35.7a Plan contents enforced ──
// ── [PCODE-219 | S15 | v0.1.0] T20.2 Pricing and self-serve purchase for self-hosted customers (offers, buy flow, licence orders, plan enforcement) ──
//    Why:  what can be bought, in one place: the docs site's pricing page, the public buy page and the
//          server's checkout read the same offers, so a price or a seat range cannot differ between them.
//          The prices are the 2027 plan's hypothesis and stay a draft (PRICING_DRAFT) until the owner
//          decides them; the draft shows on the pricing page.
import { FREE_SEATS, TEAM_PROJECTS, type Plan } from './licence.js';

export const PRICING_DRAFT: boolean = true;
export const CURRENCY = 'EUR';

export interface Offer {
  plan: Plan | 'free';
  name: string;
  /** per seat and month, billed yearly; null: free, or quoted */
  pricePerSeatMonth: number | null;
  /** the price is a starting point and quoted per customer */
  quoted: boolean;
  minSeats: number;
  maxSeats: number | null;
  audience: string;
  includes: string[];
  /** bought on the buy page without talking to us */
  selfServe: boolean;
}

export const OFFERS: readonly Offer[] = [
  {
    plan: 'free',
    name: 'Free',
    pricePerSeatMonth: null,
    quoted: false,
    minSeats: 1,
    maxSeats: FREE_SEATS,
    audience: 'Trying Orqiva, or a small team',
    includes: [
      'Up to ' + String(FREE_SEATS) + ' people',
      'Every stage, from idea to release',
      'Agents with your own model key',
      'Docker install, no licence key needed',
    ],
    selfServe: false,
  },
  {
    plan: 'team',
    name: 'Team',
    pricePerSeatMonth: 19,
    quoted: false,
    minSeats: 3,
    maxSeats: 25,
    audience: 'One or two teams',
    includes: [
      // [PCODE-359 | S15 | v0.1.0] what the licence check holds a Team workspace to
      'Up to ' + String(TEAM_PROJECTS) + ' active projects',
      'Sprints, boards, CI test runs, security findings',
      'Standard agents with your own model key',
      'GitHub and GitLab, the CLI and VS Code',
    ],
    selfServe: true,
  },
  {
    plan: 'business',
    name: 'Business',
    pricePerSeatMonth: 35,
    quoted: false,
    minSeats: 10,
    maxSeats: 150,
    audience: 'Several teams, agencies',
    includes: [
      'Everything in Team, with any number of projects',
      'Portfolio command center',
      'Your own agents, lifecycles and gates',
      'Test management, compliance packs, audit log',
      'Client portal with free client seats',
    ],
    selfServe: true,
  },
  {
    plan: 'enterprise',
    name: 'Enterprise',
    pricePerSeatMonth: 55,
    quoted: true,
    minSeats: 150,
    maxSeats: null,
    audience: 'Large and regulated organisations',
    includes: [
      'Everything in Business',
      'SAML single sign-on and SCIM provisioning',
      'Kubernetes and air-gapped installs',
      'Support with a service level',
    ],
    selfServe: false,
  },
];

export const offerOf = (plan: string): Offer | undefined => OFFERS.find((o) => o.plan === plan);

/** Why this purchase is not possible on the buy page; empty when it is. */
export function purchaseProblem(plan: string, seats: number): string {
  const o = offerOf(plan);
  if (!o || !o.selfServe) return 'This plan cannot be bought online; contact us for it';
  if (!Number.isInteger(seats) || seats < o.minSeats)
    return o.name + ' starts at ' + String(o.minSeats) + ' seats';
  if (o.maxSeats !== null && seats > o.maxSeats)
    return o.name + ' goes up to ' + String(o.maxSeats) + ' seats; choose a larger plan';
  return '';
}

/** "€19" style, for one seat and month. */
export const priceLabel = (o: Offer): string =>
  o.pricePerSeatMonth === null
    ? o.plan === 'free'
      ? '€0'
      : 'Quoted'
    : (o.quoted ? 'from ' : '') + '€' + String(o.pricePerSeatMonth);

/** A year's price for these seats, in whole euros. */
export const yearlyPrice = (o: Offer, seats: number): number | null =>
  o.pricePerSeatMonth === null || o.quoted ? null : o.pricePerSeatMonth * 12 * seats;
