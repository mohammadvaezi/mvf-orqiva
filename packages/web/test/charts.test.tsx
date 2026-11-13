// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-114 | S15 | v0.1.0] Add the Home dashboard and project overview with our own charts ──
import { describe as sentence, type ActivityEvent } from '@orqiva/shared';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Burndown, Donut, HBars, WeeklyBars, arc, ticks } from '../src/charts.js';

describe('chart arithmetic', () => {
  it('puts gridlines on round numbers that cover the largest value', () => {
    expect(ticks(0)).toEqual([0, 1]);
    expect(ticks(7)).toEqual([0, 2, 4, 6, 8]);
    expect(ticks(80)).toEqual([0, 20, 40, 60, 80]);
    expect(ticks(113)).toEqual([0, 50, 100, 150]);
  });

  it('draws a donut slice from the top, clockwise', () => {
    expect(arc(60, 60, 46, 0, Math.PI / 2)).toBe('M 60.00 14.00 A 46 46 0 0 1 106.00 60.00');
    expect(arc(60, 60, 46, 0, Math.PI * 1.5)).toContain(' 0 1 1 ');
  });
});

describe('charts', () => {
  it('donut: one arc per non-empty slice in its own colour, the centre figure, a legend and a data table', () => {
    const html = renderToString(
      <Donut
        title="Tasks by state"
        slices={[
          { label: 'Done', value: 3, color: '#16a34a' },
          { label: 'Review', value: 1, color: '#a855f7' },
          { label: 'Todo', value: 0, color: '#3f76ff' },
        ]}
        center="75%"
        centerLabel="done"
      />,
    );
    expect(html.match(/<path /g)).toHaveLength(2);
    expect(html).toContain('stroke="#16a34a"');
    expect(html).toContain('<title>Done: 3 (75%)</title>');
    expect(html).toContain('>75%</text>');
    expect(html).not.toContain('Todo');
    expect(html).toContain('<caption>Tasks by state</caption>');
  });

  it('weekly bars: two series per week with tooltips, and the numbers as a table', () => {
    const html = renderToString(
      <WeeklyBars
        title="Pace"
        weeks={[
          { week: '2026-09-21', created: 4, completed: 1 },
          { week: '2026-09-28', created: 2, completed: 5 },
        ]}
      />,
    );
    expect(html.match(/class="pe-series-1"/g)?.length).toBeGreaterThanOrEqual(2);
    expect(html).toContain(' 5 finished</title>');
    expect(html).toContain('<td>2026-09-28</td><td>2</td><td>5</td>');
    expect(html).toMatch(/Created<\/span><span class="pe-legend-value">6</);
  });

  it('burndown: the remaining line up to today, the ideal line, nothing drawn for future days', () => {
    const html = renderToString(
      <Burndown
        title="Sprint"
        total={4}
        days={[
          { date: '2026-10-01', remaining: 4 },
          { date: '2026-10-02', remaining: 3 },
          { date: '2026-10-03', remaining: null },
        ]}
      />,
    );
    expect(html.match(/class="pe-chart-point"/g)).toHaveLength(2);
    expect(html).toContain('class="pe-chart-ideal"');
    expect(html).toContain('<td>2026-10-03</td><td>–</td>');
  });

  it('horizontal bars: stacked parts scaled to the largest row, with links', () => {
    const html = renderToString(
      <HBars
        title="Projects"
        go={() => undefined}
        rows={[
          {
            label: 'APP',
            href: '/projects/a',
            parts: [
              { label: 'Open', value: 2 },
              { label: 'Done', value: 2 },
            ],
          },
          {
            label: 'OPS',
            parts: [
              { label: 'Open', value: 1 },
              { label: 'Done', value: 0 },
            ],
          },
        ]}
      />,
    );
    expect(html).toContain('href="/projects/a"');
    expect(html).toContain('width="50"');
    expect(html).toContain('width="25"');
    expect(html).toContain('>4</span>');
  });
});

describe('activity sentences', () => {
  it('say an import in one go', () => {
    const e = {
      sequence: 1,
      time: '2026-10-03T10:00:00Z',
      data: {
        actor: { kind: 'user', id: 'u', name: 'Dev Tester' },
        verb: 'updated',
        object: { type: 'project', id: 'p', label: 'PCODE Orqiva' },
        changes: { imported: { from: 'plane', to: { items: 112 } } },
      },
    } as unknown as ActivityEvent;
    expect(sentence(e)).toBe('Dev Tester imported PCODE Orqiva from Plane');
  });
});
