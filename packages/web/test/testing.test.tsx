// ── [PCODE-138 | S15 | v0.1.0] Show tests, coverage and live runs in the web app ──
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { appRoute } from '../src/core/nav.js';
import { DraftDialog, TestState, runSummary, runTotal } from '../src/testing.js';

const ID = '11111111-1111-4111-8111-111111111111';
const text = (html: string): string => html.replace(/<!-- -->/g, '');

describe('test pages', () => {
  it('have their own addresses', () => {
    expect(appRoute('/projects/' + ID + '/tests')).toEqual({
      kind: 'project',
      id: ID,
      view: 'tests',
    });
    expect(appRoute('/test-runs/' + ID)).toEqual({ kind: 'test-run', id: ID });
  });

  it('read a run and a requirement in words', () => {
    const r = { passed: 12, failed: 1, skipped: 0, blocked: 0 };
    expect(runTotal(r)).toBe(13);
    expect(runSummary(r)).toBe('12 passed, 1 failed');
    expect(runSummary({ passed: 0, failed: 0, skipped: 0, blocked: 0 })).toBe('no results yet');
    expect(renderToString(<TestState state={null} />)).toContain('Not run');
    expect(renderToString(<TestState state="uncovered" />)).toContain('No test');
  });

  it('show the Tester agent’s drafts to accept, all chosen at first', () => {
    const html = text(
      renderToString(
        <DraftDialog
          drafts={[
            { criterionId: 'k1', title: 'Header row', steps: '1. Export', expected: 'One header' },
            { criterionId: null, title: 'Fast', steps: '', expected: '' },
          ]}
          onAccept={() => Promise.resolve(null)}
          onClose={() => undefined}
        />,
      ),
    );
    expect(html).toContain('Add 2 test cases');
    expect(html).toContain('Expected: One header');
  });
});
