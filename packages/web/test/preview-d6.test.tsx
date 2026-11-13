// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-158 | S15 | v0.1.0] D6 preview: Clients and portal, Incidents, Time, web and VS Code side by side ──
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ClientsPage } from '../src/preview/clients.js';
import { IdePage } from '../src/preview/ide.js';
import { IncidentsPage } from '../src/preview/incidents.js';
import { ClientPortalPage, PORTAL_SECTIONS } from '../src/preview/portal.js';
import { Sidebar } from '../src/preview/shell.js';
import { TimePage } from '../src/preview/time.js';

const go = (): void => undefined;
const text = (html: string): string => html.replace(/<!-- -->/g, '');

describe('D6: clients, portal, incidents, time, web and VS Code', () => {
  it('gives the client the portal navigation and none of the team sections', () => {
    const nav = renderToString(
      <Sidebar
        section=""
        projectKey={null}
        role="client"
        inboxCount={1}
        collapsed={false}
        onCollapse={go}
        go={go}
      />,
    );
    for (const s of PORTAL_SECTIONS) expect(nav).toContain(s.label);
    for (const team of ['Agents', 'Insights', 'People', 'Incidents', 'Clients'])
      expect(nav).not.toContain('>' + team + '<');
  });

  it('draws every portal section, and never internal notes', () => {
    for (const s of PORTAL_SECTIONS) {
      const html = text(renderToString(<ClientPortalPage section={s.key} />));
      expect(html).toContain(s.label);
      expect(html).not.toContain('Internal:');
    }
    expect(text(renderToString(<ClientPortalPage section="approvals" />))).toContain(
      'release +2 days',
    );
  });

  it('shows the team the internal notes and a way to see what the client sees', () => {
    const html = text(renderToString(<ClientsPage onViewAsClient={go} />));
    expect(html).toContain('View as client');
    expect(html).toContain('Helio Health AG');
  });

  it('draws the live incident with suspect changes, the timesheet, and both sides of the IDE sync', () => {
    expect(text(renderToString(<IncidentsPage />))).toContain('Suspect changes');
    expect(text(renderToString(<TimePage />))).toContain('Started by orq start in VS Code');
    const ide = text(renderToString(<IdePage />));
    expect(ide).toContain('ORQIVA');
    expect(ide).toContain('[NWL-191 | S14 | v1.4.0]');
    expect(ide).toContain('Where each part works');
  });
});
