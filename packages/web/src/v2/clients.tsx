// ── [PCODE-436 | S15 | v0.1.0] T37 low: Untangle the three folder import cycles ──
// ── [PCODE-420 | S15 | v0.1.0] T37 medium: English screens use English number and date formats ──
// ── [PCODE-341 | S15 | v0.1.0] T34.2b Public status pages per client and environment; incident update templates ──
// ── [PCODE-339 | S15 | v0.1.0] T34.1d Portal magic-link sign-in and passwordless invitations, MFA required per client ──
// ── [PCODE-338 | S15 | v0.1.0] T34.1c Meeting notes and actions into tasks; the team's client overview with health, revenue, activity and people ──
// ── [PCODE-337 | S15 | v0.1.0] T34.1b Request votes and duplicate merge, NPS survey, embeddable feedback widget ──
// ── [PCODE-191 | S15 | v0.1.0] B7.6 Client status page with uptime probes, own portal domains with DNS verification and on-demand TLS ──
// ── [PCODE-189 | S15 | v0.1.0] B7.5 Portal budget and invoices with PDF, quotes, meeting booking with agenda and calendar file ──
// ── [PCODE-186 | S15 | v0.1.0] B7.2 Client portal live: roadmap, acceptance tests, approvals, releases with ratings, shared documents ──
// ── [PCODE-185 | S15 | v0.1.0] B7.1 Client requests live: portal requests, threads with internal notes, response times, change requests with impact and signature, ratings ──
// ── [PCODE-164 | S15 | v0.1.0] B1.3 The v2 shell live in the web app: Home per role, Inbox, Clients, portal mode, settings ──
//    Why:  the team's side of the client portal on the server: the clients with their own portal domains,
//          what each client sees (shares), which projects belong to them and who their contacts are. A new
//          contact without an account gets an invitation link to pass on. Admins change; others read.
import { ClientVoice } from './clientvoice.js'; // [PCODE-337 | S15 | v0.1.0]
import { StatusPageSettings } from './statuspage.js'; // [PCODE-341 | S15 | v0.1.0]
// [PCODE-338 | S15 | v0.1.0]
import {
  ClientMeetings,
  ClientOverview,
  HEALTH_TEXT,
  HEALTH_TONE,
  type ClientHealth,
} from './clientwork.js';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api } from '../core/api.js';
import type { EventHub } from '../core/hub.js';
import { PIcon } from '../preview/picons.js';
import { Button, Card, Chip, PageHead, Stat } from '../preview/ui.js';
import type { Project } from '../core/types.js';
import { euroCents } from './shell.js';
import { fmtLocale } from '../core/locale.js'; // [PCODE-420 | S15 | v0.1.0]

export interface LiveClient {
  id: string;
  name: string;
  shortName: string;
  ownerName: string | null;
  portalDomain: string | null;
  domainVerified: boolean;
  language: string;
  shares: Record<string, boolean>;
  projects: { id: string; key: string; name: string }[];
  contacts: number;
  // [PCODE-185 | S15 | v0.1.0] requests, response times, satisfaction, portal use
  openRequests: number;
  lateRequests: number;
  satisfaction: number | null;
  lastPortalVisit: string | null;
  responseHours: Record<string, number>;
  requireMfa?: boolean; // [PCODE-339 | S15 | v0.1.0]
  statusPublic?: boolean; // [PCODE-341 | S15 | v0.1.0]
  statusSlug?: string | null;
}

interface Contact {
  userId: string;
  name: string;
  email: string;
  portalRoles: string[];
}

export const SHARE_LABELS: Record<string, string> = {
  roadmap: 'Roadmap',
  sprint_summary: 'Sprint summary',
  requested_tasks: 'Their requested tasks',
  acceptance_tests: 'Acceptance tests',
  release_notes: 'Release notes',
  budget: 'Budget',
  ai_cost_line: 'AI cost line',
};

const PORTAL_ROLES: [string, string][] = [
  ['sponsor', 'Sponsor'],
  ['approver', 'Approver'],
  ['product_owner', 'Product owner'],
  ['tester', 'Tester'],
  ['requester', 'Requester'],
  ['viewer', 'Viewer'],
];

