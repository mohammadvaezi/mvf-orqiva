// ── [PCODE-292 | S15 | v0.1.0] T30.6 Handoff specs per mockup: tokens, components, states, breakpoints, measures, export areas ──
//    Why:  two clicks on the image become a straight measure or an export area, and the export links
//          name the version and format.
import { describe, expect, it } from 'vitest';
import { areaFrom, exportUrl, snapMeasure } from '../src/v2/handoff.js';

describe('handoff on the image', () => {
  it('snaps measures, orders area corners and links the export', () => {
    // wider than tall in pixels: runs across, even on a tall image share-wise
    expect(snapMeasure({ x: 0.1, y: 0.1 }, { x: 0.3, y: 0.15 }, 1000, 1000)).toEqual({
      x: 0.3,
      y: 0.1,
    });
    expect(snapMeasure({ x: 0.1, y: 0.1 }, { x: 0.12, y: 0.3 }, 1000, 1000)).toEqual({
      x: 0.1,
      y: 0.3,
    });
    expect(snapMeasure({ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }, 400, 2000)).toEqual({
      x: 0.1,
      y: 0.2,
    });
    expect(areaFrom({ x: 0.6, y: 0.5 }, { x: 0.2, y: 0.1 })).toEqual({
      x: 0.2,
      y: 0.1,
      w: 0.4,
      h: 0.4,
    });
    expect(exportUrl('w', 'm', 3, 'md')).toBe(
      '/api/workspaces/w/mockups/m/handoff/export?version=3&format=md',
    );
  });
});
