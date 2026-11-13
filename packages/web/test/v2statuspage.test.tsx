// ── [PCODE-341 | S15 | v0.1.0] T34.2b Public status pages per client and environment; incident update templates ──
//    Why:  the public page's address, its headline, and the time of the next update in a template.
import { describe, expect, it } from 'vitest';
import { level, nextAt, overall, statusSlug } from '../src/v2/statuspage.js';

describe('public status pages', () => {
  it('reads the short name from the address', () => {
    expect(statusSlug('/status/helio')).toBe('helio');
    expect(statusSlug('/status/helio/')).toBe('helio');
    expect(statusSlug('/status/Helio')).toBeNull();
    expect(statusSlug('/statuses/helio')).toBeNull();
  });
  it('says how things stand in one line', () => {
    expect(overall([{ state: 'working' }, { state: 'working' }])).toBe('All services are working');
    expect(overall([{ state: 'working' }, { state: 'slow' }])).toBe('Some services are slow');
    expect(overall([{ state: 'down' }, { state: 'slow' }])).toBe('Some services are down');
    expect(overall([])).toBe('Status not known right now');
    expect(level([{ state: 'unknown' }])).toBe('unknown');
    expect(level([{ state: 'working' }])).toBe('ok');
  });
  it('names the time of the next update', () => {
    const now = new Date('2026-10-15T12:00:00');
    expect(nextAt('30', now)).toBe('12:30');
    expect(nextAt('', now)).toBe('the next update');
  });
});
