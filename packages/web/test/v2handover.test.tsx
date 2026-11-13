// ── [PCODE-200 | S15 | v0.1.0] T16.4 Handover screens: design preview, team Handover tab, portal Handover section with signature ──
//    Why:  the team sees what blocks the pack and cannot send while something is missing; a pack names its
//          status, signature and PDF; the client gets Accept and Ask for changes only on a pack that waits;
//          the tab and the portal section are reachable by address.
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { appRoute } from '../src/core/nav.js';
import { SAMPLE_HANDOVER } from '../src/preview/handover.js';
import {
  HandoverView,
  PackView,
  PortalHandoverView,
  checkCounts,
  dayText,
  type PackContentsView,
} from '../src/v2/handover.js';
import { PROJECT_TABS_V2 } from '../src/v2/projecttabs.js';

const html = (n: React.ReactNode): string => renderToString(n).replace(/<!-- -->/g, '');
const noop = (): void => undefined;
const contents: PackContentsView = {
  project: { key: 'HEL', name: 'Patient app' },
  client: 'Helio',
  checks: [{ key: 'tests', label: 'Tests', state: 'ok', detail: 'Regression: 10 passed' }],
  pages: [{ id: 'p1', title: 'Handover readme', version: 4, generated: false }],
  release: { version: '2.0.0', notes: '', releasedAt: '2026-10-06T09:00:00Z' },
  tests: { name: 'Regression', passed: 10, failed: 0, finishedAt: null },
  acceptance: null,
  openTasks: [],
  note: 'For the launch',
};
const pack = SAMPLE_HANDOVER.packs[0];
if (!pack) throw new Error('no sample pack');

describe('the Handover tab', () => {
  it('counts the checks and blocks sending while something is missing', () => {
    expect(checkCounts(SAMPLE_HANDOVER.checks)).toEqual({ ok: 9, warn: 2, missing: 3 });
    const out = html(
      <HandoverView
        data={SAMPLE_HANDOVER}
        canEdit
        pdfHref={(id) => '/pdf/' + id}
        onToggle={noop}
        onAdd={noop}
        onSuggested={noop}
        onRemove={noop}
        onSend={noop}
        onOpenPack={noop}
      />,
    );
    expect(out).toContain('Send pack 3');
    expect(out).toContain('title="Something required is missing" disabled=""');
    expect(out).toContain('Missing: Handover readme, Support contact and hours named');
    expect(out).toContain('changes asked for');
    expect(out).toContain('href="/pdf/k2"');
    expect(out).toContain('Add the suggested items');
  });

  it('is a team tab, and the portal has a Handover section', () => {
    expect(PROJECT_TABS_V2.find((t) => t.view === 'handover')).toMatchObject({ team: true });
    expect(appRoute('/projects/11111111-1111-4111-8111-111111111111/handover')).toMatchObject({
      kind: 'project',
      view: 'handover',
    });
    expect(appRoute('/portal/handover')).toEqual({ kind: 'portal', section: 'handover', id: null });
  });
});

describe('a pack', () => {
  const view = (status: string, mayDecide: boolean): string =>
    html(
      <PackView
        pack={{ ...pack, status, signedName: status === 'accepted' ? 'Ines Vogel' : '' }}
        contents={contents}
        pdfHref="/x.pdf"
        mayDecide={mayDecide}
        openPage={() => Promise.resolve(null)}
      />,
    );

  it('lets an approver decide only while it waits', () => {
    expect(view('sent', true)).toContain('Accept');
    expect(view('sent', true)).toContain('Ask for changes');
    expect(view('sent', false)).not.toContain('Ask for changes');
    expect(view('accepted', true)).toContain('Accepted and signed by Ines Vogel');
    expect(view('accepted', true)).not.toContain('Ask for changes');
    expect(view('sent', true)).toContain('Regression: 10 passed, 0 failed');
    expect(view('sent', true)).toContain('Download PDF');
  });

  it('tells a client without packs what will show', () => {
    expect(html(<PortalHandoverView packs={[]} onOpen={noop} pdfHref={() => ''} />)).toContain(
      'No handover pack yet.',
    );
    expect(dayText('2026-10-09T10:00:00Z')).toBe('9 Oct 2026');
  });
});
