// ── [PCODE-248 | S15 | v0.1.0] T25.3 Custom roles, role conditions and project roles enforced ──
import { describe, expect, it } from 'vitest';
import { conditionHolds, conditionsProblem, conditionText, permissionFor } from '../src/index.js';

const W = '/api/workspaces/11111111-1111-4111-8111-111111111111';

describe('the permission a request needs', () => {
  it('reads, money, and writes by area', () => {
    expect(permissionFor('GET', W + '/projects/p/items', 'guest')).toBe('read');
    expect(permissionFor('GET', W + '/ai-spend?month=2026-10', 'member')).toBe('money');
    expect(permissionFor('PATCH', W + '/items/i', 'member')).toBe('write');
    expect(permissionFor('POST', W + '/projects/p/test-runs', 'member')).toBe('test');
    expect(permissionFor('POST', W + '/projects/p/agent-runs', 'member')).toBe('agents');
    expect(permissionFor('POST', W + '/projects/p/releases', 'member')).toBe('ship');
    expect(permissionFor('PUT', W + '/members/u/custom-role', 'admin')).toBe('people');
    expect(permissionFor('PATCH', W + '/agents/a', 'admin')).toBe('agents-admin');
    expect(permissionFor('POST', W + '/owners', 'owner')).toBe('owners');
  });

  it('leaves searches and the person’s own things to the base role', () => {
    expect(permissionFor('POST', W + '/activity/search', 'member')).toBeNull();
    expect(permissionFor('POST', W + '/access-tokens', 'member')).toBeNull();
    expect(permissionFor('PATCH', W + '/inbox/x', 'guest')).toBeNull();
    expect(permissionFor('POST', W + '/unknown-admin-thing', 'admin')).toBeNull();
  });
});

describe('role conditions', () => {
  it('hold on their weekdays and hours', () => {
    const c = { weekdays: [1, 2, 3, 4, 5], hours: [8, 18] as [number, number] };
    expect(conditionText(c)).toBe('Mon–Fri 08:00–18:00');
    expect(conditionText({ weekdays: [1, 3] })).toBe('Mon, Wed');
    expect(conditionText({})).toBe('always');
    expect(conditionHolds(c, 1, 8)).toBe(true);
    expect(conditionHolds(c, 5, 17)).toBe(true);
    expect(conditionHolds(c, 5, 18)).toBe(false);
    expect(conditionHolds(c, 6, 10)).toBe(false);
  });

  it('say what is wrong with them', () => {
    expect(conditionsProblem({ ship: { weekdays: [1, 5], hours: [8, 18] } })).toBeNull();
    expect(conditionsProblem({ fly: {} })).toBe('There is no permission fly');
    expect(conditionsProblem({ ship: { weekdays: [0] } })).toMatch(/Weekdays/);
    expect(conditionsProblem({ ship: { hours: [18, 8] } })).toMatch(/Hours/);
  });
});
