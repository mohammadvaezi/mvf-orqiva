// ── [PCODE-363 | S15 | v0.1.0] T35.7e Rate limits shared across cluster nodes ──
// ── [PCODE-359 | S15 | v0.1.0] T35.7a Plan contents enforced ──
// ── [PCODE-219 | S15 | v0.1.0] T20.2 Pricing and self-serve purchase for self-hosted customers (offers, buy flow, licence orders, plan enforcement) ──
//    Why:  a self-hosted customer buys without a workspace on our server and without talking to us. The
//          vendor's server (the one with Stripe keys and the licence signing key) offers the plans, starts
//          a Stripe Checkout for a plan and a number of seats, and, once Stripe says it is paid, signs the
//          licence. The order page, at the Checkout session's id (which only the buyer's browser learns from
//          Stripe), shows the key to paste into Settings → Licence; every renewal puts the next key there.
//          Elsewhere, without those keys, the buy routes say so and do nothing. Starting a checkout is
//          public, so it is rate-limited per address.
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import type { Pool, PoolClient } from 'pg';
import {
  CURRENCY,
  OFFERS,
  PRICING_DRAFT,
  purchaseProblem,
  type Licence,
  type Plan,
} from '@orqiva/shared';
import { SharedRateLimiter, type Limiter } from '../auth/ratelimit.js'; // [PCODE-363 | S15 | v0.1.0]
import { inSystem } from '../db/pool.js';
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s } from '../http/schema.js';
import { signLicence } from '../licence/licence.js';
import { stripeForm, type BillingDeps } from './billing.js';

/** Days a self-hosted licence stays valid after the paid period: room for a renewal to be installed offline. */
export const ORDER_GRACE_DAYS = 14;
const SESSION = /^cs_[A-Za-z0-9_]{8,250}$/;

type Env = Record<string, string | undefined>;

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const obj = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

const priceOf = (env: Env, plan: string): string | undefined =>
  env['STRIPE_PRICE_' + plan.toUpperCase()];

/** Whether this server sells: Stripe, its webhook secret and the licence signing key are all set. */
export function sells(env: Env): boolean {
  const key = env['ORQIVA_LICENCE_SIGNING_KEY_FILE'];
  return Boolean(
    env['STRIPE_SECRET_KEY'] && env['STRIPE_WEBHOOK_SECRET'] && key && existsSync(key),
  );
}

interface OrderRow {
  id: string;
  company: string;
  email: string;
  plan: Plan;
  seats: number;
  status: string;
  licence: string | null;
  current_period_end: Date | null;
  stripe_subscription_id: string | null;
}

/** The licence a paid period of an order buys. */
export function licenceForOrder(o: {
  orderId: string;
  company: string;
  email: string;
  plan: Plan;
  seats: number;
  periodEnd: Date;
  now: Date;
}): Licence {
  return {
    v: 1,
    id: 'order-' + o.orderId + '-' + String(o.periodEnd.getTime()),
    customer: o.company,
    email: o.email,
    plan: o.plan,
    seats: o.seats,
    features: [], // [PCODE-359 | S15 | v0.1.0] the plan carries its own features
    issued: o.now.toISOString(),
    expires: new Date(o.periodEnd.getTime() + ORDER_GRACE_DAYS * 86_400_000).toISOString(),
  };
}

async function issueForOrder(
  c: PoolClient,
  env: Env,
  order: OrderRow,
  periodEnd: Date,
  now: Date,
): Promise<void> {
  const keyFile = env['ORQIVA_LICENCE_SIGNING_KEY_FILE'];
  const token = keyFile
    ? signLicence(
        licenceForOrder({
          orderId: order.id,
          company: order.company,
          email: order.email,
          plan: order.plan,
          seats: order.seats,
          periodEnd,
          now,
        }),
        readFileSync(keyFile, 'utf8'),
      )
    : null;
  await c.query(
    `UPDATE licence_orders SET status = 'active', current_period_end = $2, licence = coalesce($3, licence),
       updated_at = now() WHERE id = $1`,
    [order.id, periodEnd, token],
  );
}

/**
 * A Stripe event about a self-hosted order: handled here and true, false when it came before, null when
 * the event is not about an order (the workspace billing handles it then).
 */
