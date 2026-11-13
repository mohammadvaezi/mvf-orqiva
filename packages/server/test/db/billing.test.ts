// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-149 | S15 | v0.1.0] Bill through Stripe without its SDK: checkout, webhooks, licences ──
//    Why:  billing against the real database with Stripe faked: the request we send, the signatures we
//          accept, and the licence a payment buys (once, however often Stripe delivers the event).
import { createHmac, generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { stripeForm, verifyStripeSignature } from '../../src/api/billing.js';
import { useLicenceKeyForTests } from '../../src/licence/licence.js';
import { inSystem } from '../../src/db/pool.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

const SECRET = 'whsec_test_' + 'k'.repeat(24);
const signature = (body: string, t: number, secret = SECRET): string =>
  't=' +
  String(t) +
  ',v1=' +
  createHmac('sha256', secret)
    .update(String(t) + '.' + body)
    .digest('hex');

describe('Stripe signatures and forms', () => {
  const now = new Date('2026-10-04T12:00:00Z');
  const t = Math.floor(now.getTime() / 1000);
  it('accept only a fresh signature made with the secret', () => {
    const body = '{"id":"evt_1"}';
    expect(verifyStripeSignature(body, signature(body, t), SECRET, now)).toBe(true);
    expect(verifyStripeSignature(body, signature(body, t, 'whsec_other'), SECRET, now)).toBe(false);
    expect(verifyStripeSignature(body + ' ', signature(body, t), SECRET, now)).toBe(false);
    expect(verifyStripeSignature(body, signature(body, t - 301), SECRET, now)).toBe(false);
    expect(
      verifyStripeSignature(
        body,
        't=' + String(t) + ',v1=00,' + (signature(body, t).split(',')[1] ?? ''),
        SECRET,
        now,
      ),
    ).toBe(true);
    expect(verifyStripeSignature(body, '', SECRET, now)).toBe(false);
  });

  it('encode nested fields as Stripe reads them', () => {
    expect(stripeForm({ mode: 'subscription', metadata: { a: 1 }, items: [{ price: 'p' }] })).toBe(
      'mode=subscription&metadata%5Ba%5D=1&items%5B0%5D%5Bprice%5D=p',
    );
  });
});

describe.skipIf(!hasDatabase)('billing (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  const sent: { url: string; headers: Record<string, string>; body: string }[] = [];
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  const keys = generateKeyPairSync('ed25519');
  const keyFile = join(mkdtempSync(join(tmpdir(), 'pe-bill-')), 'vendor.pem');
  writeFileSync(keyFile, keys.privateKey.export({ type: 'pkcs8', format: 'pem' }));
  useLicenceKeyForTests(keys.publicKey.export({ type: 'spki', format: 'pem' }).toString());
  const env: Record<string, string | undefined> = {
    STRIPE_SECRET_KEY: 'sk_test_' + 'x'.repeat(20),
    STRIPE_WEBHOOK_SECRET: SECRET,
    STRIPE_PRICE_TEAM: 'price_team_1',
    ORQIVA_PUBLIC_URL: 'https://pe.example',
    ORQIVA_LICENCE_SIGNING_KEY_FILE: keyFile,
  };
  const deliver = async (event: Record<string, unknown>, sig?: string) => {
    const body = JSON.stringify(event);
    return fetch(t.base + '/stripe/webhook', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'stripe-signature': sig ?? signature(body, Math.floor(Date.now() / 1000)),
      },
      body,
    });
  };

  beforeAll(async () => {
    t = await startTestApp({
      billing: {
        env,
        fetchImpl: ((url: string, init?: RequestInit) => {
          sent.push({
            url,
            headers: init?.headers as Record<string, string>,
            body: init?.body as string,
          });
          return Promise.resolve(
            new Response(
              JSON.stringify({ id: 'cs_1', url: 'https://checkout.stripe.com/c/pay/cs_1' }),
            ),
          );
        }) as typeof fetch,
      },
    });
    ada = await t.signup('Ada');
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('starts a Checkout with the plan’s price, the seats and the workspace', async () => {
    const r = await t.call<{ url: string }>(ada, 'POST', W('/billing/checkout'), {
      plan: 'team',
      seats: 12,
    });
    expect(r.body.url).toBe('https://checkout.stripe.com/c/pay/cs_1');
    expect(sent[0]?.url).toBe('https://api.stripe.com/v1/checkout/sessions');
    expect(sent[0]?.headers['authorization']).toBe('Bearer ' + (env['STRIPE_SECRET_KEY'] ?? ''));
    const form = new URLSearchParams(sent[0]?.body);
    expect(form.get('line_items[0][price]')).toBe('price_team_1');
    expect(form.get('line_items[0][quantity]')).toBe('12');
    expect(form.get('client_reference_id')).toBe(ada.workspaceId);
    expect(form.get('metadata[seats]')).toBe('12');
    expect(
      (await t.call(ada, 'POST', W('/billing/checkout'), { plan: 'business', seats: 1 })).status,
    ).toBe(409);
  });

  it('issues the licence a payment buys, once, and refuses unsigned deliveries', async () => {
    const paid = {
      id: 'evt_paid_1',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_1',
          payment_status: 'paid',
          amount_total: 12000,
          currency: 'eur',
          customer: 'cus_1',
          subscription: 'sub_1',
          client_reference_id: ada.workspaceId,
          metadata: { workspace_id: ada.workspaceId, plan: 'team', seats: '12' },
        },
      },
    };
    expect((await deliver(paid, 't=1,v1=bad')).status).toBe(400);
    expect((await deliver(paid)).status).toBe(200);
    expect((await deliver(paid)).status).toBe(200);
    const lic = await t.call<{ status: string; plan: string; seats: number; source: string }>(
      ada,
      'GET',
      W('/licence'),
    );
    expect(lic.body).toMatchObject({
      status: 'active',
      plan: 'team',
      seats: 12,
      source: 'workspace',
    });
    const handled = await inSystem(
      t.db.pool,
      async (c) => (await c.query('SELECT 1 FROM billing_events')).rowCount,
    );
    expect(handled).toBe(1);

    const periodEnd = Math.floor(Date.parse('2027-01-01T00:00:00Z') / 1000);
    await deliver({
      id: 'evt_inv_1',
      type: 'invoice.paid',
      data: {
        object: {
          subscription: 'sub_1',
          amount_paid: 12000,
          currency: 'eur',
          hosted_invoice_url: 'https://invoice.stripe.com/i/1',
          lines: { data: [{ period: { end: periodEnd } }] },
        },
      },
    });
    const bill = await t.call<{
      account: { status: string; currentPeriodEnd: string };
      invoices: { amount: number; url: string }[];
    }>(ada, 'GET', W('/billing'));
    expect(bill.body.account).toMatchObject({
      status: 'active',
      currentPeriodEnd: '2027-01-01T00:00:00.000Z',
    });
    expect(bill.body.invoices).toEqual([
      expect.objectContaining({ amount: 12000, url: 'https://invoice.stripe.com/i/1' }),
    ]);
    const lic2 = await t.call<{ expires: string }>(ada, 'GET', W('/licence'));
    expect(lic2.body.expires).toBe('2027-01-04T00:00:00.000Z');

    await deliver({
      id: 'evt_fail_1',
      type: 'invoice.payment_failed',
      data: { object: { subscription: 'sub_1' } },
    });
    expect(
      (await t.call<{ account: { status: string } }>(ada, 'GET', W('/billing'))).body.account
        .status,
    ).toBe('past_due');
  });
});
