// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-149 | S15 | v0.1.0] Bill through Stripe without its SDK: checkout, webhooks, licences ──
//    Why:  paying for Orqiva, with Stripe doing the money and nothing of Stripe's code in ours. An owner
//          starts a Checkout session (Stripe's REST API, form-encoded, over fetch); Stripe calls our webhook,
//          whose Stripe-Signature we check ourselves (HMAC-SHA256 over "timestamp.body", five minutes'
//          tolerance, constant-time comparison). A paid checkout or invoice issues the workspace's licence,
//          signed with the vendor key; each Stripe event is handled once, by its id. Keys come only from the
//          environment: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_TEAM / _BUSINESS, and
//          ORQIVA_LICENCE_SIGNING_KEY_FILE for the signing key.
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Pool, PoolClient } from 'pg';
import type { Licence, Plan } from '@orqiva/shared';
import { inSystem } from '../db/pool.js';
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s } from '../http/schema.js';
import { signLicence } from '../licence/licence.js';
import { asMember } from './access.js';
import { applyOrderEvent } from './buy.js';

const uuid = s.string({ format: 'uuid' });
const TOLERANCE_S = 300;

export interface BillingDeps {
  fetchImpl?: typeof fetch;
  env?: Record<string, string | undefined>;
  now?: () => Date;
}

