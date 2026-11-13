// ── [PCODE-191 | S15 | v0.1.0] B7.6 Client status page with uptime probes, own portal domains with DNS verification and on-demand TLS ──
// ── [PCODE-186 | S15 | v0.1.0] B7.2 Client portal live: roadmap, acceptance tests, approvals, releases with ratings, shared documents ──
//    Why:  the roadmap keeps its bars in the box and in date order, marks today and the months; the portal's
//          sections are open to a client contact and to nothing else; pages render without inline styles.
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EventHub } from '../src/core/hub.js';
import { appRoute } from '../src/core/nav.js';
import { portalAllows } from '../src/v2/portal.js';
import {
  PortalPage,
  STATE_CHIP,
  invoiceState,
  roadmapGeometry,
  slotText,
  uptimeText,
} from '../src/v2/portalpages.js';

describe('client portal pages', () => {
  it('lays out the roadmap inside the box', () => {
    const g = roadmapGeometry(
      [
        { start: '2026-09-01', due: '2026-09-28' },
        { start: '2026-10-01', due: '2026-10-20' },
        { start: null, due: '2026-11-01' },
      ],
      '2026-10-05',
    );
    expect(g.bars).toHaveLength(3);
    expect(g.bars.every((b) => b.x >= 220 && b.x + b.w <= 880.5)).toBe(true);
    expect((g.bars[0]?.x ?? 0) < (g.bars[1]?.x ?? 0)).toBe(true);
    expect(g.ticks.map((t) => t.label)).toEqual(['Sep', 'Oct', 'Nov']);
    expect(g.todayX).toBeGreaterThan(g.bars[1]?.x ?? 0);
    expect(roadmapGeometry([], '2026-10-05').bars).toEqual([]);
  });

  it('routes the portal’s sections and lets client contacts in', () => {
    expect(appRoute('/portal/acceptance')).toEqual({
      kind: 'portal',
      section: 'acceptance',
      id: null,
    });
    const id = '0f9a4e6c-5b1d-4e0a-9f3b-2c7d8e9f0a1b';
    expect(appRoute('/portal/documents/' + id)).toEqual({
      kind: 'portal',
      section: 'documents',
      id,
    });
    expect(appRoute('/portal/nonsense')).toEqual({ kind: 'home' });
    expect(portalAllows({ kind: 'portal', section: 'roadmap', id: null })).toBe(true);
  });

  it('renders without inline styles', () => {
    const html = renderToString(
      <PortalPage
        workspaceId="w"
        section="approvals"
        docId={null}
        hub={new EventHub()}
        go={() => undefined}
      />,
    );
    expect(html).toContain('Approvals');
    expect(html).not.toContain('style=');
  });

  // [PCODE-189 | S15 | v0.1.0]
  it('says invoice states and meeting slots in the client’s words', () => {
    expect(invoiceState({ state: 'sent', overdue: false, dueOn: '2026-10-15' })).toEqual({
      text: 'open · due 15 Oct',
      tone: 'warning',
    });
    expect(invoiceState({ state: 'sent', overdue: true, dueOn: '2026-10-01' }).tone).toBe('danger');
    expect(invoiceState({ state: 'paid', overdue: false, dueOn: null }).text).toBe('paid');
    expect(slotText(new Date(2026, 9, 7, 10, 30).toISOString())).toBe('Wed 7 Oct 10:30');
  });

  // [PCODE-191 | S15 | v0.1.0]
  it('says a component’s state and uptime plainly', () => {
    expect(STATE_CHIP['down']).toEqual({ text: 'disrupted', tone: 'danger' });
    expect(uptimeText(99.98)).toBe('99,98 % in 30 days');
    expect(uptimeText(null)).toBe('not probed');
    expect(appRoute('/portal/status')).toEqual({ kind: 'portal', section: 'status', id: null });
  });
});
