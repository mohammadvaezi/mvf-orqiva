// ── [PCODE-210 | S15 | v0.1.0] T18.2 Command center screen: lanes with people and agents, heatmap, alerts, 24 h replay slider (design preview and live) ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-159 | S15 | v0.1.0] D7 preview: full click-through, fixes and the gate A1 package ──
// ── [PCODE-158 | S15 | v0.1.0] D6 preview: Clients and portal, Incidents, Time, web and VS Code side by side ──
// ── [PCODE-153 | S15 | v0.1.0] D1 preview: design system v2, shell, Cmd-K, Home, Inbox, project overview ──
//    Why:  the frame every screen of the command center lives in. A banner says this is the preview and
//          lets the owner look through each role's eyes; the sidebar holds the whole map of the platform
//          (projects are one part of it); the top bar keeps search, running agents, today's AI spend in euro,
//          the IDE connection and the inbox in sight everywhere.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  AGENTS_LIVE,
  CLIENTS,
  INBOX,
  PEOPLE,
  PROJECTS,
  SPEND,
  WORKSPACE,
  euro,
  type Role,
} from './data.js';
import { PIcon, type PIconName } from './picons.js';
import { PORTAL_SECTIONS } from './portal.js';
import { Avatar, Kbd } from './ui.js';

export const BASE = '/preview';

export function link(
  to: string,
  go: (p: string) => void,
): (e: { preventDefault: () => void; metaKey?: boolean; ctrlKey?: boolean }) => void {
  return (e: { preventDefault: () => void; metaKey?: boolean; ctrlKey?: boolean }) => {
    if (e.metaKey || e.ctrlKey) return;
    e.preventDefault();
    go(to);
  };
}

interface NavEntry {
  key: string;
  label: string;
  icon: PIconName;
  badge?: number;
  roles?: Role[];
}

// [PCODE-158 | S15 | v0.1.0] a client sees the portal's own navigation, nothing of the team's
const PORTAL_GROUPS: { label: string | null; items: NavEntry[] }[] = [
  {
    label: null,
    items: [
      { key: '', label: 'Home', icon: 'home' },
      { key: 'inbox', label: 'Waiting for you', icon: 'inbox' },
    ],
  },
  {
    label: 'Your projects',
    items: [{ key: 'projects', label: 'Projects', icon: 'projects' }, ...PORTAL_SECTIONS],
  },
];

const GROUPS: { label: string | null; items: NavEntry[] }[] = [
  {
    label: null,
    items: [
      { key: '', label: 'Home', icon: 'home' },
      {
        key: 'command',
        label: 'Command center',
        icon: 'live',
        roles: ['lead', 'admin', 'developer'],
      }, // [PCODE-210 | S15 | v0.1.0]
      { key: 'inbox', label: 'Inbox', icon: 'inbox' },
    ],
  },
  {
    label: 'Delivery',
    items: [
      { key: 'projects', label: 'Projects', icon: 'projects' },
      { key: 'clients', label: 'Clients', icon: 'clients', roles: ['lead', 'admin', 'developer'] },
      {
        key: 'releases',
        label: 'Releases',
        icon: 'releases',
        roles: ['lead', 'admin', 'developer', 'tester'],
      },
      {
        key: 'incidents',
        label: 'Incidents',
        icon: 'incidents',
        roles: ['lead', 'admin', 'developer'],
      },
      { key: 'time', label: 'Time', icon: 'time', roles: ['lead', 'admin', 'developer', 'tester'] },
    ],
  },
  {
    label: 'Engineering',
    items: [
      {
        key: 'agents',
        label: 'Agents',
        icon: 'agents',
        roles: ['lead', 'admin', 'developer', 'tester'],
      },
      { key: 'activity', label: 'Activity', icon: 'activity' },
      { key: 'insights', label: 'Insights', icon: 'insights', roles: ['lead', 'admin'] },
    ],
  },
  {
    label: 'Administration',
    items: [
      { key: 'people', label: 'People', icon: 'people', roles: ['lead', 'admin'] },
      {
        key: 'tokens',
        label: 'Tokens and costs',
        icon: 'tokens',
        roles: ['lead', 'admin', 'developer'],
      },
      { key: 'settings', label: 'Settings', icon: 'settings' },
    ],
  },
];

export const ROLES: { key: Role; label: string; who: string }[] = [
  { key: 'developer', label: 'Developer', who: 'lea' },
  { key: 'lead', label: 'Lead', who: 'mara' },
  { key: 'admin', label: 'Admin', who: 'ada' },
  { key: 'tester', label: 'Tester', who: 'sara' },
  { key: 'client', label: 'Client', who: 'c-ines' },
];

