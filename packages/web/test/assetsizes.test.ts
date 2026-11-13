// ── [PCODE-293 | S15 | v0.1.0] T30.7 Generated asset sizes and a download portal ──
//    Why:  the portal has an Assets section, reachable by its address.
import { describe, expect, it } from 'vitest';
import { appRoute } from '../src/core/nav.js';
import { PORTAL_PAGES } from '../src/v2/portal.js';

describe('the download portal', () => {
  it('is a section of the portal', () => {
    expect(PORTAL_PAGES.map((p) => p.key)).toContain('assets');
    expect(appRoute('/portal/assets')).toEqual({ kind: 'portal', section: 'assets', id: null });
  });
});
