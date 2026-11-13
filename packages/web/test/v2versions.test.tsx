// ── [PCODE-206 | S15 | v0.1.0] T17.4 Release management in the web app: trains, environments with promote and rollback, notes approval, backport, go/no-go notes, changelog ──
// ── [PCODE-178 | S15 | v0.1.0] B4.4 Versions tab and Releases page live in the web app: pull requests, releases with go/no-go, notes, flags, DORA, overview ──
//    Why:  the go/no-go list is the decision a release is shipped on, so it must say exactly what holds;
//          dates and durations read the way the workspace writes them; the tab is there for the team.
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ProjectTabsV2 } from '../src/v2/projecttabs.js';
import { dateText, goNoGo, hoursText, stateText, type Release } from '../src/v2/versions.js';

const rel: Release = {
  id: 'r',
  version: '1.4.0',
  name: '',
  train: '',
  hotfixOf: null,
  state: 'planned',
  freezeAt: null,
  frozen: false,
  targetDate: null,
  notesTeam: '',
  notesClient: '',
  environmentName: null,
  releasedBy: null,
  releasedAt: null,
  items: 2,
  done: 1,
};
const item = (stateGroup: string) => ({
  id: stateGroup,
  ref: 'A-1',
  title: 't',
  kind: 'story',
  stateGroup,
  breaking: false,
  tests: 0,
  testsPassing: 0,
  testsFailing: 0,
  pullRequests: 0,
});

describe('versions', () => {
  it('lists what holds before a release ships', () => {
    const checks = goNoGo(
      {
        release: {
          ...rel,
          notesClient: 'x',
          notesTeam: 'y',
          notesApprovedBy: 'Mara',
          notesApprovedAt: '2026-10-09T09:50:00Z',
        },
        items: [item('completed'), item('started')],
        tests: { cases: 3, passing: 2, failing: 1, untested: 0 },
        findings: { critical: 0, high: 0, medium: 2, low: 0 },
        flags: [],
        suggested: '1.4.0',
        previous: null,
      },
      {
        passes: false,
        results: [{ policy: 'No high', violations: ['1 open high or worse finding'] }],
      },
    );
    expect(checks.map((c) => [c.label, c.ok])).toEqual([
      ['All tasks done or moved out', false],
      ['Tests', false],
      ['Security', true],
      ['Release notes approved', true],
      ['Release policies', false],
    ]);
    expect(checks[0]?.detail).toBe('1 of 2 done');
    expect(checks[4]?.detail).toBe('No high: 1 open high or worse finding');
  });

  it('writes dates, durations and states the way people read them', () => {
    expect(dateText('2026-10-13')).toBe('13.10.2026');
    expect(dateText(null)).toBe('—');
    expect([hoursText(0.5), hoursText(5.25), hoursText(72), hoursText(null)]).toEqual([
      '30 min',
      '5,3 h',
      '3 days',
      '—',
    ]);
    expect(stateText({ state: 'planned', frozen: true })).toBe('frozen');
    expect(stateText({ state: 'rolled_back', frozen: false })).toBe('rolled back');
  });

  it('has a Versions tab for the team, not for clients', () => {
    const id = '0b1f6a52-3c1e-4d7a-9a51-2f0f6c1d2e3a';
    const team = renderToString(
      <ProjectTabsV2
        projectId={id}
        view="versions"
        portal={false}
        role="member"
        go={() => undefined}
      />,
    );
    expect(team).toContain('Versions');
    const client = renderToString(
      <ProjectTabsV2 projectId={id} view="overview" portal role="guest" go={() => undefined} />,
    );
    expect(client).not.toContain('Versions');
  });
});
