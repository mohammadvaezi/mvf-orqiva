// ── [PCODE-199 | S15 | v0.1.0] T16.3 Handover pack on the server: checks, team checklist, frozen packs, PDF, client acceptance in the portal ──
//    Why:  a pack goes out only when nothing required is missing; warnings show but never block; a page an
//          agent wrote counts only after a person approved it; the pack carries the documents a client
//          relies on, readme first.
import { describe, expect, it } from 'vitest';
import {
  handoverChecks,
  handoverReady,
  packPages,
  type HandoverFacts,
  type HandoverPage,
} from '../src/index.js';

const page = (title: string, over: Partial<HandoverPage> = {}): HandoverPage => ({
  id: title,
  title,
  status: 'published',
  version: 1,
  needsApproval: false,
  stale: false,
  generated: false,
  clientVisible: false,
  ...over,
});
const good: HandoverFacts = {
  pages: [
    page('Architecture'),
    page('Handover readme'),
    page('Runbook: deploy'),
    page('System overview (from code)', { generated: true }),
  ],
  drift: 0,
  release: { version: '1.0.0', state: 'released', hasClientNotes: true },
  tests: { name: 'Regression', passed: 40, failed: 0 },
  acceptance: { name: 'UAT 1', accepted: true },
  seriousFindings: 0,
  openTasks: 0,
  items: [{ id: 'a', label: 'Access handed over', done: true }],
};
const state = (f: HandoverFacts): Record<string, string> =>
  Object.fromEntries(handoverChecks(f).map((c) => [c.key, c.state]));

describe('handover checks', () => {
  it('passes a project with everything in place', () => {
    expect(handoverChecks(good).every((c) => c.state === 'ok')).toBe(true);
    expect(handoverReady(handoverChecks(good))).toBe(true);
  });

  it('blocks on what a client relies on, and only warns on the rest', () => {
    const f: HandoverFacts = {
      ...good,
      pages: [
        page('Architecture', { needsApproval: true }),
        page('Runbook: deploy', { status: 'draft', stale: true }),
      ],
      drift: 2,
      release: { version: '1.1.0', state: 'frozen', hasClientNotes: false },
      tests: { name: 'Regression', passed: 38, failed: 2 },
      acceptance: null,
      seriousFindings: 1,
      openTasks: 3,
      items: [{ id: 'a', label: 'Access handed over', done: false }],
    };
    expect(state(f)).toEqual({
      architecture: 'missing',
      readme: 'missing',
      runbooks: 'missing',
      'code-docs': 'warn',
      fresh: 'warn',
      release: 'missing',
      tests: 'missing',
      acceptance: 'warn',
      security: 'missing',
      'open-work': 'warn',
      'item:a': 'missing',
    });
    const c = handoverChecks(f);
    expect(c.find((x) => x.key === 'architecture')?.detail).toBe(
      'Architecture waits for a person’s approval',
    );
    expect(c.find((x) => x.key === 'readme')?.detail).toBe('No page titled "Handover readme" yet');
    expect(c.find((x) => x.key === 'fresh')?.detail).toBe(
      '1 page past the review date, 2 pages disagree with the code',
    );
    expect(c.find((x) => x.key === 'release')?.detail).toBe('1.1.0 is frozen');
    expect(handoverReady(c)).toBe(false);
  });

  it('carries the handover documents, readme first, and shared pages', () => {
    const pages = [
      page('Zeta notes'),
      page('Shared FAQ', { clientVisible: true }),
      page('Runbook: deploy'),
      page('Handover readme'),
      page('Architecture'),
      page('Tours API (from code)', { generated: true }),
      page('Runbook: draft', { status: 'draft' }),
    ];
    expect(packPages(pages).map((p) => p.title)).toEqual([
      'Handover readme',
      'Architecture',
      'Runbook: deploy',
      'Tours API (from code)',
      'Shared FAQ',
    ]);
  });
});
