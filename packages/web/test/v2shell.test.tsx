// ── [PCODE-164 | S15 | v0.1.0] B1.3 The v2 shell live in the web app: Home per role, Inbox, Clients, portal mode, settings ──
//    Why:  the approved shell renders the team's whole map or the portal's map, with the live numbers from
//          /shell (German euro format); a client contact cannot open the team's pages; the new addresses
//          resolve; sections of later steps say which step brings them.
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EventHub } from '../src/core/hub.js';
import { appRoute, type AppRoute } from '../src/core/nav.js';
import { ago, InboxV2, tomorrowMorning } from '../src/v2/inbox.js';
import { LaterPage } from '../src/v2/later.js';
import { portalAllows } from '../src/v2/portal.js';
import { showValue } from '../src/v2/settings.js';
import { crumbOf, euroCents, ShellV2, type ShellSummary } from '../src/v2/shell.js';

const noop = (): void => undefined;
const text = (html: string): string => html.replace(/<!-- -->/g, '');

const summary: ShellSummary = {
  role: 'admin',
  inbox: { open: 7, unread: 3 },
  agents: { running: 2, waiting: 1, queued: 0 },
  spend: {
    todayCents: 128_650,
    monthCents: 1_286_000,
    usdEur: 0.92,
    rateDate: '2026-10-04',
    rateSource: 'ecb',
  },
  ide: { connected: true, lastSeen: '2026-10-04T08:00:00Z' },
};

const shell = (
  role: string,
  client: { name: string } | null,
  route: AppRoute = { kind: 'home' },
): string =>
  text(
    renderToString(
      <ShellV2
        me={{ user: { id: 'u1', email: 'ada@example.com', name: 'Ada Lovelace' }, workspaces: [] }}
        workspaceId="w1"
        workspaceName="Broszio"
        role={role}
        client={client}
        route={route}
        projects={[{ id: 'p1', key: 'HEL', name: 'Helio app' }]}
        currentProjectId={null}
        online
        pending={0}
        people={[]}
        summary={summary}
        theme="light"
        onTheme={noop}
        onLogout={noop}
        onSearch={noop}
        onNewTask={noop}
        go={noop}
      >
        <p>page</p>
      </ShellV2>,
    ),
  );

describe('v2 shell', () => {
  it('shows the team the whole map, live numbers in euro and the page', () => {
    const html = shell('admin', null);
    for (const label of [
      'Home',
      'Inbox',
      'My work',
      'Projects',
      'Clients',
      'Releases',
      'Incidents',
      'Time',
      'Agents',
      'Activity',
      'Insights',
      'People',
      'Tokens and costs',
      'Settings',
    ])
      expect(html).toContain('>' + label + '</span>');
    expect(html).toContain('1.286,50 €');
    expect(html).toContain('2 running');
    expect(html).toContain('· 1 waiting');
    expect(html).toContain('VS Code synced');
    expect(html).toContain('New task');
    expect(html).toContain('<p>page</p>');
    expect(html).toContain('pv-nav-badge">7<');
  });

  it('keeps leads’ sections from members and the money from testers', () => {
    const member = shell('member', null);
    expect(member).not.toContain('>Insights</span>');
    expect(member).not.toContain('>People</span>');
    expect(shell('tester', null)).not.toContain('>Tokens and costs</span>');
  });

  it('gives a client contact the portal map: no agents, no spend, no team sections', () => {
    const html = shell('guest', { name: 'Helio Health AG' });
    expect(html).toContain('Helio Health AG');
    expect(html).toContain('Client portal · Broszio');
    expect(html).toContain('>Waiting for you</span>');
    expect(html).toContain('>Your profile</span>');
    for (const hidden of [
      '>Agents</span>',
      '>Clients</span>',
      '>Activity</span>',
      'running',
      'today',
      'VS Code',
      'New task',
    ])
      expect(html).not.toContain(hidden);
  });

  it('lets a client contact open only the portal’s pages', () => {
    for (const ok of [
      '/',
      '/inbox',
      '/projects',
      '/projects/0b1f6a52-3c1e-4d7a-9a51-2f0f6c1d2e3a',
      '/projects/0b1f6a52-3c1e-4d7a-9a51-2f0f6c1d2e3a/board',
      '/items/0b1f6a52-3c1e-4d7a-9a51-2f0f6c1d2e3a',
      '/settings/profile',
    ])
      expect(portalAllows(appRoute(ok)), ok).toBe(true);
    for (const no of [
      '/agents',
      '/activity',
      '/clients',
      '/my-work',
      '/tokens',
      '/settings/members',
      '/projects/0b1f6a52-3c1e-4d7a-9a51-2f0f6c1d2e3a/git',
    ])
      expect(portalAllows(appRoute(no)), no).toBe(false);
  });

  it('resolves the new addresses and names them in the crumbs', () => {
    expect(appRoute('/inbox')).toEqual({ kind: 'inbox' });
    expect(appRoute('/clients')).toEqual({ kind: 'clients' });
    expect(appRoute('/tokens')).toEqual({ kind: 'later', section: 'tokens' });
    expect(crumbOf(appRoute('/tokens'))).toBe('Tokens and costs');
  });

  it('says which step brings a later section and links its design', () => {
    const html = text(renderToString(<LaterPage section="incidents" go={noop} />));
    expect(html).toContain('Incidents comes with step B7.');
    expect(html).toContain('href="/preview/incidents"');
  });

  it('renders the inbox frame before its data arrives, with the keys', () => {
    const html = text(
      renderToString(
        <InboxV2 workspaceId="w1" role="member" portal={false} hub={new EventHub()} go={noop} />,
      ),
    );
    expect(html).toContain('>Inbox</h1>');
    expect(html).toContain('Mark all read');
    expect(html).toContain('snooze');
  });

  it('formats money, ages, snooze times and setting values', () => {
    expect(euroCents(128_650)).toBe('1.286,50 €');
    expect(euroCents(1_286_000, 0)).toBe('12.860 €');
    const now = Date.parse('2026-10-04T12:00:00Z');
    expect(ago('2026-10-04T11:56:00Z', now)).toBe('4 min');
    expect(ago('2026-10-04T09:00:00Z', now)).toBe('3 h');
    expect(ago('2026-10-01T12:00:00Z', now)).toBe('3 d');
    const t = new Date(tomorrowMorning(new Date(2026, 9, 4, 22, 30)));
    expect([t.getDate(), t.getHours(), t.getMinutes()]).toEqual([5, 8, 0]);
    expect(showValue(['mon', 'tue'])).toBe('mon, tue');
    expect(showValue({ from: '08:00', to: '18:00' })).toBe('08:00 – 18:00');
    expect(showValue(true)).toBe('Yes');
  });
});
