// ── [PCODE-219 | S15 | v0.1.0] T20.2 Pricing and self-serve purchase for self-hosted customers (offers, buy flow, licence orders, plan enforcement) ──
//    Why:  the exit test of self-serve purchase, against a fake Stripe: offers, a checkout without an
//          account, the paid webhook signing a licence, the order page showing it, the licence installed
//          on a self-hosted workspace, a renewal issuing the next key; and the plan rules enforced.
import { createHmac, randomUUID } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { purchaseProblem } from '@orqiva/shared';
import { sells } from '../../src/api/buy.js';
import { verifyLicence } from '../../src/licence/licence.js';
import { CERT } from '../samlbuilder.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { installLicence, TEST_SIGNING_KEY } from './licencehelper.js';
import { hasDatabase } from './testdb.js';

const SECRET = 'whsec_test_' + 'b'.repeat(24);
const sign = (body: string): string => {
  const t = Math.floor(Date.now() / 1000);
  return (
    't=' +
    String(t) +
    ',v1=' +
    createHmac('sha256', SECRET)
      .update(String(t) + '.' + body)
      .digest('hex')
  );
};

describe('offers', () => {
  it('know their seat ranges and which plans are bought online', () => {
    expect(purchaseProblem('team', 5)).toBe('');
    expect(purchaseProblem('team', 2)).toBe('Team starts at 3 seats');
    expect(purchaseProblem('team', 26)).toBe('Team goes up to 25 seats; choose a larger plan');
    expect(purchaseProblem('enterprise', 200)).toBe(
      'This plan cannot be bought online; contact us for it',
    );
    expect(sells({})).toBe(false);
  });
});

