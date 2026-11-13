// ── [PCODE-420 | S15 | v0.1.0] T37 medium: English screens use English number and date formats ──
// ── [PCODE-417 | S15 | v0.1.0] T37 medium: Members do not see the Administration group they cannot use ──
// ── [PCODE-416 | S15 | v0.1.0] T37 high: A person in two workspaces can switch between them ──
// ── [PCODE-411 | S15 | v0.1.0] T36.6 Keyboard-only and screen-reader passes ──
// ── [PCODE-235 | S15 | v0.1.0] T23.2 Messages in the web app ──
// ── [PCODE-210 | S15 | v0.1.0] T18.2 Command center screen: lanes with people and agents, heatmap, alerts, 24 h replay slider (design preview and live) ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-186 | S15 | v0.1.0] B7.2 Client portal live: roadmap, acceptance tests, approvals, releases with ratings, shared documents ──
// ── [PCODE-185 | S15 | v0.1.0] B7.1 Client requests live: portal requests, threads with internal notes, response times, change requests with impact and signature, ratings ──
// ── [PCODE-164 | S15 | v0.1.0] B1.3 The v2 shell live in the web app: Home per role, Inbox, Clients, portal mode, settings ──
//    Why:  the shell approved at gate A1, on live data, around every signed-in page. The sidebar carries the
//          whole map for the team (projects are one part of it) and the portal's map for a client contact;
//          the top bar shows search, agents at work, today's AI spend in euro, the VS Code connection, who
//          is online and the inbox. Its numbers come from /shell and refresh when events arrive.
import type { PresenceEntry } from '@orqiva/shared';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { api, type Me } from '../core/api.js';
import type { EventHub } from '../core/hub.js';
import type { AppRoute } from '../core/nav.js';
import { PIcon, type PIconName } from '../preview/picons.js';
import { Kbd } from '../preview/ui.js';
import type { ThemeChoice } from '../core/theme.js';
import { LATER } from './later.js';
import { PORTAL_PAGES } from './portal.js'; // [PCODE-186 | S15 | v0.1.0]
import { fmtLocale } from '../core/locale.js'; // [PCODE-420 | S15 | v0.1.0]

export interface ShellSummary {
  role: string;
  inbox: { open: number; unread: number };
  agents: { running: number; waiting: number; queued: number };
  spend: {
    todayCents: number;
    monthCents: number;
    usdEur: number;
    rateDate: string | null;
    rateSource: string;
  };
  ide: { connected: boolean; lastSeen: string | null };
}

export interface NavProjectV2 {
  id: string;
  key: string;
  name: string;
}