export function ClientsV2(props: {
  workspaceId: string;
  role: string;
  hub: EventHub;
  go: (p: string) => void;
}): ReactNode {
  const W = '/api/workspaces/' + props.workspaceId;
  const admin = props.role === 'admin' || props.role === 'owner';
  const [clients, setClients] = useState<LiveClient[] | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  // [PCODE-338 | S15 | v0.1.0] health and revenue per client
  const [glance, setGlance] = useState<
    Record<string, { health: ClientHealth; paid12mCents: number | null; openCents: number | null }>
  >({});

  const load = useCallback(async () => {
    const [c, p, g] = await Promise.all([
      api<LiveClient[]>('GET', W + '/clients'),
      api<Project[]>('GET', W + '/projects'),
      api<
        {
          clientId: string;
          health: ClientHealth;
          paid12mCents: number | null;
          openCents: number | null;
        }[]
      >('GET', W + '/clients-overview'),
    ]);
    if (g.ok) setGlance(Object.fromEntries(g.data.map((x) => [x.clientId, x])));
    if (c.ok) setClients(c.data);
    else setError(c.error.message);
    if (p.ok) setProjects(p.data.filter((x) => !x.archived));
  }, [W]);
  useEffect(() => {
    void load();
    return props.hub.on(() => void load());
  }, [load, props.hub]);

  const current = clients?.find((c) => c.id === selected) ?? clients?.[0] ?? null;
  return (
    <div className="pv-page">
      <PageHead
        title="Clients"
        sub={
          clients
            ? String(clients.length) +
              (clients.length === 1 ? ' client' : ' clients') +
              ' · each with its own portal'
            : 'Loading…'
        }
        icon="clients"
        actions={
          admin ? (
            <Button
              kind="primary"
              icon="plus"
              onClick={() => {
                setAdding(true);
              }}
            >
              New client
            </Button>
          ) : null
        }
      />
      {error ? (
        <p className="v2-error" role="alert">
          {error}
        </p>
      ) : null}
      {adding ? (
        <NewClient
          base={W}
          onDone={(id) => {
            setAdding(false);
            if (id) setSelected(id);
            void load();
          }}
        />
      ) : null}
      {clients && !clients.length && !adding ? (
        <Card>
          <div className="pv-empty">
            <PIcon name="clients" size={28} />
            <strong>No clients yet.</strong>
            <span>
              A client gets its own portal: the projects you assign, what you decide to share, and
              their contacts.
            </span>
          </div>
        </Card>
      ) : null}
      {clients && current ? (
        <div className="pv-grid v2-split">
          <Card title="All clients" flush>
            <ul className="pv-rows">
              {clients.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    className="pv-row v2-row-btn"
                    aria-current={c.id === current.id ? 'true' : undefined}
                    onClick={() => {
                      setSelected(c.id);
                    }}
                  >
                    <span className="pv-kind">
                      <PIcon name="clients" size={15} />
                    </span>
                    <span className="pv-row-main">
                      <span className="pv-row-title">
                        {c.name}{' '}
                        {glance[c.id] ? (
                          <Chip tone={HEALTH_TONE[glance[c.id]?.health ?? 'on-track']}>
                            {HEALTH_TEXT[glance[c.id]?.health ?? 'on-track']}
                          </Chip>
                        ) : null}
                      </span>
                      {glance[c.id]?.paid12mCents != null ? (
                        <span className="pv-row-sub">
                          {euroCents(glance[c.id]?.paid12mCents ?? 0, 0)} in 12 months
                          {glance[c.id]?.openCents
                            ? ' · ' + euroCents(glance[c.id]?.openCents ?? 0, 0) + ' open'
                            : ''}
                        </span>
                      ) : null}
                      <span className="pv-row-sub">
                        {c.projects.map((p) => p.key).join(', ') || 'no project'} · {c.contacts}{' '}
                        {c.contacts === 1 ? 'contact' : 'contacts'}
                      </span>
                      {/* [PCODE-185 | S15 | v0.1.0] open and late requests at a glance */}
                      {c.openRequests ? (
                        <span className={'pv-row-sub' + (c.lateRequests ? ' pv-text-danger' : '')}>
                          {c.openRequests} open {c.openRequests === 1 ? 'request' : 'requests'}
                          {c.lateRequests
                            ? ' · ' + String(c.lateRequests) + ' past response time'
                            : ''}
                        </span>
                      ) : null}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </Card>
          <ClientDetail
            key={current.id}
            base={W}
            client={current}
            admin={admin}
            projects={projects}
            go={props.go}
            onChanged={() => void load()}
            onError={setError}
          />
        </div>
      ) : null}
    </div>
  );
}

function NewClient(props: { base: string; onDone: (id: string | null) => void }): ReactNode {
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  const [language, setLanguage] = useState('de');
  const [error, setError] = useState('');
  const save = async (): Promise<void> => {
    const body: Record<string, string> = { name: name.trim(), language };
    if (domain.trim()) body['portalDomain'] = domain.trim();
    const r = await api<LiveClient>('POST', props.base + '/clients', body);
    if (r.ok) props.onDone(r.data.id);
    else setError(r.error.message);
  };
  return (
    <Card title="New client">
      <div className="v2-form">
        <label className="v2-field">
          <span>Name</span>
          <input
            className="v2-input"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
            }}
            placeholder="Helio Health AG"
          />
        </label>
        <label className="v2-field">
          <span>Portal domain</span>
          <input
            className="v2-input"
            value={domain}
            onChange={(e) => {
              setDomain(e.target.value);
            }}
            placeholder="projects.example.com"
          />
        </label>
        <label className="v2-field">
          <span>Language</span>
          <select
            className="v2-input"
            value={language}
            onChange={(e) => {
              setLanguage(e.target.value);
            }}
          >
            <option value="de">German</option>
            <option value="en">English</option>
          </select>
        </label>
        {error ? (
          <p className="v2-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="v2-actions">
          <Button kind="primary" icon="check" disabled={!name.trim()} onClick={() => void save()}>
            Create client
          </Button>
          <Button
            kind="ghost"
            onClick={() => {
              props.onDone(null);
            }}
          >
            Cancel
          </Button>
        </div>
      </div>
    </Card>
  );
}

function ClientDetail(props: {
  base: string;
  client: LiveClient;
  admin: boolean;
  projects: Project[];
  go: (p: string) => void; // [PCODE-185 | S15 | v0.1.0]
  onChanged: () => void;
  onError: (m: string) => void;
}): ReactNode {
  const c = props.client;
  const [contacts, setContacts] = useState<Contact[] | null>(null);
  const [email, setEmail] = useState('');
  const [portalRole, setPortalRole] = useState('approver');
  const [link, setLink] = useState('');
  const [domain, setDomain] = useState(c.portalDomain ?? '');
  const loadContacts = useCallback(async () => {
    const r = await api<Contact[]>('GET', props.base + '/clients/' + c.id + '/contacts');
    if (r.ok) setContacts(r.data);
  }, [props.base, c.id]);
  useEffect(() => {
    void loadContacts();
  }, [loadContacts]);

  const patch = async (body: Record<string, unknown>): Promise<void> => {
    const r = await api('PATCH', props.base + '/clients/' + c.id, body);
    if (r.ok) props.onChanged();
    else props.onError(r.error.message);
  };
  const assign = async (projectId: string, clientId: string | null): Promise<void> => {
    const r = await api('PUT', props.base + '/projects/' + projectId + '/client', { clientId });
    if (r.ok) props.onChanged();
    else props.onError(r.error.message);
  };
  const invite = async (): Promise<void> => {
    const r = await api<{ contact: Contact | null; invitation: { token: string } | null }>(
      'POST',
      props.base + '/clients/' + c.id + '/contacts',
      {
        email: email.trim(),
        portalRole,
      },
    );
    if (!r.ok) {
      props.onError(r.error.message);
      return;
    }
    setEmail('');
    setLink(r.data.invitation ? window.location.origin + '/invite/' + r.data.invitation.token : '');
    await loadContacts();
    props.onChanged();
  };
  const remove = async (userId: string): Promise<void> => {
    const r = await api('DELETE', props.base + '/clients/' + c.id + '/contacts/' + userId);
    if (r.ok) {
      await loadContacts();
      props.onChanged();
    } else props.onError(r.error.message);
  };
  const free = props.projects.filter((p) => !c.projects.some((x) => x.id === p.id));

  return (
    <div className="pv-stack">
      {/* [PCODE-338 | S15 | v0.1.0] health, revenue, activity and people */}
      <ClientOverview base={props.base} clientId={c.id} />
      <Card
        title={c.name}
        action={
          c.portalDomain ? (
            <Chip tone={c.domainVerified ? 'success' : 'warning'} mono>
              {c.portalDomain}
            </Chip>
          ) : (
            <Chip>No portal domain</Chip>
          )
        }
      >
        <div className="pv-kv">
          <span>Language</span>
          <span>{c.language === 'de' ? 'German' : 'English'}</span>
          <span>Owner on our side</span>
          <span>{c.ownerName ?? '—'}</span>
          <span>Portal domain</span>
          <span>
            {props.admin ? (
              <span className="v2-inline">
                <input
                  className="v2-input"
                  value={domain}
                  onChange={(e) => {
                    setDomain(e.target.value);
                  }}
                  placeholder="projects.example.com"
                  aria-label="Portal domain"
                />
                <Button
                  size="sm"
                  onClick={() => void patch({ portalDomain: domain.trim() || null })}
                >
                  Save
                </Button>
              </span>
            ) : (
              (c.portalDomain ?? '—')
            )}
            {c.portalDomain && !c.domainVerified ? (
              <span className="pv-small pv-muted">
                {' '}
                · add the DNS record under Own portal domain to verify it
              </span>
            ) : null}
          </span>
        </div>
      </Card>
      <ClientRequests
        client={c}
        admin={props.admin}
        base={props.base}
        go={props.go}
        onChanged={props.onChanged}
        onError={props.onError}
      />
      {/* [PCODE-338 | S15 | v0.1.0] meetings with their notes and action items */}
      <ClientMeetings
        base={props.base}
        clientId={c.id}
        projects={c.projects.map((p) => ({ id: p.id, key: p.key }))}
        go={props.go}
      />
      {/* [PCODE-337 | S15 | v0.1.0] the recommendation score and the feedback widgets */}
      <ClientVoice base={props.base} clientId={c.id} admin={props.admin} />
      <ClientMoney base={props.base} clientId={c.id} onError={props.onError} />
      <ClientStatus base={props.base} client={c} admin={props.admin} onError={props.onError} />{' '}
      {/* [PCODE-191 | S15 | v0.1.0] */} {/* [PCODE-189 | S15 | v0.1.0] */}
      {/* [PCODE-339 | S15 | v0.1.0] contacts sign in with a second factor */}
      {props.admin ? (
        <Card title="Sign-in of the client’s contacts">
          <label className="v2-check">
            <input
              type="checkbox"
              checked={c.requireMfa ?? false}
              onChange={(e) => {
                void api('PATCH', props.base + '/clients/' + c.id, {
                  requireMfa: e.target.checked,
                }).then((r) => {
                  if (r.ok) props.onChanged();
                  else props.onError(r.error.message);
                });
              }}
            />
            Contacts must use a second factor (an authenticator app)
          </label>
          <p className="pv-small pv-muted">
            Contacts may join without a password and sign in with a link by email. With this on,
            they set up the app at their next link sign-in; a password alone no longer signs them
            in.
          </p>
        </Card>
      ) : null}
      <Card title="What the client sees">
        <div className="v2-switches">
          {Object.keys(SHARE_LABELS).map((k) => (
            <label key={k} className="v2-switch">
              <input
                type="checkbox"
                checked={c.shares[k] !== false}
                disabled={!props.admin}
                onChange={(e) => void patch({ shares: { ...c.shares, [k]: e.target.checked } })}
              />
              <span>{SHARE_LABELS[k]}</span>
            </label>
          ))}
        </div>
        <p className="pv-small pv-muted">
          Comments reach the client only when written for the client. Internal notes never do.
        </p>
      </Card>
      <Card title="Projects" flush>
        <ul className="pv-rows">
          {c.projects.map((p) => (
            <li key={p.id} className="pv-row">
              <span className="pv-mono">{p.key}</span>
              <span className="pv-row-main">
                <span className="pv-row-title">{p.name}</span>
              </span>
              {props.admin ? (
                <Button size="sm" kind="ghost" onClick={() => void assign(p.id, null)}>
                  Remove
                </Button>
              ) : null}
            </li>
          ))}
          {!c.projects.length ? (
            <li className="pv-row pv-muted">No project assigned yet.</li>
          ) : null}
        </ul>
        {props.admin && free.length ? (
          <div className="v2-pad">
            <label className="v2-inline">
              <span className="pv-small">Assign</span>
              <select
                className="v2-input"
                value=""
                onChange={(e) => {
                  if (e.target.value) void assign(e.target.value, c.id);
                }}
              >
                <option value="">Choose a project…</option>
                {free.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.key} · {p.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : null}
      </Card>
      <Card title="Contacts" flush>
        <ul className="pv-rows">
          {(contacts ?? []).map((p) => (
            <li key={p.userId} className="pv-row">
              <span className="pv-row-main">
                <span className="pv-row-title">{p.name}</span>
                <span className="pv-row-sub">{p.email}</span>
              </span>
              {p.portalRoles.map((r) => (
                <Chip key={r}>{PORTAL_ROLES.find(([k]) => k === r)?.[1] ?? r}</Chip>
              ))}
              {props.admin ? (
                <Button size="sm" kind="ghost" onClick={() => void remove(p.userId)}>
                  Remove
                </Button>
              ) : null}
            </li>
          ))}
          {contacts && !contacts.length ? (
            <li className="pv-row pv-muted">No contact yet.</li>
          ) : null}
        </ul>
        {props.admin ? (
          <div className="v2-pad v2-inline">
            <input
              className="v2-input"
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
              }}
              placeholder="name@client.example"
              aria-label="E-mail"
            />
            <select
              className="v2-input"
              value={portalRole}
              onChange={(e) => {
                setPortalRole(e.target.value);
              }}
              aria-label="Portal role"
            >
              {PORTAL_ROLES.map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
            <Button
              kind="primary"
              icon="plus"
              disabled={!email.includes('@')}
              onClick={() => void invite()}
            >
              Add contact
            </Button>
          </div>
        ) : null}
        {link ? (
          <div className="v2-pad">
            <p className="pv-small">
              This person has no account yet. Send them this invitation link (valid 14 days):
            </p>
            <code className="pv-code v2-break">{link}</code>
          </div>
        ) : null}
      </Card>
    </div>
  );
}

// ── [PCODE-185 | S15 | v0.1.0] B7.1 Client requests live: portal requests, threads with internal notes, response times, change requests with impact and signature, ratings ──
const KIND_LABELS: [string, string][] = [
  ['bug', 'Bug'],
  ['change', 'Change'],
  ['feature', 'Feature'],
  ['question', 'Question'],
];

/** When a time was, roughly: minutes, hours or days ago. */
export function agoText(iso: string | null, now = new Date()): string {
  if (!iso) return 'never';
  const m = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 60_000));
  if (m < 60) return m <= 1 ? 'just now' : String(m) + ' min ago';
  const h = Math.round(m / 60);
  if (h < 48) return String(h) + ' h ago';
  return String(Math.round(h / 24)) + ' days ago';
}

