// ── [PCODE-188 | S15 | v0.1.0] B7.4 Incidents and on-call live: alerts, incidents with timeline and roles, suspect deploys and rollback, status updates, rotations and escalation, postmortems, SLOs ──
//    Why:  severity and state colours, escalation steps in words, and the page without inline styles.
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EventHub } from '../src/core/hub.js';
import { IncidentsHub, sevTone, stateTone, stepText } from '../src/v2/incidentspage.js';

describe('incidents page', () => {
  it('colours severity and state, and says escalation in words', () => {
    expect(sevTone('sev2')).toBe('danger');
    expect(sevTone('sev3')).toBe('warning');
    expect(stateTone('mitigated')).toBe('success');
    expect(stepText({ afterMinutes: 10, target: 'backup', userName: null })).toBe(
      'After 10 min without acknowledgement: the backup.',
    );
    expect(stepText({ afterMinutes: 90, target: 'user', userName: 'Mara Schulz' })).toBe(
      'After 1 h 30 min without acknowledgement: Mara Schulz.',
    );
  });

  it('renders without inline styles', () => {
    const html = renderToString(
      <IncidentsHub workspaceId="w" role="member" hub={new EventHub()} go={() => undefined} />,
    );
    expect(html).toContain('Incidents and on-call');
    expect(html).not.toContain('style=');
  });
});
