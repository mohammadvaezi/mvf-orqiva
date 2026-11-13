// ── [PCODE-210 | S15 | v0.1.0] T18.2 Command center screen: lanes with people and agents, heatmap, alerts, 24 h replay slider (design preview and live) ──
// ── [PCODE-208 | S15 | v0.1.0] Enterprise density: compact, professional UI across the app (no hero tiles, 13 px base, tighter shell) ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-160 | S15 | v0.1.0] Gate A1 answers: agent-vs-people comparisons for admins only, sign-off recorded ──
// ── [PCODE-159 | S15 | v0.1.0] D7 preview: full click-through, fixes and the gate A1 package ──
// ── [PCODE-158 | S15 | v0.1.0] D6 preview: Clients and portal, Incidents, Time, web and VS Code side by side ──
// ── [PCODE-157 | S15 | v0.1.0] D5 preview: Agents, People, Tokens and costs, Activity, Insights, Settings ──
// ── [PCODE-156 | S15 | v0.1.0] D4 preview: Versions, Security, Code map and Releases ──
// ── [PCODE-155 | S15 | v0.1.0] D3 preview: Documents, UI kit and Test ──
// ── [PCODE-154 | S15 | v0.1.0] D2 preview: Ideation, Planning and Canvas ──
// ── [PCODE-153 | S15 | v0.1.0] D1 preview: design system v2, shell, Cmd-K, Home, Inbox, project overview ──
//    Why:  the preview's root, at /preview. It needs no sign-in and calls no server: it reads the path,
//          keeps the owner's choices (role, light or dark) for this browser, holds the inbox state so
//          counts change everywhere when an item is done, and opens the command palette on Ctrl K.
import { useEffect, useState, type ReactNode } from 'react';
import { navigate } from '../core/nav.js';
import { applyTheme } from '../core/theme.js';
import { project, type Role } from './data.js';
import { HomePage } from './home.js';
import { InboxPage } from './inbox.js';
import { ProjectPage, ProjectsPage, UpcomingPage } from './projects.js';
import {
  BASE,
  Palette,
  PreviewBanner,
  ROLES,
  Sidebar,
  TopBar,
  inboxFor,
  visibleProjects,
} from './shell.js';
import { SECTIONS, TABS } from './upcoming.js';
import { PageHead } from './ui.js';
import './preview.css';
import { CommandPreview } from './command.js'; // [PCODE-210 | S15 | v0.1.0]
// [PCODE-208 | S15 | v0.1.0] the design preview follows the same compact scale
import '../v2/dense.css';
// [PCODE-154 | S15 | v0.1.0]
import './d2.css';
// [PCODE-155 | S15 | v0.1.0]
import './d3.css';
// [PCODE-156 | S15 | v0.1.0]
import './d4.css';
// [PCODE-157 | S15 | v0.1.0]
import './d5.css';
// [PCODE-158 | S15 | v0.1.0]
import './d6.css';
// [PCODE-159 | S15 | v0.1.0]
import './d7.css';
import { ClientsPage } from './clients.js';
import { IdePage } from './ide.js';
import { IncidentsPage } from './incidents.js';
import { ClientPortalPage, PORTAL_SECTIONS } from './portal.js';
import { TimePage } from './time.js';
import { InsightsPage } from './insights.js';
import { ActivityPage } from './pactivity.js';
import { AgentsPage } from './pagents.js';
import { PeoplePage } from './people.js';
import { SettingsPagePreview } from './psettings.js';
import { TokensPage } from './tokens.js';
import { ReleasesPage } from './versions.js';

// [PCODE-157 | S15 | v0.1.0]
const D5: Record<string, { label: string; page: ReactNode }> = {
  agents: { label: 'Agents', page: <AgentsPage /> },
  people: { label: 'People', page: <PeoplePage /> },
  tokens: { label: 'Tokens and costs', page: <TokensPage /> },
  activity: { label: 'Activity', page: <ActivityPage /> },
  insights: { label: 'Insights', page: null },
  settings: { label: 'Settings', page: <SettingsPagePreview /> },
};

export const isPreview = (path: string): boolean => path === BASE || path.startsWith(BASE + '/');

export interface PreviewRoute {
  section: string;
  projectKey: string | null;
  tab: string;
  item: string | null;
}

