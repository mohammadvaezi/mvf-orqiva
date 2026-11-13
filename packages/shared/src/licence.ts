// ── [PCODE-359 | S15 | v0.1.0] T35.7a Plan contents enforced ──
// ── [PCODE-148 | S15 | v0.1.0] Add signed licence keys with seats, features and expiry ──
// ── [PCODE-150 | S15 | v0.1.0] Add the cloud tenant and harden sign-in, rate limits and headers ──
//    Why:  what a licence says and what follows from it, the same for the server that enforces it, the
//          CLI that issues it and the web app that shows it. The signature itself (Ed25519) is made and
//          checked with Node's crypto in the CLI and the server; this module only knows the format.

/** The vendor's public key; the private half never enters the repository. */
export const LICENCE_PUBLIC_KEY =
  '-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAx83bT3KjeqZjtDWGe09GCo8cWcQ0HzZyEkv293X1pGs=\n-----END PUBLIC KEY-----\n';

export const PLANS = ['team', 'business', 'enterprise'] as const;
export type Plan = (typeof PLANS)[number];

export interface Licence {
  v: 1;
  id: string;
  customer: string;
  email: string;
  plan: Plan;
  seats: number;
  /** extra features beyond the plan's, e.g. "sso" */
  features: string[];
  issued: string;
  /** ISO date; null never expires */
  expires: string | null;
}

/** Without a licence: up to this many members, every feature but the enterprise ones. */
export const FREE_SEATS = 5;
export const ENTERPRISE_FEATURES = ['sso', 'scim', 'audit-export'] as const;

// [PCODE-359 | S15 | v0.1.0] what each plan holds beyond seats (the pricing table of the 2027 plan)
/** Business adds these to Team. */
export const BUSINESS_FEATURES = [
  'projects-unlimited',
  'command-center',
  'custom-agents',
  'custom-gates',
  'test-management',
  'compliance-packs',
  'audit-log',
] as const;
/** Team holds this many active projects; Business and up hold any number. */
export const TEAM_PROJECTS = 5;

/** The features a plan holds. The free plan keeps everything but the Enterprise features. */
export function planFeatures(plan: Plan | 'free'): string[] {
  if (plan === 'team') return [];
  if (plan === 'enterprise') return [...BUSINESS_FEATURES, ...ENTERPRISE_FEATURES];
  return [...BUSINESS_FEATURES];
}

/** The first plan that holds a feature, for messages. */
export function planOfFeature(feature: string): 'Business' | 'Enterprise' {
  return (ENTERPRISE_FEATURES as readonly string[]).includes(feature) ? 'Enterprise' : 'Business';
}

/** The features in words, for the licence page. */
export const FEATURE_NAMES: Record<string, string> = {
  'projects-unlimited': 'Unlimited projects',
  'command-center': 'Command center',
  'custom-agents': 'Custom agents',
  'custom-gates': 'Custom lifecycles and gates',
  'test-management': 'Test management',
  'compliance-packs': 'Compliance packs',
  'audit-log': 'Audit log export',
  sso: 'SAML single sign-on',
  scim: 'SCIM provisioning',
  'audit-export': 'Audit export to a SIEM',
};

export const PREFIX = 'PE1.';

/** "PE1.<payload>.<signature>", both base64url; the payload is the licence as JSON. */
export function splitLicence(token: string): { payload: string; signature: string } | null {
  const t = token.trim();
  if (!t.startsWith(PREFIX)) return null;
  const parts = t.slice(PREFIX.length).split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  return { payload: parts[0], signature: parts[1] };
}

/** What is wrong with a licence's content; empty when it is well formed. */
export function licenceProblems(v: unknown): string[] {
  const l = (typeof v === 'object' && v !== null ? v : {}) as Record<string, unknown>;
  const out: string[] = [];
  if (l['v'] !== 1) out.push('unknown licence version');
  for (const k of ['id', 'customer', 'email', 'issued'] as const)
    if (typeof l[k] !== 'string' || !l[k].trim()) out.push(k + ' is missing');
  if (!PLANS.includes(l['plan'] as Plan)) out.push('plan is one of ' + PLANS.join(', '));
  if (!Number.isInteger(l['seats']) || (l['seats'] as number) < 1)
    out.push('seats is a whole number of 1 or more');
  if (
    !Array.isArray(l['features']) ||
    !(l['features'] as unknown[]).every((f) => typeof f === 'string')
  )
    out.push('features is a list of names');
  if (
    l['expires'] !== null &&
    (typeof l['expires'] !== 'string' || Number.isNaN(Date.parse(l['expires'])))
  )
    out.push('expires is a date or null');
  return out;
}

// [PCODE-150 | S15 | v0.1.0] 'trial': a cloud workspace's first weeks
export type LicenceStatus = 'free' | 'trial' | 'active' | 'expired' | 'over_seats';

/** [PCODE-150 | S15 | v0.1.0] a cloud trial: the Business plan with this many seats */
export const TRIAL_SEATS = 25;
export const TRIAL_DAYS = 14;

export interface Entitlement {
  status: LicenceStatus;
  plan: Plan | 'free';
  seats: number;
  used: number;
  features: string[];
  customer: string | null;
  expires: string | null;
  /** why something is limited, in a sentence; empty when nothing is */
  problem: string;
}

/** What a workspace may do, from its licence (or none), the members it has and the date. */
export function entitlementOf(
  licence: Licence | null,
  members: number,
  now: Date,
  trialEndsAt: Date | null = null,
): Entitlement {
  // [PCODE-150 | S15 | v0.1.0] a running cloud trial counts as the Business plan
  if (!licence && trialEndsAt && trialEndsAt > now)
    return {
      status: 'trial',
      plan: 'business',
      seats: TRIAL_SEATS,
      used: members,
      features: planFeatures('business'), // [PCODE-359 | S15 | v0.1.0]
      customer: null,
      expires: trialEndsAt.toISOString(),
      problem: members > TRIAL_SEATS ? 'The trial has ' + String(TRIAL_SEATS) + ' seats' : '',
    };
  if (!licence)
    return {
      status: members > FREE_SEATS ? 'over_seats' : 'free',
      plan: 'free',
      seats: FREE_SEATS,
      used: members,
      features: planFeatures('free'), // [PCODE-359 | S15 | v0.1.0]
      customer: null,
      expires: null,
      problem:
        members > FREE_SEATS
          ? 'The free plan has ' + String(FREE_SEATS) + ' seats; add a licence for more'
          : '',
    };
  const base = {
    plan: licence.plan,
    used: members,
    customer: licence.customer,
    expires: licence.expires,
  };
  const expired = licence.expires !== null && Date.parse(licence.expires) < now.getTime();
  if (expired)
    return {
      ...base,
      status: 'expired',
      seats: FREE_SEATS,
      features: planFeatures('free'), // [PCODE-359 | S15 | v0.1.0]
      problem:
        'The licence expired on ' +
        (licence.expires ?? '').slice(0, 10) +
        '; the free plan’s limits apply until it is renewed',
    };
  const over = members > licence.seats;
  return {
    ...base,
    status: over ? 'over_seats' : 'active',
    seats: licence.seats,
    features: [...new Set([...planFeatures(licence.plan), ...licence.features])], // [PCODE-359 | S15 | v0.1.0]
    problem: over
      ? String(members) +
        ' members on ' +
        String(licence.seats) +
        ' seats; remove members or add seats'
      : '',
  };
}

/** Whether one more member may join: always below the seat count, never above it. */
export const mayAddMember = (e: Entitlement): boolean => e.used < e.seats;
