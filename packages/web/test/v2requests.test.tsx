// ── [PCODE-185 | S15 | v0.1.0] B7.1 Client requests live: portal requests, threads with internal notes, response times, change requests with impact and signature, ratings ──
//    Why:  the impact a client signs reads in their words (points, euro, schedule), short times in a
//          thread, how long ago a portal was used, a viewer gets no "New request", and the page renders
//          without inline styles.
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EventHub } from '../src/core/hub.js';
import { agoText } from '../src/v2/clients.js';
import { RequestsPage, impactChips, kindTone, whenText } from '../src/v2/requests.js';

const hub = new EventHub();

describe('requests page', () => {
  it('says a change’s impact the way a client signs it', () => {
    expect(impactChips({ points: 8, priceCents: 340000, days: 2 })).toEqual([
      '8 points',
      '3.400 €',
      'release +2 days',
    ]);
    expect(impactChips({ points: 1, priceCents: 0, days: 0 })[2]).toBe('no schedule change');
    expect(kindTone('bug')).toBe('danger');
  });

  it('keeps times short', () => {
    const now = new Date('2026-10-05T15:00:00');
    expect(whenText('2026-10-05T09:20:00', now)).toBe('09:20');
    expect(whenText('2026-10-02T16:40:00', now)).toBe('02.10. 16:40');
    expect(agoText(null, now)).toBe('never');
    expect(agoText(new Date(now.getTime() - 2 * 3_600_000).toISOString(), now)).toBe('2 h ago');
  });

  it('offers a new request to filers only, and renders without inline styles', () => {
    const page = (roles: string[]) =>
      renderToString(
        <RequestsPage
          workspaceId="w"
          role="guest"
          client={{ id: 'c', name: 'Helio', portalRoles: roles }}
          hub={hub}
          id={null}
          go={() => undefined}
        />,
      );
    expect(page(['requester'])).toContain('New request');
    expect(page(['viewer'])).not.toContain('New request');
    expect(page(['requester'])).not.toContain('style=');
  });
});
