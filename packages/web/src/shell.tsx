// ── [PCODE-436 | S15 | v0.1.0] T37 low: Untangle the three folder import cycles ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-167 | S15 | v0.1.0] B2.3 Canvas live in the web app: Gantt with critical path and dependencies, baselines, scenarios, grid, workload and levelling, calendar ──
// ── [PCODE-166 | S15 | v0.1.0] B2.2 Planning live in the web app: sprint header, board, backlog, Planner draft, capacity, reports, retro ──
// ── [PCODE-113 | S15 | v0.1.0] Rebuild the web app shell: sidebar, top bar, page layout, design refresh ──
// ── [PCODE-116 | S15 | v0.1.0] Restyle the web app after the owner's reference kit: gradient band, hero cards, KPI tiles, lavender sidebar ──
// ── [PCODE-118 | S15 | v0.1.0] Show and drive the lifecycle in the web app: stepper, stages, gate checklist and sign-off ──
// ── [PCODE-146 | S15 | v0.1.0] Show compliance, evidence packs and reviews in the web app ──
// ── [PCODE-142 | S15 | v0.1.0] Show security findings in the web app with Security agent triage ──
// ── [PCODE-138 | S15 | v0.1.0] Show tests, coverage and live runs in the web app ──
// ── [PCODE-134 | S15 | v0.1.0] Show environments, secrets and live deploys in the web app ──
// ── [PCODE-126 | S15 | v0.1.0] Show ideas, the interview, proposals and signing in the web app ──
// ── [PCODE-122 | S15 | v0.1.0] Show agents in the web app: agents page, ask from a task, live run view, approvals, card badge ──
//    Why:  the frame every signed-in page lives in, as people know it from the web apps they use daily: a
//          top bar (menu, product, search, live status, help, the account menu), a sidebar (workspace,
//          a New task button, Home, My work, Projects with the open project's pages, Activity, Settings)
//          that collapses on wide screens and slides in as a drawer on phones, and one page layout (header
//          with title, actions and tabs; content in cards). Pure views: the workspace feeds them.
import type { PresenceEntry } from '@orqiva/shared';
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
  type SyntheticEvent,
} from 'react';
import type { Me } from './core/api.js';
import { Icon, Logo, type IconName } from './core/icons.js';
import { projectPath, type AppRoute, type ProjectViewKind } from './core/nav.js';
import { avatarSlot, initials } from './presence.js';
import type { ThemeChoice } from './core/theme.js';

export interface NavProject {
  id: string;
  key: string;
  name: string;
}

export const PROJECT_PAGES: { view: ProjectViewKind; label: string; icon: IconName }[] = [
  { view: 'overview', label: 'Overview', icon: 'overview' },
  { view: 'lifecycle', label: 'Lifecycle', icon: 'flow' }, // [PCODE-118 | S15 | v0.1.0]
  { view: 'ideas', label: 'Ideas', icon: 'idea' }, // [PCODE-126 | S15 | v0.1.0]
  { view: 'planning', label: 'Planning', icon: 'board' }, // [PCODE-166 | S15 | v0.1.0]
  { view: 'canvas', label: 'Canvas', icon: 'flow' }, // [PCODE-167 | S15 | v0.1.0]
  { view: 'list', label: 'List', icon: 'list' },
  { view: 'board', label: 'Board', icon: 'board' },
  { view: 'backlog', label: 'Backlog', icon: 'backlog' },
  { view: 'tests', label: 'Tests', icon: 'flask' }, // [PCODE-138 | S15 | v0.1.0]
  { view: 'security', label: 'Security', icon: 'shield' }, // [PCODE-142 | S15 | v0.1.0]
  { view: 'compliance', label: 'Compliance', icon: 'scale' }, // [PCODE-146 | S15 | v0.1.0]
  { view: 'git', label: 'Repositories', icon: 'git' },
  { view: 'environments', label: 'Environments', icon: 'server' }, // [PCODE-134 | S15 | v0.1.0]
  { view: 'settings', label: 'Settings', icon: 'settings' },
];

