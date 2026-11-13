// ── [PCODE-176 | S15 | v0.1.0] B4.2 Security and Code map on the server: risk score, workflow, SBOM, policies, campaigns, posture, code files, hotspots, API inventory ──
import { describe, expect, it } from 'vitest';
import {
  codeHealth,
  evaluatePolicy,
  hotspots,
  parseSbom,
  riskScore,
  sbomDiff,
} from '../src/posture.js';

describe('risk', () => {
  it('folds CVSS, EPSS, KEV, reachability and exposure into one score', () => {
    expect(riskScore({ severity: 'high' })).toBe(75);
    expect(riskScore({ severity: 'high', cvss: 8.1, epss: 0.4 })).toBe(91);
    expect(riskScore({ severity: 'medium', kev: true })).toBe(100);
    expect(riskScore({ severity: 'critical', cvss: 9.8, reachable: false })).toBe(49);
    expect(riskScore({ severity: 'low', exposed: true })).toBe(29);
  });
});

describe('sbom', () => {
  it('reads CycloneDX with nested components and licences', () => {
    const r = parseSbom({
      bomFormat: 'CycloneDX',
      components: [
        {
          name: 'express',
          version: '4.19.2',
          purl: 'pkg:npm/express@4.19.2',
          licenses: [{ license: { id: 'MIT' } }],
          components: [
            { name: 'qs', version: '6.11.0', licenses: [{ expression: 'BSD-3-Clause' }] },
          ],
        },
      ],
    });
    expect(r).toEqual({
      format: 'cyclonedx',
      components: [
        { name: 'express', version: '4.19.2', purl: 'pkg:npm/express@4.19.2', licences: ['MIT'] },
        { name: 'qs', version: '6.11.0', purl: '', licences: ['BSD-3-Clause'] },
      ],
    });
  });

  it('reads SPDX, skips the document itself, splits licence expressions', () => {
    const r = parseSbom({
      spdxVersion: 'SPDX-2.3',
      packages: [
        { SPDXID: 'SPDXRef-DOCUMENT', name: 'app' },
        {
          SPDXID: 'SPDXRef-pkg',
          name: 'left-pad',
          versionInfo: '1.3.0',
          licenseConcluded: '(MIT OR Apache-2.0)',
          externalRefs: [{ referenceType: 'purl', referenceLocator: 'pkg:npm/left-pad@1.3.0' }],
        },
      ],
    });
    expect(r?.components).toEqual([
      {
        name: 'left-pad',
        version: '1.3.0',
        purl: 'pkg:npm/left-pad@1.3.0',
        licences: ['MIT', 'Apache-2.0'],
      },
    ]);
    expect(parseSbom({ hello: 1 })).toBeNull();
  });

  it('diffs two SBOMs', () => {
    const c = (name: string, version: string) => ({ name, version, purl: '', licences: [] });
    expect(sbomDiff([c('a', '1'), c('b', '1')], [c('b', '2'), c('d', '1')])).toEqual({
      added: [c('d', '1')],
      removed: [c('a', '1')],
      changed: [{ name: 'b', from: '1', to: '2' }],
    });
  });
});

describe('policies', () => {
  const f = (
    severity: string,
    extra: Partial<{ risk: number; rule: string; open: boolean; firstSeenDaysAgo: number }> = {},
  ) => ({ title: 't', severity, risk: 50, rule: 'x', open: true, firstSeenDaysAgo: 1, ...extra });
  it('blocks on severity, risk, secrets and banned licences; only new issues when asked', () => {
    expect(evaluatePolicy({ maxSeverity: 'high' }, [f('critical'), f('medium')], [])).toEqual([
      '1 open high or worse finding',
    ]);
    expect(
      evaluatePolicy(
        { maxSeverity: 'high', newOnly: true },
        [f('critical', { firstSeenDaysAgo: 90 })],
        [],
      ),
    ).toEqual([]);
    expect(
      evaluatePolicy(
        { minRisk: 70 },
        [f('low', { risk: 80 }), f('low', { risk: 80, open: false })],
        [],
      ),
    ).toEqual(['1 finding with a risk of 70 or more']);
    expect(evaluatePolicy({ liveSecrets: true }, [f('high', { rule: 'secret/aws' })], [])).toEqual([
      '1 secret in the code',
    ]);
    expect(
      evaluatePolicy(
        { bannedLicences: ['agpl-3.0'] },
        [],
        [{ name: 'x', version: '1', purl: '', licences: ['AGPL-3.0'] }],
      ),
    ).toEqual(['x 1 is under AGPL-3.0']);
  });
});

describe('code', () => {
  it('rates health and finds hot spots', () => {
    expect(codeHealth({ lines: 120, complexity: 6, churn: 2 })).toBe(9);
    expect(codeHealth({ lines: 2000, complexity: 400, churn: 50 })).toBe(1.5);
    expect(
      hotspots([
        { lines: 1, complexity: 10, churn: 10 },
        { lines: 1, complexity: 5, churn: 2 },
      ]).map((x) => x.hotspot),
    ).toEqual([100, 10]);
  });
});