export function previewRoute(path: string): PreviewRoute {
  const [p = '', query = ''] = path.slice(BASE.length).split('?');
  const parts = p.split('/').filter(Boolean);
  const item = new URLSearchParams(query).get('item');
  if (parts[0] === 'projects' && parts[1])
    return {
      section: 'projects',
      projectKey: parts[1].toUpperCase(),
      tab: parts[2] ?? 'overview',
      item,
    };
  return { section: parts[0] ?? '', projectKey: null, tab: 'overview', item };
}

const remember = <T extends string>(key: string, fallback: T, allowed: readonly string[]): T => {
  try {
    const v = window.localStorage.getItem(key);
    return v && allowed.includes(v) ? (v as T) : fallback;
  } catch {
    return fallback;
  }
};
const keep = (key: string, value: string): void => {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // private window: the choice lasts for this page only
  }
};

export function Preview(props: { path: string }): ReactNode {
  const route = previewRoute(props.path);
  // a shared link may name the view: ?as=client&theme=dark&palette=1
  // [PCODE-159 | S15 | v0.1.0] read from the path the app passes in, so the preview also renders without a browser
  const query = new URLSearchParams(props.path.split('?')[1] ?? '');
  const asRole = ROLES.find((r) => r.key === query.get('as'))?.key;
  const [role, setRole] = useState<Role>(
    () =>
      asRole ??
      remember<Role>(
        'pv-role',
        'lead',
        ROLES.map((r) => r.key),
      ),
  );
  const [dark, setDark] = useState<boolean>(() =>
    query.has('theme')
      ? query.get('theme') === 'dark'
      : remember<string>('pv-dark', '0', ['0', '1']) === '1',
  );
  const [palette, setPalette] = useState(query.get('palette') === '1');
  const [collapsed, setCollapsed] = useState(false);
  // [PCODE-159 | S15 | v0.1.0] the phone menu
  const [menu, setMenu] = useState(false);
  const [done, setDone] = useState<Set<string>>(new Set());
  const [snoozed, setSnoozed] = useState<Set<string>>(new Set());
  const [history, setHistory] = useState<{ id: string; kind: 'done' | 'snoozed' }[]>([]);
  const [selected, setSelected] = useState<string | null>(route.item);

  const go = (p: string): void => {
    navigate(BASE + p);
  };
  useEffect(() => {
    applyTheme(dark ? 'dark' : 'light');
  }, [dark]);
  useEffect(() => {
    document.title = 'Orqiva preview';
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPalette((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, []);
  useEffect(() => {
    if (route.item) setSelected(route.item);
  }, [route.item]);

  const items = inboxFor(role);
  const open = items.filter((i) => !done.has(i.id) && !snoozed.has(i.id));
  const mark = (id: string, kind: 'done' | 'snoozed'): void => {
    (kind === 'done' ? setDone : setSnoozed)((s) => new Set(s).add(id));
    setHistory((h) => [...h, { id, kind }]);
    const next = open.filter((i) => i.id !== id);
    const at = open.findIndex((i) => i.id === id);
    setSelected(next[Math.min(at, next.length - 1)]?.id ?? null);
  };
  const undo = (): void => {
    const last = history[history.length - 1];
    if (!last) return;
    (last.kind === 'done' ? setDone : setSnoozed)((s) => {
      const n = new Set(s);
      n.delete(last.id);
      return n;
    });
    setHistory((h) => h.slice(0, -1));
    setSelected(last.id);
  };

  let page: ReactNode;
  const crumbs: { label: string; to?: string }[] = [];
  // [PCODE-159 | S15 | v0.1.0] a client reaches only the portal: home, inbox, their projects and the portal sections
  const clientMayOpen =
    route.section === '' ||
    route.section === 'inbox' ||
    PORTAL_SECTIONS.some((s) => s.key === route.section) ||
    (route.section === 'projects' &&
      (!route.projectKey || visibleProjects('client').some((p) => p.key === route.projectKey)));
  if (role === 'client' && !clientMayOpen) {
    page = (
      <div className="pv-page">
        <PageHead
          title="Not part of your portal"
          sub="This page belongs to the team. Everything shared with you is in the menu on the left."
          icon="lock"
        />
      </div>
    );
    crumbs.push({ label: 'Not available' });
  } else if (route.section === '') {
    page = <HomePage role={role} inbox={open} go={go} />;
    crumbs.push({ label: 'Home' });
  } else if (route.section === 'command') {
    // [PCODE-210 | S15 | v0.1.0] the command center, designed in T18
    page = <CommandPreview />;
    crumbs.push({ label: 'Command center' });
  } else if (route.section === 'inbox') {
    page = (
      <InboxPage
        items={items}
        done={done}
        snoozed={snoozed}
        selected={selected}
        onSelect={setSelected}
        onDone={(id) => {
          mark(id, 'done');
        }}
        onSnooze={(id) => {
          mark(id, 'snoozed');
        }}
        onUndo={undo}
      />
    );
    crumbs.push({ label: 'Inbox' });
  } else if (route.section === 'projects' && route.projectKey) {
    const p = project(route.projectKey);
    page = <ProjectPage pkey={route.projectKey} tab={route.tab} role={role} go={go} />;
    crumbs.push(
      { label: 'Projects', to: '/projects' },
      { label: p ? p.key + ' ' + p.name : route.projectKey },
    );
    if (route.tab !== 'overview') crumbs.push({ label: TABS[route.tab]?.title ?? route.tab });
  } else if (role === 'client' && PORTAL_SECTIONS.some((s) => s.key === route.section)) {
    // [PCODE-158 | S15 | v0.1.0] the client portal
    page = <ClientPortalPage section={route.section} />;
    crumbs.push({ label: PORTAL_SECTIONS.find((s) => s.key === route.section)?.label ?? '' });
  } else if (route.section === 'clients') {
    page = (
      <ClientsPage
        onViewAsClient={() => {
          setRole('client');
          keep('pv-role', 'client');
          go('');
        }}
      />
    );
    crumbs.push({ label: 'Clients' });
  } else if (route.section === 'incidents') {
    page = <IncidentsPage />;
    crumbs.push({ label: 'Incidents and on-call' });
  } else if (route.section === 'time') {
    page = <TimePage />;
    crumbs.push({ label: 'Time' });
  } else if (route.section === 'sync') {
    page = <IdePage />;
    crumbs.push({ label: 'Web app and VS Code' });
  } else if (D5[route.section]) {
    // [PCODE-157 | S15 | v0.1.0] the platform sections designed in D5
    const s = D5[route.section];
    // [PCODE-160 | S15 | v0.1.0] Insights depends on the role
    page = route.section === 'insights' ? <InsightsPage role={role} /> : s?.page;
    crumbs.push({ label: s?.label ?? '' });
  } else if (route.section === 'releases') {
    // [PCODE-156 | S15 | v0.1.0] designed in D4
    page = <ReleasesPage />;
    crumbs.push({ label: 'Releases and environments' });
  } else if (route.section === 'projects') {
    page = <ProjectsPage role={role} go={go} />;
    crumbs.push({ label: 'Projects' });
  } else {
    const u = SECTIONS[route.section];
    page = u ? (
      <UpcomingPage u={u} />
    ) : (
      <UpcomingPage
        u={{
          title: 'Not found',
          icon: 'search',
          step: '—',
          summary: 'This page does not exist in the preview.',
          highlights: [],
        }}
      />
    );
    crumbs.push({ label: u?.title ?? 'Not found' });
  }

  return (
    <div className="pv-app">
      <PreviewBanner
        role={role}
        onRole={(r) => {
          setRole(r);
          keep('pv-role', r);
          setSelected(null);
        }}
        dark={dark}
        onDark={() => {
          setDark((d) => {
            keep('pv-dark', d ? '0' : '1');
            return !d;
          });
        }}
      />
      <div className="pv-frame">
        {menu ? (
          <div
            className="pv-menu-scrim"
            role="presentation"
            onClick={() => {
              setMenu(false);
            }}
          />
        ) : null}
        <Sidebar
          section={route.section}
          projectKey={route.projectKey}
          role={role}
          inboxCount={open.length}
          collapsed={collapsed}
          onCollapse={() => {
            setCollapsed((c) => !c);
          }}
          open={menu}
          onClose={() => {
            setMenu(false);
          }}
          go={go}
        />
        <div className="pv-main">
          <TopBar
            crumbs={crumbs}
            role={role}
            inboxCount={open.length}
            onSearch={() => {
              setPalette(true);
            }}
            onMenu={() => {
              setMenu((m) => !m);
            }}
            go={go}
          />
          <main className="pv-content">{page}</main>
        </div>
      </div>
      {palette ? (
        <Palette
          role={role}
          onClose={() => {
            setPalette(false);
          }}
          go={go}
          onDark={() => {
            setDark((d) => !d);
          }}
        />
      ) : null}
    </div>
  );
}
