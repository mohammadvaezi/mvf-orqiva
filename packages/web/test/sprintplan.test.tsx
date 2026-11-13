// ── [PCODE-128 | S15 | v0.1.0] Add capacity, velocity and the sprint planning agent ──
import { describe, expect, it } from 'vitest';
import { loadText } from '../src/sprintplan.js';

describe('sprint load', () => {
  it('reads against capacity, or velocity when no capacity is set', () => {
    expect(loadText({ capacity: 12, committed: 9, velocity: 10 })).toBe(
      '9 of 12 points committed, 3 left',
    );
    expect(loadText({ capacity: 0, committed: 12, velocity: 10.4 })).toBe(
      '12 of 10 points committed, 2 over',
    );
    expect(loadText({ capacity: 0, committed: 4, velocity: null })).toBe(
      '4 points committed; set capacity to plan against it',
    );
  });
});
