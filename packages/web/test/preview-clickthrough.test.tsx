// ── [PCODE-210 | S15 | v0.1.0] T18.2 Command center screen: lanes with people and agents, heatmap, alerts, 24 h replay slider (design preview and live) ──
// ── [PCODE-159 | S15 | v0.1.0] D7 preview: full click-through, fixes and the gate A1 package ──
//    Why:  the click-through as a test: every page and project tab for every role renders, links stay
//          inside the preview, and a client never sees another client, internal notes, agent costs or the
//          team's sections, whatever address they type.
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PROJECTS, PROJECT_TABS, type Role } from '../src/preview/data.js';
import { Preview } from '../src/preview/index.js';
import { PORTAL_SECTIONS } from '../src/preview/portal.js';

const ROLES: Role[] = ['developer', 'lead', 'admin', 'tester', 'client'];
const TOP = [
  '',
  'inbox',
  'projects',
  'agents',
  'activity',
  'people',
  'tokens',
  'releases',
  'command', // [PCODE-210 | S15 | v0.1.0]
  'insights',
  'clients',
  'incidents',
  'time',
  'settings',
  'sync',
];
const ROUTES = [
  ...TOP,
  ...PORTAL_SECTIONS.map((s) => s.key),
  ...PROJECTS.flatMap((p) =>
    PROJECT_TABS.map((t) => 'projects/' + p.key + (t.key === 'overview' ? '' : '/' + t.key)),
  ),
];

const render = (route: string, role: Role): string =>
  renderToString(
    <Preview path={'/preview' + (route ? '/' + route : '') + '?as=' + role} />,
  ).replace(/<!-- -->/g, '');

describe('the full click-through', () => {
  it(
    'renders every page for every role (' + String(ROUTES.length * ROLES.length) + ' pages)',
    () => {
      for (const role of ROLES)
        for (const route of ROUTES) {
          const html = render(route, role);
          expect(html, route + ' as ' + role).toContain('pv-app');
          // no page of the preview links outside it
          for (const m of html.matchAll(/href="([^"]+)"/g))
            expect(m[1], route).toMatch(/^\/preview/);
        }
    },
    60_000,
  );

  it('keeps a client inside their portal on every address', { timeout: 60_000 }, () => {
    for (const route of ROUTES) {
      const html = render(route, 'client');
      expect(html, route).not.toContain('Nordwind');
      expect(html, route).not.toContain('Aurum');
      expect(html, route).not.toContain('Internal:');
      expect(html, route).not.toContain('Pause all agents');
      expect(html, route).not.toContain('Tokens and costs');
    }
    expect(render('agents', 'client')).toContain('Not part of your portal');
    expect(render('projects/NWL', 'client')).toContain('Not part of your portal');
    // their own project: the overview only
    const own = render('projects/HEL/codemap', 'client');
    expect(own).toContain('Patient app');
    expect(own).not.toContain('Code by feature');
  });
});
