// ── [PCODE-336 | S15 | v0.1.0] T34.1a Portal home with health, milestone, release and budget; release deliverables and demos; client sign-off per release; files on acceptance results ──
//    Why:  the budget, a deliverable's address and a sign-off read in words a client understands.
import { describe, expect, it } from 'vitest';
import { deliverableHref, signOffText } from '../src/v2/deliverables.js';
import { budgetLine } from '../src/v2/home.js';

describe('portal home words', () => {
  it('says how much of the budget is used and where it heads', () => {
    expect(budgetLine({ budgetCents: 1000000, usedCents: 620000, forecastCents: 940000 })).toBe(
      '62 % of the budget used, heading for 94 %',
    );
    expect(budgetLine({ budgetCents: 1000000, usedCents: 0, forecastCents: null })).toBe(
      '0 % of the budget used',
    );
    expect(
      budgetLine({ budgetCents: null, usedCents: 123456, forecastCents: null }).replace(/\s/g, ' '),
    ).toBe('1.235 € so far');
  });

  it('opens a deliverable at its link or its file, and words a sign-off', () => {
    const d = {
      id: 'd',
      kind: 'demo' as const,
      title: 'Demo',
      url: '',
      fileId: 'f1',
      fileName: 'demo.mp4',
      mime: 'video/mp4',
    };
    expect(deliverableHref('/api/workspaces/w', d)).toBe('/api/workspaces/w/files/f1/content');
    expect(deliverableHref('/api/workspaces/w', { ...d, url: 'https://x.test' })).toBe(
      'https://x.test',
    );
    expect(
      signOffText({
        decision: 'declined',
        signedName: 'Ines Vogel',
        note: 'Sound missing',
        at: '2026-10-15T10:00:00Z',
      }),
    ).toBe('Declined by Ines Vogel · 15.10.2026 · Sound missing');
  });
});
