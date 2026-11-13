// ── [PCODE-273 | S15 | v0.1.0] T28.2 Interview steered by coverage; handed-over questions notify their owner ──
// ── [PCODE-272 | S15 | v0.1.0] T28.1 Ideation intake: links read on the server, sources from the CLI and VS Code ──
// ── [PCODE-170 | S15 | v0.1.0] B3.3 Ideation live in the web app: ideas list, interview with coverage, sources, requirements, questions, risks, priority, decisions ──
//    Why:  the Ideation tab's rules: which ideas get the quiet nudge, the total coverage, score inputs that
//          match what the server accepts, and the frame before data arrives.
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EventHub } from '../src/core/hub.js';
import {
  AREA_LABEL,
  askedText,
  coverageTotal,
  ideaInQuery,
  IdeationPage,
  isStale,
  METHODS,
} from '../src/v2/ideation.js';
import { labelsText, linkText, sizeText } from '../src/v2/files.js';

describe('ideation', () => {
  it('nudges open ideas nobody touched for 30 days', () => {
    const now = Date.parse('2026-10-04T12:00:00Z');
    expect(isStale({ status: 'new', lastActivityAt: '2026-08-01T00:00:00Z' }, now)).toBe(true);
    expect(isStale({ status: 'approved', lastActivityAt: '2026-08-01T00:00:00Z' }, now)).toBe(
      false,
    );
    expect(isStale({ status: 'interviewing', lastActivityAt: '2026-09-30T00:00:00Z' }, now)).toBe(
      false,
    );
  });

  it('totals coverage over the eight areas', () => {
    expect(Object.keys(AREA_LABEL)).toHaveLength(8);
    expect(
      coverageTotal({
        problem: 100,
        users: 50,
        scope: 0,
        non_goals: 0,
        non_functional: 0,
        data: 0,
        integrations: 0,
        security: 50,
      }),
    ).toBe(25);
    expect(coverageTotal({})).toBe(0);
  });

  it('asks for the inputs the server scores', () => {
    expect(METHODS.map((m) => m.key)).toEqual(['rice', 'ice', 'wsjf', 'value_effort']);
    expect(METHODS.find((m) => m.key === 'rice')?.inputs.map((i) => i.key)).toEqual([
      'reach',
      'impact',
      'confidence',
      'effort',
    ]);
  });

  it('shows the ideas pane before data arrives', () => {
    const html = renderToString(
      <IdeationPage
        workspaceId="w"
        projectId="p"
        hub={new EventHub()}
        canEdit
        meId="u"
        go={() => undefined}
      />,
    ).replace(/<!-- -->/g, '');
    expect(html).toContain('<strong>Ideas</strong>');
    expect(html).toContain('>All<');
    expect(html).toContain('Loading…');
  });

  it('writes sizes the German way', () => {
    expect(sizeText(1_258_291)).toBe('1,2 MB');
    expect(sizeText(2048)).toBe('2 KB');
  });

  // [PCODE-272 | S15 | v0.1.0]
  it('says how a link read went, and names the empty sources', () => {
    expect(linkText(null)).toEqual({ text: '', failed: false });
    expect(linkText({ status: 'reading', error: '' }).text).toBe('being read');
    expect(linkText({ status: 'failed', error: 'example.com answered 404' })).toEqual({
      text: 'not read: example.com answered 404',
      failed: true,
    });
    expect(labelsText(['S2'])).toBe('S2');
    expect(labelsText(['S2', 'S3', 'S5'])).toBe('S2, S3 and S5');
  });

  // [PCODE-273 | S15 | v0.1.0]
  it('opens the idea and tab a link names, and counts the questions', () => {
    expect(ideaInQuery('?idea=i1&sub=questions')).toEqual({ idea: 'i1', sub: 'questions' });
    expect(ideaInQuery('?idea=i1&sub=nonsense')).toEqual({ idea: 'i1', sub: null });
    expect(ideaInQuery('')).toEqual({ idea: null, sub: null });
    expect(askedText(3, 12)).toBe('Question 3 of at most 12');
    expect(askedText(14, 12)).toBe('Question 12 of at most 12');
  });
});
