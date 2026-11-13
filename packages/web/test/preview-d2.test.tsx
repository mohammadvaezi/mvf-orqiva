// ── [PCODE-154 | S15 | v0.1.0] D2 preview: Ideation, Planning and Canvas ──
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CanvasTab, schedule } from '../src/preview/canvas.js';
import { GANTT, TASKS } from '../src/preview/data2.js';
import { IdeationTab } from '../src/preview/ideation.js';
import { PlanningTab } from '../src/preview/planning.js';
import { ProjectPage } from '../src/preview/projects.js';

const go = (): void => undefined;

describe('D2: Ideation, Planning and Canvas', () => {
  it('opens Ideation on the interview with coverage per area and sign-off one click away', () => {
    const html = renderToString(<IdeationTab pkey="NWL" />);
    expect(html).toContain('Customer self-service tracking');
    expect(html).toContain('Coverage');
    expect(html).toContain('Data and privacy');
    expect(html).toContain('Send for sign-off');
    expect(html).toContain('Continue in VS Code');
  });

  it('shows the sprint with its goal, scope at start and the board with WIP limits', () => {
    const html = renderToString(<PlanningTab pkey="HEL" />).replace(/<!-- -->/g, '');
    expect(html).toContain('Goal: Dispatchers can re-route a tour live');
    expect(html).toContain('Scope at start');
    expect(html).toContain('In Progress');
    // references take the project key
    expect(html).toContain('HEL-188');
    const sprint = TASKS.filter((t) => t.state !== 'Backlog');
    const done = sprint.filter((t) => t.state === 'Done').reduce((s, t) => s + (t.points ?? 0), 0);
    const scope = sprint.reduce((s, t) => s + (t.points ?? 0), 0);
    expect([done, scope]).toEqual([21, 35]);
  });

  it('draws the Gantt with critical path, baseline and commits', () => {
    const html = renderToString(<CanvasTab />);
    expect(html).toContain('pv-task-bar--crit');
    expect(html).toContain('pv-baseline');
    expect(html).toContain('pv-commit');
    expect(html).toContain('Pilot with 40 trucks');
  });

  it('moves successors when a task gets longer, and keeps summaries around their tasks', () => {
    const longer = schedule(GANTT.map((r) => (r.wbs === '2.2' ? { ...r, dur: r.dur + 5 } : r)));
    const at = (w: string) => longer.find((r) => r.wbs === w);
    expect(at('2.4')?.start).toBe(37);
    // the load test had float and stays; the G3 milestone waits for the later ETA work
    expect(at('4.1')?.start).toBe(38);
    expect(at('4.2')?.start).toBe(45);
    const live = at('2');
    expect(live?.start).toBe(12);
    expect((live?.start ?? 0) + (live?.dur ?? 0)).toBe(45);
  });

  it('puts the three tabs into every project', () => {
    for (const tab of ['ideation', 'planning', 'canvas'])
      expect(
        renderToString(<ProjectPage pkey="AUR" tab={tab} role="lead" go={go} />),
      ).not.toContain('Designed in step');
  });
});
