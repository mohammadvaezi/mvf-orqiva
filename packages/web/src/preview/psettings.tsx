// ── [PCODE-157 | S15 | v0.1.0] D5 preview: Agents, People, Tokens and costs, Activity, Insights, Settings ──
//    Why:  Settings in one place, with inheritance made visible: a value set for the workspace can be
//          overridden for a team, a project or a person, and the screen says where a value comes from.
//          Integrations, policies (tried with a dry run before they apply), notification rules, templates
//          and the health of the server itself live here too.
import { useState, type ReactNode } from 'react';
import { INTEGRATIONS } from './data5.js';
import { PIcon, type PIconName } from './picons.js';
import { Button, Card, Chip, PageHead } from './ui.js';

function Workspace(): ReactNode {
  return (
    <Card title="Workspace">
      <div className="pv-settings-rows">
        {[
          ['Name', 'Broszio Engineering', 'workspace'],
          [
            'Language',
            'English · German for Nordwind and Helio users',
            'workspace, overridden per person',
          ],
          ['Currency', 'Euro (EUR)', 'workspace'],
          [
            'Working days',
            'Mon–Fri, 08:00–18:00 Europe/Berlin',
            'workspace · team Mobile: Mon–Thu',
          ],
          ['Sprint length', '2 weeks', 'workspace · project PE: 1 week'],
          [
            'Definition of done',
            'criteria met, review approved, tests green, docs updated',
            'workspace',
          ],
        ].map(([k, v, from]) => (
          <div key={k} className="pv-setting">
            <span className="pv-setting-k">{k}</span>
            <span className="pv-setting-v">{v}</span>
            <Chip
              tone={
                String(from).includes('overridden') || String(from).includes('·')
                  ? 'warning'
                  : 'neutral'
              }
            >
              {from}
            </Chip>
          </div>
        ))}
      </div>
    </Card>
  );
}

function Integrations(): ReactNode {
  return (
    <div className="pv-integrations">
      {INTEGRATIONS.map((i) => (
        <div key={i.name} className="pv-integration">
          <div className="pv-integration-head">
            <strong>{i.name}</strong>
            <Chip
              tone={
                i.state === 'connected'
                  ? 'success'
                  : i.state === 'test mode'
                    ? 'warning'
                    : 'neutral'
              }
            >
              {i.state}
            </Chip>
          </div>
          <span className="pv-muted pv-small">{i.what}</span>
          <Button size="sm" kind={i.state === 'not connected' ? 'primary' : 'ghost'}>
            {i.state === 'not connected' ? 'Connect' : 'Settings'}
          </Button>
        </div>
      ))}
      <div className="pv-integration pv-integration--api">
        <strong>API, webhooks and MCP</strong>
        <span className="pv-muted pv-small">
          REST API, signed webhooks with retries, the MCP server for agents and IDEs, CLI pe
        </span>
        <Button size="sm" kind="ghost">
          Open API docs
        </Button>
      </div>
    </div>
  );
}

function Policies(): ReactNode {
  const [dry, setDry] = useState(false);
  return (
    <Card
      title="Policies"
      action={
        <Button size="sm" icon="plus">
          New policy
        </Button>
      }
    >
      <ul className="pv-rows">
        {[
          ['Deploys to production need a second person', 'all projects', true],
          ['Agents may not merge', 'all projects', true],
          ['Client-visible comments need a team member’s review', 'NWL, HEL', true],
          ['Stop all agent runs above the workspace budget', 'workspace', true],
          ['Tasks without acceptance criteria cannot enter a sprint', 'all projects', false],
        ].map(([r, s, on]) => (
          <li key={String(r)} className="pv-row pv-row--static">
            <span className="pv-row-main">
              <span className="pv-row-title">{r}</span>
              <span className="pv-row-sub">{s}</span>
            </span>
            <Chip tone={on ? 'success' : 'neutral'}>{on ? 'on' : 'draft'}</Chip>
          </li>
        ))}
      </ul>
      <div className="pv-page-actions pv-mt">
        <Button
          onClick={() => {
            setDry(true);
          }}
        >
          Dry run the draft policy
        </Button>
      </div>
      {dry ? (
        <div className="pv-callout pv-callout--agent pv-mt">
          <PIcon name="check" size={16} />
          <div>
            Over the last 30 days this policy would have stopped <strong>2 stories</strong> from
            entering a sprint (NWL-201, HEL-230). No running sprint changes when you turn it on.
          </div>
        </div>
      ) : null}
    </Card>
  );
}

