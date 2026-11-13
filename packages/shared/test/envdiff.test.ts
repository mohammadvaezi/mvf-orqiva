// ── [PCODE-307 | S15 | v0.1.0] T31.7 Environment config diff: variables, secrets, settings, flags and versions side by side ──
//    Why:  settings flatten to dotted keys; a secret compares by its hash but shows "set"; drift leaves out
//          what is meant to differ.
import { describe, expect, it } from 'vitest';
import { configDiff, driftText, flattenSettings, type ConfigEntry } from '../src/index.js';

const v = (name: string, value: string): ConfigEntry => ({
  area: 'variable',
  name,
  shown: value,
  compare: value,
});
const sec = (name: string, hash: string): ConfigEntry => ({
  area: 'secret',
  name,
  shown: 'set',
  compare: hash,
});

describe('environment config diff', () => {
  it('flattens settings to dotted keys', () => {
    expect(flattenSettings({ dir: '/srv', deploy: { replicas: 2, zone: 'eu' } })).toEqual([
      { name: 'deploy.replicas', value: '2' },
      { name: 'deploy.zone', value: '"eu"' },
      { name: 'dir', value: '"/srv"' },
    ]);
    expect(flattenSettings(null)).toEqual([]);
  });

  it('says same, different or only in one, secrets by their hash', () => {
    const rows = configDiff(
      [v('A', '1'), v('B', '1'), sec('S', 'h1'), sec('T', 'h1')],
      [v('A', '1'), v('B', '2'), v('C', '3'), sec('S', 'h2'), sec('T', 'h1')],
    );
    expect(rows.map((r) => [r.name, r.a, r.b, r.state])).toEqual([
      ['A', '1', '1', 'same'],
      ['B', '1', '2', 'different'],
      ['C', null, '3', 'only_b'],
      ['S', 'set', 'set', 'different'],
      ['T', 'set', 'set', 'same'],
    ]);
  });

  it('counts drift without what is meant to differ', () => {
    const rows = configDiff([v('A', '1'), v('B', '1')], [v('A', '2')], new Set(['variable:A']));
    expect(driftText(rows, 'Staging', 'Production')).toBe('1 only in Staging.');
    expect(driftText(configDiff([v('A', '1')], [v('A', '1')]), 'S', 'P')).toBe(
      'No drift between S and P.',
    );
  });
});