export const visibleProjects = (role: Role): typeof PROJECTS =>
  role === 'client' ? PROJECTS.filter((p) => p.clientId === 'hel') : PROJECTS;

export function Sidebar(props: {
  section: string;
  projectKey: string | null;
  role: Role;
  inboxCount: number;
  collapsed: boolean;
  onCollapse: () => void;
  /** [PCODE-159 | S15 | v0.1.0] on a phone the sidebar opens over the page */
  open?: boolean;
  onClose?: () => void;
  go: (p: string) => void;
}): ReactNode {
  const items = (g: (typeof GROUPS)[number]): NavEntry[] =>
    g.items.filter((i) => !i.roles || i.roles.includes(props.role));
  const client = CLIENTS.find((c) => c.id === 'hel');
  return (
    <nav
      className={
        'pv-sidebar' +
        (props.collapsed ? ' pv-sidebar--collapsed' : '') +
        (props.open ? ' pv-sidebar--open' : '')
      }
      onClick={(e) => {
        // a link was followed: close the phone menu
        if ((e.target as HTMLElement).closest('a')) props.onClose?.();
      }}
      aria-label="Sections"
    >
      <button
        type="button"
        className="pv-ws"
        onClick={props.onCollapse}
        title="Collapse the sidebar"
      >
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
            {props.role === 'client' ? (client?.name ?? '') : WORKSPACE.name}
          </span>
          <span className="pv-ws-plan">
            {props.role === 'client'
              ? 'Client portal'
              : WORKSPACE.plan +
                ' · ' +
                String(WORKSPACE.seatsUsed) +
                ' of ' +
                String(WORKSPACE.seats) +
                ' seats'}
          </span>
        </span>
        <PIcon name="chevronDown" size={14} className="pv-ws-chev" />
      </button>
      <div className="pv-nav-scroll">
        {(props.role === 'client' ? PORTAL_GROUPS : GROUPS).map((g) => {
          const list = items(g);
          if (!list.length) return null;
          return (
            <div key={g.label ?? 'top'} className="pv-nav-group">
              {g.label ? <div className="pv-nav-heading">{g.label}</div> : null}
              {list.map((i) => (
                <div key={i.key}>
                  <a
                    href={BASE + (i.key ? '/' + i.key : '')}
                    className="pv-nav-item"
                    aria-current={
                      props.section === i.key && !(i.key === 'projects' && props.projectKey)
                        ? 'page'
                        : undefined
                    }
                    onClick={link(i.key ? '/' + i.key : '', props.go)}
                    title={i.label}
                  >
                    <PIcon name={i.icon} />
                    <span className="pv-nav-label">{i.label}</span>
                    {i.key === 'inbox' && props.inboxCount ? (
                      <span className="pv-nav-badge">{props.inboxCount}</span>
                    ) : null}
                  </a>
                  {i.key === 'projects' ? (
                    <div className="pv-nav-projects">
                      {visibleProjects(props.role).map((p) => (
                        <a
                          key={p.key}
                          href={BASE + '/projects/' + p.key}
                          className="pv-nav-sub"
                          aria-current={props.projectKey === p.key ? 'page' : undefined}
                          onClick={link('/projects/' + p.key, props.go)}
                          title={p.key + ' ' + p.name}
                        >
                          <span className={'pv-dot pv-dot--' + p.health} aria-hidden="true" />
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
        <a
          href={BASE + '/settings'}
          className="pv-nav-item"
          onClick={link('/settings', props.go)}
          title="Help and shortcuts"
        >
          <PIcon name="keyboard" />
          <span className="pv-nav-label">Shortcuts</span>
          <Kbd>?</Kbd>
        </a>
      </div>
    </nav>
  );
}

export function TopBar(props: {
  crumbs: { label: string; to?: string }[];
  role: Role;
  inboxCount: number;
  onSearch: () => void;
  /** [PCODE-159 | S15 | v0.1.0] the menu button, shown on phones only */
  onMenu?: () => void;
  go: (p: string) => void;
}): ReactNode {
  const me = ROLES.find((r) => r.key === props.role)?.who ?? 'lea';
  const running = AGENTS_LIVE.filter((a) => !a.waiting).length;
  const waiting = AGENTS_LIVE.filter((a) => a.waiting).length;
  const online = PEOPLE.filter((p) => p.online && p.kind === 'human').map((p) => p.id);
  return (
    <header className="pv-topbar">
      <button type="button" className="pv-menu-btn" aria-label="Menu" onClick={props.onMenu}>
        <PIcon name="overview" />
      </button>
      <ol className="pv-crumbs" aria-label="Where you are">
        {props.crumbs.map((c, i) => (
          <li key={i}>
            {c.to !== undefined ? (
              <a href={BASE + c.to} onClick={link(c.to, props.go)}>
                {c.label}
              </a>
            ) : (
              <span aria-current="page">{c.label}</span>
            )}
          </li>
        ))}
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
        {props.role !== 'client' ? (
          <>
            <a
              href={BASE + '/agents'}
              className="pv-pill pv-pill--agent"
              onClick={link('/agents', props.go)}
              title="Agents working now"
            >
              <span className="pv-pulse" aria-hidden="true" />
              {running} running
              {waiting ? <span className="pv-pill-warn">· {waiting} waiting</span> : null}
            </a>
            <a
              href={BASE + '/tokens'}
              className="pv-pill"
              onClick={link('/tokens', props.go)}
              title={'AI spend this month ' + euro(SPEND.month) + ' of ' + euro(SPEND.monthBudget)}
            >
              <PIcon name="euro" size={14} />
              <span className="pv-num">{euro(SPEND.today, 2)}</span>
              <span className="pv-muted">today</span>
            </a>
            <a
              href={BASE + '/sync'}
              className="pv-pill pv-pill--ok"
              onClick={link('/sync', props.go)}
              title="VS Code on this account is connected and in sync"
            >
              <PIcon name="ide" size={14} />
              VS Code synced
            </a>
            <span className="pv-presence-stack" title="Online now">
              {online.slice(0, 4).map((id) => (
                <Avatar key={id} id={id} size="xs" ring />
              ))}
            </span>
          </>
        ) : null}
        <a
          href={BASE + '/inbox'}
          className="pv-icon-btn"
          onClick={link('/inbox', props.go)}
          title="Inbox"
        >
          <PIcon name="bell" />
          {props.inboxCount ? <span className="pv-icon-badge">{props.inboxCount}</span> : null}
        </a>
        <Avatar id={me} size="md" />
      </div>
    </header>
  );
}

export function PreviewBanner(props: {
  role: Role;
  onRole: (r: Role) => void;
  dark: boolean;
  onDark: () => void;
}): ReactNode {
  return (
    <div className="pv-banner" role="region" aria-label="Preview controls">
      <span className="pv-banner-tag">Preview · D7</span>
      <span className="pv-banner-text">Sample data only. Nothing you click is saved.</span>
      <div className="pv-banner-roles" role="radiogroup" aria-label="View as">
        <span className="pv-banner-label">View as</span>
        {ROLES.map((r) => (
          <button
            key={r.key}
            type="button"
            role="radio"
            aria-checked={props.role === r.key}
            className="pv-seg"
            onClick={() => {
              props.onRole(r.key);
            }}
          >
            {r.label}
          </button>
        ))}
      </div>
      <button
        type="button"
        className="pv-banner-theme"
        onClick={props.onDark}
        title="Light or dark"
      >
        <PIcon name={props.dark ? 'sun' : 'moon'} size={16} />
      </button>
    </div>
  );
}

interface PaletteEntry {
  group: string;
  label: string;
  hint?: string;
  icon: PIconName;
  to?: string;
  run?: () => void;
  keys?: string;
}

export function Palette(props: {
  role: Role;
  onClose: () => void;
  go: (p: string) => void;
  onDark: () => void;
}): ReactNode {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
  }, []);
  const all = useMemo<PaletteEntry[]>(() => {
    const out: PaletteEntry[] = [];
    out.push(
      {
        group: 'Actions',
        label: 'Create a task',
        icon: 'plus',
        hint: 'in the current project',
        keys: 'C',
      },
      {
        group: 'Actions',
        label: 'New idea from documents',
        icon: 'ideation',
        to: '/projects/PE/ideation',
      },
      { group: 'Actions', label: 'Start an agent run', icon: 'agents', to: '/agents' },
      {
        group: 'Actions',
        label: 'Pause all agents',
        icon: 'pause',
        hint: 'kill switch',
        to: '/agents',
      },
      { group: 'Actions', label: 'Log time', icon: 'time', to: '/time' },
      { group: 'Actions', label: 'Switch light or dark', icon: 'moon', run: props.onDark },
    );
    for (const p of visibleProjects(props.role))
      out.push({
        group: 'Projects',
        label: p.key + ' · ' + p.name,
        icon: 'projects',
        hint: p.phase + ' · ' + p.sprint.name,
        to: '/projects/' + p.key,
      });
    out.push(
      {
        group: 'Tasks',
        label: 'NWL-188 Live re-routing for dispatchers',
        icon: 'planning',
        hint: 'Review · Lea',
        to: '/projects/NWL/planning',
      },
      {
        group: 'Tasks',
        label: 'HEL-212 Booking slots',
        icon: 'planning',
        hint: 'Review · Jonas',
        to: '/projects/HEL/planning',
      },
      {
        group: 'Tasks',
        label: 'AUR-4 SEPA instant: idempotency keys',
        icon: 'planning',
        hint: 'Todo · Lea',
        to: '/projects/AUR/planning',
      },
      {
        group: 'Documents',
        label: 'HEL · Booking flow PRD v3',
        icon: 'documents',
        hint: 'approved by Helio',
        to: '/projects/HEL/documents',
      },
      {
        group: 'Documents',
        label: 'NWL · Runbook: map provider outage',
        icon: 'documents',
        to: '/projects/NWL/documents',
      },
    );
    for (const p of PEOPLE.filter((x) => x.kind !== 'client'))
      out.push({
        group: p.kind === 'agent' ? 'Agents' : 'People',
        label: p.name,
        icon: p.kind === 'agent' ? 'agents' : 'user',
        hint: p.title,
        to: p.kind === 'agent' ? '/agents' : '/people',
      });
    out.push(
      { group: 'Go to', label: 'Inbox', icon: 'inbox', to: '/inbox', keys: 'G I' },
      { group: 'Go to', label: 'Activity', icon: 'activity', to: '/activity', keys: 'G A' },
      { group: 'Go to', label: 'Tokens and costs', icon: 'tokens', to: '/tokens' },
      { group: 'Go to', label: 'Clients', icon: 'clients', to: '/clients' },
      { group: 'Go to', label: 'Settings', icon: 'settings', to: '/settings' },
    );
    return props.role === 'client'
      ? out.filter((e) => e.group === 'Projects' || e.group === 'Documents' || e.label === 'Inbox')
      : out;
  }, [props.role, props.onDark]);

  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const hits = all
    .filter((e) =>
      words.every((w) =>
        (e.label + ' ' + (e.hint ?? '') + ' ' + e.group).toLowerCase().includes(w),
      ),
    )
    .slice(0, 14);
  const choose = (e: PaletteEntry | undefined): void => {
    if (!e) return;
    props.onClose();
    if (e.run) e.run();
    else if (e.to) props.go(e.to);
  };
  let lastGroup = '';
  return (
    <div className="pv-scrim" onClick={props.onClose} role="presentation">
      <div
        className="pv-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Search or jump to"
        onClick={(e) => {
          e.stopPropagation();
        }}
      >
        <div className="pv-palette-input">
          <PIcon name="search" />
          <input
            ref={input}
            value={q}
            placeholder="Search projects, tasks, documents, people, agents, actions"
            aria-label="Search"
            onChange={(e) => {
              setQ(e.target.value);
              setSel(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSel((s) => Math.min(hits.length - 1, s + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSel((s) => Math.max(0, s - 1));
              } else if (e.key === 'Enter') choose(hits[sel]);
              else if (e.key === 'Escape') props.onClose();
            }}
          />
          <Kbd>Esc</Kbd>
        </div>
        <ul className="pv-palette-list" role="listbox" aria-label="Results">
          {hits.map((e, i) => {
            const head = e.group !== lastGroup ? e.group : null;
            lastGroup = e.group;
            return (
              <li key={e.group + e.label} role="presentation">
                {head ? <div className="pv-palette-group">{head}</div> : null}
                <button
                  type="button"
                  role="option"
                  aria-selected={i === sel}
                  className="pv-palette-item"
                  onMouseEnter={() => {
                    setSel(i);
                  }}
                  onClick={() => {
                    choose(e);
                  }}
                >
                  <PIcon name={e.icon} size={16} />
                  <span className="pv-palette-label">{e.label}</span>
                  {e.hint ? <span className="pv-palette-hint">{e.hint}</span> : null}
                  {e.keys ? <Kbd>{e.keys}</Kbd> : null}
                </button>
              </li>
            );
          })}
          {!hits.length ? <li className="pv-palette-empty">Nothing matches “{q}”.</li> : null}
        </ul>
        <footer className="pv-palette-foot">
          <span>
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> to move
          </span>
          <span>
            <Kbd>Enter</Kbd> to open
          </span>
          <span>Also in VS Code: Ctrl Shift P → Orqiva</span>
        </footer>
      </div>
    </div>
  );
}

export const inboxFor = (role: Role): typeof INBOX => INBOX.filter((i) => i.roles.includes(role));
