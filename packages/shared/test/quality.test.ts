// ── [PCODE-175 | S15 | v0.1.0] B4.1 Test and Versions on the server: suites, steps, configs, evidence, flaky, Playwright, pull requests, releases, notes, flags, DORA ──
import { describe, expect, it } from 'vitest';
import {
  compareVersions,
  doraMetrics,
  flakiness,
  nextVersion,
  parsePlaywright,
  releaseNotes,
} from '../src/quality.js';

describe('versions', () => {
  it('suggests the next semantic version from the contents', () => {
    expect(nextVersion('1.4.2', [{ kind: 'bug', breaking: false }])).toBe('1.4.3');
    expect(
      nextVersion('1.4.2', [
        { kind: 'bug', breaking: false },
        { kind: 'story', breaking: false },
      ]),
    ).toBe('1.5.0');
    expect(nextVersion('1.4.2', [{ kind: 'task', breaking: true }])).toBe('2.0.0');
    expect(nextVersion(null, [{ kind: 'story', breaking: false }])).toBe('0.1.0');
  });

  it('orders versions, pre-releases first', () => {
    expect(['1.10.0', '1.2.0', '1.2.0-rc.1', '0.9.9'].sort(compareVersions)).toEqual([
      '0.9.9',
      '1.2.0-rc.1',
      '1.2.0',
      '1.10.0',
    ]);
  });

  it('writes notes for the team with references and for the client without', () => {
    const items = [
      { ref: 'APP-1', title: 'Live tracking', kind: 'story', breaking: false },
      { ref: 'APP-2', title: 'Map loads twice', kind: 'bug', breaking: false },
      { ref: 'APP-3', title: 'Old API removed', kind: 'task', breaking: true },
      { ref: 'APP-4', title: 'Spike: offline', kind: 'spike', breaking: false },
    ];
    const team = releaseNotes('1.5.0', items, 'team', '2026-10-20');
    expect(team).toContain('# 1.5.0 (2026-10-20)');
    expect(team).toContain('## Breaking changes\n\n- APP-3 Old API removed');
    expect(team).toContain('- APP-4 Spike: offline');
    const client = releaseNotes('1.5.0', items, 'client');
    expect(client).toContain('## Fixed\n\n- Map loads twice');
    expect(client).not.toContain('APP-');
    expect(client).not.toContain('Spike');
  });
});

describe('tests', () => {
  it('calls a case flaky when it flips between pass and fail', () => {
    expect(flakiness(['passed', 'failed', 'passed', 'failed', 'passed'])).toMatchObject({
      flips: 4,
      flaky: true,
      passRate: 60,
    });
    expect(flakiness(['failed', 'failed', 'failed', 'passed', 'passed']).flaky).toBe(false);
    expect(flakiness(['skipped', 'passed']).flaky).toBe(false);
  });

  it('reads a Playwright JSON report, the last retry counts', () => {
    const r = parsePlaywright({
      suites: [
        {
          title: 'tracking.spec.ts',
          specs: [],
          suites: [
            {
              title: 'tracking page',
              specs: [
                {
                  title: 'shows the truck',
                  tests: [
                    {
                      projectName: 'chromium',
                      results: [
                        { status: 'failed', duration: 900, error: { message: 'timeout' } },
                        { status: 'passed', duration: 450 },
                      ],
                    },
                  ],
                },
                {
                  title: 'asks for the postcode',
                  tests: [
                    {
                      projectName: 'webkit',
                      results: [
                        { status: 'timedOut', duration: 30000, error: { message: 'Timed out' } },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
    expect(r).toEqual([
      {
        key: 'pw:tracking.spec.ts › tracking page › shows the truck [chromium]',
        title: 'shows the truck [chromium]',
        suite: 'tracking.spec.ts / tracking page',
        status: 'passed',
        durationMs: 450,
        message: '',
      },
      {
        key: 'pw:tracking.spec.ts › tracking page › asks for the postcode [webkit]',
        title: 'asks for the postcode [webkit]',
        suite: 'tracking.spec.ts / tracking page',
        status: 'failed',
        durationMs: 30000,
        message: 'Timed out',
      },
    ]);
  });
});

describe('dora', () => {
  it('measures deploy frequency, failure rate, restore time and lead time', () => {
    const d = doraMetrics(
      [
        {
          status: 'succeeded',
          createdAt: '2026-10-01T08:00:00Z',
          finishedAt: '2026-10-01T08:10:00Z',
        },
        { status: 'failed', createdAt: '2026-10-02T08:00:00Z', finishedAt: '2026-10-02T08:10:00Z' },
        {
          status: 'succeeded',
          createdAt: '2026-10-02T09:00:00Z',
          finishedAt: '2026-10-02T10:10:00Z',
        },
        {
          status: 'succeeded',
          createdAt: '2026-10-05T08:00:00Z',
          finishedAt: '2026-10-05T08:10:00Z',
        },
        { status: 'cancelled', createdAt: '2026-10-06T08:00:00Z', finishedAt: null },
      ],
      [10, 30, 20],
      14,
    );
    expect(d).toEqual({
      deploysPerWeek: 1.5,
      leadTimeHours: 20,
      changeFailureRate: 25,
      timeToRestoreHours: 2,
    });
  });
});
