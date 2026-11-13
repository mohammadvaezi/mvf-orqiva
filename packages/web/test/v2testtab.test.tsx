// ── [PCODE-177 | S15 | v0.1.0] B4.3 Test tab live in the web app: runs with matrix, steps, evidence, defects, repository, coverage, flaky, AI cases ──
//    Why:  the rules the Test tab rests on: runs planned together form one matrix, a case's result
//          follows from its steps, configurations are typed one per line, and the tab renders.
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EventHub } from '../src/core/hub.js';
import { caseStatus, groupRuns, parseConfigs, TestPage, type Run } from '../src/v2/testtab.js';

const run = (id: string, name: string, at: string): Run => ({
  id,
  projectId: 'p',
  name,
  source: 'manual',
  status: 'running',
  startedBy: 'Sara',
  startedAt: at,
  finishedAt: null,
  passed: 0,
  failed: 0,
  skipped: 0,
  blocked: 0,
});

describe('test tab', () => {
  it('groups the runs of one plan into one matrix', () => {
    const g = groupRuns([
      run('a', 'Regression (chrome · windows)', '2026-10-04T08:10:01Z'),
      run('b', 'Regression (firefox · windows)', '2026-10-04T08:10:02Z'),
      run('c', 'Regression', '2026-10-03T08:10:00Z'),
    ]);
    expect(g.map((x) => [x.name, x.runs.map((r) => r.id)])).toEqual([
      ['Regression', ['a', 'b']],
      ['Regression', ['c']],
    ]);
  });

  it('takes the case result from its steps', () => {
    expect(caseStatus(['passed', 'failed', 'untested'])).toBe('failed');
    expect(caseStatus(['passed', 'blocked'])).toBe('blocked');
    expect(caseStatus(['passed', 'untested'])).toBeNull();
    expect(caseStatus(['passed', 'skipped'])).toBe('passed');
    expect(caseStatus(['skipped'])).toBe('skipped');
    expect(caseStatus([])).toBeNull();
  });

  it('reads configurations one per line', () => {
    expect(parseConfigs('browser: chrome, os: windows\n\nbrowser: webkit\nnonsense')).toEqual([
      { browser: 'chrome', os: 'windows' },
      { browser: 'webkit' },
    ]);
  });

  it('renders its views with no inline style', () => {
    const html = renderToString(
      <TestPage
        workspaceId="w"
        projectId="p"
        hub={new EventHub()}
        canEdit
        canTest
        go={() => undefined}
      />,
    );
    for (const v of ['Runs', 'Repository', 'Coverage', 'Flaky', 'Bugs', 'AI cases'])
      expect(html).toContain(v);
    expect(html).not.toContain('style=');
  });
});
