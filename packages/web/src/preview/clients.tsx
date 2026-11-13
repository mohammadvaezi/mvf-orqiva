// ── [PCODE-158 | S15 | v0.1.0] D6 preview: Clients and portal, Incidents, Time, web and VS Code side by side ──
//    Why:  the team's side of the clients: every client with health, revenue, open requests, response
//          times and satisfaction; per client the contacts and their portal roles, requests with the
//          internal notes the client never sees, money, and the portal's settings (branding, own domain,
//          what is shared). "View as client" opens the portal exactly as the client sees it.
import { useState, type ReactNode } from 'react';
import { CLIENTS, PROJECTS, euro, person } from './data.js';
import { PIcon, type PIconName } from './picons.js';
import { Avatar, Button, Card, HealthPill, PageHead, Stat } from './ui.js';

function Overview(props: { id: string }): ReactNode {
  const c = CLIENTS.find((x) => x.id === props.id);
  if (!c) return null;
  const contacts: Record<string, [string, string][]> = {
    nwl: [
      ['c-kai', 'Product owner · approver'],
      ['c-kai', 'Tester (UAT)'],
    ],
    hel: [['c-ines', 'Sponsor · approver']],
    aur: [['c-paul', 'Viewer']],
  };
  return (
    <div className="pv-stack">
      <div className="pv-stats">
        <Stat
          label="Revenue this year"
          value={euro(c.revenueYtd)}
          sub="3 invoices open"
          icon="euro"
        />
        <Stat
          label="Open requests"
          value={String(c.openRequests)}
          sub={c.slaBreaches ? String(c.slaBreaches) + ' past response time' : 'all in time'}
          tone={c.slaBreaches ? 'danger' : 'success'}
          icon="request"
        />
        <Stat
          label="Satisfaction"
          value={c.csat.toFixed(1) + ' / 5'}
          sub="last 5 ratings"
          icon="check"
        />
        <Stat label="Portal use" value="last 2 h" sub="12 visits this week" icon="clients" />
      </div>
      <div className="pv-split pv-split--even">
        <Card flush title="Projects">
          <ul className="pv-rows">
            {PROJECTS.filter((p) => p.clientId === c.id).map((p) => (
              <li key={p.key} className="pv-row pv-row--static">
                <span className="pv-mono pv-tile-key">{p.key}</span>
                <span className="pv-row-main">
                  <span className="pv-row-title">{p.name}</span>
                  <span className="pv-row-sub">
                    {p.phase} · {p.milestone.name} {p.milestone.date}
                  </span>
                </span>
                <HealthPill health={p.health} />
              </li>
            ))}
          </ul>
        </Card>
        <Card flush title="Contacts and portal roles">
          <ul className="pv-rows">
            {(contacts[c.id] ?? []).map(([id, role], i) => (
              <li key={id + String(i)} className="pv-row pv-row--static">
                <Avatar id={id} size="sm" />
                <span className="pv-row-main">
                  <span className="pv-row-title">{person(id).name}</span>
                  <span className="pv-row-sub">{role}</span>
                </span>
              </li>
            ))}
            <li className="pv-row pv-row--static">
              <Button size="sm" icon="plus">
                Invite a contact
              </Button>
            </li>
          </ul>
        </Card>
      </div>
    </div>
  );
}

