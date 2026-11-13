// ── [PCODE-146 | S15 | v0.1.0] Show compliance, evidence packs and reviews in the web app ──
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ControlState, latestDecision, packUrl } from '../src/compliance.js';
import { appRoute } from '../src/core/nav.js';

const ID = '11111111-1111-4111-8111-111111111111';

describe('the compliance page', () => {
  it('has its own address and downloads the pack of the chosen period', () => {
    expect(appRoute('/projects/' + ID + '/compliance')).toEqual({
      kind: 'project',
      id: ID,
      view: 'compliance',
    });
    expect(packUrl('w1', 'p1', '2026-07-01', '2026-10-04')).toBe(
      '/api/workspaces/w1/projects/p1/evidence-pack?from=2026-07-01&to=2026-10-04',
    );
  });

  it('reads a control’s state in words', () => {
    expect(renderToString(<ControlState status="exempt" />)).toContain('Not applicable');
    expect(renderToString(<ControlState status="partial" />)).toContain('pe-control--partial');
  });
});

describe('the review panel', () => {
  it('counts only a person’s latest decision', () => {
    expect(
      latestDecision([
        { kind: 'agent', decision: null },
        { kind: 'person', decision: 'approved' },
        { kind: 'person', decision: 'changes_requested' },
      ]),
    ).toBe('approved');
    expect(latestDecision([{ kind: 'agent', decision: null }])).toBeNull();
  });
});
