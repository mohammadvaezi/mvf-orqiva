// ── [PCODE-142 | S15 | v0.1.0] Show security findings in the web app with Security agent triage ──
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { appRoute } from '../src/core/nav.js';
import { SeverityChip, gateBlock, whereText } from '../src/security.js';

const ID = '11111111-1111-4111-8111-111111111111';

describe('security pages', () => {
  it('have their own addresses', () => {
    expect(appRoute('/projects/' + ID + '/security')).toEqual({
      kind: 'project',
      id: ID,
      view: 'security',
    });
    expect(appRoute('/findings/' + ID)).toEqual({ kind: 'finding', id: ID });
  });

  it('count only open high and critical findings as blocking the gate', () => {
    expect(
      gateBlock([
        { severity: 'critical', status: 'open' },
        { severity: 'high', status: 'accepted' },
        { severity: 'high', status: 'open' },
        { severity: 'medium', status: 'open' },
      ]),
    ).toBe(2);
    expect(gateBlock([])).toBe(0);
  });

  it('show where and how bad', () => {
    expect(whereText({ file: 'src/a.ts', line: 12 })).toBe('src/a.ts:12');
    expect(whereText({ file: 'package-lock.json', line: null })).toBe('package-lock.json');
    expect(whereText({ file: '', line: null })).toBe('');
    expect(renderToString(<SeverityChip severity="critical" />)).toContain('pe-severity--critical');
  });
});
