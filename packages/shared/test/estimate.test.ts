// ── [PCODE-252 | S15 | v0.1.0] T26.1 Estimation: units, async planning poker, suggestions from similar tasks, estimate vs actual ──
import { describe, expect, it } from 'vitest';
import {
  cardValue,
  estimateText,
  nearestCard,
  pokerSummary,
  similarity,
  suggestFrom,
  words,
} from '../src/index.js';

describe('estimates', () => {
  it('reads a number in the unit of the project', () => {
    expect(estimateText(5, 'points')).toBe('5 pt');
    expect(estimateText(8, 'hours')).toBe('8 h');
    expect(estimateText(5, 'tshirt')).toBe('L');
    expect(estimateText(4, 'tshirt')).toBe('L');
    expect(estimateText(null, 'points')).toBe('');
    expect(cardValue('M', 'tshirt')).toBe(3);
    expect(cardValue('?', 'points')).toBeNull();
    expect(cardValue('4', 'points')).toBeNull();
    expect(nearestCard(4, 'points')).toBe('5');
    expect(nearestCard(10, 'hours')).toBe('8');
  });

  it('sums up a round of poker', () => {
    expect(pokerSummary(['3', '5', '8', '?'], 'points')).toEqual({
      votes: 4,
      low: 3,
      high: 8,
      median: 5,
      agreed: false,
      suggested: '5',
    });
    expect(pokerSummary(['M', 'M'], 'tshirt')).toMatchObject({ agreed: true, suggested: 'M' });
    expect(pokerSummary(['?'], 'points')).toMatchObject({ median: null, suggested: null });
  });

  it('finds tasks that read alike and suggests from what they took', () => {
    const a = words('Export appointments to CSV for the accountant');
    expect(similarity(a, words('Export invoices to CSV for the accountant'))).toBeGreaterThan(0.5);
    expect(similarity(a, words('Redesign the login page'))).toBe(0);
    const similar = [
      { ref: 'A-1', title: '', estimate: 3, hours: 20, score: 0.8 },
      { ref: 'A-2', title: '', estimate: 5, hours: 16, score: 0.7 },
    ];
    expect(suggestFrom(similar, 'points', 6)).toEqual({ value: 3, basis: 'actual' });
    expect(suggestFrom(similar, 'hours', 6)).toEqual({ value: 16, basis: 'actual' });
    expect(
      suggestFrom(
        similar.map((x) => ({ ...x, hours: 0 })),
        'points',
        6,
      ),
    ).toEqual({ value: 5, basis: 'estimate' });
    expect(suggestFrom([], 'points', 6)).toEqual({ value: null, basis: 'none' });
  });
});
