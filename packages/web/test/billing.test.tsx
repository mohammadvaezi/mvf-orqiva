// ── [PCODE-149 | S15 | v0.1.0] Bill through Stripe without its SDK: checkout, webhooks, licences ──
import { describe, expect, it } from 'vitest';
import { money, STATUS_TEXT } from '../src/billing.js';
import { appRoute } from '../src/core/nav.js';

describe('the billing settings', () => {
  it('have their own address, and show money as Stripe counts it', () => {
    expect(appRoute('/settings/billing')).toEqual({ kind: 'settings', section: 'billing' });
    expect(money(12000, 'eur')).toBe('120.00 EUR');
    expect(money(null, null)).toBe('—');
    expect(STATUS_TEXT['over_seats']).toBe('Over the seat count');
  });
});