describe.skipIf(!hasDatabase)('self-serve purchase (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let eve: Person;
  const sent: { url: string; body: string }[] = [];
  const keyFile = join(mkdtempSync(join(tmpdir(), 'orq-buy-')), 'vendor.pem');
  writeFileSync(keyFile, TEST_SIGNING_KEY);
  const env: Record<string, string | undefined> = {
    STRIPE_SECRET_KEY: 'sk_test_' + 'y'.repeat(20),
    STRIPE_WEBHOOK_SECRET: SECRET,
    STRIPE_PRICE_TEAM: 'price_team_1',
    ORQIVA_PUBLIC_URL: 'https://vendor.example',
    ORQIVA_LICENCE_SIGNING_KEY_FILE: keyFile,
  };
  const deliver = (event: Record<string, unknown>): Promise<Response> => {
    const body = JSON.stringify(event);
    return fetch(t.base + '/stripe/webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'stripe-signature': sign(body) },
      body,
    });
  };

  beforeAll(async () => {
    t = await startTestApp({
      billing: {
        env,
        fetchImpl: ((url: string, init?: RequestInit) => {
          sent.push({ url, body: init?.body as string });
          const id = 'cs_test_order_' + String(sent.length);
          return Promise.resolve(
            new Response(JSON.stringify({ id, url: 'https://checkout.stripe.com/c/pay/' + id })),
          );
        }) as typeof fetch,
      },
    });
    ada = await t.signup('Ada');
    eve = await t.signup('Eve');
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('shows the offers to anyone, with what this server sells', async () => {
    const r = await t.call<{
      sells: boolean;
      draft: boolean;
      offers: { plan: string; available: boolean; pricePerSeatMonth: number | null }[];
    }>(null, 'GET', '/buy/offers');
    expect(r.status).toBe(200);
    expect(r.body.sells).toBe(true);
    expect(r.body.offers.map((o) => [o.plan, o.available])).toEqual([
      ['free', false],
      ['team', true],
      ['business', false], // no Stripe price for it here
      ['enterprise', false],
    ]);
  });

  it('sells a Team licence: checkout, paid, key on the order page, installed, renewed', async () => {
    const r = await t.call<{ url: string }>(null, 'POST', '/buy/checkout', {
      plan: 'team',
      seats: 5,
      company: 'Acme GmbH',
      email: 'it@acme.example',
    });
    expect(r.status).toBe(200);
    const session = r.body.url.split('/').at(-1) ?? '';
    const form = new URLSearchParams(sent.at(-1)?.body);
    expect(form.get('line_items[0][price]')).toBe('price_team_1');
    expect(form.get('line_items[0][quantity]')).toBe('5');
    expect(form.get('success_url')).toBe(
      'https://vendor.example/buy/done?session={CHECKOUT_SESSION_ID}',
    );
    expect(form.get('customer_email')).toBe('it@acme.example');
    expect(form.get('metadata[kind]')).toBe('selfhosted');
    const orderId = form.get('subscription_data[metadata][order]') ?? '';
    expect(orderId).toMatch(/^[0-9a-f-]{36}$/);

    const pending = await t.call<{ status: string; licence: string | null }>(
      null,
      'GET',
      '/buy/orders/' + session,
    );
    expect(pending.body).toMatchObject({ status: 'pending', licence: null });

    expect(
      (
        await deliver({
          id: 'evt_' + randomUUID(),
          type: 'checkout.session.completed',
          data: {
            object: {
              id: session,
              payment_status: 'paid',
              customer: 'cus_1',
              subscription: 'sub_acme',
              metadata: { kind: 'selfhosted', order: orderId },
            },
          },
        })
      ).status,
    ).toBe(200);
    const paid = await t.call<{ status: string; licence: string; paidUntil: string }>(
      null,
      'GET',
      '/buy/orders/' + session,
    );
    expect(paid.body.status).toBe('active');
    const lic = verifyLicence(paid.body.licence);
    expect('licence' in lic && lic.licence).toMatchObject({
      customer: 'Acme GmbH',
      email: 'it@acme.example',
      plan: 'team',
      seats: 5,
      features: [],
    });

    // the customer pastes it into their own server
    const installed = await t.call<{ plan: string; seats: number; status: string }>(
      ada,
      'PUT',
      '/api/workspaces/' + ada.workspaceId + '/licence',
      { token: paid.body.licence },
    );
    expect(installed.body).toMatchObject({ plan: 'team', seats: 5, status: 'active' });

    // a year later the renewal is paid: the next key, valid to the new period and 14 days more
    const end = Math.floor(Date.UTC(2028, 9, 10) / 1000);
    const renewal = {
      id: 'evt_' + randomUUID(),
      type: 'invoice.paid',
      data: {
        object: {
          subscription: 'sub_acme',
          amount_paid: 114000,
          currency: 'eur',
          lines: { data: [{ period: { end }, metadata: { order: orderId } }] },
        },
      },
    };
    await deliver(renewal);
    await deliver(renewal); // Stripe may deliver twice
    const renewed = await t.call<{ licence: string; paidUntil: string }>(
      null,
      'GET',
      '/buy/orders/' + session,
    );
    expect(renewed.body.paidUntil).toBe(new Date(end * 1000).toISOString());
    const next = verifyLicence(renewed.body.licence);
    expect('licence' in next && next.licence.expires).toBe(
      new Date((end + 14 * 86_400) * 1000).toISOString(),
    );

    await deliver({
      id: 'evt_' + randomUUID(),
      type: 'invoice.payment_failed',
      data: { object: { subscription: 'sub_acme' } },
    });
    expect(
      (await t.call<{ status: string }>(null, 'GET', '/buy/orders/' + session)).body.status,
    ).toBe('past_due');
  });

  it('refuses what cannot be bought online, unknown orders, and too many checkouts', async () => {
    const buy = (plan: string, seats: number) =>
      t.call<{ error: { message: string } }>(null, 'POST', '/buy/checkout', {
        plan,
        seats,
        company: 'Acme GmbH',
        email: 'it@acme.example',
      });
    expect((await buy('team', 2)).body.error.message).toBe('Team starts at 3 seats');
    expect((await buy('business', 20)).status).toBe(409);
    expect((await buy('enterprise', 200)).status).toBe(400);
    expect((await t.call(null, 'GET', '/buy/orders/cs_unknown_12345678')).status).toBe(404);
    expect((await t.call(null, 'GET', '/buy/orders/not-a-session')).status).toBe(404);
    const statuses: number[] = [];
    for (let i = 0; i < 8; i++) statuses.push((await buy('team', 3)).status);
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThan(0);
    expect(statuses.every((s) => s === 200 || s === 429)).toBe(true);
  });

  it('keeps SAML and SCIM for licences that include them', async () => {
    const W = (p: string): string => '/api/workspaces/' + eve.workspaceId + p;
    const saml = {
      idpEntityId: 'https://idp.example/eve',
      ssoUrl: 'https://idp.example/sso',
      certificate: CERT,
      domains: ['eve.example'],
      defaultRole: 'member',
      enabled: true,
    };
    const refused = await t.call<{ error: { message: string } }>(eve, 'PUT', W('/saml'), saml);
    expect(refused.status).toBe(403);
    expect(refused.body.error.message).toContain('Enterprise plan');
    expect((await t.call(eve, 'POST', W('/scim/tokens'), { name: 'Entra' })).status).toBe(403);
    // switching it off never needs a licence
    expect((await t.call(eve, 'PUT', W('/saml'), { ...saml, enabled: false })).status).toBe(200);

    await installLicence(t, eve, { plan: 'business' });
    expect((await t.call(eve, 'POST', W('/scim/tokens'), { name: 'Entra' })).status).toBe(403);
    await installLicence(t, eve, { plan: 'business', features: ['scim'] });
    expect((await t.call(eve, 'POST', W('/scim/tokens'), { name: 'Entra' })).status).toBe(201);
    await installLicence(t, eve);
    expect((await t.call(eve, 'PUT', W('/saml'), saml)).status).toBe(200);
  });
});
