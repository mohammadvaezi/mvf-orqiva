// ── [PCODE-275 | S15 | v0.1.0] T28.4 PRD: templates per idea kind, citations per statement, version diff, MD, PDF and Word export ──
//    Why:  a citation's tooltip carries the passage, sections are saved in the template's order, and the
//          page draws citations as chips and a diff with insertions and deletions.
import type { ProposalContent } from '@orqiva/shared';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CitedText, citeTitle, PrdDiff, PrdExports, sectionsFrom } from '../src/prdparts.js';

const content: ProposalContent = {
  summary: 'Reminders the day before [R-1].',
  problem: 'Customers forget.',
  goals: ['Fewer no-shows'],
  scopeIn: [],
  scopeOut: [],
  risks: [],
  tasks: [{ title: 'Send SMS', estimate: 3, description: '' }],
};

describe('the PRD page parts', () => {
  it('shows the passage behind a citation, and says when a code is unknown', () => {
    expect(
      citeTitle(
        { code: 'R-1', text: 'A reminder', source: 'S1 Notes', passage: 'remind them' },
        'R-1',
      ),
    ).toBe('R-1: A reminder\nS1 Notes: “remind them”');
    expect(citeTitle(undefined, 'R-9')).toBe('R-9: not found in this idea');
  });

  it('saves the template sections in order, keeping older ones it does not name', () => {
    expect(
      sectionsFrom(
        [
          { key: 'steps', title: 'Steps to reproduce', hint: '' },
          { key: 'expected', title: 'Expected and actual', hint: '' },
        ],
        { expected: ' It sends ', steps: '' },
        [{ key: 'old', title: 'Old part', body: 'kept' }],
      ),
    ).toEqual([
      { key: 'expected', title: 'Expected and actual', body: 'It sends' },
      { key: 'old', title: 'Old part', body: 'kept' },
    ]);
  });

  it('draws citations as chips, a diff with insertions, and the exports', () => {
    const cited = renderToString(
      <CitedText
        text="Day before [R-1, R-7]."
        refs={[{ code: 'R-1', text: 'x', source: '', passage: '' }]}
      />,
    );
    expect(cited).toContain('class="pe-cite"');
    expect(cited).toContain('pe-cite--missing');
    const diff = renderToString(
      <PrdDiff
        from={{ version: 1, content }}
        to={{ version: 2, content: { ...content, goals: ['Fewer no-shows', 'Fewer calls'] } }}
      />,
    );
    expect(diff).toContain('1 part changed');
    expect(diff).toContain('<ins>Fewer calls</ins>');
    const ex = renderToString(<PrdExports workspaceId="w" ideaId="i" version={2} />);
    expect(ex).toContain('/api/workspaces/w/ideas/i/prd/export?version=2&amp;format=docx');
  });
});

// ── [PCODE-276 | S15 | v0.1.0] T28.5 Idea estimates: size, confidence range from estimate vs actual, basis from similar past tasks ──
describe('the estimate panel', () => {
  it('places low, likely and high on the bar, and draws the size and confidence', async () => {
    const { EstimatePanel, rangeBar } = await import('../src/prdparts.js');
    expect(rangeBar({ low: 10, likely: 15, high: 20 })).toEqual({
      left: 43.5,
      width: 43.5,
      mark: 65.2,
    });
    const html = renderToString(
      <EstimatePanel
        estimate={{
          version: 1,
          text: '',
          unit: 'points',
          range: {
            points: 12,
            size: 'M',
            low: 9,
            likely: 12,
            high: 19.2,
            lowDays: 2,
            likelyDays: 3,
            highDays: 4,
            confidence: 'low',
            basis: 'standard',
            history: 0,
          },
          tasks: [
            {
              title: 'Build',
              estimate: 2,
              suggested: 5,
              basis: 'actual',
              off: true,
              similar: [{ ref: 'APP-3', title: 'Build it', estimate: 3, hours: 30, score: 0.5 }],
            },
          ],
        }}
      />,
    );
    const text = html.replace(/<!-- -->/g, '');
    expect(html).toContain('>M<');
    expect(text).toContain('low confidence');
    expect(text).toContain('1 task is far from what similar tasks took');
  });
});