export async function applyOrderEvent(
  c: PoolClient,
  ev: { id: string; type: string; data: { object: Record<string, unknown> } },
  env: Env,
  now: Date,
): Promise<boolean | null> {
  const o = ev.data.object;
  const meta = obj(o['metadata']);
  // the order's id travels in the subscription's metadata, which invoices carry too
  const orderId =
    str(meta['order']) ||
    str(obj(obj(o['subscription_details'])['metadata'])['order']) ||
    str(obj(obj(arr(obj(o['lines'])['data'])[0])['metadata'])['order']);
  const subscription = ev.type.startsWith('customer.subscription')
    ? str(o['id'])
    : str(o['subscription']);
  const cols =
    'id, company, email, plan, seats, status, licence, current_period_end, stripe_subscription_id';
  let order: OrderRow | undefined;
  if (ev.type === 'checkout.session.completed' && str(meta['kind']) === 'selfhosted')
    order = (
      await c.query<OrderRow>(
        'SELECT ' + cols + ' FROM licence_orders WHERE checkout_session = $1',
        [str(o['id'])],
      )
    ).rows[0];
  if (!order && /^[0-9a-f-]{36}$/.test(orderId))
    order = (
      await c.query<OrderRow>('SELECT ' + cols + ' FROM licence_orders WHERE id = $1', [orderId])
    ).rows[0];
  if (!order && subscription)
    order = (
      await c.query<OrderRow>(
        'SELECT ' + cols + ' FROM licence_orders WHERE stripe_subscription_id = $1',
        [subscription],
      )
    ).rows[0];
  if (!order) return null;

  const first = await c.query(
    'INSERT INTO billing_events (id, workspace_id, type, summary) VALUES ($1, NULL, $2, $3) ON CONFLICT (id) DO NOTHING',
    [
      ev.id,
      ev.type,
      JSON.stringify({
        order: order.id,
        amount: o['amount_paid'] ?? o['amount_total'] ?? null,
        currency: o['currency'] ?? null,
        invoice: o['hosted_invoice_url'] ?? null,
        status: o['status'] ?? o['payment_status'] ?? null,
      }),
    ],
  );
  if (!first.rowCount) return false;

  if (ev.type === 'checkout.session.completed' && str(o['payment_status']) === 'paid') {
    await c.query(
      `UPDATE licence_orders SET stripe_customer_id = coalesce($2, stripe_customer_id),
         stripe_subscription_id = coalesce($3, stripe_subscription_id), updated_at = now() WHERE id = $1`,
      [order.id, str(o['customer']) || null, str(o['subscription']) || null],
    );
    // the invoice may have come first and set the real period; otherwise a year (prices are yearly)
    const periodEnd =
      order.current_period_end && order.current_period_end > now
        ? order.current_period_end
        : new Date(now.getTime() + 366 * 86_400_000);
    if (!order.licence || order.current_period_end?.getTime() !== periodEnd.getTime())
      await issueForOrder(c, env, order, periodEnd, now);
  } else if (ev.type === 'invoice.paid') {
    const line = obj(arr(obj(o['lines'])['data'])[0]);
    const end = Number(obj(line['period'])['end']);
    if (Number.isFinite(end) && end > 0) {
      if (subscription && !order.stripe_subscription_id)
        await c.query('UPDATE licence_orders SET stripe_subscription_id = $2 WHERE id = $1', [
          order.id,
          subscription,
        ]);
      await issueForOrder(c, env, order, new Date(end * 1000), now);
    }
  } else if (ev.type === 'invoice.payment_failed') {
    await c.query(
      "UPDATE licence_orders SET status = 'past_due', updated_at = now() WHERE id = $1",
      [order.id],
    );
  } else if (ev.type === 'customer.subscription.deleted') {
    // the last key stays valid to its date; no new one follows
    await c.query(
      "UPDATE licence_orders SET status = 'cancelled', updated_at = now() WHERE id = $1",
      [order.id],
    );
  }
  return true;
}

const clientIp = (req: IncomingMessage): string => req.socket.remoteAddress ?? 'unknown';