/** Stripe's signature header checked against the raw body: true only for a fresh, matching signature. */
export function verifyStripeSignature(
  rawBody: string,
  header: string,
  secret: string,
  now: Date,
): boolean {
  const parts = header.split(',').map((p) => p.trim().split('='));
  const t = Number(parts.find(([k]) => k === 't')?.[1]);
  const sigs = parts.filter(([k]) => k === 'v1').map(([, v]) => v ?? '');
  if (!Number.isFinite(t) || !sigs.length) return false;
  if (Math.abs(now.getTime() / 1000 - t) > TOLERANCE_S) return false;
  const expected = Buffer.from(
    createHmac('sha256', secret)
      .update(String(t) + '.' + rawBody)
      .digest('hex'),
  );
  return sigs.some((sig) => {
    const given = Buffer.from(sig);
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

/** Stripe's form encoding, nested keys in brackets: line_items[0][price]=… */
export function stripeForm(v: Record<string, unknown>, prefix = ''): string {
  const out: string[] = [];
  const add = (key: string, val: unknown): void => {
    if (val === undefined || val === null) return;
    if (Array.isArray(val))
      val.forEach((x, i) => {
        add(key + '[' + String(i) + ']', x);
      });
    else if (typeof val === 'object')
      for (const [k, x] of Object.entries(val)) add(key + '[' + k + ']', x);
    else if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean')
      out.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(val)));
  };
  for (const [k, val] of Object.entries(v)) add(prefix ? prefix + '[' + k + ']' : k, val);
  return out.join('&');
}

const priceFor = (env: Record<string, string | undefined>, plan: string): string | undefined =>
  env['STRIPE_PRICE_' + plan.toUpperCase()];

/** The licence a payment buys: the plan and seats paid for, valid to the period's end and three days more. */
export function licenceForPayment(o: {
  workspaceId: string;
  customer: string;
  email: string;
  plan: Plan;
  seats: number;
  periodEnd: Date;
  now: Date;
}): Licence {
  return {
    v: 1,
    id: 'stripe-' + o.workspaceId + '-' + String(o.periodEnd.getTime()),
    customer: o.customer,
    email: o.email,
    plan: o.plan,
    seats: o.seats,
    features: [],
    issued: o.now.toISOString(),
    expires: new Date(o.periodEnd.getTime() + 3 * 86_400_000).toISOString(),
  };
}

interface StripeEvent {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const obj = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};

/** Issues and installs the workspace's licence for a paid period, if a signing key is configured. */
async function issue(
  c: PoolClient,
  env: Record<string, string | undefined>,
  workspaceId: string,
  plan: Plan,
  seats: number,
  periodEnd: Date,
  now: Date,
): Promise<boolean> {
  const keyFile = env['ORQIVA_LICENCE_SIGNING_KEY_FILE'];
  if (!keyFile) return false;
  const ws = (
    await c.query<{ name: string; email: string }>(
      `SELECT w.name, u.email FROM workspaces w JOIN workspace_members m ON m.workspace_id = w.id AND m.role = 'owner'
       JOIN users u ON u.id = m.user_id WHERE w.id = $1 LIMIT 1`,
      [workspaceId],
    )
  ).rows[0];
  if (!ws) return false;
  const token = signLicence(
    licenceForPayment({
      workspaceId,
      customer: ws.name,
      email: ws.email,
      plan,
      seats,
      periodEnd,
      now,
    }),
    readFileSync(keyFile, 'utf8'),
  );
  await c.query(
    `INSERT INTO workspace_licences (workspace_id, token) VALUES ($1, $2)
     ON CONFLICT (workspace_id) DO UPDATE SET token = $2, installed_at = now(), installed_by = NULL`,
    [workspaceId, token],
  );
  return true;
}

/** Handles one Stripe event; false when it was handled before. */
export async function handleStripeEvent(
  c: PoolClient,
  ev: StripeEvent,
  env: Record<string, string | undefined>,
  now: Date,
): Promise<boolean> {
  // [PCODE-219 | S15 | v0.1.0] a self-hosted order has no workspace here; its events are handled apart
  const forOrder = await applyOrderEvent(c, ev, env, now);
  if (forOrder !== null) return forOrder;
  const o = ev.data.object;
  const meta = obj(o['metadata']);
  let workspaceId = str(meta['workspace_id']) || str(o['client_reference_id']);
  if (!workspaceId && str(o['subscription']))
    workspaceId =
      (
        await c.query<{ workspace_id: string }>(
          'SELECT workspace_id FROM billing_accounts WHERE stripe_subscription_id = $1',
          [str(o['subscription'])],
        )
      ).rows[0]?.workspace_id ?? '';
  if (!workspaceId && ev.type.startsWith('customer.subscription'))
    workspaceId =
      (
        await c.query<{ workspace_id: string }>(
          'SELECT workspace_id FROM billing_accounts WHERE stripe_subscription_id = $1',
          [str(o['id'])],
        )
      ).rows[0]?.workspace_id ?? '';
  const valid =
    /^[0-9a-f-]{36}$/.test(workspaceId) &&
    (await c.query('SELECT 1 FROM workspaces WHERE id = $1', [workspaceId])).rowCount;
  const first = await c.query(
    'INSERT INTO billing_events (id, workspace_id, type, summary) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING',
    [
      ev.id,
      valid ? workspaceId : null,
      ev.type,
      JSON.stringify({
        amount: o['amount_paid'] ?? o['amount_total'] ?? null,
        currency: o['currency'] ?? null,
        invoice: o['hosted_invoice_url'] ?? null,
        number: o['number'] ?? null,
        status: o['status'] ?? o['payment_status'] ?? null,
      }),
    ],
  );
  if (!first.rowCount) return false;
  if (!valid) return true;

  if (ev.type === 'checkout.session.completed' && str(o['payment_status']) === 'paid') {
    const plan = (str(meta['plan']) || 'team') as Plan;
    const seats = Number(meta['seats'] ?? 1) || 1;
    const periodEnd = new Date(now.getTime() + 31 * 86_400_000);
    await c.query(
      `INSERT INTO billing_accounts (workspace_id, stripe_customer_id, stripe_subscription_id, plan, seats, status, current_period_end)
       VALUES ($1, $2, $3, $4, $5, 'active', $6)
       ON CONFLICT (workspace_id) DO UPDATE SET stripe_customer_id = $2, stripe_subscription_id = $3, plan = $4, seats = $5,
         status = 'active', current_period_end = $6, updated_at = now()`,
      [
        workspaceId,
        str(o['customer']) || null,
        str(o['subscription']) || null,
        plan,
        seats,
        periodEnd,
      ],
    );
    await issue(c, env, workspaceId, plan, seats, periodEnd, now);
  } else if (ev.type === 'invoice.paid') {
    const line = obj(arr(obj(o['lines'])['data'])[0]);
    const end = Number(obj(line['period'])['end']);
    const acct = (
      await c.query<{ plan: Plan; seats: number }>(
        'SELECT plan, seats FROM billing_accounts WHERE workspace_id = $1',
        [workspaceId],
      )
    ).rows[0];
    if (acct && Number.isFinite(end)) {
      const periodEnd = new Date(end * 1000);
      await c.query(
        "UPDATE billing_accounts SET status = 'active', current_period_end = $2, updated_at = now() WHERE workspace_id = $1",
        [workspaceId, periodEnd],
      );
      await issue(c, env, workspaceId, acct.plan, acct.seats, periodEnd, now);
    }
  } else if (ev.type === 'invoice.payment_failed') {
    await c.query(
      "UPDATE billing_accounts SET status = 'past_due', updated_at = now() WHERE workspace_id = $1",
      [workspaceId],
    );
  } else if (ev.type === 'customer.subscription.deleted') {
    await c.query(
      "UPDATE billing_accounts SET status = 'cancelled', updated_at = now() WHERE workspace_id = $1",
      [workspaceId],
    );
  }
  return true;
}

const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

export function billingRoutes(pool: Pool, deps: BillingDeps = {}): Route[] {
  const env = (): Record<string, string | undefined> => deps.env ?? process.env;
  const fetchImpl = (): typeof fetch => deps.fetchImpl ?? fetch;
  const now = (): Date => deps.now?.() ?? new Date();

  const get = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/billing',
    summary: 'The workspace’s subscription and invoices (owner)',
    tags: ['billing'],
    params: s.object({ workspaceId: uuid }),
    response: s.object({
      configured: s.boolean(),
      account: s.nullable(
        s.object({
          plan: s.string(),
          seats: s.number({ integer: true }),
          status: s.string(),
          currentPeriodEnd: s.nullable(s.string()),
        }),
      ),
      invoices: s.array(
        s.object({
          id: s.string(),
          at: s.string(),
          amount: s.nullable(s.number()),
          currency: s.nullable(s.string()),
          url: s.nullable(s.string()),
        }),
      ),
    }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'owner', async (c, a) => {
        const acct = (
          await c.query<{
            plan: string;
            seats: number;
            status: string;
            current_period_end: Date | null;
          }>(
            'SELECT plan, seats, status, current_period_end FROM billing_accounts WHERE workspace_id = $1',
            [a.workspaceId],
          )
        ).rows[0];
        const invoices = (
          await c.query<{
            id: string;
            received_at: Date;
            summary: { amount: number | null; currency: string | null; invoice: string | null };
          }>(
            "SELECT id, received_at, summary FROM billing_events WHERE workspace_id = $1 AND type = 'invoice.paid' ORDER BY received_at DESC LIMIT 50",
            [a.workspaceId],
          )
        ).rows;
        return {
          body: {
            configured: Boolean(env()['STRIPE_SECRET_KEY'] && env()['STRIPE_WEBHOOK_SECRET']),
            account: acct
              ? {
                  plan: acct.plan,
                  seats: acct.seats,
                  status: acct.status,
                  currentPeriodEnd: acct.current_period_end?.toISOString() ?? null,
                }
              : null,
            invoices: invoices.map((i) => ({
              id: i.id,
              at: i.received_at.toISOString(),
              amount: i.summary.amount,
              currency: i.summary.currency,
              url: i.summary.invoice,
            })),
          },
        };
      }),
  });

  const checkout = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/billing/checkout',
    summary:
      'Start a Stripe Checkout for a plan and a number of seats; answers the page to go to (owner)',
    tags: ['billing'],
    params: s.object({ workspaceId: uuid }),
    body: s.object({
      plan: s.enum(['team', 'business']),
      seats: s.number({ integer: true, min: 1, max: 10_000 }),
    }),
    response: s.object({ url: s.string() }),
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'owner', async (c, a) => {
        const e = env();
        const key = e['STRIPE_SECRET_KEY'];
        const price = priceFor(e, body.plan);
        if (!key || !price)
          throw new HttpError(
            409,
            'conflict',
            'Billing is not set up on this server (STRIPE_SECRET_KEY and a price for the plan)',
          );
        const base = (e['ORQIVA_PUBLIC_URL'] ?? '').replace(/\/$/, '');
        const form = stripeForm({
          mode: 'subscription',
          'line_items[0][price]': price,
          'line_items[0][quantity]': body.seats,
          success_url: base + '/settings/billing?paid=1',
          cancel_url: base + '/settings/billing',
          client_reference_id: a.workspaceId,
          customer_email: a.user.email,
          metadata: { workspace_id: a.workspaceId, plan: body.plan, seats: body.seats },
          subscription_data: {
            metadata: { workspace_id: a.workspaceId, plan: body.plan, seats: body.seats },
          },
        });
        const res = await fetchImpl()('https://api.stripe.com/v1/checkout/sessions', {
          method: 'POST',
          headers: {
            authorization: 'Bearer ' + key,
            'content-type': 'application/x-www-form-urlencoded',
            'idempotency-key': randomUUID(),
          },
          body: form,
          signal: AbortSignal.timeout(20_000),
        });
        const out = (await res.json()) as { url?: string; error?: { message?: string } };
        if (!res.ok || !out.url)
          throw new HttpError(
            409,
            'conflict',
            'Stripe refused the checkout: ' + (out.error?.message ?? String(res.status)),
          );
        await c.query(
          `INSERT INTO billing_accounts (workspace_id, plan, seats, status) VALUES ($1, $2, $3, 'pending')
           ON CONFLICT (workspace_id) DO UPDATE SET plan = $2, seats = $3, updated_at = now()`,
          [a.workspaceId, body.plan, body.seats],
        );
        return { body: { url: out.url } };
      }),
  });

  const webhook = route({
    method: 'POST',
    path: '/stripe/webhook',
    summary: 'Stripe’s events; only deliveries with a valid Stripe-Signature are taken',
    tags: ['billing'],
    body: s.anyObject(),
    response: s.object({ received: s.boolean() }),
    handler: async ({ body, req, rawBody }) => {
      const secret = env()['STRIPE_WEBHOOK_SECRET'];
      if (!secret) throw new HttpError(409, 'conflict', 'Billing is not set up on this server');
      const header = String(req.headers['stripe-signature'] ?? '');
      if (!verifyStripeSignature(rawBody ?? '', header, secret, now()))
        throw new HttpError(400, 'invalid_request', 'The Stripe signature does not match');
      const ev = body as unknown as StripeEvent;
      if (typeof ev.id !== 'string' || typeof ev.type !== 'string')
        throw new HttpError(400, 'invalid_request', 'Not a Stripe event');
      await inSystem(pool, (c) => handleStripeEvent(c, ev, env(), now()));
      return { body: { received: true } };
    },
  });

  return [get, checkout, webhook];
}
