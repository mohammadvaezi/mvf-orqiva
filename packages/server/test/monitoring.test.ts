// ── [PCODE-340 | S15 | v0.1.0] T34.2a Automatic alerts from probes and failed deploys; Sentry and Alertmanager sources with signed webhooks ──
//    Why:  Alertmanager's and Sentry's bodies, in the shapes their documentation gives, become our alerts
//          with sensible severities; and a Sentry signature is checked over the exact bytes.
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  amSeverity,
  fromAlertmanager,
  fromSentry,
  sentrySeverity,
  sentrySigned,
} from '../src/api/monitoring.js';

describe('outside alerts', () => {
  it('reads Alertmanager’s alerts, firing and resolved', () => {
    const got = fromAlertmanager({
      version: '4',
      status: 'firing',
      alerts: [
        {
          status: 'firing',
          labels: { alertname: 'HighErrorRate', severity: 'critical', service: 'api' },
          annotations: { summary: 'API errors above 5 %', description: 'For 10 minutes' },
          startsAt: '2026-10-15T10:00:00Z',
          fingerprint: 'abc123',
        },
        {
          status: 'resolved',
          labels: { alertname: 'DiskFull', severity: 'warning' },
          annotations: {},
          fingerprint: 'def456',
        },
        { status: 'firing', labels: {}, annotations: {} },
      ],
    });
    expect(got.map((a) => [a.key, a.severity, a.title, a.resolved])).toEqual([
      ['am:abc123', 'sev1', 'API errors above 5 %', false],
      ['am:def456', 'sev3', 'DiskFull', true],
    ]);
    expect(amSeverity('ERROR')).toBe('sev2');
    expect(amSeverity(undefined)).toBe('sev3');
    expect(amSeverity('info')).toBe('sev4');
  });

  it('reads Sentry’s issues and issue alerts', () => {
    expect(
      fromSentry({
        action: 'created',
        data: {
          issue: {
            id: '42',
            title: 'TypeError: x is undefined',
            level: 'fatal',
            shortId: 'API-1',
            permalink: 'https://sentry.example/i/42',
          },
        },
      }),
    ).toEqual([
      expect.objectContaining({
        key: 'sentry:42',
        severity: 'sev2',
        title: 'TypeError: x is undefined',
        resolved: false,
      }),
    ]);
    expect(
      fromSentry({ action: 'resolved', data: { issue: { id: '42', title: 'x' } } })[0]?.resolved,
    ).toBe(true);
    expect(
      fromSentry({
        action: 'triggered',
        data: { event: { issue_id: '7', title: 'Slow', level: 'warning' } },
      }),
    ).toEqual([expect.objectContaining({ key: 'sentry:7', severity: 'sev4' })]);
    expect(fromSentry({ data: {} })).toEqual([]);
    expect(sentrySeverity('error')).toBe('sev3');
  });

  it('checks Sentry’s signature over the exact body', () => {
    const body = '{"action":"created"}';
    const sig = createHmac('sha256', 'the-client-secret').update(body).digest('hex');
    expect(sentrySigned(body, 'the-client-secret', sig)).toBe(true);
    expect(sentrySigned(body + ' ', 'the-client-secret', sig)).toBe(false);
    expect(sentrySigned(body, 'another-secret', sig)).toBe(false);
    expect(sentrySigned(body, 'the-client-secret', 'short')).toBe(false);
  });
});