function Requests(): ReactNode {
  return (
    <Card flush title="Requests from Helio · 11 open">
      <ul className="pv-rows">
        {[
          {
            id: 'Q-8',
            t: 'How long are chat messages kept?',
            s: '2 days past response time',
            late: true,
            note: 'Ole: waiting for the DPO answer from our side, draft in Documents.',
          },
          {
            id: 'CR-9',
            t: 'SMS reminders 2 hours before appointments',
            s: 'quoted · waiting for Helio',
            late: false,
            note: 'Jonas: SMS provider cost not included, check with Mara before they sign.',
          },
          {
            id: 'BUG-31',
            t: 'Calendar shows UTC instead of local time',
            s: 'in progress · HEL-231',
            late: false,
            note: '',
          },
        ].map((r) => (
          <li key={r.id} className="pv-row pv-row--static pv-row--top">
            <span className="pv-mono pv-muted">{r.id}</span>
            <span className="pv-row-main">
              <span className="pv-row-title">{r.t}</span>
              <span className={'pv-row-sub' + (r.late ? ' pv-text-danger' : '')}>{r.s}</span>
              {r.note ? (
                <span className="pv-internal">
                  <PIcon name="lock" size={12} /> Internal: {r.note}
                </span>
              ) : null}
            </span>
            <Button size="sm">Answer</Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function PortalSettings(): ReactNode {
  const [shared, setShared] = useState<Record<string, boolean>>({
    'Roadmap and milestones': true,
    'Sprint progress (summary)': true,
    'Tasks they asked for': true,
    'Test runs (their acceptance tests)': true,
    'Release notes for clients': true,
    'Budget and invoices': true,
    'AI cost as a separate line': true,
    'Agent activity and traces': false,
    'Internal comments': false,
    'Other clients': false,
  });
  return (
    <div className="pv-split pv-split--even">
      <Card title="Branding">
        <div className="pv-kv pv-kv--wide">
          <span>Logo</span>
          <span>Helio logo (SVG)</span>
          <span>Colours</span>
          <span className="pv-who">
            <svg width="18" height="18" aria-hidden="true">
              <rect width="18" height="18" rx="4" fill="#0E7C86" />
            </svg>
            #0E7C86 from the Helio UI kit
          </span>
          <span>Address</span>
          <span className="pv-mono pv-small">projects.helio-health.de (own domain, TLS ok)</span>
          <span>Language</span>
          <span>German, English for the IT team</span>
          <span>Sign-in</span>
          <span>e-mail link with a second factor · Helio’s own SSO possible</span>
          <span>E-mails</span>
          <span>one daily digest instead of single mails</span>
        </div>
      </Card>
      <Card title="What Helio sees">
        <ul className="pv-rows pv-rows--tight">
          {Object.entries(shared).map(([k, v]) => (
            <li key={k} className="pv-row pv-row--static">
              <span className="pv-row-main">
                <span className="pv-row-title">{k}</span>
              </span>
              <label className="pv-switch">
                <input
                  type="checkbox"
                  checked={v}
                  disabled={k === 'Other clients' || k === 'Internal comments'}
                  onChange={(e) => {
                    setShared((s) => ({ ...s, [k]: e.target.checked }));
                  }}
                />
                <span>{v ? 'shown' : 'hidden'}</span>
              </label>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

const TABS: { key: string; label: string; icon: PIconName }[] = [
  { key: 'overview', label: 'Overview', icon: 'overview' },
  { key: 'requests', label: 'Requests', icon: 'request' },
  { key: 'portal', label: 'Portal settings', icon: 'settings' },
];

export function ClientsPage(props: { onViewAsClient: () => void }): ReactNode {
  const [sel, setSel] = useState('hel');
  const [tab, setTab] = useState('overview');
  const c = CLIENTS.find((x) => x.id === sel);
  return (
    <div className="pv-page">
      <PageHead
        title="Clients"
        sub="3 clients · €552 600 revenue this year · 20 open requests"
        icon="clients"
        actions={
          <Button kind="primary" icon="plus">
            New client
          </Button>
        }
      />
      <Card flush>
        <table className="pv-table">
          <thead>
            <tr>
              <th>Client</th>
              <th>Health</th>
              <th>Account owner</th>
              <th className="pv-num">Open requests</th>
              <th className="pv-num">Past response time</th>
              <th className="pv-num">Satisfaction</th>
              <th className="pv-num">Revenue this year</th>
            </tr>
          </thead>
          <tbody>
            {CLIENTS.map((x) => (
              <tr
                key={x.id}
                className={'pv-click-row' + (x.id === sel ? ' pv-row-sel' : '')}
                onClick={() => {
                  setSel(x.id);
                }}
              >
                <td className="pv-cell-strong">{x.name}</td>
                <td>
                  <HealthPill health={x.health} />
                </td>
                <td>
                  <span className="pv-who">
                    <Avatar id={x.owner} size="xs" />
                    {person(x.owner).name}
                  </span>
                </td>
                <td className="pv-num">{x.openRequests}</td>
                <td className={'pv-num ' + (x.slaBreaches ? 'pv-text-danger' : '')}>
                  {x.slaBreaches}
                </td>
                <td className="pv-num">{x.csat.toFixed(1)}</td>
                <td className="pv-num">{euro(x.revenueYtd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      {c ? (
        <div className="pv-stack pv-mt">
          <div className="pv-toolbar">
            <h2 className="pv-client-h">{c.name}</h2>
            <nav className="pv-subtabs" aria-label="Client">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  className="pv-subtab"
                  aria-pressed={tab === t.key}
                  onClick={() => {
                    setTab(t.key);
                  }}
                >
                  <PIcon name={t.icon} size={14} />
                  {t.label}
                </button>
              ))}
            </nav>
            <span className="pv-spacer" />
            <Button icon="user" onClick={props.onViewAsClient}>
              View as client
            </Button>
          </div>
          {tab === 'overview' ? <Overview id={c.id} /> : null}
          {tab === 'requests' ? <Requests /> : null}
          {tab === 'portal' ? <PortalSettings /> : null}
        </div>
      ) : null}
    </div>
  );
}