export function buyRoutes(pool: Pool, deps: BillingDeps & { limiter?: Limiter } = {}): Route[] {
  const env = (): Env => deps.env ?? process.env;
  const fetchImpl = (): typeof fetch => deps.fetchImpl ?? fetch;
  const limiter = deps.limiter ?? new SharedRateLimiter(pool, 'buy', 10, 15 * 60_000); // [PCODE-363 | S15 | v0.1.0]

  const offers = route({
    method: 'GET',
    path: '/buy/offers',
    summary: 'The plans, their prices and seat ranges, and whether this server sells them (public)',
    tags: ['billing'],
    response: s.object({
      sells: s.boolean(),
      draft: s.boolean(),
      currency: s.string(),
      offers: s.array(
        s.object({
          plan: s.string(),
          name: s.string(),
          pricePerSeatMonth: s.nullable(s.number()),
          quoted: s.boolean(),
          minSeats: s.number({ integer: true }),
          maxSeats: s.nullable(s.number({ integer: true })),
          audience: s.string(),
          includes: s.array(s.string()),
          selfServe: s.boolean(),
          available: s.boolean(),
        }),
      ),
    }),
    handler: () => {
      const e = env();
      const on = sells(e);
      return {
        body: {
          sells: on,
          draft: PRICING_DRAFT,
          currency: CURRENCY,
          offers: OFFERS.map((o) => ({
            ...o,
            includes: [...o.includes],
            available: on && o.selfServe && Boolean(priceOf(e, o.plan)),
          })),
        },
      };
    },
  });

  const checkout = route({
    method: 'POST',
    path: '/buy/checkout',
    summary:
      'Start a Stripe Checkout for a self-hosted licence; answers the page to go to (public, rate-limited)',
    tags: ['billing'],
    body: s.object({
      plan: s.enum(['team', 'business']),
      seats: s.number({ integer: true, min: 1, max: 10_000 }),
      company: s.string({ min: 1, max: 120 }),
      email: s.string({ format: 'email', max: 254 }),
    }),
    response: s.object({ url: s.string() }),
    handler: async ({ body, req }) => {
      const ip = 'buy:' + clientIp(req);
      if (!(await limiter.allowed(ip)))
        throw new HttpError(
          429,
          'too_many_requests',
          'Too many checkouts from this address; try again in a quarter of an hour',
        );
      await limiter.fail(ip);
      const e = env();
      const key = e['STRIPE_SECRET_KEY'];
      const price = priceOf(e, body.plan);
      if (!sells(e) || !key || !price)
        throw new HttpError(409, 'conflict', 'This server does not sell licences');
      const problem = purchaseProblem(body.plan, body.seats);
      if (problem) throw new HttpError(400, 'invalid_request', problem);
      const company = body.company.trim();
      if (!company) throw new HttpError(400, 'invalid_request', 'Name the company');
      const orderId = randomUUID();
      const base = (e['ORQIVA_PUBLIC_URL'] ?? '').replace(/\/$/, '');
      const meta = {
        kind: 'selfhosted',
        order: orderId,
        plan: body.plan,
        seats: body.seats,
        company,
      };
      const res = await fetchImpl()('https://api.stripe.com/v1/checkout/sessions', {
        method: 'POST',
        headers: {
          authorization: 'Bearer ' + key,
          'content-type': 'application/x-www-form-urlencoded',
          'idempotency-key': orderId,
        },
        body: stripeForm({
          mode: 'subscription',
          'line_items[0][price]': price,
          'line_items[0][quantity]': body.seats,
          success_url: base + '/buy/done?session={CHECKOUT_SESSION_ID}',
          cancel_url: base + '/buy?plan=' + body.plan,
          customer_email: body.email,
          billing_address_collection: 'required',
          tax_id_collection: { enabled: true },
          metadata: meta,
          subscription_data: { metadata: meta },
        }),
        signal: AbortSignal.timeout(20_000),
      });
      const out = (await res.json()) as { id?: string; url?: string; error?: { message?: string } };
      if (!res.ok || !out.url || !SESSION.test(out.id ?? ''))
        throw new HttpError(
          409,
          'conflict',
          'Stripe refused the checkout: ' + (out.error?.message ?? String(res.status)),
        );
      await inSystem(pool, (c) =>
        c.query(
          `INSERT INTO licence_orders (id, checkout_session, company, email, plan, seats)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [orderId, out.id, company, body.email, body.plan, body.seats],
        ),
      );
      return { body: { url: out.url } };
    },
  });

  const order = route({
    method: 'GET',
    path: '/buy/orders/:session',
    summary:
      'A self-hosted order by its Checkout session: its state and, once paid, the licence key (public, by the session id)',
    tags: ['billing'],
    params: s.object({ session: s.string({ max: 260 }) }),
    response: s.object({
      status: s.string(),
      plan: s.string(),
      seats: s.number({ integer: true }),
      company: s.string(),
      email: s.string(),
      licence: s.nullable(s.string()),
      paidUntil: s.nullable(s.string()),
    }),
    handler: async ({ params }) => {
      if (!SESSION.test(params.session)) throw new HttpError(404, 'not_found', 'No such order');
      const row = await inSystem(
        pool,
        async (c) =>
          (
            await c.query<OrderRow>(
              `SELECT id, company, email, plan, seats, status, licence, current_period_end, stripe_subscription_id
                 FROM licence_orders WHERE checkout_session = $1`,
              [params.session],
            )
          ).rows[0],
      );
      if (!row) throw new HttpError(404, 'not_found', 'No such order');
      return {
        body: {
          status: row.licence ? row.status : 'pending',
          plan: row.plan,
          seats: row.seats,
          company: row.company,
          email: row.email,
          licence: row.licence,
          paidUntil: row.current_period_end?.toISOString() ?? null,
        },
      };
    },
  });

  return [offers, checkout, order];
}