/** A link that moves inside the app without reloading it (a new tab still works). */
export function follow(path: string, go: (p: string) => void) {
  return (e: SyntheticEvent): void => {
    const m = e.nativeEvent as MouseEvent;
    if (m.ctrlKey || m.metaKey || m.shiftKey || m.button === 1) return;
    e.preventDefault();
    go(path);
  };
}

/** Closes a popover on Escape and on a click outside it. */
function useDismiss(open: boolean, close: () => void): RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close();
    };
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown);
    };
  }, [open, close]);
  return ref;
}

export function Avatar(props: { id: string; name: string; size?: 'sm' | 'md' | 'lg' }): ReactNode {
  return (
    <span
      className={
        'pe-avatar-round pe-avatar--' +
        String(avatarSlot(props.id)) +
        ' pe-avatar-round--' +
        (props.size ?? 'md')
      }
      aria-hidden="true"
    >
      {initials(props.name)}
    </span>
  );
}

function UserMenu(props: {
  me: Me;
  theme: ThemeChoice;
  canAdmin: boolean;
  onTheme: (t: ThemeChoice) => void;
  onLogout: () => void;
  go: (p: string) => void;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => {
    setOpen(false);
  });
  const menuId = useId();
  const to = (path: string) => (e: SyntheticEvent) => {
    setOpen(false);
    follow(path, props.go)(e);
  };
  return (
    <div className="pe-popover-anchor" ref={ref}>
      <button
        type="button"
        className="pe-icon-btn pe-account-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={'Account: ' + props.me.user.name}
        onClick={() => {
          setOpen((o) => !o);
        }}
      >
        <Avatar id={props.me.user.id} name={props.me.user.name} />
      </button>
      {open ? (
        <div className="pe-popover pe-popover--right pe-account" id={menuId} role="menu">
          <div className="pe-account-head">
            <Avatar id={props.me.user.id} name={props.me.user.name} size="lg" />
            <div>
              <div className="pe-account-name">{props.me.user.name}</div>
              <div className="pe-muted pe-small">{props.me.user.email}</div>
            </div>
          </div>
          <a
            role="menuitem"
            className="pe-menu-item"
            href="/settings/profile"
            onClick={to('/settings/profile')}
          >
            <Icon name="person" /> Profile and account
          </a>
          <a
            role="menuitem"
            className="pe-menu-item"
            href="/settings/tokens"
            onClick={to('/settings/tokens')}
          >
            <Icon name="key" /> Personal tokens
          </a>
          {props.canAdmin ? (
            <a
              role="menuitem"
              className="pe-menu-item"
              href="/settings/members"
              onClick={to('/settings/members')}
            >
              <Icon name="users" /> Members and invitations
            </a>
          ) : null}
          <div className="pe-menu-sep" role="separator" />
          <div className="pe-menu-label" id={menuId + '-theme'}>
            Theme
          </div>
          <div className="pe-segmented" role="radiogroup" aria-labelledby={menuId + '-theme'}>
            {(
              [
                ['system', 'System', 'monitor'],
                ['light', 'Light', 'sun'],
                ['dark', 'Dark', 'moon'],
              ] as const
            ).map(([value, label, icon]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={props.theme === value}
                className="pe-segment"
                onClick={() => {
                  props.onTheme(value);
                }}
              >
                <Icon name={icon} size={16} /> {label}
              </button>
            ))}
          </div>
          <div className="pe-menu-sep" role="separator" />
          <button
            type="button"
            role="menuitem"
            className="pe-menu-item"
            onClick={() => {
              setOpen(false);
              props.onLogout();
            }}
          >
            <Icon name="logout" /> Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}

const modKey = (): string =>
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.userAgent) ? '⌘' : 'Ctrl';

// [PCODE-116 | S15 | v0.1.0] help as a dialog, opened from the top bar and from the sidebar's help card
function HelpDialog(props: { onClose: () => void }): ReactNode {
  const mod = modKey();
  return (
    <Dialog title="Help" onClose={props.onClose}>
      <div className="pe-menu-label">Keyboard</div>
      <dl className="pe-keys">
        <dt>
          <kbd>{mod}</kbd> <kbd>K</kbd>
        </dt>
        <dd>Search, go to a page, run a command</dd>
        <dt>
          <kbd>Esc</kbd>
        </dt>
        <dd>Close a menu or dialog</dd>
      </dl>
      <div className="pe-menu-label">Pages</div>
      <dl className="pe-keys">
        <dt>Home</dt>
        <dd>Where your work and the team's work stand, with charts</dd>
        <dt>My work</dt>
        <dd>Everything open that is assigned to you</dd>
        <dt>Projects</dt>
        <dd>Overview, list, board, backlog, repositories and settings of each project</dd>
        <dt>Activity</dt>
        <dd>What people, agents and connected tools did, live</dd>
      </dl>
      <div className="pe-menu-label">Terminal and Claude Code</div>
      <p className="pe-small pe-muted">
        The same work runs through <code>pe</code>: <code>orq list</code>,{' '}
        <code>orq start PCODE-12</code>, <code>orq done PCODE-12</code>. Changes made there appear
        here live.
      </p>
    </Dialog>
  );
}

/** Each place has its own colour, as the icons in the sidebar show. */
export type Tone = 'indigo' | 'blue' | 'violet' | 'pink' | 'amber' | 'teal' | 'coral';

function NavItem(props: {
  href: string;
  icon: IconName;
  label: string;
  active: boolean;
  go: (p: string) => void;
  onNavigate?: () => void;
  nested?: boolean;
  badge?: string;
  tone?: Tone;
  chevron?: boolean;
}): ReactNode {
  return (
    <a
      href={props.href}
      className={
        'pe-nav-item' +
        (props.nested ? ' pe-nav-item--nested' : '') +
        (props.tone ? ' pe-tone-' + props.tone : '')
      }
      aria-current={props.active ? 'page' : undefined}
      onClick={(e) => {
        props.onNavigate?.();
        follow(props.href, props.go)(e);
      }}
    >
      <span className="pe-nav-icon">
        <Icon name={props.icon} />
      </span>
      <span className="pe-nav-label">{props.label}</span>
      {props.badge ? <span className="pe-nav-badge">{props.badge}</span> : null}
      {props.chevron ? (
        <span className="pe-nav-chevron">
          <Icon name="chevronRight" size={16} />
        </span>
      ) : null}
    </a>
  );
}

function KeyTile(props: { projectKey: string; id: string }): ReactNode {
  return (
    <span className={'pe-key-tile pe-avatar--' + String(avatarSlot(props.id))} aria-hidden="true">
      {props.projectKey.slice(0, 2)}
    </span>
  );
}

function Sidebar(props: {
  workspaceName: string;
  role: string;
  route: AppRoute;
  projects: NavProject[];
  currentProjectId: string | null;
  canCreate: boolean;
  onNewTask: () => void;
  onHelp: () => void;
  go: (p: string) => void;
  onNavigate: () => void;
}): ReactNode {
  const r = props.route;
  const current = props.projects.find((p) => p.id === props.currentProjectId) ?? null;
  const others = props.projects.filter((p) => p.id !== props.currentProjectId).slice(0, 8);
  const isAdmin = props.role === 'admin' || props.role === 'owner';
  return (
    <nav className="pe-sidebar" aria-label="Main">
      {/* [PCODE-116 | S15 | v0.1.0] the product at the top of the sidebar, the workspace under it */}
      <a
        className="pe-brand-row"
        href="/"
        onClick={(e) => {
          props.onNavigate();
          follow('/', props.go)(e);
        }}
      >
        <Logo />
        <span className="pe-nav-label pe-brand-name">Orqiva</span>
      </a>
      <div className="pe-workspace">
        <span className="pe-workspace-tile" aria-hidden="true">
          {props.workspaceName.slice(0, 1).toUpperCase()}
        </span>
        <div className="pe-workspace-text">
          <div className="pe-workspace-name">{props.workspaceName}</div>
          <div className="pe-small pe-muted">{ROLE_NAME[props.role] ?? props.role}</div>
        </div>
      </div>
      {props.canCreate ? (
        <button type="button" className="pe-compose" onClick={props.onNewTask}>
          <Icon name="plus" size={20} /> <span className="pe-nav-label">New task</span>
        </button>
      ) : null}
      <div className="pe-nav-group">
        <div className="pe-nav-heading">Main navigation</div>
        <NavItem
          href="/"
          icon="home"
          label="Home"
          tone="indigo"
          chevron
          active={r.kind === 'home'}
          go={props.go}
          onNavigate={props.onNavigate}
        />
        <NavItem
          href="/my-work"
          icon="task"
          label="My work"
          tone="blue"
          chevron
          active={r.kind === 'my-work'}
          go={props.go}
          onNavigate={props.onNavigate}
        />
        <NavItem
          href="/activity"
          icon="pulse"
          label="Activity"
          tone="pink"
          chevron
          active={r.kind === 'activity'}
          go={props.go}
          onNavigate={props.onNavigate}
        />
        {/* [PCODE-122 | S15 | v0.1.0] the workspace's AI agents and their runs */}
        <NavItem
          href="/agents"
          icon="agent"
          label="Agents"
          tone="violet"
          chevron
          active={r.kind === 'agents' || r.kind === 'run'}
          go={props.go}
          onNavigate={props.onNavigate}
        />
        <NavItem
          href="/projects"
          icon="folder"
          label="All projects"
          tone="amber"
          chevron
          active={r.kind === 'projects'}
          go={props.go}
          onNavigate={props.onNavigate}
        />
      </div>
      <div className="pe-nav-group">
        <div className="pe-nav-heading">Projects</div>
        {current ? (
          <div className="pe-nav-project" aria-label={'Project ' + current.name}>
            <a
              href={projectPath(current.id)}
              className="pe-nav-item pe-nav-item--project"
              onClick={(e) => {
                props.onNavigate();
                follow(projectPath(current.id), props.go)(e);
              }}
            >
              <KeyTile projectKey={current.key} id={current.id} />
              <span className="pe-nav-label">{current.name}</span>
            </a>
            {PROJECT_PAGES.map((page) => (
              <NavItem
                key={page.view}
                href={projectPath(current.id, page.view)}
                icon={page.icon}
                label={page.label}
                nested
                active={r.kind === 'project' && r.id === current.id && r.view === page.view}
                go={props.go}
                onNavigate={props.onNavigate}
              />
            ))}
          </div>
        ) : null}
        {others.map((p) => (
          <a
            key={p.id}
            href={projectPath(p.id)}
            className="pe-nav-item pe-nav-item--project"
            onClick={(e) => {
              props.onNavigate();
              follow(projectPath(p.id), props.go)(e);
            }}
          >
            <KeyTile projectKey={p.key} id={p.id} />
            <span className="pe-nav-label">{p.name}</span>
          </a>
        ))}
        {props.projects.length === 0 ? (
          <NavItem
            href="/projects"
            icon="plus"
            label="Create a project"
            active={false}
            go={props.go}
            onNavigate={props.onNavigate}
          />
        ) : null}
      </div>
      <div className="pe-nav-group">
        <div className="pe-nav-heading">Settings</div>
        <NavItem
          href="/settings/profile"
          icon="person"
          label="Profile"
          tone="teal"
          chevron
          active={r.kind === 'settings' && ['profile', 'tokens', 'appearance'].includes(r.section)}
          go={props.go}
          onNavigate={props.onNavigate}
        />
        {isAdmin ? (
          <>
            <NavItem
              href="/settings/members"
              icon="users"
              label="Members"
              tone="violet"
              chevron
              active={r.kind === 'settings' && r.section === 'members'}
              go={props.go}
              onNavigate={props.onNavigate}
            />
            <NavItem
              href="/settings/workspace"
              icon="settings"
              label="Workspace"
              tone="coral"
              chevron
              active={r.kind === 'settings' && r.section === 'workspace'}
              go={props.go}
              onNavigate={props.onNavigate}
            />
          </>
        ) : null}
      </div>
      <div className="pe-nav-spacer" />
      <div className="pe-help-card">
        <span className="pe-help-badge" aria-hidden="true">
          <Icon name="help" size={22} />
        </span>
        <div className="pe-help-title">Help center</div>
        <p>Shortcuts, pages and the pe command line, in one place.</p>
        <button type="button" className="pe-help-button" onClick={props.onHelp}>
          Open help
        </button>
      </div>
    </nav>
  );
}

export const ROLE_NAME: Record<string, string> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
  guest: 'Guest',
};

function readNavPreference(): boolean {
  try {
    return window.localStorage.getItem('pe.nav') !== 'collapsed';
  } catch {
    return true;
  }
}

export function AppShell(props: {
  me: Me;
  workspaceName: string;
  role: string;
  route: AppRoute;
  projects: NavProject[];
  currentProjectId: string | null;
  online: boolean;
  pending: number;
  people: PresenceEntry[];
  theme: ThemeChoice;
  onTheme: (t: ThemeChoice) => void;
  onLogout: () => void;
  onSearch: () => void;
  onNewTask: () => void;
  go: (p: string) => void;
  children: ReactNode;
}): ReactNode {
  const [expanded, setExpanded] = useState(readNavPreference);
  const [drawer, setDrawer] = useState(false);
  const [help, setHelp] = useState(false);
  const canEdit = props.role !== 'guest';
  const canAdmin = props.role === 'admin' || props.role === 'owner';
  const toggle = (): void => {
    // narrow screens open the drawer; wide ones collapse to icons and remember it
    if (window.matchMedia('(max-width: 900px)').matches) {
      setDrawer((d) => !d);
      return;
    }
    setExpanded((x) => {
      try {
        window.localStorage.setItem('pe.nav', x ? 'collapsed' : 'open');
      } catch {
        // a preference only
      }
      return !x;
    });
  };
  const others = new Set(
    props.people.filter((p) => p.userId !== props.me.user.id).map((p) => p.userId),
  ).size;
  const first = props.me.user.name.split(' ')[0] ?? props.me.user.name;
  return (
    <div
      className={'pe-app' + (expanded ? '' : ' pe-app--rail') + (drawer ? ' pe-app--drawer' : '')}
    >
      <a className="pe-skip" href="#pe-content">
        Skip to content
      </a>
      <div
        className="pe-scrim"
        aria-hidden="true"
        onClick={() => {
          setDrawer(false);
        }}
      />
      <Sidebar
        workspaceName={props.workspaceName}
        role={props.role}
        route={props.route}
        projects={props.projects}
        currentProjectId={props.currentProjectId}
        canCreate={canEdit}
        onNewTask={() => {
          setDrawer(false);
          props.onNewTask();
        }}
        onHelp={() => {
          setDrawer(false);
          setHelp(true);
        }}
        go={props.go}
        onNavigate={() => {
          setDrawer(false);
        }}
      />
      {/* [PCODE-116 | S15 | v0.1.0] the main column: the gradient band carries the top bar and the page header */}
      <div className="pe-content" id="pe-content">
        <header className="pe-topbar">
          <button
            type="button"
            className="pe-icon-btn"
            aria-label={expanded ? 'Collapse the menu' : 'Expand the menu'}
            aria-expanded={drawer || expanded}
            onClick={toggle}
          >
            <Icon name="menu" />
          </button>
          <a
            className="pe-product"
            href="/"
            onClick={follow('/', props.go)}
            aria-label="Orqiva home"
          >
            <Logo />
          </a>
          <button type="button" className="pe-search" onClick={props.onSearch}>
            <Icon name="search" />
            <span className="pe-search-text">Search tasks, projects and commands</span>
            <span className="pe-search-keys" aria-hidden="true">
              <kbd>{modKey()}</kbd> <kbd>K</kbd>
            </span>
          </button>
          <span className="pe-topbar-spacer" />
          <span
            className={'pe-status' + (props.online ? ' pe-status--live' : ' pe-status--off')}
            role="status"
            aria-live="polite"
          >
            <span className="pe-status-dot" aria-hidden="true" />
            {props.online
              ? props.pending
                ? 'Saving ' + String(props.pending)
                : 'Live' + (others ? ' · ' + String(others) + ' online' : '')
              : 'Offline' + (props.pending ? ' · ' + String(props.pending) + ' waiting' : '')}
          </span>
          <button
            type="button"
            className="pe-icon-btn"
            aria-label="Help"
            aria-haspopup="dialog"
            onClick={() => {
              setHelp(true);
            }}
          >
            <Icon name="help" />
          </button>
          <span className="pe-greeting">Hi, {first}</span>
          <UserMenu
            me={props.me}
            theme={props.theme}
            canAdmin={canAdmin}
            onTheme={props.onTheme}
            onLogout={props.onLogout}
            go={props.go}
          />
        </header>
        {props.children}
      </div>
      {help ? (
        <HelpDialog
          onClose={() => {
            setHelp(false);
          }}
        />
      ) : null}
    </div>
  );
}

export interface Tab {
  label: string;
  href: string;
  active: boolean;
  icon?: IconName;
}

export function PageHeader(props: {
  title: ReactNode;
  eyebrow?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  tabs?: Tab[];
  go?: (p: string) => void;
}): ReactNode {
  return (
    <header className="pe-page-header">
      <div className="pe-page-header-row">
        <div className="pe-page-titles">
          {props.eyebrow ? <div className="pe-eyebrow">{props.eyebrow}</div> : null}
          <h1 className="pe-page-title">{props.title}</h1>
          {props.subtitle ? <p className="pe-page-subtitle">{props.subtitle}</p> : null}
        </div>
        {props.actions ? <div className="pe-page-actions">{props.actions}</div> : null}
      </div>
      {props.tabs ? (
        <nav className="pe-tabbar" aria-label="Pages">
          {props.tabs.map((t) => (
            <a
              key={t.href}
              href={t.href}
              className="pe-tab"
              aria-current={t.active ? 'page' : undefined}
              onClick={props.go ? follow(t.href, props.go) : undefined}
            >
              {t.icon ? <Icon name={t.icon} size={18} /> : null}
              {t.label}
            </a>
          ))}
        </nav>
      ) : null}
    </header>
  );
}

export function Card(props: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string | undefined;
  label?: string;
}): ReactNode {
  return (
    <section
      className={'pe-panel' + (props.className ? ' ' + props.className : '')}
      aria-label={props.label ?? (typeof props.title === 'string' ? props.title : undefined)}
    >
      {props.title || props.actions ? (
        <div className="pe-panel-head">
          <div>
            {props.title ? <h2 className="pe-panel-title">{props.title}</h2> : null}
            {props.subtitle ? <p className="pe-panel-subtitle">{props.subtitle}</p> : null}
          </div>
          {props.actions ? <div className="pe-panel-actions">{props.actions}</div> : null}
        </div>
      ) : null}
      {props.children}
    </section>
  );
}

/** Quick figures at the top of a page: "12 open", "3 in review". */
// [PCODE-116 | S15 | v0.1.0] a hero card: its own colour and icon
export function Stat(props: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: IconName;
}): ReactNode {
  return (
    <div className="pe-stat">
      {props.icon ? (
        <span className="pe-stat-icon" aria-hidden="true">
          <Icon name={props.icon} size={22} />
        </span>
      ) : null}
      <div className="pe-stat-value">{props.value}</div>
      <div className="pe-stat-label">{props.label}</div>
      {props.hint ? <div className="pe-stat-hint">{props.hint}</div> : null}
    </div>
  );
}

export function EmptyState(props: {
  icon: IconName;
  title: string;
  children?: ReactNode;
}): ReactNode {
  return (
    <div className="pe-empty-state">
      <span className="pe-empty-icon">
        <Icon name={props.icon} size={28} />
      </span>
      <div className="pe-empty-title">{props.title}</div>
      {props.children ? <div className="pe-muted">{props.children}</div> : null}
    </div>
  );
}

// [PCODE-436 | S15 | v0.1.0]
export { Dialog } from './core/dialog.js';
import { Dialog } from './core/dialog.js';
