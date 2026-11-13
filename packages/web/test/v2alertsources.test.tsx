// ── [PCODE-340 | S15 | v0.1.0] T34.2a Automatic alerts from probes and failed deploys; Sentry and Alertmanager sources with signed webhooks ──
//    Why:  the Alertmanager receiver to copy names the address and the token and sends resolved alerts too.
import { describe, expect, it } from 'vitest';
import { alertmanagerSnippet } from '../src/v2/alertsources.js';

describe('alert sources', () => {
  it('writes the Alertmanager receiver', () => {
    const y = alertmanagerSnippet('https://orq.example/hooks/alerts/x', 'tok');
    expect(y).toContain('      - url: https://orq.example/hooks/alerts/x');
    expect(y).toContain('send_resolved: true');
    expect(y).toContain('credentials: tok');
  });
});
