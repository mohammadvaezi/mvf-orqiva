// ── [PCODE-181 | S15 | v0.1.0] B5.2 Tokens and costs live: AI spend, budgets, prices, provider keys per project, access tokens with scopes, policy, leak revocation ──
import { describe, expect, it } from 'vitest';
import {
  findTokens,
  ipAllowed,
  isIpRule,
  scopeAllows,
  spendAnomalies,
  TOKEN_SHAPE,
} from '../src/tokens.js';

const t43 = 'A'.repeat(43);

describe('access tokens', () => {
  it('finds tokens of every kind in text and knows their shape', () => {
    const text =
      'my token pe_pat_' + t43 + ' and old pe_' + 'b'.repeat(43) + ', not pe_short or xpe_' + t43;
    expect(findTokens(text)).toEqual(['pe_pat_' + t43, 'pe_' + 'b'.repeat(43)]);
    expect(TOKEN_SHAPE.test('pe_svc_' + t43)).toBe(true);
    expect(TOKEN_SHAPE.test('pe_' + t43)).toBe(true);
    expect(TOKEN_SHAPE.test('pe_svc_' + t43 + 'x')).toBe(false);
    // [PCODE-192 | S15 | v0.1.0] new tokens start orq_; the old pe_ ones keep their meaning
    expect(TOKEN_SHAPE.test('orq_pat_' + t43)).toBe(true);
    expect(findTokens('a orq_svc_' + t43 + ' b')).toEqual(['orq_svc_' + t43]);
  });

  it('checks the IP allow-list', () => {
    expect(ipAllowed('10.0.4.7', [])).toBe(true);
    expect(ipAllowed('10.0.4.7', ['10.0.0.0/16'])).toBe(true);
    expect(ipAllowed('::ffff:10.0.4.7', ['10.0.0.0/16'])).toBe(true);
    expect(ipAllowed('10.1.4.7', ['10.0.0.0/16', '185.12.40.5'])).toBe(false);
    expect(ipAllowed('185.12.40.5', ['185.12.40.5'])).toBe(true);
    expect([
      isIpRule('10.0.0.0/16'),
      isIpRule('1.2.3.4'),
      isIpRule('::1'),
      isIpRule('10.0.0.0/40'),
      isIpRule('host'),
    ]).toEqual([true, true, true, false, false]);
  });

  it('lets scopes decide what a request may do', () => {
    expect(scopeAllows([], 'POST', true)).toBe(true);
    expect(scopeAllows(['read'], 'GET', false)).toBe(true);
    expect(scopeAllows(['read'], 'POST', false)).toBe(false);
    expect(scopeAllows(['read', 'loop'], 'POST', false)).toBe(true);
    expect(scopeAllows(['write'], 'PATCH', true)).toBe(false);
    expect(scopeAllows(['write', 'admin'], 'PATCH', true)).toBe(true);
  });

  it('finds days whose spend stands out', () => {
    expect(spendAnomalies([10, 12, 0, 11, 80, 9])).toEqual([4]);
    expect(spendAnomalies([0, 0, 5])).toEqual([]);
  });
});
