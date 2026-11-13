// ── [PCODE-440 | S15 | v0.1.0] T37 Consistency: errors and loading are announced everywhere ──
// ── [PCODE-353 | S15 | v0.1.0] T35.4a System health page with backup, restore and upgrade wizards ──
// ── [PCODE-352 | S15 | v0.1.0] T35.3c Policies for approvals, budgets and data, with a dry run ──
// ── [PCODE-350 | S15 | v0.1.0] T35.3a Templates library for projects, PRDs, sprints and agents ──
// ── [PCODE-348 | S15 | v0.1.0] T35.2a Integrations hub; email-in for replies to messages and ideas by email ──
// ── [PCODE-242 | S15 | v0.1.0] T24.3 AI providers and file reading in the web app ──
// ── [PCODE-213 | S15 | v0.1.0] T19.2 SCIM 2.0 provisioning (users, role groups, suspend on deactivate) and identity settings (SAML, SCIM tokens) ──
// ── [PCODE-151 | S15 | v0.1.0] Make the web app an installable PWA with Web Push ──
// ── [PCODE-113 | S15 | v0.1.0] Rebuild the web app shell: sidebar, top bar, page layout, design refresh ──
// ── [PCODE-119 | S15 | v0.1.0] Add workspace lifecycle templates with an editor ──
// ── [PCODE-149 | S15 | v0.1.0] Bill through Stripe without its SDK: checkout, webhooks, licences ──
// ── [PCODE-122 | S15 | v0.1.0] Show agents in the web app: agents page, ask from a task, live run view, approvals, card badge ──
//    Why:  one place for every setting, split the way people look for them: about me (profile, tokens,
//          appearance) and about the workspace (general, members). Admin sections are shown to admins only.
import type { ReactNode } from 'react';
import type { Me } from './core/api.js';
import { Icon, type IconName } from './core/icons.js';
import type { SettingsSection } from './core/nav.js';
import { Card, PageHeader, ROLE_NAME, follow } from './shell.js';
import type { ThemeChoice } from './core/theme.js';

const SECTIONS: {
  id: SettingsSection;
  label: string;
  icon: IconName;
  admin?: boolean;
  group: string;
}[] = [
  { id: 'profile', label: 'Profile', icon: 'person', group: 'You' },
  { id: 'tokens', label: 'Personal tokens', icon: 'key', group: 'You' },
  // [PCODE-224 | S15 | v0.1.0]
  { id: 'phone', label: 'Phone app', icon: 'phone', group: 'You' },
  { id: 'appearance', label: 'Appearance', icon: 'palette', group: 'You' },
  // [PCODE-151 | S15 | v0.1.0]
  { id: 'notifications', label: 'Notifications', icon: 'bell', group: 'You' },
  { id: 'workspace', label: 'General', icon: 'settings', admin: true, group: 'Workspace' },
  { id: 'members', label: 'Members', icon: 'users', admin: true, group: 'Workspace' },
  // [PCODE-119 | S15 | v0.1.0]
  { id: 'lifecycle', label: 'Lifecycle templates', icon: 'flow', admin: true, group: 'Workspace' },
  // [PCODE-122 | S15 | v0.1.0]
  // [PCODE-242 | S15 | v0.1.0] several connections now
  { id: 'ai', label: 'AI providers', icon: 'agent', admin: true, group: 'Workspace' },
  // [PCODE-149 | S15 | v0.1.0]
  { id: 'billing', label: 'Plan and billing', icon: 'key', admin: true, group: 'Workspace' },
  // [PCODE-213 | S15 | v0.1.0]
  { id: 'identity', label: 'Single sign-on', icon: 'key', admin: true, group: 'Workspace' },
  // [PCODE-348 | S15 | v0.1.0]
  { id: 'integrations', label: 'Integrations', icon: 'flow', admin: true, group: 'Workspace' },
  // [PCODE-350 | S15 | v0.1.0]
  { id: 'library', label: 'Templates library', icon: 'flow', group: 'Workspace' },
  // [PCODE-352 | S15 | v0.1.0]
  { id: 'policies', label: 'Policies', icon: 'key', admin: true, group: 'Workspace' },
  // [PCODE-353 | S15 | v0.1.0] for the owner
  { id: 'system', label: 'System', icon: 'settings', admin: true, group: 'Workspace' },
];

export function SettingsPage(props: {
  section: SettingsSection;
  me: Me;
  workspaceId: string;
  workspaceName: string;
  role: string;
  theme: ThemeChoice;
  onTheme: (t: ThemeChoice) => void;
  go: (p: string) => void;
  /** [PCODE-115] the sections' content */
  content?: Partial<Record<SettingsSection, ReactNode>>;
}): ReactNode {
  const isAdmin = props.role === 'admin' || props.role === 'owner';
  const visible = SECTIONS.filter((s) => !s.admin || isAdmin);
  const section = visible.find((s) => s.id === props.section) ?? visible[0];
  const groups = [...new Set(visible.map((s) => s.group))];
  return (
    <div className="pe-page">
      <PageHeader
        title="Settings"
        subtitle={
          props.me.user.name +
          ' · ' +
          props.workspaceName +
          ' (' +
          (ROLE_NAME[props.role] ?? props.role) +
          ')'
        }
      />
      <div className="pe-settings">
        <nav className="pe-settings-nav" aria-label="Settings">
          {groups.map((g) => (
            <div key={g} className="pe-nav-group">
              <div className="pe-nav-heading">{g}</div>
              {visible
                .filter((s) => s.group === g)
                .map((s) => (
                  <a
                    key={s.id}
                    href={'/settings/' + s.id}
                    className="pe-nav-item"
                    aria-current={s.id === section?.id ? 'page' : undefined}
                    onClick={follow('/settings/' + s.id, props.go)}
                  >
                    <Icon name={s.icon} />
                    <span className="pe-nav-label">{s.label}</span>
                  </a>
                ))}
            </div>
          ))}
        </nav>
        <div className="pe-settings-body">
          {section?.id === 'appearance' ? (
            <Appearance theme={props.theme} onTheme={props.onTheme} />
          ) : (
            (props.content?.[section?.id ?? 'profile'] ?? (
              <Card title={section?.label ?? 'Settings'}>
                <p className="pe-muted" role="status">
                  Loading…
                </p>
              </Card>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function Appearance(props: { theme: ThemeChoice; onTheme: (t: ThemeChoice) => void }): ReactNode {
  const options: [ThemeChoice, string, string, IconName][] = [
    ['system', 'Like the system', 'Follows the setting of your computer.', 'monitor'],
    ['light', 'Light', 'Bright surfaces, for daylight.', 'sun'],
    ['dark', 'Dark', 'Dark surfaces, easy on the eyes at night.', 'moon'],
  ];
  return (
    <Card title="Appearance" subtitle="Kept in this browser.">
      <div className="pe-choice-grid" role="radiogroup" aria-label="Theme">
        {options.map(([value, label, hint, icon]) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={props.theme === value}
            className="pe-choice"
            onClick={() => {
              props.onTheme(value);
            }}
          >
            <Icon name={icon} size={24} />
            <span className="pe-choice-label">{label}</span>
            <span className="pe-small pe-muted">{hint}</span>
          </button>
        ))}
      </div>
    </Card>
  );
}
