// ── [PCODE-352 | S15 | v0.1.0] T35.3c Policies for approvals, budgets and data, with a dry run ──
//    Why:  a policy says which projects it is for.
import { describe, expect, it } from 'vitest';
import { policyScope } from '../src/v2/policies.js';

describe('policies page', () => {
  it('names the projects', () => {
    const ps = [
      { id: 'a', key: 'APP' },
      { id: 'b', key: 'OPS' },
    ];
    expect(policyScope([], ps)).toBe('all projects');
    expect(policyScope(['b', 'a'], ps)).toBe('OPS, APP');
    expect(policyScope(['x'], ps)).toBe('a removed project');
  });
});
