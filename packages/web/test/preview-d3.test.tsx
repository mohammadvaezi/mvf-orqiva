// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-155 | S15 | v0.1.0] D3 preview: Documents, UI kit and Test ──
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DocumentsTab } from '../src/preview/documents.js';
import { ProjectPage } from '../src/preview/projects.js';
import { TestTab } from '../src/preview/testtab.js';
import { UiKitTab } from '../src/preview/uikit.js';

const go = (): void => undefined;
const text = (html: string): string => html.replace(/<!-- -->/g, '');

describe('D3: Documents, UI kit and Test', () => {
  it('opens Documents on a page with owner, review date, comments and the agents that may read it', () => {
    const html = text(renderToString(<DocumentsTab />));
    expect(html).toContain('ADR-007 Live routing via WebSocket');
    expect(html).toContain('Owner Lea Wagner');
    expect(html).toContain('Review by 24 Dec');
    expect(html).toContain('synced from src/live/events.ts');
    expect(html).toContain('exponential backoff');
    expect(html).toContain('Shared with Nordwind');
  });

  it('opens the UI kit on mockup review with pinned comments and the client approval', () => {
    const html = text(renderToString(<UiKitTab />));
    expect(html).toContain('Pinned comments');
    expect(html).toContain('Approve as Kai');
    expect(html).toContain('pv-pin-dot');
  });

  it('opens Test on a run with the matrix, step results, evidence and AI triage', () => {
    const html = text(renderToString(<TestTab />));
    expect(html).toContain('Run 88');
    expect(html).toContain('Firefox · Windows');
    expect(html).toContain('Actual: download stops at 5 000 rows');
    expect(html).toContain('captured by the Orqiva Capture extension');
    expect(html).toContain('File bug with all evidence');
  });

  it('puts the three tabs into every project', () => {
    for (const tab of ['documents', 'uikit', 'test'])
      expect(
        renderToString(<ProjectPage pkey="HEL" tab={tab} role="lead" go={go} />),
      ).not.toContain('Designed in step');
  });
});