/** Money as the owner decided at gate A1: German format, euro. */
export const euroCents = (cents: number, digits = 2): string =>
  new Intl.NumberFormat(fmtLocale(), {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(cents / 100);

const isTeam = (role: string): boolean => role !== 'guest';
const isAdmin = (role: string): boolean => role === 'admin' || role === 'owner';

/** The shell's numbers, read again when something happens in the workspace (at most every 2 s) and each minute. */
export function useShellSummary(workspaceId: string, hub: EventHub): ShellSummary | null {
  const [summary, setSummary] = useState<ShellSummary | null>(null);
  const timer = useRef<number | null>(null);
  const load = useCallback(async () => {
    const r = await api<ShellSummary>('GET', '/api/workspaces/' + workspaceId + '/shell');
    if (r.ok) setSummary(r.data);
  }, [workspaceId]);
  useEffect(() => {
    void load();
    const minute = window.setInterval(() => void load(), 60_000);
    const off = hub.on(() => {
      if (timer.current !== null) return;
      timer.current = window.setTimeout(() => {
        timer.current = null;
        void load();
      }, 2000);
    });
    return () => {
      window.clearInterval(minute);
      if (timer.current !== null) window.clearTimeout(timer.current);
      off();
    };
  }, [load, hub]);
  return summary;
}

const TONES = 6;
const toneOf = (id: string): number => {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return (h % TONES) + 1;
};
const initials = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('') || '?';

export function LiveAvatar(props: {
  id: string;
  name: string;
  size?: 'xs' | 'sm' | 'md';
  online?: boolean;
  agent?: boolean;
}): ReactNode {
  return (
    <span
      className={
        'pv-avatar pv-avatar--' +
        (props.size ?? 'sm') +
        ' pv-tone-' +
        String(toneOf(props.id)) +
        (props.agent ? ' pv-avatar--agent' : '')
      }
      title={props.name}
    >
      {props.agent ? <PIcon name="agents" size={12} /> : initials(props.name)}
      {props.online ? <span className="pv-presence" aria-label="online" /> : null}
    </span>
  );
}

interface NavEntry {
  to: string;
  label: string;
  icon: PIconName;
  match: (r: AppRoute) => boolean;
  show?: (role: string) => boolean;
  badge?: 'inbox' | 'messages'; // [PCODE-235 | S15 | v0.1.0]
}

const later = (s: string) => (r: AppRoute) => r.kind === 'later' && r.section === s;

const TEAM: { label: string | null; items: NavEntry[] }[] = [
  {
    label: null,
    items: [
      { to: '/', label: 'Home', icon: 'home', match: (r) => r.kind === 'home' },
      // [PCODE-210 | S15 | v0.1.0]
      { to: '/command', label: 'Command center', icon: 'live', match: (r) => r.kind === 'command' },
      {
        to: '/inbox',
        label: 'Inbox',
        icon: 'inbox',
        match: (r) => r.kind === 'inbox',
        badge: 'inbox',
      },
      // [PCODE-235 | S15 | v0.1.0] the team's own conversations
      {
        to: '/messages',
        label: 'Messages',
        icon: 'chat',
        match: (r) => r.kind === 'messages',
        badge: 'messages',
      },
      { to: '/my-work', label: 'My work', icon: 'planning', match: (r) => r.kind === 'my-work' },
    ],
  },
  {
    label: 'Delivery',
    items: [
      { to: '/projects', label: 'Projects', icon: 'projects', match: (r) => r.kind === 'projects' },
      // [PCODE-185 | S15 | v0.1.0] a request belongs to Clients
      {
        to: '/clients',
        label: 'Clients',
        icon: 'clients',
        match: (r) => r.kind === 'clients' || r.kind === 'requests' || r.kind === 'portal', // [PCODE-186 | S15 | v0.1.0]
      },
      { to: '/releases', label: 'Releases', icon: 'releases', match: later('releases') },
      { to: '/incidents', label: 'Incidents', icon: 'incidents', match: later('incidents') },
      { to: '/time', label: 'Time', icon: 'time', match: later('time') },
    ],
  },
  {
    label: 'Engineering',
    items: [
      {
        to: '/agents',
        label: 'Agents',
        icon: 'agents',
        match: (r) => r.kind === 'agents' || r.kind === 'run',
      },
      { to: '/activity', label: 'Activity', icon: 'activity', match: (r) => r.kind === 'activity' },
      {
        to: '/insights',
        label: 'Insights',
        icon: 'insights',
        match: later('insights'),
        show: (role) => isAdmin(role) || role === 'auditor',
      },
    ],
  },
  {
    label: 'Administration',
    items: [
      {
        to: '/people',
        label: 'People',
        icon: 'people',
        match: later('people'),
        show: (role) => isAdmin(role) || role === 'auditor',
      },
      {
        to: '/tokens',
        label: 'Tokens and costs',
        icon: 'tokens',
        match: later('tokens'),
        show: (role) => role !== 'tester' && role !== 'designer',
      },
      { to: '/settings', label: 'Settings', icon: 'settings', match: (r) => r.kind === 'settings' },
    ],
  },
];

const PORTAL: { label: string | null; items: NavEntry[] }[] = [
  {
    label: null,
    items: [
      { to: '/', label: 'Home', icon: 'home', match: (r) => r.kind === 'home' },
      {
        to: '/inbox',
        label: 'Waiting for you',
        icon: 'inbox',
        match: (r) => r.kind === 'inbox',
        badge: 'inbox',
      },
      // [PCODE-235 | S15 | v0.1.0] the client's channel with the team
      {
        to: '/messages',
        label: 'Messages',
        icon: 'chat',
        match: (r) => r.kind === 'messages',
        badge: 'messages',
      },
    ],
  },
  {
    label: 'Your projects',
    items: [
      { to: '/projects', label: 'Projects', icon: 'projects', match: (r) => r.kind === 'projects' },
      // [PCODE-185 | S15 | v0.1.0] the client's requests
      { to: '/requests', label: 'Requests', icon: 'request', match: (r) => r.kind === 'requests' },
      // [PCODE-186 | S15 | v0.1.0] the portal's sections
      ...PORTAL_PAGES.map((p): NavEntry => ({
        to: '/portal/' + p.key,
        label: p.label,
        icon: p.icon,
        match: (r) => r.kind === 'portal' && r.section === p.key,
      })),
    ],
  },
  {
    label: null,
    items: [
      {
        to: '/settings/profile',
        label: 'Your profile',
        icon: 'user',
        match: (r) => r.kind === 'settings',
      },
    ],
  },
];

const follow =
  (to: string, go: (p: string) => void) =>
  (e: { preventDefault: () => void; metaKey?: boolean; ctrlKey?: boolean }) => {
    if (e.metaKey || e.ctrlKey) return;
    e.preventDefault();
    go(to);
  };

function Sidebar(props: {
  me: Me;
  workspaceId: string; // [PCODE-416 | S15 | v0.1.0]
  onSwitchWorkspace?: (id: string) => void;
  workspaceName: string;
  role: string;
  client: { name: string } | null;
  route: AppRoute;
  projects: NavProjectV2[];
  currentProjectId: string | null;
  inbox: number;
  /** [PCODE-235 | S15 | v0.1.0] unread conversations */
  messages: number;
  open: boolean;
  onClose: () => void;
  go: (p: string) => void;
}): ReactNode {
  const groups = props.client ? PORTAL : TEAM;
  return (
    <nav
      className={'pv-sidebar' + (props.open ? ' pv-sidebar--open' : '')}
      aria-label="Sections"
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('a')) props.onClose();
      }}
    >
      <div className="pv-ws">
        <span className="pv-ws-logo" aria-hidden="true">
          <svg width="28" height="28" viewBox="0 0 32 32">
            <rect className="pv-logo-tile" x="1" y="1" width="30" height="30" rx="8" />
            <path
              d="M10 22V10h6.5a4.5 4.5 0 0 1 0 9H10"
              className="pv-logo-mark"
              fill="none"
              strokeWidth="2.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <circle className="pv-logo-dot" cx="22.5" cy="22.5" r="2.6" />
          </svg>
        </span>
        <span className="pv-ws-text">
          <span className="pv-ws-name">
            {props.client ? props.client.name : props.workspaceName}
          </span>
          <span className="pv-ws-plan">
            {props.client ? 'Client portal · ' + props.workspaceName : roleLabel(props.role)}
          </span>
        </span>
        {/* [PCODE-416 | S15 | v0.1.0] the other workspaces this person belongs to */}
        {props.onSwitchWorkspace && props.me.workspaces.length > 1 ? (
          <details className="pv-ws-switch">
            <summary aria-label="Switch workspace">
              <PIcon name="chevronDown" size={14} />
            </summary>
            <div className="pv-ws-list" role="menu">
              {props.me.workspaces.map((w) => (
                <button
                  key={w.id}
                  type="button"
                  role="menuitem"
                  className="pv-ws-choice"
                  aria-current={w.id === props.workspaceId ? 'true' : undefined}
                  onClick={(e) => {
                    e.currentTarget.closest('details')?.removeAttribute('open');
                    if (w.id !== props.workspaceId) props.onSwitchWorkspace?.(w.id);
                  }}
                >
                  <span>{w.client ? w.client.name : w.name}</span>
                  <span className="pv-muted pv-small">
                    {w.client ? 'Client portal' : roleLabel(w.role)}
                  </span>
                </button>
              ))}
            </div>
          </details>
        ) : null}
      </div>
      <div className="pv-nav-scroll">
        {groups.map((g, gi) => {
          const items = g.items.filter((i) => !i.show || i.show(props.role));
          if (!items.length) return null;
          return (
            <div key={gi} className="pv-nav-group">
              {/* [PCODE-417 | S15 | v0.1.0] a member's own settings and costs are not administration */}
              {g.label ? (
                <div className="pv-nav-heading">
                  {g.label === 'Administration' && !isAdmin(props.role) && props.role !== 'auditor'
                    ? 'Your account'
                    : g.label}
                </div>
              ) : null}
              {items.map((i) => (
                <div key={i.to}>
                  <a
                    href={i.to}
                    className="pv-nav-item"
                    aria-current={i.match(props.route) ? 'page' : undefined}
                    onClick={follow(i.to, props.go)}
                  >
                    <PIcon name={i.icon} />
                    <span className="pv-nav-label">{i.label}</span>
                    {i.badge === 'inbox' && props.inbox ? (
                      <span className="pv-nav-badge">{props.inbox}</span>
                    ) : null}
                    {i.badge === 'messages' && props.messages ? (
                      <span className="pv-nav-badge">{props.messages}</span>
                    ) : null}
                  </a>
                  {i.to === '/projects' && props.projects.length ? (
                    <div className="pv-nav-projects">
                      {props.projects.map((p) => (
                        <a
                          key={p.id}
                          href={'/projects/' + p.id}
                          className="pv-nav-sub"
                          aria-current={props.currentProjectId === p.id ? 'page' : undefined}
                          onClick={follow('/projects/' + p.id, props.go)}
                        >
                          <span className="pv-mono pv-nav-key">{p.key}</span>
                          <span className="pv-nav-label">{p.name}</span>
                        </a>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          );
        })}
      </div>
      <div className="pv-sidebar-foot">
        <span className="pv-who pv-small">
          <LiveAvatar id={props.me.user.id} name={props.me.user.name} size="xs" />
          <span className="pv-nav-label">{props.me.user.name}</span>
        </span>
      </div>
    </nav>
  );
}

export const roleLabel = (role: string): string =>
  ({
    owner: 'Owner',
    admin: 'Admin',
    member: 'Member',
    tester: 'Tester',
    designer: 'Designer',
    billing: 'Billing',
    auditor: 'Auditor',
    guest: 'Guest',
  })[role] ?? role;

export function crumbOf(r: AppRoute): string {
  switch (r.kind) {
    case 'home':
      return 'Home';
    case 'inbox':
      return 'Inbox';
    case 'messages': // [PCODE-235 | S15 | v0.1.0]
      return 'Messages';
    case 'command': // [PCODE-210 | S15 | v0.1.0]
      return 'Command center';
    case 'my-work':
      return 'My work';
    case 'projects':
      return 'Projects';
    case 'project':
      return 'Project';
    case 'item':
      return 'Task';
    case 'activity':
      return 'Activity';
    case 'agents':
      return 'Agents';
    case 'run':
      return 'Agent run';
    case 'idea':
      return 'Idea';
    case 'deploy':
      return 'Deploy';
    case 'test-run':
      return 'Test run';
    case 'finding':
      return 'Finding';
    case 'settings':
      return 'Settings';
    case 'clients':
      return 'Clients';
    case 'requests': // [PCODE-185 | S15 | v0.1.0]
      return 'Requests';
    case 'portal': // [PCODE-186 | S15 | v0.1.0]
      return PORTAL_PAGES.find((p) => p.key === r.section)?.label ?? 'Portal';
    case 'later':
      return LATER[r.section].title;
  }
}

function AccountMenu(props: {
  me: Me;
  theme: ThemeChoice;
  onTheme: (t: ThemeChoice) => void;
  onLogout: () => void;
  go: (p: string) => void;
}): ReactNode {
  const [open, setOpen] = useState(false);
  return (
    <div className="v2-account">
      <button
        type="button"
        className="v2-account-btn"
        aria-expanded={open}
        aria-label="Your account"
        onClick={() => {
          setOpen((o) => !o);
        }}
      >
        <LiveAvatar id={props.me.user.id} name={props.me.user.name} size="md" />
      </button>
      {open ? (
        <div className="v2-menu" role="menu">
          <div className="v2-menu-head">
            <strong>{props.me.user.name}</strong>
            <span className="pv-muted pv-small">{props.me.user.email}</span>
          </div>
          <button
            type="button"
            role="menuitem"
            className="v2-menu-item"
            onClick={() => {
              setOpen(false);
              props.go('/settings/profile');
            }}
          >
            <PIcon name="user" size={16} /> Profile and settings
          </button>
          <button
            type="button"
            role="menuitem"
            className="v2-menu-item"
            onClick={() => {
              props.onTheme(props.theme === 'dark' ? 'light' : 'dark');
            }}
          >
            <PIcon name={props.theme === 'dark' ? 'sun' : 'moon'} size={16} />{' '}
            {props.theme === 'dark' ? 'Light' : 'Dark'} theme
          </button>
          <button type="button" role="menuitem" className="v2-menu-item" onClick={props.onLogout}>
            <PIcon name="external" size={16} /> Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function ShellV2(props: {
  me: Me;
  workspaceId: string;
  workspaceName: string;
  role: string;
  client: { name: string } | null;
  route: AppRoute;
  projects: NavProjectV2[];
  currentProjectId: string | null;
  online: boolean;
  pending: number;
  people: PresenceEntry[];
  summary: ShellSummary | null;
  /** [PCODE-235 | S15 | v0.1.0] unread conversations, for the rail */
  messages?: number;
  theme: ThemeChoice;
  onTheme: (t: ThemeChoice) => void;
  onLogout: () => void;
  onSearch: () => void;
  /** a new task from anywhere; absent for those who only read */
  onNewTask?: () => void;
  /** [PCODE-416 | S15 | v0.1.0] */
  onSwitchWorkspace?: (id: string) => void;
  go: (p: string) => void;
  children: ReactNode;
}): ReactNode {
  const [menu, setMenu] = useState(false);
  const s = props.summary;
  const team = isTeam(props.role) && !props.client;
  const others = props.people.filter((p) => p.kind === 'user' && p.userId !== props.me.user.id);
  return (
    <div className="v2-app">
      {/* [PCODE-411 | S15 | v0.1.0] the keyboard's way past the sidebar and the top bar */}
      <a className="pe-skip" href="#pv-main">
        Skip to content
      </a>
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
        <div className="pv-app v2-part">
          <Sidebar
            me={props.me}
            workspaceId={props.workspaceId}
            {...(props.onSwitchWorkspace ? { onSwitchWorkspace: props.onSwitchWorkspace } : {})}
            workspaceName={props.workspaceName}
            role={props.role}
            client={props.client}
            route={props.route}
            projects={props.projects}
            currentProjectId={props.currentProjectId}
            inbox={s?.inbox.open ?? 0}
            messages={props.messages ?? 0}
            open={menu}
            onClose={() => {
              setMenu(false);
            }}
            go={props.go}
          />
        </div>
        <div className="pv-main">
          <div className="pv-app v2-part">
            <header className="pv-topbar">
              <button
                type="button"
                className="pv-menu-btn"
                aria-label="Menu"
                onClick={() => {
                  setMenu((m) => !m);
                }}
              >
                <PIcon name="overview" />
              </button>
              <ol className="pv-crumbs" aria-label="Where you are">
                <li>
                  <span aria-current="page">
                    {props.client && props.route.kind === 'inbox'
                      ? 'Waiting for you'
                      : crumbOf(props.route)}
                  </span>
                </li>
              </ol>
              <button type="button" className="pv-search" onClick={props.onSearch}>
                <PIcon name="search" size={16} />
                <span>Search or jump to…</span>
                <span className="pv-search-keys">
                  <Kbd>Ctrl</Kbd>
                  <Kbd>K</Kbd>
                </span>
              </button>
              <div className="pv-topbar-right">
                {!props.online ? (
                  <span
                    className="pv-pill v2-pill--offline"
                    title={
                      props.pending
                        ? String(props.pending) + ' changes wait to be sent'
                        : 'Reconnecting'
                    }
                  >
                    <PIcon name="live" size={14} />{' '}
                    {props.pending ? String(props.pending) + ' waiting' : 'Offline'}
                  </span>
                ) : null}
                {team && s ? (
                  <>
                    <a
                      href="/agents"
                      className="pv-pill pv-pill--agent"
                      onClick={follow('/agents', props.go)}
                      title="Agents at work"
                    >
                      {s.agents.running ? <span className="pv-pulse" aria-hidden="true" /> : null}
                      {s.agents.running} running
                      {s.agents.waiting ? (
                        <span className="pv-pill-warn">· {s.agents.waiting} waiting</span>
                      ) : null}
                    </a>
                    <a
                      href="/tokens"
                      className="pv-pill"
                      onClick={follow('/tokens', props.go)}
                      title={
                        'AI spend this month ' +
                        euroCents(s.spend.monthCents, 0) +
                        ' · rate ' +
                        String(s.spend.usdEur) +
                        ' (' +
                        s.spend.rateSource +
                        ')'
                      }
                    >
                      <PIcon name="euro" size={14} />
                      <span className="pv-num">{euroCents(s.spend.todayCents)}</span>
                      <span className="pv-muted">today</span>
                    </a>
                    <span
                      className={'pv-pill' + (s.ide.connected ? ' pv-pill--ok' : '')}
                      title={
                        s.ide.lastSeen
                          ? 'VS Code last seen ' +
                            new Date(s.ide.lastSeen).toLocaleString(fmtLocale())
                          : 'Connect VS Code with a personal token'
                      }
                    >
                      <PIcon name="ide" size={14} />
                      {s.ide.connected ? 'VS Code synced' : 'VS Code not connected'}
                    </span>
                  </>
                ) : null}
                {others.length ? (
                  <span
                    className="pv-presence-stack"
                    title={others.map((p) => p.name).join(', ') + ' online'}
                  >
                    {others.slice(0, 4).map((p) => (
                      <LiveAvatar key={p.userId} id={p.userId} name={p.name} size="xs" />
                    ))}
                  </span>
                ) : null}
                {team && props.onNewTask ? (
                  <button
                    type="button"
                    className="pv-btn pv-btn--primary pv-btn--sm"
                    onClick={props.onNewTask}
                  >
                    <PIcon name="plus" size={14} /> New task
                  </button>
                ) : null}
                <a
                  href="/inbox"
                  className="pv-icon-btn"
                  onClick={follow('/inbox', props.go)}
                  title="Inbox"
                >
                  <PIcon name="bell" />
                  {s?.inbox.open ? <span className="pv-icon-badge">{s.inbox.open}</span> : null}
                </a>
                <AccountMenu
                  me={props.me}
                  theme={props.theme}
                  onTheme={props.onTheme}
                  onLogout={props.onLogout}
                  go={props.go}
                />
              </div>
            </header>
          </div>
          <main id="pv-main" tabIndex={-1} className="pv-content">
            {props.children}
          </main>
        </div>
      </div>
    </div>
  );
}
