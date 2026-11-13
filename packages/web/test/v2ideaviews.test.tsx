// ── [PCODE-274 | S15 | v0.1.0] T28.3 Stories with Given/When/Then and personas; value/effort matrix, evidence library, compare ──
//    Why:  stories grouped by persona with the ones without last, matrix points in their quadrant, the
//          compare rows, and the stories tab drawn with its scenarios.
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { IdeaWorkspace } from '../src/v2/ideation.js';
import { compareRows, matrixPoint, Stories, storiesByPersona } from '../src/v2/ideaviews.js';

const req = (over: Record<string, unknown>) => ({
  id: 'r',
  code: 'R-1',
  kind: 'story',
  text: 'As a driver, I want quiet.',
  status: 'accepted',
  area: 'users',
  sourceId: null,
  passage: '',
  priority: 'should',
  ...over,
});

const ws = (over: Partial<IdeaWorkspace> = {}): IdeaWorkspace => ({
  idea: {
    id: 'i1',
    ref: 'BKG-I1',
    title: 'Reminders',
    body: '',
    status: 'new',
    interviewDone: false,
    summary: '',
    createdBy: null,
    createdAt: '2026-10-12T00:00:00Z',
    messageCount: 0,
    rejectedReason: '',
    mergedIntoId: null,
    lastActivityAt: '2026-10-12T00:00:00Z',
  } as IdeaWorkspace['idea'],
  sources: [],
  requirements: [],
  questions: [],
  risks: [],
  assumptions: [],
  scores: [],
  coverage: { problem: 100, users: 50 },
  decisions: [],
  ...over,
});

describe('ideation views', () => {
  it('groups stories by persona, the ones without one last, rejected left out', () => {
    const g = storiesByPersona([
      req({ id: '1', personaName: 'Dispatcher' }),
      req({ id: '2' }),
      req({ id: '3', personaName: 'Customer' }),
      req({ id: '4', personaName: 'Customer', status: 'rejected' }),
      req({ id: '5', kind: 'functional', personaName: 'Customer' }),
    ]);
    expect(g.map((x) => [x.persona, x.stories.map((s) => s.id)])).toEqual([
      ['Customer', ['3']],
      ['Dispatcher', ['1']],
      ['', ['2']],
    ]);
  });

  it('places value up and effort right', () => {
    expect(matrixPoint(10, 1, 420, 36)).toEqual({ x: 36, y: 36 });
    expect(matrixPoint(1, 10, 420, 36)).toEqual({ x: 384, y: 384 });
  });

  it('compares two ideas row by row', () => {
    const a = ws({
      scores: [
        {
          method: 'value_effort',
          count: 2,
          mean: 4,
          min: 3,
          max: 5,
          spread: 0.5,
          mine: null,
          scorers: [],
        },
      ],
      requirements: [
        req({ kind: 'functional' }),
        req({ kind: 'story' }),
        req({ kind: 'story', status: 'rejected' }),
      ] as IdeaWorkspace['requirements'],
      risks: [
        {
          id: 'k',
          text: 'Carriers stop',
          likelihood: 3,
          impact: 4,
          exposure: 12,
          mitigation: '',
          ownerName: null,
          status: 'open',
        },
      ],
    });
    const b = ws({ idea: { ...ws().idea, status: 'approved' } });
    const rows = compareRows(a, { ...b, requests: [] });
    expect(rows.find((r) => r.label === 'Status')).toEqual({
      label: 'Status',
      left: 'new',
      right: 'approved',
    });
    expect(rows.find((r) => r.label === 'Value/effort')?.left).toBe('4 (2)');
    expect(rows.find((r) => r.label === 'Requirements')?.left).toBe('2 (1 functional, 1 story)');
    expect(rows.find((r) => r.label === 'Top risk')?.left).toBe('Carriers stop (12)');
    expect(rows.find((r) => r.label === 'Coverage')?.left).toBe('75 %');
  });

  it('draws the stories with their scenarios', () => {
    const html = renderToString(
      <Stories
        ws={ws({
          requirements: [
            req({
              personaName: 'Customer',
              scenarios: [{ given: 'a booking tomorrow', when: '18:00', then: 'an SMS goes out' }],
            }),
          ] as IdeaWorkspace['requirements'],
        })}
        edit
        call={() => Promise.resolve(true)}
      />,
    );
    expect(html).toContain('Customer');
    expect(html).toContain('an SMS goes out');
    expect(html).toContain('Copy as Gherkin');
    expect(html).toContain('Add story');
  });
});
