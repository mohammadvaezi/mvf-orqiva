// ── [PCODE-293 | S15 | v0.1.0] T30.7 Generated asset sizes and a download portal ──
// ── [PCODE-235 | S15 | v0.1.0] T23.2 Messages in the web app ──
// ── [PCODE-200 | S15 | v0.1.0] T16.4 Handover screens: design preview, team Handover tab, portal Handover section with signature ──
// ── [PCODE-191 | S15 | v0.1.0] B7.6 Client status page with uptime probes, own portal domains with DNS verification and on-demand TLS ──
// ── [PCODE-189 | S15 | v0.1.0] B7.5 Portal budget and invoices with PDF, quotes, meeting booking with agenda and calendar file ──
// ── [PCODE-186 | S15 | v0.1.0] B7.2 Client portal live: roadmap, acceptance tests, approvals, releases with ratings, shared documents ──
// ── [PCODE-185 | S15 | v0.1.0] B7.1 Client requests live: portal requests, threads with internal notes, response times, change requests with impact and signature, ratings ──
// ── [PCODE-164 | S15 | v0.1.0] B1.3 The v2 shell live in the web app: Home per role, Inbox, Clients, portal mode, settings ──
//    Why:  a client contact moves only inside the portal's map: Home, what waits for them, their projects
//          and tasks, their profile. Any other address shows that it is not part of their portal (the
//          server returns nothing of it either; this keeps the team's pages from opening empty).
import type { ReactNode } from 'react';
import type { AppRoute } from '../core/nav.js';
import { PIcon, type PIconName } from '../preview/picons.js';
import { Card, PageHead } from '../preview/ui.js';

// [PCODE-186 | S15 | v0.1.0] the portal's sections after Requests, in the approved order
export const PORTAL_PAGES: { key: string; label: string; icon: PIconName }[] = [
  { key: 'roadmap', label: 'Roadmap', icon: 'canvas' },
  { key: 'acceptance', label: 'Acceptance tests', icon: 'test' },
  { key: 'approvals', label: 'Approvals', icon: 'signoff' },
  { key: 'releases', label: 'Releases', icon: 'releases' },
  { key: 'documents', label: 'Documents', icon: 'documents' },
  { key: 'assets', label: 'Assets', icon: 'uikit' }, // [PCODE-293 | S15 | v0.1.0]
  { key: 'handover', label: 'Handover', icon: 'approval' }, // [PCODE-200 | S15 | v0.1.0]
  { key: 'billing', label: 'Budget and invoices', icon: 'euro' }, // [PCODE-189 | S15 | v0.1.0]
  { key: 'meetings', label: 'Meetings', icon: 'clock' },
  { key: 'status', label: 'Status', icon: 'live' }, // [PCODE-191 | S15 | v0.1.0]
];

export function portalAllows(r: AppRoute): boolean {
  switch (r.kind) {
    case 'home':
    case 'inbox':
    case 'projects':
    case 'item':
    case 'requests': // [PCODE-185 | S15 | v0.1.0]
    case 'portal': // [PCODE-186 | S15 | v0.1.0]
    case 'messages': // [PCODE-235 | S15 | v0.1.0] the client's channel with the team
      return true;
    case 'project':
      return r.view === 'overview' || r.view === 'list' || r.view === 'board';
    case 'settings':
      return r.section === 'profile';
    default:
      return false;
  }
}

export function NotInPortal(props: { go: (p: string) => void }): ReactNode {
  return (
    <div className="pv-page">
      <PageHead title="Not part of your portal" icon="lock" />
      <Card>
        <div className="pv-empty">
          <PIcon name="lock" size={28} />
          <strong>This page belongs to the team's workspace.</strong>
          <span>Your portal shows your projects, what waits for your answer and your profile.</span>
          <a
            href="/"
            className="pv-btn pv-btn--secondary"
            onClick={(e) => {
              e.preventDefault();
              props.go('/');
            }}
          >
            <PIcon name="home" size={16} /> Back to your home
          </a>
        </div>
      </Card>
    </div>
  );
}