/** The client's requests at a glance, their satisfaction and portal use, and the promised response times. */
function ClientRequests(props: {
  client: LiveClient;
  admin: boolean;
  base: string;
  go: (p: string) => void;
  onChanged: () => void;
  onError: (m: string) => void;
}): ReactNode {
  const c = props.client;
  const [hours, setHours] = useState<Record<string, string>>(() =>
    Object.fromEntries(KIND_LABELS.map(([k]) => [k, String(c.responseHours[k] ?? '')])),
  );
  const save = async (): Promise<void> => {
    const body = Object.fromEntries(
      KIND_LABELS.map(([k]) => [k, Number((hours[k] ?? '').replace(',', '.'))]),
    );
    const r = await api('PUT', props.base + '/clients/' + c.id + '/response-hours', body);
    if (r.ok) props.onChanged();
    else props.onError(r.error.message);
  };
  return (
    <Card
      title="Requests"
      action={
        <span className="v2-inline">
          {/* [PCODE-186 | S15 | v0.1.0] the portal exactly as the client sees it, read only */}
          <Button
            size="sm"
            icon="user"
            onClick={() => {
              props.go('/portal/roadmap?client=' + c.id);
            }}
          >
            View as client
          </Button>
          <Button
            size="sm"
            icon="request"
            onClick={() => {
              props.go('/requests?client=' + c.id);
            }}
          >
            Open requests
          </Button>
        </span>
      }
    >
      <div className="pv-stats">
        <Stat
          label="Open"
          value={String(c.openRequests)}
          sub={c.lateRequests ? String(c.lateRequests) + ' past response time' : 'all in time'}
          tone={c.lateRequests ? 'danger' : 'success'}
          icon="request"
        />
        <Stat
          label="Satisfaction"
          value={
            c.satisfaction === null ? '—' : c.satisfaction.toFixed(1).replace('.', ',') + ' / 5'
          }
          sub="last 5 ratings"
          icon="check"
        />
        <Stat
          label="Portal use"
          value={agoText(c.lastPortalVisit)}
          sub="last visit"
          icon="clients"
        />
      </div>
      <p className="pv-small pv-muted pv-mt">First answer within, in hours</p>
      <div className="v2-inline">
        {KIND_LABELS.map(([k, l]) => (
          <label key={k} className="v2-field">
            <span>{l}</span>
            <input
              className="v2-input v2-input--sm"
              inputMode="decimal"
              value={hours[k] ?? ''}
              disabled={!props.admin}
              onChange={(e) => {
                setHours((h) => ({ ...h, [k]: e.target.value }));
              }}
            />
          </label>
        ))}
        {props.admin ? (
          <Button size="sm" onClick={() => void save()}>
            Save
          </Button>
        ) : null}
      </div>
    </Card>
  );
}

