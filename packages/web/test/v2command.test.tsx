// ── [PCODE-210 | S15 | v0.1.0] T18.2 Command center screen: lanes with people and agents, heatmap, alerts, 24 h replay slider (design preview and live) ──
//    Why:  going back in time undoes later moves and creations, brings back cards that have moved on, and
//          counts each lane's activity per hour; the view shows lanes, faces, heatmap and alerts.
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SAMPLE_COMMAND } from '../src/preview/command.js';
import { CommandView, cardsAt, hourly, type CcEvent, type CcProject } from '../src/v2/command.js';

const NOW = Date.parse('2026-10-09T15:00:00Z');
const at = (h: number): string => new Date(NOW - h * 3_600_000).toISOString();
const project: CcProject = {
  id: 'p',
  key: 'APP',
  name: 'App',
  client: null,
  phase: null,
  gates: [],
  health: 'on-track',
  reasons: [],
  heat: {},
  counts: { open: 0, inProgress: 2, doneThisWeek: 0 },
  cards: [
    {
      id: 'a',
      ref: 'APP-1',
      title: 'Old card',
      state: 'In Progress',
      assignee: null,
      agents: [],
      updatedAt: at(10),
    },
    {
      id: 'b',
      ref: 'APP-2',
      title: 'New card',
      state: 'In Progress',
      assignee: null,
      agents: [],
      updatedAt: at(1),
    },
  ],
};
const ev = (
  seq: number,
  h: number,
  objectId: string,
  verb: string,
  state: CcEvent['state'],
  label = '',
): CcEvent => ({
  sequence: seq,
  at: at(h),
  projectId: 'p',
  object: 'item',
  objectId,
  label,
  verb,
  actor: 'Ada',
  actorKind: 'user',
  state,
});
const events = [
  ev(1, 6, 'c', 'moved', { from: 'Todo', to: 'In Progress' }, 'APP-3 Moved on'),
  ev(2, 3, 'b', 'created', null),
  ev(3, 2, 'c', 'moved', { from: 'In Progress', to: 'Review' }, 'APP-3 Moved on'),
];

describe('the replay', () => {
  it('shows the cards as they were', () => {
    expect(cardsAt(project, events, NOW, ['In Progress']).map((c) => c.ref)).toEqual([
      'APP-1',
      'APP-2',
    ]);
    expect(
      cardsAt(project, events, NOW - 4 * 3_600_000, ['In Progress']).map((c) => c.ref),
    ).toEqual(['APP-1', 'APP-3']);
    expect(
      cardsAt(project, events, NOW - 8 * 3_600_000, ['In Progress']).map((c) => c.ref),
    ).toEqual(['APP-1']);
  });

  it('counts each lane per hour, oldest first', () => {
    const h = hourly(events, 'p', NOW);
    expect(h).toHaveLength(24);
    expect(h[23 - 6]).toBe(1);
    expect(h.reduce((a, b) => a + b, 0)).toBe(3);
  });
});

describe('the command center view', () => {
  it('shows lanes, faces, heatmap and alerts', () => {
    const html = renderToString(
      <CommandView
        data={SAMPLE_COMMAND}
        events={[]}
        people={[]}
        now={NOW}
        at={null}
        onAt={() => undefined}
        agentsRunning={4}
      />,
    ).replace(/<!-- -->/g, '');
    expect(html).toContain('Command center');
    expect(html).toContain('1 critical');
    expect(html).toContain('4 agents at work');
    expect(html).toContain('NWL-212');
    expect(html).toContain('v2-cc-face--agent');
    expect(html).toContain('SMS gateway: 30 % of messages failing');
    expect(html).toContain('1 SEV-1/2 incident open');
    expect(html).toContain('live');
  });
});
