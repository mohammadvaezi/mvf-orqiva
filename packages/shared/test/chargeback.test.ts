// ── [PCODE-328 | S15 | v0.1.0] T33.1b Cost estimate before a run, chargeback per client and cost centre, unit costs ──
//    Why:  the estimate takes the middle half of the agent's finished runs, or a rough figure with a wide
//          range when there are too few; the chargeback file reads in a spreadsheet; a result's cost is
//          only given when something was finished.
import { describe, expect, it } from 'vitest';
import { chargebackCsv, perUnit, roughRunTokens, runEstimate } from '../src/chargeback.js';

describe('run estimate', () => {
  it('takes the quartiles of enough finished runs', () => {
    expect(runEstimate([400, 100, 300, 200, 500], 9999)).toEqual({
      low: 200,
      mid: 300,
      high: 400,
      basis: 'history',
      runs: 5,
    });
  });

  it('falls back to the rough figure, halved and doubled, with too few runs', () => {
    expect(runEstimate([100, 200], 1000)).toEqual({
      low: 500,
      mid: 1000,
      high: 2000,
      basis: 'rough',
      runs: 2,
    });
  });

  it('counts a few turns that each read what came before', () => {
    const r = roughRunTokens(4000);
    // (1000 + 1500) × 4 + 800 × (0 + 1 + 2 + 3)
    expect(r).toEqual({ input: 10_000 + 4800, output: 1600 });
    expect(roughRunTokens(4000, 1).input).toBe(2500);
  });
});

describe('chargeback', () => {
  it('writes one row per group with euro and a byte order mark', () => {
    const csv = chargebackCsv('2026-10', 'cost centre', [
      { group: '4711 Product', projects: ['APP', 'WEB'], runs: 12, cents: 12345 },
      { group: '=cmd', projects: [], runs: 1, cents: 5 },
    ]);
    expect(csv.startsWith('﻿"Month","Cost centre","Projects","Runs","AI cost (EUR)"')).toBe(true);
    expect(csv).toContain('"2026-10","4711 Product","APP WEB","12","123.45"');
    // a cell a spreadsheet would run is defused
    expect(csv).toContain('"\'=cmd"');
  });

  it('gives a unit cost only when something was finished', () => {
    expect(perUnit(1000, 0)).toBeNull();
    expect(perUnit(1000, 3)).toBe(333);
  });
});
