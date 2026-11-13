// ── [PCODE-308 | S15 | v0.1.0] T31.8a Code map by feature, sprint and version, and its time-lapse ──
//    Why:  folders at a depth, a group's share of each folder, weeks that start on Monday with their sprint,
//          and the colour steps of the time-lapse.
import { describe, expect, it } from 'vitest';
import { folderAt, folderShares, intensity, timelineFrames, weekStart } from '../src/index.js';

describe('code map by work', () => {
  it('finds a path’s folder at a depth', () => {
    expect(folderAt('server/src/api/x.ts', 2)).toBe('server/src');
    expect(folderAt('server/x.ts', 3)).toBe('server');
    expect(folderAt('README.md', 2)).toBe('(root)');
  });

  it('says how much of each folder a group makes up', () => {
    const files = [
      { path: 'a/x.ts', lines: 30 },
      { path: 'a/y.ts', lines: 10 },
      { path: 'b/z.ts', lines: 0 },
    ];
    expect(folderShares(new Set(['a/x.ts', 'b/z.ts']), files, 1)).toEqual({ a: 0.75, b: 1 });
  });
});

describe('time-lapse', () => {
  // Wednesday 14 Oct 2026, noon
  const now = Date.UTC(2026, 9, 14, 12);
  it('starts weeks on Monday', () => {
    expect(new Date(weekStart(now)).toISOString().slice(0, 10)).toBe('2026-10-12');
  });

  it('counts changed files per folder, week by week, with the sprint', () => {
    const frames = timelineFrames(
      [
        { at: '2026-10-13T09:00:00Z', paths: ['web/a.ts', 'web/b.ts', 'server/c.ts'] },
        { at: '2026-10-06T09:00:00Z', paths: ['server/c.ts'] },
        { at: '2026-01-01T09:00:00Z', paths: ['old/x.ts'] },
      ],
      [{ name: 'Sprint 7', start: '2026-10-05', end: '2026-10-16' }],
      { weeks: 3, depth: 1, now },
    );
    expect(frames.map((f) => [f.start, f.commits, f.changes, f.sprint])).toEqual([
      ['2026-09-28', 0, {}, null],
      ['2026-10-05', 1, { server: 1 }, 'Sprint 7'],
      ['2026-10-12', 1, { web: 2, server: 1 }, 'Sprint 7'],
    ]);
  });

  it('colours in four steps', () => {
    expect([0, 1, 5, 10].map((n) => intensity(n, 10))).toEqual([0, 1, 2, 4]);
    expect(intensity(3, 0)).toBe(0);
  });
});
