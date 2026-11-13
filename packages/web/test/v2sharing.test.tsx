// ── [PCODE-264 | S15 | v0.1.0] T27.6 Canvas pictures and sharing: PNG and PDF with page fitting, read-only share link with iCal subscription ──
//    Why:  the picture of the Gantt stands on its own (names, bars, links, milestones, today, its colours
//          inside), lands on paper as asked (one page, or page wide across pages, never larger than life),
//          and a share link is recognised and turned into a page and a calendar address.
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PlanData } from '../src/v2/canvas.js';
import { fitPages, ganttSvg, printCss, scaledSvg } from '../src/v2/ganttpicture.js';
import { SharePanel, shareToken, shareUrls } from '../src/v2/sharing.js';

const plan: PlanData = {
  today: '2030-01-08',
  workingDays: ['mon', 'tue', 'wed', 'thu', 'fri'],
  start: '2030-01-07',
  finish: '2030-01-14',
  tasks: [
    {
      id: 'A',
      ref: 'APP-1',
      title: 'Design <&> build',
      kind: 'task',
      stateGroup: 'started',
      assigneeId: null,
      estimate: null,
      parentId: null,
      sprintId: null,
      startDate: null,
      dueDate: null,
      durationDays: 3,
      scheduleMode: 'auto',
    },
    {
      id: 'M',
      ref: 'APP-2',
      title: 'Go live',
      kind: 'milestone',
      stateGroup: 'unstarted',
      assigneeId: null,
      estimate: null,
      parentId: null,
      sprintId: null,
      startDate: null,
      dueDate: null,
      durationDays: 0,
      scheduleMode: 'auto',
    },
  ],
  schedule: [
    {
      id: 'A',
      wbs: '1',
      level: 0,
      summary: false,
      milestone: false,
      start: '2030-01-07',
      finish: '2030-01-09',
      durationDays: 3,
      percentDone: 50,
      totalFloat: 0,
      critical: true,
      violations: [],
    },
    {
      id: 'M',
      wbs: '2',
      level: 0,
      summary: false,
      milestone: true,
      start: '2030-01-14',
      finish: '2030-01-14',
      durationDays: 0,
      percentDone: 0,
      totalFloat: 0,
      critical: true,
      violations: [],
    },
  ],
  dependencies: [{ id: 'd', predecessorId: 'A', successorId: 'M', kind: 'FS', lagDays: 0 }],
  cycle: [],
  ignored: [],
  baseline: null,
  scenario: null,
};

describe('the picture', () => {
  it('is one standalone SVG with names, bars, the link, the milestone and today', () => {
    const p = ganttSvg(plan, { zoom: 'day', title: 'App plan', critical: true });
    expect(p.svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(p.svg).toContain('Design &lt;&amp;&gt; build');
    expect(p.svg).toContain('App plan');
    expect(p.svg).toContain('stroke-dasharray="4 3"');
    expect(p.svg).toContain('l7 7 -7 7 -7 -7z');
    expect(p.svg).not.toContain('var(--');
    expect(p.height).toBe(34 + 40 + 2 * 24 + 10);
    expect(p.width).toBeGreaterThan(300);
  });

  it('fits the page: one page, or page wide over pages down, never above life size', () => {
    // A4 landscape printable: 277 × 190 mm = 1047 × 718 px
    const one = fitPages(2094, 718, 'a4', 'landscape', 'page');
    expect(one.scale).toBeCloseTo(0.5, 2);
    expect(one.pages).toBe(1);
    const wide = fitPages(2094, 3000, 'a4', 'landscape', 'width');
    expect(wide.scale).toBeCloseTo(0.5, 2);
    expect(wide.pages).toBe(3);
    expect(fitPages(400, 300, 'a3', 'portrait', 'page').scale).toBe(1);
    expect(printCss('a3', 'landscape')).toContain('@page { size: A3 landscape; margin: 10mm; }');
    expect(printCss('a4', 'portrait')).toContain(
      'body > *:not(#pv-print) { display: none !important; }',
    );
    expect(
      scaledSvg(
        { svg: '<svg xmlns="x" width="2094" height="718"></svg>', width: 2094, height: 718 },
        0.5,
      ),
    ).toBe('<svg xmlns="x" width="1047" height="359"></svg>');
  });
});

describe('share links', () => {
  it('knows a share path and makes the page and calendar addresses', () => {
    expect(shareToken('/share/plan/abcDEF123_-abcDEF123_-xyz')).toBe('abcDEF123_-abcDEF123_-xyz');
    expect(shareToken('/share/plan/short')).toBeNull();
    expect(shareToken('/projects/x/canvas')).toBeNull();
    expect(shareUrls('https://orqiva.example', 'TOKEN')).toEqual({
      page: 'https://orqiva.example/share/plan/TOKEN',
      calendar: 'webcal://orqiva.example/api/share/plan/TOKEN/ics',
    });
  });

  it('offers to make a link with a name and an end', () => {
    const html = renderToString(
      <SharePanel workspaceId="w" projectId="p" onClose={() => undefined} />,
    );
    expect(html).toContain('aria-label="Name of the link"');
    expect(html).toContain('aria-label="Ends on"');
    expect(html).toContain('no people, comments or code');
  });
});
