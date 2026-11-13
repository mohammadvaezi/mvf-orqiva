// ── [PCODE-179 | S15 | v0.1.0] B4.5 Security and Code map live in the web app: posture, findings by risk, SBOM, policies, campaigns, treemap, hotspots, APIs, hygiene ──
//    Why:  a finding's state, a policy's rule and a folder's colour are what people act on, so they must
//          read right; both tabs are for the team, not for clients.
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { cellClass } from '../src/v2/codemap.js';
import { ProjectTabsV2 } from '../src/v2/projecttabs.js';
import { findingState, riskBand, ruleText, trendPath } from '../src/v2/security.js';

describe('security and code map', () => {
  it('reads a finding’s state from its decision first, then its workflow', () => {
    expect(
      findingState({ status: 'accepted', workflow: 'new', acceptedUntil: '2026-11-03' }),
    ).toEqual({
      text: 'accepted until 3.11.2026',
      tone: 'neutral',
    });
    expect(findingState({ status: 'fixed', workflow: 'verified', acceptedUntil: null }).text).toBe(
      'verified',
    );
    expect(findingState({ status: 'open', workflow: 'fixing', acceptedUntil: null })).toEqual({
      text: 'fixing',
      tone: 'primary',
    });
    expect([riskBand(91), riskBand(50), riskBand(10)]).toEqual(['high', 'mid', 'low']);
  });

  it('says a policy’s rule in words', () => {
    expect(ruleText({ maxSeverity: 'high', newOnly: true })).toBe(
      'no open high or worse finding (new issues only)',
    );
    expect(ruleText({ liveSecrets: true, bannedLicences: ['AGPL-3.0'] })).toBe(
      'no secret in the code, no package under AGPL-3.0',
    );
    expect(ruleText({})).toBe('no rule');
  });

  it('draws the trend only with two scans or more', () => {
    expect(trendPath([4], 100, 50)).toBe('');
    expect(trendPath([4, 2], 100, 50)).toBe('M10.0 40.0 L90.0 25.0');
  });

  it('colours folders by health, agent share or heat', () => {
    const f = { health: 5.5, agentShare: 0.5, hotspot: 70 };
    expect(cellClass(f, 'health')).toBe('pv-tm pv-tm--healthbad');
    expect(cellClass(f, 'agent')).toBe('pv-tm pv-tm--agent2');
    expect(cellClass(f, 'hot')).toBe('pv-tm pv-tm--healthbad');
    expect(cellClass({ health: 9, agentShare: 0, hotspot: 0 }, 'hot')).toBe(
      'pv-tm pv-tm--healthgood',
    );
  });

  it('has a Code map tab for the team, not for clients', () => {
    const id = '0b1f6a52-3c1e-4d7a-9a51-2f0f6c1d2e3a';
    expect(
      renderToString(
        <ProjectTabsV2
          projectId={id}
          view="codemap"
          portal={false}
          role="member"
          go={() => undefined}
        />,
      ),
    ).toMatch(/aria-current="page"[^>]*>.*?Code map<\/a>/);
    expect(
      renderToString(
        <ProjectTabsV2 projectId={id} view="overview" portal role="guest" go={() => undefined} />,
      ),
    ).not.toContain('Code map');
  });
});