// ── [PCODE-189 | S15 | v0.1.0] B7.5 Portal budget and invoices with PDF, quotes, meeting booking with agenda and calendar file ──
interface TeamInvoice {
  id: string;
  number: string;
  periodLabel: string;
  grossCents: number;
  state: string;
  overdue: boolean;
  dueOn: string | null;
}

interface TeamMeeting {
  id: string;
  title: string;
  startsAt: string;
  attendees: string[];
}

/** A client's invoices (draft from a month of time, send, mark paid) and the meetings they booked. */
function ClientMoney(props: {
  base: string;
  clientId: string;
  onError: (m: string) => void;
}): ReactNode {
  const [d, setD] = useState<{
    invoices: TeamInvoice[] | null;
    meetings: TeamMeeting[];
    mayBill: boolean;
  } | null>(null);
  const [month, setMonth] = useState(() => {
    const x = new Date();
    x.setUTCDate(1);
    x.setUTCMonth(x.getUTCMonth() - 1);
    return x.toISOString().slice(0, 7);
  });
  const C = props.base + '/clients/' + props.clientId;
  const load = useCallback(async () => {
    const r = await api<{
      invoices: TeamInvoice[] | null;
      meetings: TeamMeeting[];
      mayBill: boolean;
    }>('GET', C + '/invoices');
    if (r.ok) setD(r.data);
  }, [C]);
  useEffect(() => {
    void load();
  }, [load]);
  const act = async (
    method: 'POST' | 'PATCH',
    path: string,
    body: Record<string, unknown>,
  ): Promise<void> => {
    const r = await api(method, path, body);
    if (!r.ok) props.onError(r.error.message);
    await load();
  };
  if (!d) return null;
  return (
    <>
      {d.invoices ? (
        <Card flush title="Invoices">
          {d.invoices.length ? (
            <table className="pv-table">
              <tbody>
                {d.invoices.map((i) => (
                  <tr key={i.id}>
                    <td className="pv-mono v2-nowrap">{i.number}</td>
                    <td className="pv-cell-grow">{i.periodLabel || 'Invoice'}</td>
                    <td className="pv-num">{euroCents(i.grossCents)}</td>
                    <td>
                      <Chip
                        tone={
                          i.state === 'paid'
                            ? 'success'
                            : i.overdue
                              ? 'danger'
                              : i.state === 'sent'
                                ? 'warning'
                                : 'neutral'
                        }
                      >
                        {i.overdue ? 'overdue' : i.state}
                      </Chip>
                    </td>
                    <td>
                      <span className="v2-inline">
                        <a
                          className="pv-btn pv-btn--ghost pv-btn--sm"
                          href={props.base + '/invoices/' + i.id + '/pdf'}
                          target="_blank"
                          rel="noreferrer"
                        >
                          PDF
                        </a>
                        {d.mayBill && i.state === 'draft' ? (
                          <Button
                            size="sm"
                            kind="primary"
                            onClick={() =>
                              void act('PATCH', props.base + '/invoices/' + i.id, { state: 'sent' })
                            }
                          >
                            Send
                          </Button>
                        ) : null}
                        {d.mayBill && i.state === 'sent' ? (
                          <Button
                            size="sm"
                            onClick={() =>
                              void act('PATCH', props.base + '/invoices/' + i.id, { state: 'paid' })
                            }
                          >
                            Paid
                          </Button>
                        ) : null}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="pv-muted pv-small pv-pad">No invoices yet.</p>
          )}
          {d.mayBill ? (
            <div className="v2-inline pv-pad">
              <input
                type="month"
                className="v2-input v2-input--sm"
                aria-label="Month"
                value={month}
                onChange={(e) => {
                  if (e.target.value) setMonth(e.target.value);
                }}
              />
              <Button
                size="sm"
                onClick={() => void act('POST', C + '/invoices/from-time', { month })}
              >
                Draft from approved time
              </Button>
              <span className="pv-muted pv-small">
                Sent invoices appear in the client’s portal.
              </span>
            </div>
          ) : null}
        </Card>
      ) : null}
      <Card flush title="Meetings booked by the client">
        {d.meetings.length ? (
          <ul className="pv-rows">
            {d.meetings.map((m) => (
              <li key={m.id} className="pv-row pv-row--static">
                <span className="pv-row-main">
                  <span className="pv-row-title">{m.title}</span>
                  <span className="pv-row-sub">
                    {new Date(m.startsAt).toLocaleString(fmtLocale(), {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}{' '}
                    · {m.attendees.join(', ')}
                  </span>
                </span>
                <a
                  className="pv-btn pv-btn--ghost pv-btn--sm"
                  href={props.base + '/meetings/' + m.id + '/ics'}
                >
                  Calendar
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p className="pv-muted pv-small pv-pad">No meetings coming up.</p>
        )}
      </Card>
    </>
  );
}

// ── [PCODE-191 | S15 | v0.1.0] B7.6 Client status page with uptime probes, own portal domains with DNS verification and on-demand TLS ──
interface DomainInfo {
  domain: string | null;
  verified: boolean;
  record: { type: string; name: string; value: string } | null;
}

interface Component {
  id: string;
  name: string;
  environment: string | null;
  probeUrl: string | null;
  lastCheck: { ok: boolean; latencyMs: number | null; at: string } | null;
}

/** The portal domain's proof (a DNS TXT record) and the components on the client's status page. */
function ClientStatus(props: {
  base: string;
  client: LiveClient;
  admin: boolean;
  onError: (m: string) => void;
}): ReactNode {
  const c = props.client;
  const C = props.base + '/clients/' + c.id;
  const [dom, setDom] = useState<DomainInfo | null>(null);
  const [msg, setMsg] = useState('');
  const [comps, setComps] = useState<Component[]>([]);
  const [envs, setEnvs] = useState<{ id: string; name: string; key: string }[]>([]);
  const [form, setForm] = useState({ name: '', probeUrl: '', environmentId: '' });
  const load = useCallback(async () => {
    const r = await api<{ components: Component[] }>('GET', C + '/status-components');
    if (r.ok) setComps(r.data.components);
    if (props.admin) {
      const d = await api<DomainInfo>('GET', C + '/domain');
      if (d.ok) setDom(d.data);
    }
  }, [C, props.admin]);
  useEffect(() => {
    void load();
    void Promise.all(
      c.projects.map((p) =>
        api<{ id: string; name: string; key: string }[]>(
          'GET',
          props.base + '/projects/' + p.id + '/environments',
        ),
      ),
    ).then((rs) => {
      setEnvs(rs.flatMap((r) => (r.ok ? r.data : [])));
    });
  }, [load, c.projects, props.base]);
  const verify = async (): Promise<void> => {
    const r = await api<{ verified: boolean; message: string }>('POST', C + '/domain/verify', {});
    if (r.ok) setMsg(r.data.message);
    else props.onError(r.error.message);
    await load();
  };
  const add = async (): Promise<void> => {
    const r = await api('POST', C + '/status-components', {
      name: form.name.trim(),
      ...(form.probeUrl.trim() ? { probeUrl: form.probeUrl.trim() } : {}),
      ...(form.environmentId ? { environmentId: form.environmentId } : {}),
    });
    if (!r.ok) props.onError(r.error.message);
    else setForm({ name: '', probeUrl: '', environmentId: '' });
    await load();
  };
  return (
    <>
      {props.admin && dom?.record ? (
        <Card title="Own portal domain">
          <div className="pv-kv pv-kv--wide">
            <span>Domain</span>
            <span className="pv-mono">
              {dom.domain}{' '}
              {dom.verified ? (
                <Chip tone="success">verified · certificate on first visit</Chip>
              ) : (
                <Chip tone="warning">not verified</Chip>
              )}
            </span>
            {!dom.verified ? (
              <>
                <span>DNS record</span>
                <span className="pv-mono pv-small">
                  {dom.record.type} {dom.record.name} → {dom.record.value}
                </span>
              </>
            ) : null}
          </div>
          {!dom.verified ? (
            <div className="v2-inline pv-mt">
              <Button size="sm" onClick={() => void verify()}>
                Verify now
              </Button>
              <span className="pv-muted pv-small">
                {msg ||
                  'The client (or their IT) adds this record at their DNS provider; then verify.'}
              </span>
            </div>
          ) : null}
        </Card>
      ) : null}
      <Card flush title="Status page">
        {comps.length ? (
          <ul className="pv-rows">
            {comps.map((x) => (
              <li key={x.id} className="pv-row pv-row--static">
                <span className="pv-row-main">
                  <span className="pv-row-title">{x.name}</span>
                  <span className="pv-row-sub">
                    {x.environment ? x.environment + ' · ' : ''}
                    {x.probeUrl ?? 'not probed'}
                    {x.lastCheck
                      ? ' · ' +
                        (x.lastCheck.ok ? 'up' : 'down') +
                        (x.lastCheck.latencyMs !== null
                          ? ', ' + String(x.lastCheck.latencyMs) + ' ms'
                          : '')
                      : ''}
                  </span>
                </span>
                {props.admin ? (
                  <Button
                    size="sm"
                    kind="ghost"
                    onClick={() =>
                      void api('DELETE', props.base + '/status-components/' + x.id).then(() =>
                        load(),
                      )
                    }
                  >
                    Remove
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="pv-muted pv-small pv-pad">
            No components yet: the client’s Status page is empty.
          </p>
        )}
        {props.admin ? (
          <div className="v2-inline pv-pad">
            <input
              className="v2-input v2-input--sm"
              placeholder="e.g. Production app"
              aria-label="Component name"
              value={form.name}
              onChange={(e) => {
                setForm({ ...form, name: e.target.value });
              }}
            />
            <input
              className="v2-input v2-input--sm"
              placeholder="https://… to probe (optional)"
              aria-label="Address to probe"
              value={form.probeUrl}
              onChange={(e) => {
                setForm({ ...form, probeUrl: e.target.value });
              }}
            />
            <select
              className="v2-input v2-input--sm"
              aria-label="Environment"
              value={form.environmentId}
              onChange={(e) => {
                setForm({ ...form, environmentId: e.target.value });
              }}
            >
              <option value="">No environment</option>
              {envs.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
            <Button size="sm" disabled={!form.name.trim()} onClick={() => void add()}>
              Add
            </Button>
          </div>
        ) : null}
        {/* [PCODE-341 | S15 | v0.1.0] the page open to everyone */}
        {props.admin ? (
          <div className="pv-pad">
            <StatusPageSettings
              base={props.base}
              clientId={c.id}
              isPublic={c.statusPublic ?? false}
              slug={c.statusSlug ?? null}
              onError={props.onError}
            />
          </div>
        ) : null}
      </Card>
    </>
  );
}
