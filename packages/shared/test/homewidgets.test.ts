// ── [PCODE-347 | S15 | v0.1.0] T35.1b Homes for developers and testers with widgets the person chooses ──
//    Why:  a person's own widgets win over the preset, unknown ones and repeats drop out; widgets move.
import { describe, expect, it } from 'vitest';
import { HOME_PRESETS, homeLayout, moveWidget } from '../src/homewidgets.js';

describe('home widgets', () => {
  it('uses the person’s choice, else the preset of their kind of home', () => {
    expect(homeLayout(null, 'tester')).toEqual([...HOME_PRESETS.tester]);
    expect(homeLayout([], 'developer')).toEqual([...HOME_PRESETS.developer]);
    expect(homeLayout(['reviews', 'nope', 'reviews', 'incidents', 3], 'developer')).toEqual([
      'reviews',
      'incidents',
    ]);
  });
  it('moves a widget up and down, not past the ends', () => {
    expect(moveWidget(['my-tasks', 'reviews', 'deploys'], 'deploys', -1)).toEqual([
      'my-tasks',
      'deploys',
      'reviews',
    ]);
    expect(moveWidget(['my-tasks', 'reviews'], 'my-tasks', -1)).toEqual(['my-tasks', 'reviews']);
    expect(moveWidget(['my-tasks'], 'reviews', 1)).toEqual(['my-tasks']);
  });
});
