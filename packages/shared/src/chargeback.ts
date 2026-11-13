// ── [PCODE-328 | S15 | v0.1.0] T33.1b Cost estimate before a run, chargeback per client and cost centre, unit costs ──
//    Why:  before a run, what it will likely cost: the agent's own finished runs say it best (their middle
//          half as the range); without enough of them a rough figure from the instruction and the price,
//          with a wide range and said so. After the month, who pays: the AI cost per client or cost centre
//          as a CSV the finance team can book, and what one result cost.
import { toCsv } from './activityquery.js';

export interface RunEstimate {
  /** millionths of a US dollar */
  low: number;
  mid: number;
  high: number;
  basis: 'history' | 'rough';
  /** the finished runs it is based on */
  runs: number;
}

/** Fewer finished runs than this and the estimate is rough. */
export const ESTIMATE_MIN_RUNS = 3;

const quantile = (sorted: readonly number[], q: number): number => {
  if (!sorted.length) return 0;
  const at = (sorted.length - 1) * q;
  const lo = Math.floor(at);
  const hi = Math.ceil(at);
  return Math.round((sorted[lo] ?? 0) + ((sorted[hi] ?? 0) - (sorted[lo] ?? 0)) * (at - lo));
};

/** From the costs of the agent's last finished runs, or the rough figure when there are too few. */
export function runEstimate(history: readonly number[], rough: number): RunEstimate {
  const sorted = [...history].filter((x) => Number.isFinite(x) && x >= 0).sort((a, b) => a - b);
  if (sorted.length >= ESTIMATE_MIN_RUNS)
    return {
      low: quantile(sorted, 0.25),
      mid: quantile(sorted, 0.5),
      high: quantile(sorted, 0.75),
      basis: 'history',
      runs: sorted.length,
    };
  return {
    low: Math.round(rough / 2),
    mid: Math.round(rough),
    high: Math.round(rough * 2),
    basis: 'rough',
    runs: sorted.length,
  };
}

/**
 * Tokens a run of a few turns reads and writes: each turn reads the prompt, the instruction and what came
 * before (about four characters a token), and writes a few hundred.
 */
export function roughRunTokens(promptChars: number, turns = 4): { input: number; output: number } {
  const base = Math.ceil(promptChars / 4) + 1500;
  let input = 0;
  for (let t = 0; t < turns; t++) input += base + t * 800;
  return { input, output: turns * 400 };
}

export interface ChargebackRow {
  /** client, cost centre or project */
  group: string;
  projects: string[];
  runs: number;
  cents: number;
}

/** The month's chargeback as CSV, with a byte order mark so Excel reads umlauts. */
export function chargebackCsv(
  month: string,
  by: 'client' | 'cost centre' | 'project',
  rows: readonly ChargebackRow[],
): string {
  const head = ['Month', by === 'client' ? 'Client' : by === 'project' ? 'Project' : 'Cost centre'];
  return (
    '﻿' +
    toCsv([
      [...head, 'Projects', 'Runs', 'AI cost (EUR)'],
      ...rows.map((r) => [
        month,
        r.group,
        r.projects.join(' '),
        String(r.runs),
        (r.cents / 100).toFixed(2),
      ]),
    ])
  );
}

/** Cents per result, or null when nothing was finished. */
export const perUnit = (cents: number, units: number): number | null =>
  units > 0 ? Math.round(cents / units) : null;
