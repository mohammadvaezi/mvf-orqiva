// ── [PCODE-355 | S15 | v0.1.0] T35.4c Activity: query autocomplete, columns, group-by, drag to zoom, heat map ──
//    Why:  a row's grid follows the columns shown; the text always takes the rest.
import { describe, expect, it } from 'vitest';
import { rowGrid } from '../src/v2/activitypage.js';

describe('activity columns', () => {
  it('lays out the columns shown', () => {
    expect(rowGrid(['time', 'who', 'kind'])).toBe('52px 22px minmax(0, 1fr) 76px');
    expect(rowGrid([])).toBe('minmax(0, 1fr)');
    expect(rowGrid(['project', 'time'])).toBe('52px minmax(0, 1fr) 64px');
  });
});
