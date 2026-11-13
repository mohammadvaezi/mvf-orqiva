// ── [PCODE-141 | S15 | v0.1.0] Audit dependencies against the OSV database ──
import { describe, expect, it } from 'vitest';
import {
  audit,
  cvss3Score,
  osvClient,
  readPackageLock,
  readRequirements,
  scanDependencies,
  severityOfVuln,
} from '../src/scan/deps.js';

const LOCK_V3 = JSON.stringify({
  name: 'app',
  lockfileVersion: 3,
  packages: {
    '': { name: 'app', version: '1.0.0' },
    'node_modules/lodash': { version: '4.17.20' },
    'node_modules/a/node_modules/minimist': { version: '1.2.5' },
    'node_modules/minimist': { version: '1.2.8' },
    'node_modules/local': { link: true },
  },
});
const LOCK_V1 = JSON.stringify({
  lockfileVersion: 1,
  dependencies: { express: { version: '4.17.1', dependencies: { qs: { version: '6.7.0' } } } },
});

// recorded answers of api.osv.dev, trimmed to the fields we read
const VULNS: Record<string, unknown> = {
  'GHSA-35jh-r3h4-6jhm': {
    id: 'GHSA-35jh-r3h4-6jhm',
    summary: 'Command Injection in lodash',
    aliases: ['CVE-2021-23337'],
    database_specific: { severity: 'HIGH' },
    affected: [
      {
        package: { name: 'lodash', ecosystem: 'npm' },
        ranges: [{ events: [{ introduced: '0' }, { fixed: '4.17.21' }] }],
      },
    ],
  },
  'PYSEC-2023-1': {
    id: 'PYSEC-2023-1',
    details: 'Requests leaks headers on redirect.\nMore text.',
    severity: [{ type: 'CVSS_V3', score: 'CVSS:3.1/AV:N/AC:H/PR:N/UI:R/S:U/C:H/I:N/A:N' }],
    affected: [
      {
        package: { name: 'requests', ecosystem: 'PyPI' },
        ranges: [{ events: [{ introduced: '0' }, { fixed: '2.31.0' }] }],
      },
    ],
  },
};

const fakeOsv = (): { fetchImpl: typeof fetch; calls: string[] } => {
  const calls: string[] = [];
  const fetchImpl = ((url: string, init?: RequestInit) => {
    calls.push(url.replace('https://api.osv.dev', ''));
    if (url.endsWith('/v1/querybatch')) {
      const body = JSON.parse(init?.body as string) as {
        queries: { package: { name: string }; version: string }[];
      };
      const results = body.queries.map((q) =>
        q.package.name === 'lodash' && q.version === '4.17.20'
          ? { vulns: [{ id: 'GHSA-35jh-r3h4-6jhm' }] }
          : q.package.name === 'requests'
            ? { vulns: [{ id: 'PYSEC-2023-1' }] }
            : {},
      );
      return Promise.resolve(new Response(JSON.stringify({ results })));
    }
    const id = decodeURIComponent(url.split('/').pop() ?? '');
    return Promise.resolve(
      new Response(JSON.stringify(VULNS[id]), { status: VULNS[id] ? 200 : 404 }),
    );
  }) as typeof fetch;
  return { fetchImpl, calls };
};

describe('lockfiles', () => {
  it('list every package and version of npm lockfiles, old and new', () => {
    expect(
      readPackageLock(LOCK_V3, 'package-lock.json').map((p) => p.name + '@' + p.version),
    ).toEqual(['lodash@4.17.20', 'minimist@1.2.5', 'minimist@1.2.8']);
    expect(
      readPackageLock(LOCK_V1, 'web/package-lock.json').map((p) => p.name + '@' + p.version),
    ).toEqual(['express@4.17.1', 'qs@6.7.0']);
  });

  it('take exact pins from requirements files', () => {
    const text =
      '# deps\nrequests==2.28.0  # http\nDjango_Rest[extra]==3.14.0 ; python_version > "3.8"\nflask>=2\n-r other.txt\n';
    expect(
      readRequirements(text, 'requirements.txt').map((p) => p.name + '==' + p.version),
    ).toEqual(['requests==2.28.0', 'django-rest==3.14.0']);
  });
});

describe('severity', () => {
  it('computes CVSS 3 base scores as the specification does', () => {
    expect(cvss3Score('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H')).toBe(9.8);
    expect(cvss3Score('CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:C/C:L/I:L/A:N')).toBe(6.1);
    expect(cvss3Score('CVSS:3.0/AV:L/AC:L/PR:L/UI:N/S:U/C:H/I:N/A:N')).toBe(5.5);
    expect(cvss3Score('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:N')).toBe(0);
    expect(cvss3Score('CVSS:2.0/AV:N')).toBeNull();
  });

  it('prefers the advisory’s own rating', () => {
    expect(severityOfVuln({ id: 'x', database_specific: { severity: 'MODERATE' } })).toBe('medium');
    expect(
      severityOfVuln({
        id: 'x',
        severity: [{ type: 'CVSS_V3', score: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H' }],
      }),
    ).toBe('critical');
    expect(severityOfVuln({ id: 'x' })).toBe('medium');
  });
});

describe('the audit', () => {
  it('finds vulnerable versions with their advisory, aliases and fix', async () => {
    const osv = fakeOsv();
    const findings = await audit(
      [
        ...readPackageLock(LOCK_V3, 'package-lock.json'),
        ...readRequirements('requests==2.28.0\n', 'requirements.txt'),
      ],
      osvClient(osv.fetchImpl),
    );
    expect(findings.map((f) => [f.rule, f.severity, f.title, f.file])).toEqual([
      [
        'GHSA-35jh-r3h4-6jhm',
        'high',
        'lodash@4.17.20: Command Injection in lodash',
        'package-lock.json',
      ],
      [
        'PYSEC-2023-1',
        'medium',
        'requests@2.28.0: Requests leaks headers on redirect.',
        'requirements.txt',
      ],
    ]);
    expect(findings[0]?.message).toContain('Also known as CVE-2021-23337.');
    expect(findings[0]?.message).toContain('Fixed in 4.17.21; upgrade lodash.');
    expect(osv.calls).toEqual([
      '/v1/querybatch',
      '/v1/vulns/GHSA-35jh-r3h4-6jhm',
      '/v1/vulns/PYSEC-2023-1',
    ]);
  });

  it('reads only lockfiles among the tracked files', async () => {
    const osv = fakeOsv();
    const files: Record<string, string> = {
      'package-lock.json': LOCK_V3,
      'docs/requirements-dev.txt': 'requests==2.28.0\n',
      'src/a.ts': 'x',
    };
    const r = await scanDependencies(
      Object.keys(files),
      (f) => Promise.resolve(files[f] ?? null),
      osvClient(osv.fetchImpl),
    );
    expect(r.tool).toBe('pe-deps');
    expect(r.note).toBe('4 packages in 2 lockfiles, checked against OSV');
    expect(r.findings).toHaveLength(2);
    expect(await audit([], osvClient(osv.fetchImpl))).toEqual([]);
  });
});