function Notifications(): ReactNode {
  const events = [
    'An agent waits for me',
    'A gate is ready to sign',
    'A deploy failed',
    'I am mentioned',
    'A client request arrives',
    'An incident starts',
    'A daily digest',
  ];
  const channels = ['In app', 'E-mail', 'Phone', 'Slack', 'VS Code'];
  const def = [
    [1, 0, 1, 1, 1],
    [1, 1, 1, 0, 0],
    [1, 0, 1, 1, 1],
    [1, 0, 1, 0, 1],
    [1, 1, 0, 1, 0],
    [1, 1, 1, 1, 1],
    [0, 1, 0, 0, 0],
  ];
  return (
    <Card
      flush
      title="Notification rules · yours"
      action={<Chip>Quiet hours 20:00–07:30, except incidents</Chip>}
    >
      <table className="pv-table pv-access">
        <thead>
          <tr>
            <th>When</th>
            {channels.map((c) => (
              <th key={c} className="pv-center">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {events.map((e, i) => (
            <tr key={e}>
              <td>{e}</td>
              {channels.map((c, j) => (
                <td key={c} className="pv-access-cell">
                  <input
                    type="checkbox"
                    defaultChecked={Boolean(def[i]?.[j])}
                    aria-label={e + ' by ' + c}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function Health(): ReactNode {
  return (
    <div className="pv-split pv-split--even">
      <Card flush title="System health">
        <table className="pv-table">
          <tbody>
            {[
              ['Server', 'v0.1.0 · 2 nodes · up 12 days', 'healthy'],
              ['Database', 'PostgreSQL 17 · 3.1 GB · replication lag 0 s', 'healthy'],
              ['Event bus', '412 events/min · 0 behind', 'healthy'],
              ['Agent queue', '3 running · 0 queued', 'healthy'],
              ['Runners', '2 of 2 online', 'healthy'],
              ['Model providers', 'Anthropic 120 ms · 61 % of rate limit', 'healthy'],
            ].map(([k, v, s]) => (
              <tr key={k}>
                <td className="pv-cell-strong">{k}</td>
                <td className="pv-cell-grow pv-muted">{v}</td>
                <td>
                  <Chip tone="success">{s}</Chip>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Card title="Backup and upgrade">
        <div className="pv-kv pv-kv--wide">
          <span>Last backup</span>
          <span>today 03:00 · 1.2 GB · verified by a test restore</span>
          <span>Kept</span>
          <span>14 daily, 8 weekly, 12 monthly</span>
          <span>Version</span>
          <span>v0.1.0 · v0.2.0 available after gate A1</span>
        </div>
        <div className="pv-page-actions pv-mt">
          <Button>Back up now</Button>
          <Button kind="ghost">Restore…</Button>
          <Button kind="ghost">Upgrade guide</Button>
        </div>
      </Card>
    </div>
  );
}

const SECTIONS: { key: string; label: string; icon: PIconName }[] = [
  { key: 'workspace', label: 'Workspace', icon: 'settings' },
  { key: 'integrations', label: 'Integrations', icon: 'external' },
  { key: 'policies', label: 'Policies', icon: 'approval' },
  { key: 'notifications', label: 'Notifications', icon: 'bell' },
  { key: 'health', label: 'System health', icon: 'live' },
];

export function SettingsPagePreview(): ReactNode {
  const [s, setS] = useState('workspace');
  return (
    <div className="pv-page">
      <PageHead
        title="Settings"
        sub="Workspace values, with where each one comes from"
        icon="settings"
      />
      <div className="pv-settings-layout">
        <nav className="pv-settings-nav" aria-label="Settings">
          {SECTIONS.map((x) => (
            <button
              key={x.key}
              type="button"
              className="pv-filter"
              aria-pressed={s === x.key}
              onClick={() => {
                setS(x.key);
              }}
            >
              <PIcon name={x.icon} size={16} />
              <span>{x.label}</span>
            </button>
          ))}
          <div className="pv-filter-sep" />
          <span className="pv-muted pv-small pv-pad">
            Also: templates, billing and licence, appearance, your profile and tokens.
          </span>
        </nav>
        <div>
          {s === 'workspace' ? <Workspace /> : null}
          {s === 'integrations' ? <Integrations /> : null}
          {s === 'policies' ? <Policies /> : null}
          {s === 'notifications' ? <Notifications /> : null}
          {s === 'health' ? <Health /> : null}
        </div>
      </div>
    </div>
  );
}
